import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { AsaasPaymentsService } from './asaas-payments.service';
import { AsaasClient, AsaasPayment, AsaasRequestError } from './asaas.client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

describe('Asaas payment lifecycle (real SQLite, mocked gateway)', () => {
    let db: PrismaClient;
    let service: AsaasPaymentsService;
    let client: AsaasClient;
    let directory: string;
    let remote: AsaasPayment;
    let broadcast: jest.Mock;
    const savedEnv = { ...process.env };
    const token = 'sandbox-webhook-test-token-with-32-characters';

    beforeAll(async () => {
        directory = mkdtempSync(resolve(tmpdir(), 'cantina-asaas-test-'));
        const url = `file:${directory}/test.db`;
        writeFileSync(`${directory}/test.db`, '');
        execFileSync(process.execPath, [resolve(__dirname, '../../../../node_modules/prisma/build/index.js'), 'migrate', 'deploy',
            '--schema', resolve(__dirname, '../../prisma/schema.prisma')], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
        db = new PrismaClient({ datasourceUrl: url });
        await db.$connect();
    }, 30_000);

    afterAll(async () => { await db?.$disconnect(); if (directory) rmSync(directory, { recursive: true }); process.env = savedEnv; });

    beforeEach(async () => {
        process.env.ASAAS_ENV = 'sandbox';
        process.env.ASAAS_ACCOUNT_REF = 'test-account';
        process.env.ASAAS_API_KEY_SANDBOX = '$aact_hmlg_test-only';
        process.env.ASAAS_WEBHOOK_TOKEN_SANDBOX = token;
        delete process.env.PAYMENTS_NEW_CHARGES_ENABLED;
        await db.asaasWebhookInbox.deleteMany();
        await db.auditLog.deleteMany();
        await db.paymentTransaction.deleteMany();
        await db.order.deleteMany();
        await db.asaasCustomer.deleteMany();
        await db.user.deleteMany();
        await db.user.create({ data: { id: 'user-1', name: 'Sandbox Test', email: 'sandbox@example.invalid', cpf: '12345678909', phone: '65999999999' } });
        await db.order.create({ data: { id: 'order-1', userId: 'user-1', totalCents: 1850, paymentMethod: 'ONLINE' } });
        client = new AsaasClient();
        jest.spyOn(client, 'request').mockImplementation(async (path: string) => {
            if (path.startsWith('/customers?')) return { data: [], hasMore: false } as any;
            if (path === '/customers') return { id: 'cus_test' } as any;
            throw new Error('Unexpected gateway request');
        });
        jest.spyOn(client, 'createPayment').mockImplementation(async input => {
            remote = { id: 'pay_test', customer: input.customer, externalReference: input.reference, billingType: input.method === 'PIX' ? 'PIX' : 'CREDIT_CARD',
                value: input.amountCents / 100, status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/test' };
            return { ...remote };
        });
        jest.spyOn(client, 'getPayment').mockImplementation(async () => ({ ...remote }));
        jest.spyOn(client, 'findPayments').mockImplementation(async () => remote ? [{ ...remote }] : []);
        jest.spyOn(client, 'getQrCode').mockResolvedValue({ payload: 'pix-test', encodedImage: 'aW1hZ2U=', expirationDate: '2027-01-01' });
        broadcast = jest.fn();
        service = new AsaasPaymentsService(db as PrismaService, client, { broadcastOrderStatus: broadcast } as unknown as EventsGateway);
    });

    async function payment(method: 'PIX' | 'CARD' = 'PIX') { return service.create('order-1', method); }
    async function event(id: string, eventType = 'PAYMENT_RECEIVED') {
        return service.receiveWebhook(token, { id, event: eventType, payment: { id: remote.id, creditCardToken: 'must-not-persist', cpf: 'must-not-persist' }, extraField: true });
    }

    it('creates and reuses one Pix charge, with durable QR and no sensitive payload', async () => {
        const first = await payment();
        const second = await payment();
        expect(second.id).toBe(first.id);
        expect(client.createPayment).toHaveBeenCalledTimes(1);
        expect(JSON.parse(second.detailsJson!).qrCode).toBe('pix-test');
        expect(await db.paymentTransaction.count()).toBe(1);
        expect(second.gatewayEnvironment).toBe('sandbox');
    });

    it('reserves a single attempt for concurrent callers and across payment methods', async () => {
        const results = await Promise.allSettled([payment(), payment(), payment('CARD')]);
        expect(results.some(r => r.status === 'fulfilled')).toBe(true);
        expect(client.createPayment).toHaveBeenCalledTimes(1);
        expect(await db.paymentTransaction.count()).toBe(1);
    });

    it('deduplicates webhooks and approves order exactly once', async () => {
        await payment(); remote.status = 'RECEIVED';
        await event('evt-1'); await event('evt-1'); await event('evt-2');
        await service.processPending();
        expect(await db.asaasWebhookInbox.count()).toBe(2);
        expect(await db.asaasWebhookInbox.count({ where: { status: 'PROCESSED' } })).toBe(2);
        expect((await db.order.findUniqueOrThrow({ where: { id: 'order-1' } })).status).toBe('PAID');
        expect(await db.auditLog.count({ where: { action: 'ORDER_PAID' } })).toBe(1);
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(await db.asaasWebhookInbox.findMany())).not.toContain('must-not-persist');
    });

    it('rejects invalid webhook authentication without persisting an event', async () => {
        await payment();
        await expect(service.receiveWebhook('bad-token', { id: 'evt-invalid', event: 'PAYMENT_RECEIVED', payment: { id: remote.id } })).rejects.toThrow('Webhook inválido');
        expect(await db.asaasWebhookInbox.count()).toBe(0);
    });

    it('retains an uncorrelated event and retries it after the attempt is linked', async () => {
        const created = await payment();
        await event('evt-early');
        remote.externalReference = 'cantina:sandbox:not-linked';
        await service.processPending();
        expect((await db.asaasWebhookInbox.findFirstOrThrow()).status).toBe('PENDING');
        remote.externalReference = created.externalReference; remote.status = 'RECEIVED';
        await db.asaasWebhookInbox.updateMany({ data: { nextAttemptAt: new Date(0) } });
        await service.processPending();
        expect((await db.asaasWebhookInbox.findFirstOrThrow()).status).toBe('PROCESSED');
    });

    it('does not approve a mismatched amount or customer', async () => {
        await payment(); remote.value = 1; remote.status = 'RECEIVED';
        await event('evt-wrong-amount'); await service.processPending();
        expect((await db.order.findFirstOrThrow()).status).toBe('CREATED');
        expect((await db.asaasWebhookInbox.findFirstOrThrow()).status).toBe('PENDING');
        remote.value = 18.5; remote.customer = 'cus_other';
        await db.asaasWebhookInbox.updateMany({ data: { nextAttemptAt: new Date(0) } });
        await service.processPending();
        expect((await db.order.findFirstOrThrow()).status).toBe('CREATED');
    });

    it('recovers a gateway timeout without issuing another charge', async () => {
        const original = client.createPayment.bind(client);
        jest.spyOn(client, 'createPayment').mockImplementationOnce(async input => { await original(input); throw new AsaasRequestError(0, false); });
        const created = await payment();
        expect(created.creationState).toBe('UNKNOWN');
        await payment();
        expect((await db.paymentTransaction.findFirstOrThrow()).externalId).toBe('pay_test');
        expect(await db.paymentTransaction.count()).toBe(1);
    });

    it('retains ambiguous empty searches instead of creating a duplicate', async () => {
        jest.spyOn(client, 'createPayment').mockRejectedValue(new AsaasRequestError(0, false));
        jest.spyOn(client, 'findPayments').mockResolvedValue([]);
        await payment(); await payment();
        expect(client.createPayment).toHaveBeenCalledTimes(1);
        expect((await db.paymentTransaction.findFirstOrThrow()).creationState).toBe('UNKNOWN');
    });

    it('preserves the remote charge when QR generation fails', async () => {
        jest.spyOn(client, 'getQrCode').mockRejectedValueOnce(new AsaasRequestError(503, false));
        const created = await payment(); expect(created.externalId).toBe('pay_test');
        await payment(); expect(client.createPayment).toHaveBeenCalledTimes(1);
        expect(JSON.parse((await db.paymentTransaction.findFirstOrThrow()).detailsJson!).qrCode).toBe('pix-test');
    });

    it('does not release Pix merely confirmed, but accepts confirmed credit card', async () => {
        const pix = await payment(); remote.status = 'CONFIRMED';
        await service.reconcile(pix); expect((await db.order.findFirstOrThrow()).status).toBe('CREATED');
        await db.paymentTransaction.deleteMany(); remote = undefined as unknown as AsaasPayment;
        const card = await payment('CARD'); remote.status = 'CONFIRMED';
        await service.reconcile(card); expect((await db.order.findFirstOrThrow()).status).toBe('PAID');
    });

    it('records a late payment without reopening an expired order', async () => {
        const created = await payment();
        await db.order.update({ where: { id: 'order-1' }, data: { status: 'EXPIRED' } });
        remote.status = 'RECEIVED'; await service.reconcile(created);
        expect((await db.order.findFirstOrThrow()).status).toBe('EXPIRED');
        expect((await db.paymentTransaction.findFirstOrThrow()).reviewReason).toBe('PAYMENT_AFTER_ORDER_CLOSED');
    });

    it('tracks partial refund, full refund and financial history without reopening orders', async () => {
        const created = await payment('CARD'); remote.status = 'CONFIRMED'; await service.reconcile(created);
        remote.refunds = [{ status: 'DONE', value: 5 }]; await service.reconcile(created);
        expect((await db.paymentTransaction.findFirstOrThrow()).refundedAmountCents).toBe(500);
        remote.status = 'REFUNDED'; await service.reconcile(created);
        expect((await db.paymentTransaction.findFirstOrThrow()).refundedAmountCents).toBe(1850);
        expect((await db.order.findFirstOrThrow()).status).toBe('PAID');
    });

    it('keeps approval on delayed pending events and never regresses kitchen state', async () => {
        const created = await payment(); remote.status = 'RECEIVED'; await service.reconcile(created);
        await db.order.update({ where: { id: 'order-1' }, data: { status: 'IN_PREP' } });
        remote.status = 'PENDING'; await service.reconcile(created);
        expect((await db.paymentTransaction.findFirstOrThrow()).status).toBe('APPROVED');
        expect((await db.order.findFirstOrThrow()).status).toBe('IN_PREP');
    });

    it('rolls back financial effects when audit persistence fails and retries the event', async () => {
        await payment(); remote.status = 'RECEIVED'; await event('evt-retry');
        let fail = true;
        db.$use(async (params, next) => {
            if (params.model === 'AuditLog' && params.action === 'create' && fail) { fail = false; throw new Error('simulated disk failure'); }
            return next(params);
        });
        await service.processPending();
        expect((await db.order.findFirstOrThrow()).status).toBe('CREATED');
        expect((await db.asaasWebhookInbox.findFirstOrThrow()).status).toBe('PENDING');
        await db.asaasWebhookInbox.updateMany({ data: { nextAttemptAt: new Date(0) } });
        await service.processPending();
        expect((await db.order.findFirstOrThrow()).status).toBe('PAID');
        expect(await db.auditLog.count({ where: { action: 'ORDER_PAID' } })).toBe(1);
    });

    it('isolates environments and rejects untrusted checkout URLs', async () => {
        const created = await payment();
        expect(client.safeInvoiceUrl('https://evil.example/')).toBeNull();
        expect(client.safeInvoiceUrl('http://sandbox.asaas.com/i/test')).toBeNull();
        process.env.ASAAS_ENV = 'production';
        await service.reconcile(created);
        expect(client.getPayment).not.toHaveBeenCalled();
    });
});
