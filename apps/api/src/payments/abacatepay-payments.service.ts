import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PaymentTransaction, Prisma } from '@prisma/client';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isValidCpf } from '../common/utils/cpf';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { AbacatePayClient, AbacatePayRequestError } from './abacatepay.client';

const PAYABLE_ORDERS = ['CREATED', 'CONFIRMED'];
const CLOSED_ORDERS = ['CANCELLED', 'EXPIRED'];
const TERMINAL_PROVIDER_STATUSES = ['EXPIRED', 'CANCELLED', 'FAILED'];
type Payer = { name: string; email: string; cpf: string | null; phone: string | null; isActive: boolean };
type WebhookBody = { id: string; event: string; data: { transparent: Record<string, unknown>; payerInformation?: Record<string, unknown> } };

@Injectable()
export class AbacatePayPaymentsService {
    private readonly logger = new Logger(AbacatePayPaymentsService.name);

    constructor(private readonly prisma: PrismaService, readonly client: AbacatePayClient, private readonly events: EventsGateway) { }

    private get scope() { return this.client.scope; }

    private inScope(payment: PaymentTransaction) {
        const scope = this.scope;
        return payment.provider === 'ABACATEPAY' && payment.gatewayEnvironment === scope.environment && payment.gatewayAccountRef === scope.accountRef;
    }

