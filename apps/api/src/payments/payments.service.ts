import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppSettingsService } from '../common/services/app-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasPaymentsService } from './asaas-payments.service';
import { CreateCardPaymentDto, CreatePixPaymentDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly appSettings: AppSettingsService,
        private readonly asaas: AsaasPaymentsService,
    ) { }

    getPublicConfig() {
        const settings = this.appSettings.getSettings();
        const onlineEnabled = this.asaas.client.configured;
        return {
            allowOnPickupPayment: settings.allowOnPickupPayment,
            onlineEnabled,
            pixEnabled: onlineEnabled,
            cardEnabled: onlineEnabled,
            cardProvider: 'ASAAS',
            cardFlow: 'HOSTED_INVOICE',
            sandbox: onlineEnabled && this.asaas.client.environment === 'sandbox',
            salesEnabled: process.env.SALES_ENABLED === 'true',
            newChargesEnabled: process.env.PAYMENTS_NEW_CHARGES_ENABLED !== 'false',
        };
    }

    async createPixPayment(orderId: string, userId: string, role: string, _dto: CreatePixPaymentDto) {
        await this.assertCanAccessOrder(orderId, userId, role);
        return this.serializePaymentTransaction(await this.asaas.create(orderId, 'PIX'));
    }

    async createCardPayment(orderId: string, userId: string, role: string, _dto: CreateCardPaymentDto) {
        await this.assertCanAccessOrder(orderId, userId, role);
        return this.serializePaymentTransaction(await this.asaas.create(orderId, 'CARD'));
    }

    async reconcileOrderPayment(orderId: string, userId: string, role: string) {
        const order = await this.assertCanAccessOrder(orderId, userId, role, {
            paymentTransactions: { orderBy: { createdAt: 'desc' }, take: 1 },
        });
        const latestPayment = order.paymentTransactions[0];
        if (latestPayment?.provider === 'ASAAS') await this.asaas.reconcile(latestPayment);
        const refreshed = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: { paymentTransactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (!refreshed) throw new NotFoundException('Pedido não encontrado');
        return {
            orderId: refreshed.id,
            orderStatus: refreshed.status,
            paymentMethod: refreshed.paymentMethod,
            totalCents: refreshed.totalCents,
            latestPayment: refreshed.paymentTransactions[0]
                ? this.serializePaymentTransaction(refreshed.paymentTransactions[0])
                : null,
        };
    }

    async cancelPendingPayment(orderId: string, userId: string, role: string) {
        await this.assertCanAccessOrder(orderId, userId, role);
        return this.serializePaymentTransaction(await this.asaas.cancel(orderId));
    }

    serializePaymentTransaction(transaction: {
        id: string; provider: string; paymentMethod: string; status: string; externalId: string | null;
        createdAt: Date; updatedAt: Date; expiresAt: Date | null; paidAt: Date | null; lastError: string | null;
        detailsJson: string | null; creationState?: string; refundedAmountCents?: number; reviewReason?: string | null;
    }) {
        const details = this.parseDetails(transaction.detailsJson);
        return {
            id: transaction.id, provider: transaction.provider, paymentMethod: transaction.paymentMethod,
            status: transaction.status, externalId: transaction.externalId, expiresAt: transaction.expiresAt,
            paidAt: transaction.paidAt, lastError: transaction.lastError, creationState: transaction.creationState ?? 'CREATED',
            refundedAmountCents: transaction.refundedAmountCents ?? 0, reviewRequired: !!transaction.reviewReason,
            checkoutUrl: typeof details.checkoutUrl === 'string' ? details.checkoutUrl : null,
            qrCode: typeof details.qrCode === 'string' ? details.qrCode : null,
            qrCodeBase64: typeof details.qrCodeBase64 === 'string' ? details.qrCodeBase64 : null,
            ticketUrl: null, brand: null, lastFourDigits: null,
            statusDetail: typeof details.statusDetail === 'string' ? details.statusDetail : null,
            receiptUrl: typeof details.receiptUrl === 'string' ? details.receiptUrl : null,
            createdAt: transaction.createdAt, updatedAt: transaction.updatedAt,
        };
    }

    private async assertCanAccessOrder(orderId: string, userId: string, role: string, include: object = {}) {
        const order = await this.prisma.order.findUnique({ where: { id: orderId }, include }) as any;
        if (!order) throw new NotFoundException('Pedido não encontrado');
        if (role === 'CLIENT' && order.userId !== userId) throw new ForbiddenException('Acesso negado a este pedido.');
        return order;
    }

    private parseDetails(value: string | null): Record<string, unknown> {
        if (!value) return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch { return {}; }
    }
}
