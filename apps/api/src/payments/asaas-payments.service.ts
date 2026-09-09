import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PaymentTransaction, Prisma } from '@prisma/client';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { AsaasClient, AsaasPayment, AsaasRequestError } from './asaas.client';

const CLOSED_ORDERS = ['CANCELLED', 'EXPIRED'];
const PAYABLE_ORDERS = ['CREATED', 'CONFIRMED'];
const MIN_CARD_PAYMENT_CENTS = 500;
type Payer = { id: string; name: string; email: string; cpf: string | null; phone: string | null };

@Injectable()
export class AsaasPaymentsService {
    private readonly logger = new Logger(AsaasPaymentsService.name);
    private processing = false;

    constructor(private readonly prisma: PrismaService, readonly client: AsaasClient, private readonly events: EventsGateway) { }

    private get scope() { return { environment: this.client.environment, accountRef: this.client.accountRef }; }

    private inScope(payment: PaymentTransaction) {
        return payment.provider === 'ASAAS' && payment.gatewayEnvironment === this.client.environment
            && payment.gatewayAccountRef === this.client.accountRef;
    }

    async create(orderId: string, method: 'PIX' | 'CARD'): Promise<PaymentTransaction> {
        if (!this.client.configured) throw new BadRequestException('Asaas indisponível neste ambiente.');
        if (process.env.PAYMENTS_NEW_CHARGES_ENABLED === 'false') throw new ConflictException('Novos pagamentos estão temporariamente pausados.');
        const id = randomUUID();
        const scope = this.scope;
        const reserved = await this.prisma.$transaction(async tx => {
            const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true, ticket: true } });
            if (!PAYABLE_ORDERS.includes(order.status)) throw new ConflictException('Este pedido não aceita novos pagamentos.');
            if (method === 'CARD' && order.totalCents < MIN_CARD_PAYMENT_CENTS) {
                throw new BadRequestException('O pagamento com cartão exige pedido mínimo de R$ 5,00. Use Pix ou adicione mais itens.');
            }
            const existing = await tx.paymentTransaction.findFirst({
                where: { orderId, OR: [{ status: 'PENDING' }, { activeOrderId: orderId }] }, orderBy: { createdAt: 'asc' },
            });
            if (existing) return { payment: existing, payer: order.user! };
            if (!order.user || !order.user.cpf || !order.user.phone || !order.user.isActive) throw new BadRequestException('Complete seu cadastro antes de pagar.');
            const payment = await tx.paymentTransaction.create({ data: {
                id, orderId, provider: 'ASAAS', paymentMethod: method, status: 'PENDING', creationState: 'CREATING',
                activeOrderId: orderId, gatewayEnvironment: scope.environment, gatewayAccountRef: scope.accountRef,
                externalReference: `cantina:${scope.environment}:${id}`, attemptKey: id,
                amountCents: order.totalCents, expiresAt: order.ticket?.expiresAt ?? new Date(Date.now() + 30 * 60_000),
                nextReconcileAt: new Date(Date.now() + 60_000),
            } });
            return { payment, payer: order.user };
        });
        if (reserved.payment.paymentMethod !== method) throw new ConflictException('Já existe pagamento em andamento por outro meio. Conclua ou aguarde sua resolução.');
        if (reserved.payment.id !== id) {
            if (reserved.payment.provider === 'ASAAS') await this.reconcile(reserved.payment);
            return this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: reserved.payment.id } });
        }

        let submitted = false;
        try {
            const customer = await this.ensureCustomer(reserved.payer);
            await this.prisma.paymentTransaction.update({ where: { id }, data: { detailsJson: JSON.stringify({ customer }) } });
            submitted = true;
            const remote = await this.client.createPayment({ customer, method, amountCents: reserved.payment.amountCents,
                reference: reserved.payment.externalReference!, orderId });
            // Record the remote ID before fetching QR details or applying the financial result.
            await this.prisma.paymentTransaction.update({ where: { id }, data: { externalId: remote.id, creationState: 'CREATED' } });
            await this.apply(id, remote);
            if (method === 'PIX' && remote.status === 'PENDING') await this.loadQr(id, remote.id);
        } catch (error) {
            const definitive = !submitted || (error instanceof AsaasRequestError && error.definitive);
            const current = await this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
            if (!current.externalId) {
                await this.prisma.paymentTransaction.update({ where: { id }, data: {
                    creationState: definitive ? 'FAILED' : 'UNKNOWN', status: definitive ? 'REJECTED' : 'PENDING',
                    activeOrderId: definitive ? null : orderId,
                    lastError: definitive ? 'Não foi possível iniciar o pagamento. Verifique seu cadastro ou tente novamente mais tarde.'
                        : 'Estamos verificando a criação do pagamento. Não gere outra cobrança.',
                } });
            } else {
                await this.prisma.paymentTransaction.update({ where: { id }, data: { lastError: 'Pagamento criado; aguardando atualização dos dados.' } });
            }
            this.logger.warn(`payment_attempt ${id} ${definitive ? 'failed' : 'awaiting_reconciliation'}`);
        }
        return this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
    }

    private async ensureCustomer(payer: Payer): Promise<string> {
        const scope = this.scope;
        const key = { userId: payer.id, ...scope };
        let claimed = false;
        let customer = await this.prisma.asaasCustomer.findUnique({ where: { userId_environment_accountRef: key } });
        if (!customer) {
            try { customer = await this.prisma.asaasCustomer.create({ data: key }); claimed = true; }
            catch (error) {
                if (!this.isUnique(error)) throw error;
                customer = await this.prisma.asaasCustomer.findUniqueOrThrow({ where: { userId_environment_accountRef: key } });
            }
        }
        if (customer.externalId) return customer.externalId;
        const reference = `cantina:user:${payer.id}`;
        let matches: { data: { id: string; cpfCnpj: string }[]; hasMore: boolean };
        try {
            matches = await this.client.request(`/customers?externalReference=${encodeURIComponent(reference)}&limit=100`);
        } catch (error) {
            // No customer POST was issued; a failed lookup can safely be tried again.
            if (claimed) await this.prisma.asaasCustomer.update({ where: { id: customer.id }, data: { creationState: 'FAILED' } });
            throw error;
        }
        const cpf = payer.cpf!.replace(/\D/g, '');
        if (matches.hasMore || matches.data.length > 1 || (matches.data[0] && matches.data[0].cpfCnpj?.replace(/\D/g, '') !== cpf)) {
            throw new ConflictException('Cadastro de pagamento exige revisão.');
        }
        let remoteId = matches.data[0]?.id;
        if (!remoteId) {
            if (!claimed && customer.creationState === 'FAILED') {
                claimed = (await this.prisma.asaasCustomer.updateMany({ where: { id: customer.id, creationState: 'FAILED' }, data: { creationState: 'CREATING' } })).count === 1;
            }
            if (!claimed) throw new ConflictException('Cadastro de pagamento em verificação. Tente novamente mais tarde.');
            try {
                const created = await this.client.request<{ id: string }>('/customers', 'POST', {
                    name: payer.name, email: payer.email, cpfCnpj: cpf, mobilePhone: payer.phone!.replace(/\D/g, ''),
                    externalReference: reference, notificationDisabled: true,
                });
                remoteId = created.id;
            } catch (error) {
                await this.prisma.asaasCustomer.update({ where: { id: customer.id }, data: {
                    creationState: error instanceof AsaasRequestError && error.definitive ? 'FAILED' : 'UNKNOWN',
                } });
                throw error;
            }
        }
        if (!remoteId) throw new Error('Resposta de cadastro inválida.');
        await this.prisma.asaasCustomer.update({ where: { id: customer.id }, data: { externalId: remoteId, creationState: 'CREATED' } });
        return remoteId;
    }

    async reconcile(payment: PaymentTransaction) {
        if (!this.inScope(payment)) return;
        // Do not race a creation request that is still in flight.
        if (payment.creationState === 'CREATING' && Date.now() - payment.createdAt.getTime() < 60_000) return;
        let remote: AsaasPayment;
        if (payment.externalId) remote = await this.client.getPayment(payment.externalId);
        else {
            const matches = await this.client.findPayments(payment.externalReference!);
            if (!matches.length) {
                await this.prisma.paymentTransaction.update({ where: { id: payment.id }, data: {
                    creationState: 'UNKNOWN', reviewReason: 'CREATION_RESULT_UNKNOWN', nextReconcileAt: new Date(Date.now() + 60_000),
                } });
                return;
            }
            if (matches.length !== 1) throw new Error('DUPLICATE_REMOTE_PAYMENTS');
            remote = matches[0];
        }
        await this.apply(payment.id, remote);
        const order = await this.prisma.order.findUniqueOrThrow({ where: { id: payment.orderId } });
        if (remote.status === 'PENDING' && !remote.deleted && (CLOSED_ORDERS.includes(order.status) || (payment.expiresAt && payment.expiresAt <= new Date()))) {
            await this.client.request(`/payments/${encodeURIComponent(remote.id)}`, 'DELETE');
            remote = await this.client.getPayment(remote.id);
            await this.apply(payment.id, remote);
        }
        if (payment.paymentMethod === 'PIX' && remote.status === 'PENDING' && !remote.deleted) await this.loadQr(payment.id, remote.id);
    }

    async cancel(orderId: string) {
        let payment = await this.prisma.paymentTransaction.findFirst({ where: {
            orderId, provider: 'ASAAS', status: 'PENDING', gatewayEnvironment: this.client.environment, gatewayAccountRef: this.client.accountRef,
        }, orderBy: { createdAt: 'desc' } });
        if (!payment) throw new ConflictException('Nenhum pagamento Asaas pendente para cancelar.');
        await this.reconcile(payment);
        payment = await this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
        if (!payment.externalId) throw new ConflictException('Pagamento ainda em verificação. Aguarde antes de trocar o meio.');
        if (payment.status !== 'PENDING') return payment;
        const remote = await this.client.getPayment(payment.externalId);
        if (!['PENDING', 'OVERDUE'].includes(remote.status)) throw new ConflictException('Pagamento em processamento; não é possível cancelar agora.');
        await this.client.request(`/payments/${encodeURIComponent(remote.id)}`, 'DELETE');
        await this.apply(payment.id, await this.client.getPayment(remote.id));
        return this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
    }

    private async loadQr(id: string, remoteId: string) {
        const qr = await this.client.getQrCode(remoteId);
        const payment = await this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
        const details = this.details(payment);
        if (payment.status !== 'PENDING') return;
        await this.prisma.paymentTransaction.update({ where: { id }, data: {
            detailsJson: JSON.stringify({ ...details, qrCode: qr.payload, qrCodeBase64: qr.encodedImage, qrExpiresAt: qr.expirationDate }), lastError: null,
        } });
    }

    async receiveWebhook(token: string | undefined, body: Record<string, unknown>) {
        const expected = Buffer.from(this.client.webhookToken);
        const received = Buffer.from(token ?? '');
        if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new UnauthorizedException('Webhook inválido.');
        const payment = body.payment as Record<string, unknown> | undefined;
        if (typeof body.id !== 'string' || body.id.length > 255 || typeof body.event !== 'string' || body.event.length > 100
            || typeof payment?.id !== 'string' || payment.id.length > 255) throw new BadRequestException('Evento de cobrança inválido.');
        try {
            // Persist only correlation fields. Never store card tokens or personal webhook payloads.
            await this.prisma.asaasWebhookInbox.create({ data: {
                ...this.scope, eventKey: body.id, eventType: body.event, paymentId: payment.id,
            } });
        } catch (error) { if (!this.isUnique(error)) throw error; }
        return { received: true };
    }

    async processPending() {
        if (this.processing || !this.client.configured) return;
        this.processing = true;
        try {
            const inbox = await this.prisma.asaasWebhookInbox.findMany({
                where: { ...this.scope, status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: 20,
            });
            for (const event of inbox) {
                try {
                    const remote = await this.client.getPayment(event.paymentId);
                    const payment = await this.prisma.paymentTransaction.findFirst({ where: {
                        provider: 'ASAAS', gatewayEnvironment: event.environment, gatewayAccountRef: event.accountRef,
                        OR: [{ externalId: remote.id }, ...(remote.externalReference ? [{ externalReference: remote.externalReference }] : [])],
                    } });
                    if (!payment) {
                        if (remote.externalReference?.startsWith('cantina:')) throw new Error('PAYMENT_NOT_CORRELATED');
                        await this.prisma.asaasWebhookInbox.update({ where: { id: event.id }, data: { status: 'IGNORED', processedAt: new Date() } });
                        continue;
                    }
                    await this.apply(payment.id, remote, event.id);
                } catch {
                    await this.prisma.asaasWebhookInbox.update({ where: { id: event.id }, data: {
                        attempts: { increment: 1 }, lastError: 'Evento aguarda consulta ou revisão de consistência.',
                        nextAttemptAt: new Date(Date.now() + Math.min(3600, 10 * 2 ** Math.min(event.attempts, 9)) * 1000),
                    } });
                    this.logger.warn(`webhook_pending ${event.id}`);
                }
            }
            const pending = await this.prisma.paymentTransaction.findMany({ where: {
                provider: 'ASAAS', gatewayEnvironment: this.client.environment, gatewayAccountRef: this.client.accountRef,
                creationState: { not: 'FAILED' }, nextReconcileAt: { lte: new Date() },
            }, orderBy: { nextReconcileAt: 'asc' }, take: 20 });
            for (const payment of pending) {
                try { await this.reconcile(payment); }
                catch { this.logger.warn(`reconciliation_pending ${payment.id}`); }
                finally {
                    // Fair scheduling also on failure; one old row cannot starve the queue.
                    await this.prisma.paymentTransaction.updateMany({ where: { id: payment.id, nextReconcileAt: { lte: new Date() } },
                        data: { nextReconcileAt: new Date(Date.now() + 60_000) } });
                }
            }
        } finally { this.processing = false; }
    }

    private async apply(id: string, remote: AsaasPayment, inboxId?: string) {
        const changed = await this.prisma.$transaction(async tx => {
            const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id } });
            if (!this.inScope(payment)) throw new Error('PAYMENT_SCOPE_MISMATCH');
            const details = this.details(payment);
            const amountCents = Math.round(Number(remote.value) * 100);
            if (!Number.isFinite(amountCents) || amountCents !== payment.amountCents || remote.externalReference !== payment.externalReference
                || remote.customer !== details.customer || remote.billingType !== (payment.paymentMethod === 'CARD' ? 'CREDIT_CARD' : 'PIX')
                || (payment.externalId && payment.externalId !== remote.id)) throw new Error('PAYMENT_IDENTITY_OR_AMOUNT_MISMATCH');
            const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { ticket: true } });
            let status = this.mapStatus(remote, payment.paymentMethod);
            if (payment.status === 'APPROVED' && ['PENDING', 'REJECTED'].includes(status)) status = 'APPROVED';
            if (payment.status === 'REFUNDED') status = 'REFUNDED';
            // Resolve a chargeback only from a fresh, verified provider state.
            if (payment.status === 'CHARGEBACK' && status === 'PENDING') status = 'CHARGEBACK';
            const refunded = (remote.refunds ?? []).filter(r => r.status === 'DONE').reduce((sum, r) => sum + Math.round(r.value * 100), 0);
            const refundedAmountCents = remote.status === 'REFUNDED' ? payment.amountCents : Math.max(payment.refundedAmountCents, refunded);
            let reviewReason = payment.reviewReason === 'CREATION_RESULT_UNKNOWN' ? null : payment.reviewReason;
            if (status === 'APPROVED' && CLOSED_ORDERS.includes(order.status)) reviewReason = 'PAYMENT_AFTER_ORDER_CLOSED';
            if (refundedAmountCents > 0 && refundedAmountCents < payment.amountCents) reviewReason = 'PARTIAL_REFUND';
            if (status === 'CHARGEBACK') reviewReason = 'CHARGEBACK';
            const otherApproval = status === 'APPROVED' && await tx.paymentTransaction.findFirst({ where: { orderId: order.id, id: { not: id }, status: 'APPROVED' } });
            if (otherApproval) reviewReason = 'DUPLICATE_APPROVAL';
            const paidAt = status === 'APPROVED' ? payment.paidAt ?? new Date() : payment.paidAt;
            await tx.paymentTransaction.update({ where: { id }, data: {
                externalId: remote.id, creationState: 'CREATED', status, providerStatus: remote.status,
                activeOrderId: status === 'PENDING' ? order.id : null, refundedAmountCents, reviewReason, paidAt,
                lastError: null, webhookVerifiedAt: inboxId ? new Date() : undefined, webhookSource: inboxId ? 'webhook_asaas' : undefined,
                detailsJson: JSON.stringify({ ...details, checkoutUrl: this.client.safeInvoiceUrl(remote.invoiceUrl), statusDetail: remote.status,
                    receiptUrl: this.client.safeInvoiceUrl(remote.transactionReceiptUrl) }),
                nextReconcileAt: ['REFUNDED', 'REJECTED'].includes(status) ? null : new Date(Date.now() + (status === 'PENDING' ? 60_000 : 24 * 60 * 60_000)),
            } });
            let orderChanged = false;
            if (status === 'APPROVED' && !reviewReason) {
                const updated = await tx.order.updateMany({ where: { id: order.id, status: { in: PAYABLE_ORDERS } },
                    data: { status: 'PAID', paidAt, paymentMethod: payment.paymentMethod } });
                orderChanged = updated.count === 1;
            }
            if (status !== payment.status || reviewReason !== payment.reviewReason || refundedAmountCents !== payment.refundedAmountCents || orderChanged) {
                await tx.auditLog.create({ data: { action: reviewReason ?? 'PAYMENT_STATUS_UPDATED', entity: 'PaymentTransaction', entityId: id,
                    payloadJson: JSON.stringify({ provider: 'ASAAS', orderId: order.id, status, providerStatus: remote.status, refundedAmountCents }) } });
            }
            if (orderChanged) await tx.auditLog.create({ data: { action: 'ORDER_PAID', entity: 'Order', entityId: order.id, payloadJson: JSON.stringify({ source: 'asaas' }) } });
            if (inboxId) await tx.asaasWebhookInbox.update({ where: { id: inboxId }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null } });
            return orderChanged ? { id: order.id, userId: order.userId ?? '', code: order.ticket?.codeShort } : null;
        });
        if (changed) this.events.broadcastOrderStatus(changed.id, changed.userId, 'PAID', changed.code);
    }

    private mapStatus(payment: AsaasPayment, method: string): string {
        if (payment.status === 'REFUNDED') return 'REFUNDED';
        if (['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'].includes(payment.status)) return 'CHARGEBACK';
        if (payment.status === 'RECEIVED' || (method === 'CARD' && payment.status === 'CONFIRMED')) return 'APPROVED';
        if (payment.deleted) return 'REJECTED';
        return 'PENDING';
    }

    private details(payment: PaymentTransaction): Record<string, unknown> {
        return payment.detailsJson ? JSON.parse(payment.detailsJson) as Record<string, unknown> : {};
    }

    private isUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
}
