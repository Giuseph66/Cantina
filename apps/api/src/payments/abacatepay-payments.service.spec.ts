import { PaymentTransaction } from '@prisma/client';
import { AbacatePayPaymentsService } from './abacatepay-payments.service';

describe('AbacatePayPaymentsService', () => {
    const webhookSecret = 's'.repeat(48);

    function buildService(duplicate = false) {
        const payment = {
            id: 'payment-1', orderId: 'order-1', provider: 'ABACATEPAY', paymentMethod: 'PIX', status: 'PENDING',
            externalId: 'pix_1', externalReference: 'cantina:abacatepay:development:payment-1', amountCents: 500,
            gatewayEnvironment: 'development', gatewayAccountRef: 'default', detailsJson: null, reviewReason: null,
            paidAt: null, refundedAmountCents: 0,
        } as PaymentTransaction;
        const tx = {
            paymentTransaction: { findFirst: jest.fn().mockResolvedValueOnce(payment).mockResolvedValueOnce(null), update: jest.fn().mockResolvedValue(payment) },
            paymentWebhookEvent: { findUnique: jest.fn().mockResolvedValue(duplicate ? { id: 'event-1' } : null), create: jest.fn() },
            order: {
                findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1', status: 'CREATED', ticket: { codeShort: 'ABC123' } }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            auditLog: { create: jest.fn() },
        };
        const prisma = { $transaction: jest.fn().mockImplementation(callback => callback(tx)) };
        const client = {
            webhookSecret, scope: { environment: 'development', accountRef: 'default' },
            verifyWebhookSignature: jest.fn().mockReturnValue(true), safeReceiptUrl: jest.fn().mockReturnValue('https://app.abacatepay.com/receipt/1'),
        };
        const events = { broadcastOrderStatus: jest.fn() };
        return { service: new AbacatePayPaymentsService(prisma as any, client as any, events as any), tx, client, events };
    }

    const payload = {
        id: 'log_1', event: 'transparent.completed', data: {
            transparent: {
                id: 'pix_1', externalId: 'cantina:abacatepay:development:payment-1', amount: 500,
                status: 'PAID', methods: ['PIX'], receiptUrl: 'https://app.abacatepay.com/receipt/1',
            },
            payerInformation: { method: 'PIX' },
        },
    };

    it('confirms a matched Pix only after URL secret and HMAC validation', async () => {
        const { service, tx, events } = buildService();

        const result = await service.receiveWebhook(webhookSecret, 'signature', Buffer.from(JSON.stringify(payload)), payload);

        expect(result).toMatchObject({ received: true, id: 'order-1' });
        expect(tx.paymentWebhookEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventKey: 'log_1' }) }));
        expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }));
        expect(events.broadcastOrderStatus).toHaveBeenCalledWith('order-1', 'user-1', 'PAID', 'ABC123');
    });

    it('acknowledges duplicate events without processing the order twice', async () => {
        const { service, tx } = buildService(true);

        await expect(service.receiveWebhook(webhookSecret, 'signature', Buffer.from(JSON.stringify(payload)), payload))
            .resolves.toMatchObject({ received: true, duplicate: true });
        expect(tx.paymentWebhookEvent.create).not.toHaveBeenCalled();
        expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a webhook with an invalid HMAC before querying the database', async () => {
        const { service, client, tx } = buildService();
        client.verifyWebhookSignature.mockReturnValue(false);

        await expect(service.receiveWebhook(webhookSecret, 'invalid', Buffer.from('{}'), {})).rejects.toThrow('Webhook AbacatePay inválido');
        expect(tx.paymentTransaction.findFirst).not.toHaveBeenCalled();
    });
});
