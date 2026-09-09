import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { ConfigService } from '@nestjs/config';
import { OrderChannel, OrderStatus, PaymentMethod, StockMode } from '../common/enums';
import { MarkInternalCreditDto } from './dto/ticket.dto';
import * as crypto from 'crypto';
import { AppSettingsService } from '../common/services/app-settings.service';

@Injectable()
export class TicketsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly config: ConfigService,
        private readonly appSettings: AppSettingsService,
    ) {
    }

    /** Generates a unique 6-char alphanumeric code like "A7KF29" */
    private generateShortCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        const bytes = crypto.randomBytes(6);
        for (let i = 0; i < 6; i++) {
            code += chars[bytes[i] % chars.length];
        }
        return code;
    }

    private signToken(ticketId: string, orderId: string, exp: number): string {
        const secret = this.config.get<string>('JWT_SECRET', 'dev_secret');
        const payload = `${ticketId}.${orderId}.${exp}`;
        return crypto.createHmac('sha256', secret).update(payload).digest('hex');
    }

    async generateTicket(orderId: string) {
        const expiresAt = this.appSettings.getTicketExpiresAt();

        // Ensure unique short code
        let codeShort = this.generateShortCode();
        let attempts = 0;
        while (await this.prisma.ticket.findUnique({ where: { codeShort } })) {
            codeShort = this.generateShortCode();
            if (++attempts > 10) throw new Error('Falha ao gerar código único de ticket');
        }

        const tempId = crypto.randomUUID();
        const tokenHash = this.signToken(tempId, orderId, expiresAt.getTime());

        const ticket = await this.prisma.ticket.create({
            data: {
                orderId,
                codeShort,
                tokenHash,
                expiresAt,
            },
        });

        // Update tokenHash with real ticket.id
        const finalHash = this.signToken(ticket.id, orderId, expiresAt.getTime());
        return this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { tokenHash: finalHash },
        });
    }

    async validateByCode(code: string) {
        const ticket = await this.prisma.ticket.findUnique({
            where: { codeShort: code.toUpperCase().replace(/[^A-Z0-9]/g, '') },
            include: {
                order: {
                    include: { items: { include: { product: true } }, user: true, creditNote: true },
                },
            },
        });

        if (!ticket) throw new NotFoundException('Ticket não encontrado');
        if (ticket.expiresAt < new Date())
            throw new BadRequestException('Ticket expirado');

        return {
            ticket,
            order: ticket.order,
            alreadyConsumed: !!ticket.consumedAt,
        };
    }

    async validateByToken(tokenHash: string) {
        const ticket = await this.prisma.ticket.findUnique({
            where: { tokenHash },
            include: {
                order: {
                    include: { items: { include: { product: true } }, user: true, creditNote: true },
                },
            },
        });

        if (!ticket) throw new NotFoundException('Ticket inválido');
        if (ticket.expiresAt < new Date())
            throw new BadRequestException('Ticket expirado');

        return {
            ticket,
            order: ticket.order,
            alreadyConsumed: !!ticket.consumedAt,
        };
    }

    /** Idempotent consume — safe to call twice */
    async consumeTicket(ticketId: string, consumedByUserId: string) {
        const ticket = await this.prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { order: { include: { items: true } } },
        });

        if (!ticket) throw new NotFoundException('Ticket não encontrado');
        if (ticket.expiresAt < new Date())
            throw new BadRequestException('Ticket expirado');

        // Idempotency: already consumed → return current state
        if (ticket.consumedAt) {
            return { ticket, alreadyConsumed: true };
        }

        // Block consumption if payment has not been confirmed yet
        if (ticket.order.status === OrderStatus.CREATED) {
            throw new BadRequestException('Pagamento ainda não confirmado. Registre o pagamento antes de liberar a retirada.');
        }

        // For PIX orders, paidAt must be explicitly set by the webhook or by the cashier
        // (prevents fraud via POST /orders/public/:id/report-paid, which only sets CONFIRMED
        // but never sets paidAt — only the real webhook/cashier mark-paid sets paidAt)
        if (ticket.order.paymentMethod === PaymentMethod.PIX && !ticket.order.paidAt) {
            throw new BadRequestException(
                'Pagamento PIX não confirmado pelo sistema. Verifique o comprovante e use "Marcar como pago" antes de liberar a retirada.',
            );
        }

        if (ticket.order.channel === OrderChannel.ONLINE && ticket.order.status !== OrderStatus.READY) {
            throw new BadRequestException(
                'Este pedido ainda está sendo separado. Marque como pronto antes de confirmar a retirada.',
            );
        }

        const [updatedTicket] = await this.prisma.$transaction([
            this.prisma.ticket.update({
                where: { id: ticketId },
                data: { consumedAt: new Date(), consumedByUserId },
            }),
            this.prisma.order.update({
                where: { id: ticket.orderId },
                data: { status: OrderStatus.PICKED_UP },
            }),
        ]);

        await this.audit.log(consumedByUserId, 'TICKET_CONSUMED', 'Ticket', ticketId, {
            orderId: ticket.orderId,
            offline: false
        });

        return { ticket: updatedTicket, alreadyConsumed: false };
    }

    /** 
     * Retorna todos os tickets que ainda podem ser consumidos hoje.
     * Usado pelo CASHIER para salvar a base local no IndexedDB.
     */
    async getOfflineCache() {
        const tickets = await this.prisma.ticket.findMany({
            where: {
                consumedAt: null,
                expiresAt: { gt: new Date() },
                order: { status: { in: [OrderStatus.CREATED, OrderStatus.CONFIRMED, OrderStatus.PAID] } },
            },
            include: { order: { include: { items: { include: { product: true } }, user: true } } },
        });

        return tickets; // Retorna array espelhado com o db
    }

    /**
     * Sincroniza uma fila de consumos offline enviada pela cantina.
     */
    async syncConsumptions(consumptions: { ticketId: string; consumedAtOffline: string; deviceId: string }[], actorUserId: string) {
        const results = [];

        for (const c of consumptions) {
            try {
                const ticket = await this.prisma.ticket.findUnique({
                    where: { id: c.ticketId },
                    include: { order: true },
                });

                if (!ticket) {
                    results.push({ ticketId: c.ticketId, status: 'error', reason: 'TICKET_NOT_FOUND' });
                    continue;
                }

                // Se já consumido e a data local for mais atual, ou outro dispositivo consumiu
                if (ticket.consumedAt) {
                    results.push({ ticketId: c.ticketId, status: 'already_consumed', consumedAt: ticket.consumedAt });
                    continue;
                }

                if (ticket.expiresAt < new Date(c.consumedAtOffline)) {
                    results.push({ ticketId: c.ticketId, status: 'error', reason: 'EXPIRED_BEFORE_CONSUME' });
                    continue;
                }

                // Sucesso na sincronização
                await this.prisma.$transaction([
                    this.prisma.ticket.update({
                        where: { id: c.ticketId },
                        data: { consumedAt: new Date(c.consumedAtOffline), consumedByUserId: actorUserId },
                    }),
                    this.prisma.order.update({
                        where: { id: ticket.orderId },
                        data: { status: OrderStatus.PICKED_UP },
                    }),
                ]);

                await this.audit.log(actorUserId, 'TICKET_CONSUMED', 'Ticket', c.ticketId, {
                    orderId: ticket.orderId,
                    offline: true,
                    deviceId: c.deviceId,
                    consumedAtOffline: c.consumedAtOffline,
                });

                results.push({ ticketId: c.ticketId, status: 'synced' });

            } catch (err: any) {
                results.push({ ticketId: c.ticketId, status: 'error', reason: err.message });
            }
        }

        return { synced: results.filter(r => r.status === 'synced').length, results };
    }

    async markOrderPaid(ticketId: string, actorUserId: string) {
        const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) throw new NotFoundException('Ticket não encontrado');

        await this.prisma.order.update({
            where: { id: ticket.orderId },
            data: { status: OrderStatus.PAID, paidAt: new Date() },
        });

        await this.audit.log(actorUserId, 'ORDER_PAID', 'Order', ticket.orderId, { ticketId });
    }

    async markOrderPending(ticketId: string, actorUserId: string) {
        const ticket = await this.prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                order: true,
            },
        });

        if (!ticket) throw new NotFoundException('Ticket não encontrado');

        if (
            ticket.order.status === OrderStatus.PICKED_UP
            || ticket.order.status === OrderStatus.CANCELLED
            || ticket.order.status === OrderStatus.EXPIRED
        ) {
            throw new BadRequestException('Este pedido não pode mais voltar para pendente.');
        }

        const nextStatus = ticket.order.paymentMethod === PaymentMethod.ON_PICKUP
            ? OrderStatus.CONFIRMED
            : OrderStatus.CREATED;

        const updatedOrder = await this.prisma.order.update({
            where: { id: ticket.orderId },
            data: {
                status: nextStatus,
                paidAt: null,
            },
        });

        await this.audit.log(actorUserId, 'ORDER_MARKED_PENDING', 'Order', ticket.orderId, {
            ticketId,
            previousStatus: ticket.order.status,
            nextStatus,
        });

        return updatedOrder;
    }

    async markOrderInternalCredit(ticketId: string, actorUserId: string, dto: MarkInternalCreditDto) {
        const ticket = await this.prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                order: {
                    include: {
                        user: true,
                        creditNote: true,
                    },
                },
            },
        });

        if (!ticket) throw new NotFoundException('Ticket não encontrado');

        if (
            ticket.order.status === OrderStatus.PICKED_UP
            || ticket.order.status === OrderStatus.CANCELLED
            || ticket.order.status === OrderStatus.EXPIRED
        ) {
            throw new BadRequestException('Este pedido não pode mais ser enviado para a notinha.');
        }

        if (ticket.order.creditNote) {
            throw new ConflictException('Este pedido já foi lançado em uma notinha.');
        }

        const customerName = ticket.order.user?.name?.trim() || dto.customerName?.trim();
        if (!customerName) {
            throw new BadRequestException('Informe um nome para lançar a notinha deste cliente.');
        }

        const dueAt = dto.dueAt
            ? new Date(dto.dueAt)
            : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

        const updatedOrder = await this.prisma.$transaction(async (tx) => {
            const order = await tx.order.update({
                where: { id: ticket.orderId },
                data: {
                    paymentMethod: PaymentMethod.INTERNAL_CREDIT,
                    status: OrderStatus.CONFIRMED,
                    paidAt: null,
                },
                include: {
                    items: { include: { product: true } },
                    user: true,
                    creditNote: true,
                },
            });

            const creditNote = await tx.creditNote.create({
                data: {
                    orderId: order.id,
                    customerUserId: order.userId,
                    customerName,
                    customerPhone: dto.customerPhone?.trim() || null,
                    totalCents: order.totalCents,
                    dueAt,
                    notes: dto.notes?.trim() || null,
                    createdById: actorUserId,
                },
            });

            return {
                ...order,
                creditNote,
            };
        });

        await this.audit.log(actorUserId, 'ORDER_MOVED_TO_CREDIT_NOTE', 'Order', ticket.orderId, {
            ticketId,
            customerUserId: ticket.order.userId,
            customerName,
            dueAt: dueAt.toISOString(),
        });

        return updatedOrder;
    }

    async expireOverdueTickets() {
        const now = new Date();
        const overdueTickets = await this.prisma.ticket.findMany({
            where: {
                expiresAt: { lte: now },
                consumedAt: null,
                order: { status: { in: [OrderStatus.CREATED, OrderStatus.CONFIRMED] } },
            },
            include: { order: { include: { items: true } } },
        });

        for (const ticket of overdueTickets) {
            await this.prisma.$transaction(async (tx) => {
                // Return stock
                for (const item of ticket.order.items) {
                    const product = await tx.product.findUnique({ where: { id: item.productId } });
                    if (product?.stockMode === StockMode.CONTROLLED) {
                        await tx.product.update({
                            where: { id: item.productId },
                            data: { stockQty: { increment: item.qty } },
                        });
                    }
                }
                await tx.order.update({
                    where: { id: ticket.orderId },
                    data: { status: OrderStatus.EXPIRED },
                });
            });

            await this.audit.log(null, 'ORDER_EXPIRED', 'Order', ticket.orderId, {
                ticketId: ticket.id,
            });
        }

        return overdueTickets.length;
    }
}