    async create(orderId: string): Promise<PaymentTransaction> {
        if (!this.client.configured) throw new BadRequestException('AbacatePay indisponível neste ambiente.');
        if (process.env.PAYMENTS_NEW_CHARGES_ENABLED === 'false') throw new ConflictException('Novos pagamentos estão temporariamente pausados.');
        const id = randomUUID();
        const scope = this.scope;
        const reserved = await this.prisma.$transaction(async tx => {
            const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true, ticket: true } });
            if (!PAYABLE_ORDERS.includes(order.status)) throw new ConflictException('Este pedido não aceita novos pagamentos.');
            const existing = await tx.paymentTransaction.findFirst({
                where: { orderId, OR: [{ status: 'PENDING' }, { activeOrderId: orderId }] }, orderBy: { createdAt: 'asc' },
            });
            if (existing) return { payment: existing, payer: order.user, expiresAt: order.ticket?.expiresAt ?? null };
            if (!order.user || !order.user.isActive || !order.user.phone || !isValidCpf(order.user.cpf)) {
                throw new BadRequestException('Complete seu cadastro com CPF válido e celular antes de pagar.');
            }
            const expiresAt = order.ticket?.expiresAt ?? new Date(Date.now() + 30 * 60_000);
            if (expiresAt <= new Date()) throw new ConflictException('Este pedido expirou antes de iniciar o pagamento.');
            const payment = await tx.paymentTransaction.create({ data: {
                id, orderId, provider: 'ABACATEPAY', paymentMethod: 'PIX', status: 'PENDING', creationState: 'CREATING',
                activeOrderId: orderId, gatewayEnvironment: scope.environment, gatewayAccountRef: scope.accountRef,
                externalReference: `cantina:abacatepay:${scope.environment}:${id}`, attemptKey: id,
                amountCents: order.totalCents, expiresAt, nextReconcileAt: new Date(Date.now() + 60_000),
            } });
            return { payment, payer: order.user, expiresAt };
        });

        if (reserved.payment.paymentMethod !== 'PIX') throw new ConflictException('Já existe pagamento em andamento por outro meio. Conclua ou aguarde sua resolução.');
        if (reserved.payment.id !== id) {
            if (reserved.payment.provider === 'ABACATEPAY') await this.reconcile(reserved.payment);
            return this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: reserved.payment.id } });
        }

        try {
            const expiresInSeconds = Math.max(60, Math.floor((reserved.expiresAt!.getTime() - Date.now()) / 1000));
            const payer = reserved.payer as Payer;
            const remote = await this.client.createTransparentPix({
                amountCents: reserved.payment.amountCents,
                expiresInSeconds,
                description: `Cantina - pedido ${orderId.slice(0, 8)}`,
                externalId: reserved.payment.externalReference!,
                orderId,
                paymentId: id,
                customer: { name: payer.name, email: payer.email, taxId: payer.cpf!.replace(/\D/g, ''), cellphone: payer.phone!.replace(/\D/g, '') },
            });
            const remoteExpiry = this.safeDate(remote.expiresAt);
            await this.prisma.paymentTransaction.update({ where: { id }, data: {
                externalId: remote.id, creationState: 'CREATED', providerStatus: remote.status,
                expiresAt: remoteExpiry && remoteExpiry < reserved.expiresAt! ? remoteExpiry : reserved.expiresAt,
                detailsJson: JSON.stringify({ qrCode: remote.brCode, qrCodeBase64: remote.brCodeBase64, qrExpiresAt: remote.expiresAt }),
                lastError: null,
            } });
        } catch (error) {
            const definitive = error instanceof AbacatePayRequestError && error.definitive;
            await this.prisma.paymentTransaction.update({ where: { id }, data: {
                creationState: definitive ? 'FAILED' : 'UNKNOWN', status: definitive ? 'REJECTED' : 'PENDING',
                activeOrderId: definitive ? null : orderId,
                lastError: definitive ? 'Não foi possível iniciar o pagamento. Verifique seu cadastro ou tente novamente mais tarde.'
                    : 'Estamos verificando a criação do pagamento. Não gere outra cobrança.',
            } });
            this.logger.warn(`abacatepay_payment_attempt ${id} ${definitive ? 'failed' : 'awaiting_reconciliation'}`);
        }
        return this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
    }

    async reconcile(payment: PaymentTransaction) {
        if (!this.inScope(payment) || !payment.externalId || payment.status !== 'PENDING') return;
        const remote = await this.client.checkTransparent(payment.externalId);
        if (remote.id !== payment.externalId) throw new Error('ABACATEPAY_PAYMENT_ID_MISMATCH');

        if (remote.status === 'PAID') {
            await this.markPaidFromPoll(payment.id, remote.status);
            return;
        }

        if (TERMINAL_PROVIDER_STATUSES.includes(remote.status)) {
            await this.prisma.paymentTransaction.update({ where: { id: payment.id }, data: {
                status: 'REJECTED', providerStatus: remote.status, activeOrderId: null, nextReconcileAt: null,
                lastError: remote.status === 'EXPIRED' ? 'O código Pix expirou. Gere uma nova cobrança.' : 'O pagamento não foi concluído.',
            } });
            return;
        }

        await this.prisma.paymentTransaction.update({ where: { id: payment.id }, data: {
            providerStatus: remote.status, nextReconcileAt: new Date(Date.now() + 60_000),
        } });
    }

    // A API GET /v2/transparents/check da AbacatePay retorna status=PAID como estado definitivo
    // (docs.abacatepay.com/pages/transparents/check), então confirmar aqui é tão confiável quanto o webhook.
    private async markPaidFromPoll(paymentId: string, providerStatus: string) {
        const changed = await this.prisma.$transaction(async tx => {
            const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: paymentId } });
            if (payment.status !== 'PENDING') return {};
            const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { ticket: true } });

            let reviewReason: string | null = payment.reviewReason;
            if (CLOSED_ORDERS.includes(order.status)) reviewReason = 'PAYMENT_AFTER_ORDER_CLOSED';
            const otherApproval = await tx.paymentTransaction.findFirst({ where: { orderId: order.id, id: { not: payment.id }, status: 'APPROVED' } });
            if (otherApproval) reviewReason = 'DUPLICATE_APPROVAL';

            const paidAt = payment.paidAt ?? new Date();
            await tx.paymentTransaction.update({ where: { id: payment.id }, data: {
                providerStatus, status: 'APPROVED', creationState: 'CREATED', activeOrderId: null, paidAt,
                reviewReason, nextReconcileAt: new Date(Date.now() + 24 * 60 * 60_000), lastError: null,
            } });

            const updated = reviewReason ? { count: 0 } : await tx.order.updateMany({
                where: { id: order.id, status: { in: PAYABLE_ORDERS } }, data: { status: 'PAID', paidAt, paymentMethod: 'PIX' },
            });

            await tx.auditLog.create({ data: {
                action: reviewReason ?? 'PAYMENT_STATUS_UPDATED', entity: 'PaymentTransaction', entityId: payment.id,
                payloadJson: JSON.stringify({ provider: 'ABACATEPAY', orderId: order.id, status: 'APPROVED', providerStatus, source: 'reconcile' }),
            } });
            if (updated.count) await tx.auditLog.create({ data: {
                action: 'ORDER_PAID', entity: 'Order', entityId: order.id, payloadJson: JSON.stringify({ source: 'abacatepay_reconcile' }),
            } });

            return updated.count ? { id: order.id, userId: order.userId ?? '', code: order.ticket?.codeShort } : {};
        });
        if ('id' in changed && changed.id) this.events.broadcastOrderStatus(changed.id, changed.userId, 'PAID', changed.code);
    }

    async cancel(orderId: string) {
        const payment = await this.prisma.paymentTransaction.findFirst({ where: {
            orderId, provider: 'ABACATEPAY', status: 'PENDING',
            gatewayEnvironment: this.scope.environment, gatewayAccountRef: this.scope.accountRef,
        }, orderBy: { createdAt: 'desc' } });
        if (!payment) throw new ConflictException('Nenhum pagamento AbacatePay pendente para cancelar.');
        await this.reconcile(payment);
        const refreshed = await this.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
        if (refreshed.status !== 'PENDING') return refreshed;
        throw new ConflictException('O Pix AbacatePay permanece válido até expirar. Aguarde o vencimento antes de trocar o meio de pagamento.');
    }

    async receiveWebhook(webhookSecret: string | undefined, signature: string | undefined, rawBody: Buffer | undefined, body: unknown) {
        const expectedSecret = Buffer.from(this.client.webhookSecret);
        const receivedSecret = Buffer.from(webhookSecret ?? '');
        if (expectedSecret.length !== receivedSecret.length || !timingSafeEqual(expectedSecret, receivedSecret)
            || !rawBody || !this.client.verifyWebhookSignature(rawBody, signature)) {
            throw new UnauthorizedException('Webhook AbacatePay inválido.');
        }
        const event = this.parseWebhook(body);
        if (!event || !event.event.startsWith('transparent.')) return { received: true, ignored: true };
        return this.applyWebhook(event);
    }

    private async applyWebhook(event: WebhookBody) {
        const transparent = event.data.transparent;
        const providerId = this.stringValue(transparent.id);
        const externalReference = this.stringValue(transparent.externalId);
        const amount = typeof transparent.amount === 'number' && Number.isSafeInteger(transparent.amount) ? transparent.amount : null;
        const providerStatus = this.stringValue(transparent.status);
        if (!providerId || !externalReference || amount === null || amount <= 0 || !providerStatus) {
            throw new BadRequestException('Evento AbacatePay sem identificação financeira válida.');
        }
        const payerMethod = this.stringValue(event.data.payerInformation?.method);
        const methods = transparent.methods;
        if (payerMethod && payerMethod !== 'PIX') throw new BadRequestException('Método de pagamento AbacatePay incompatível.');
        if (Array.isArray(methods) && !methods.includes('PIX')) throw new BadRequestException('Método de cobrança AbacatePay incompatível.');

        try {
            const changed = await this.prisma.$transaction(async tx => {
                const payment = await tx.paymentTransaction.findFirst({ where: {
                    provider: 'ABACATEPAY', gatewayEnvironment: this.scope.environment, gatewayAccountRef: this.scope.accountRef,
                    externalId: providerId, externalReference,
                } });
                if (!payment) return { ignored: true };
                if (payment.amountCents !== amount || payment.paymentMethod !== 'PIX') throw new Error('ABACATEPAY_AMOUNT_MISMATCH');

                const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { provider_eventKey: { provider: 'ABACATEPAY', eventKey: event.id } } });
                if (duplicate) return { duplicate: true };
                const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { ticket: true } });
                await tx.paymentWebhookEvent.create({ data: {
                    provider: 'ABACATEPAY', eventKey: event.id, eventType: event.event, orderId: order.id, paymentTransactionId: payment.id,
                    payloadJson: JSON.stringify({ providerId, externalReference, amount, providerStatus }),
                } });

                const details = this.details(payment);
                const receiptUrl = this.client.safeReceiptUrl(transparent.receiptUrl);
                const updateBase = {
                    providerStatus, webhookVerifiedAt: new Date(), webhookSource: 'webhook_abacatepay',
                    detailsJson: JSON.stringify({ ...details, receiptUrl, statusDetail: providerStatus }), lastError: null,
                };

                if (event.event === 'transparent.completed') {
                    if (providerStatus !== 'PAID') throw new BadRequestException('Evento concluído sem status pago.');
                    let reviewReason: string | null = payment.reviewReason;
                    if (CLOSED_ORDERS.includes(order.status)) reviewReason = 'PAYMENT_AFTER_ORDER_CLOSED';
                    const otherApproval = await tx.paymentTransaction.findFirst({ where: { orderId: order.id, id: { not: payment.id }, status: 'APPROVED' } });
                    if (otherApproval) reviewReason = 'DUPLICATE_APPROVAL';
                    const paidAt = payment.paidAt ?? new Date();
                    await tx.paymentTransaction.update({ where: { id: payment.id }, data: {
                        ...updateBase, status: 'APPROVED', creationState: 'CREATED', activeOrderId: null, paidAt,
                        reviewReason, nextReconcileAt: new Date(Date.now() + 24 * 60 * 60_000),
                    } });
                    const updated = reviewReason ? { count: 0 } : await tx.order.updateMany({
                        where: { id: order.id, status: { in: PAYABLE_ORDERS } }, data: { status: 'PAID', paidAt, paymentMethod: 'PIX' },
                    });
                    await tx.auditLog.create({ data: {
                        action: reviewReason ?? 'PAYMENT_STATUS_UPDATED', entity: 'PaymentTransaction', entityId: payment.id,
                        payloadJson: JSON.stringify({ provider: 'ABACATEPAY', orderId: order.id, status: 'APPROVED', providerStatus }),
                    } });
                    if (updated.count) await tx.auditLog.create({ data: {
                        action: 'ORDER_PAID', entity: 'Order', entityId: order.id, payloadJson: JSON.stringify({ source: 'abacatepay' }),
                    } });
                    return updated.count ? { id: order.id, userId: order.userId ?? '', code: order.ticket?.codeShort } : {};
                }

                const refunded = event.event === 'transparent.refunded';
                const disputed = event.event === 'transparent.disputed' || event.event === 'transparent.lost';
                if (refunded || disputed) {
                    await tx.paymentTransaction.update({ where: { id: payment.id }, data: {
                        ...updateBase, status: refunded ? 'REFUNDED' : 'CHARGEBACK', activeOrderId: null,
                        refundedAmountCents: refunded ? payment.amountCents : payment.refundedAmountCents,
                        reviewReason: refunded ? 'REFUND_REVIEW' : 'CHARGEBACK', nextReconcileAt: null,
                    } });
                    await tx.auditLog.create({ data: {
                        action: refunded ? 'PAYMENT_REFUNDED' : 'PAYMENT_CHARGEBACK', entity: 'PaymentTransaction', entityId: payment.id,
                        payloadJson: JSON.stringify({ provider: 'ABACATEPAY', orderId: order.id, providerStatus }),
                    } });
                }
                return {};
            });
            if ('id' in changed && changed.id) this.events.broadcastOrderStatus(changed.id, changed.userId, 'PAID', changed.code);
            return { received: true, ...changed };
        } catch (error) {
            if (this.isUnique(error)) return { received: true, duplicate: true };
            throw error;
        }
    }

    private parseWebhook(value: unknown): WebhookBody | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const candidate = value as Record<string, unknown>;
        const data = candidate.data as Record<string, unknown> | undefined;
        const transparent = data?.transparent;
        if (!this.stringValue(candidate.id) || !this.stringValue(candidate.event) || !transparent || typeof transparent !== 'object' || Array.isArray(transparent)) return null;
        return { id: candidate.id as string, event: candidate.event as string, data: { transparent: transparent as Record<string, unknown>, payerInformation: data?.payerInformation as Record<string, unknown> | undefined } };
    }

    private details(payment: PaymentTransaction): Record<string, unknown> {
        if (!payment.detailsJson) return {};
        try {
            const value = JSON.parse(payment.detailsJson);
            return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
        } catch { return {}; }
    }

    private safeDate(value: string) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    private stringValue(value: unknown) { return typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : null; }

    private isUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
}
