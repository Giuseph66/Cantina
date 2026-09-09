import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { AuditService } from '../common/services/audit.service';
import { AppSettingsService } from '../common/services/app-settings.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, PaymentMethod, StockMode } from '../common/enums';

@Injectable()
export class OrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly ticketsService: TicketsService,
        private readonly audit: AuditService,
        private readonly appSettings: AppSettingsService,
    ) { }

    async createOrder(userId: string, dto: CreateOrderDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                isActive: true,
                cpf: true,
                phone: true,
            },
        });

        if (!user || !user.isActive) {
            throw new ForbiddenException('Sessão inválida para criar pedidos.');
        }

        if (!user.cpf || !user.phone) {
            throw new BadRequestException('Complete CPF e celular antes de finalizar o pedido.');
        }

        if (dto.paymentMethod !== PaymentMethod.ONLINE && dto.paymentMethod !== PaymentMethod.ON_PICKUP) {
            throw new BadRequestException('Forma de pagamento inválida para o checkout');
        }

        const settings = this.appSettings.getSettings();
        if (dto.paymentMethod === PaymentMethod.ON_PICKUP && !settings.allowOnPickupPayment) {
            throw new BadRequestException('Pagamento no balcão está desativado no momento');
        }

        const productIds = dto.items.map((item) => item.productId);
        const products = await this.prisma.product.findMany({
            where: { id: { in: productIds }, isActive: true },
        });

        if (products.length !== dto.items.length) {
            throw new BadRequestException('Um ou mais produtos não encontrados ou inativos');
        }

        for (const item of dto.items) {
            const product = products.find((current) => current.id === item.productId)!;
            if (product.stockMode === StockMode.CONTROLLED && product.stockQty < item.qty) {
                throw new BadRequestException(
                    `Estoque insuficiente para "${product.name}" (disponível: ${product.stockQty})`,
                );
            }
        }

        const order = await this.prisma.$transaction(async (tx) => {
            for (const item of dto.items) {
                const product = products.find((current) => current.id === item.productId)!;
                if (product.stockMode === StockMode.CONTROLLED) {
                    const current = await tx.product.findUnique({ where: { id: item.productId } });
                    if (!current || current.stockQty < item.qty) {
                        throw new BadRequestException(`Estoque insuficiente para "${product.name}"`);
                    }
                    await tx.product.update({
                        where: { id: item.productId },
                        data: { stockQty: { decrement: item.qty } },
                    });
                }
            }

            const totalCents = dto.items.reduce((sum, item) => {
                const product = products.find((current) => current.id === item.productId)!;
                return sum + product.priceCents * item.qty;
            }, 0);

            return tx.order.create({
                data: {
                    userId,
                    channel: 'ONLINE',
                    status: dto.paymentMethod === PaymentMethod.ON_PICKUP ? OrderStatus.CONFIRMED : OrderStatus.CREATED,
                    totalCents,
                    paymentMethod: dto.paymentMethod,
                    items: {
                        create: dto.items.map((item) => {
                            const product = products.find((current) => current.id === item.productId)!;
                            return {
                                productId: item.productId,
                                productName: product.name,
                                qty: item.qty,
                                unitPriceCents: product.priceCents,
                                subtotalCents: product.priceCents * item.qty,
                            };
                        }),
                    },
                },
                include: this.orderInclude,
            });
        });

        const ticket = await this.ticketsService.generateTicket(order.id);
        const completeOrder = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: this.orderInclude,
        });

        if (!completeOrder) {
            throw new NotFoundException('Pedido não encontrado após criação');
        }

        await this.audit.log(userId, 'ORDER_CREATED', 'Order', completeOrder.id, {
            totalCents: completeOrder.totalCents,
            itemCount: dto.items.length,
            paymentMethod: dto.paymentMethod,
        });

        return this.serializeOrder({ ...completeOrder, ticket });
    }

    async getMyOrders(userId: string) {
        const orders = await this.prisma.order.findMany({
            where: { userId, channel: 'ONLINE' },
            include: this.orderInclude,
            orderBy: { createdAt: 'desc' },
        });

        return orders.map((order) => this.serializeOrder(order));
    }

    async getMyOrdersSummary(userId: string) {
        const orders = await this.prisma.order.findMany({
            where: { userId },
            select: { totalCents: true, status: true, paymentMethod: true, paidAt: true },
        });

        const openCreditNotes = await this.prisma.creditNote.aggregate({
            _sum: { totalCents: true },
            where: {
                customerUserId: userId,
                status: 'OPEN',
            },
        });

        const totalSpentCents = orders
            .filter((order) => !!order.paidAt)
            .reduce((sum, order) => sum + order.totalCents, 0);

        const pendingPickupCount = orders
            .filter((order) => ['PAID', 'IN_PREP', 'READY', 'CONFIRMED'].includes(order.status)).length;

        const legacyPickupDebtCents = orders
            .filter((order) => order.paymentMethod === PaymentMethod.ON_PICKUP && order.status === 'CONFIRMED')
            .reduce((sum, order) => sum + order.totalCents, 0);

        return {
            totalOrders: orders.length,
            totalSpentCents,
            pendingPickupCount,
            creditDebtCents: (openCreditNotes._sum.totalCents ?? 0) + legacyPickupDebtCents,
        };
    }

    async getOrderById(orderId: string, userId: string, role: string) {
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                ...this.orderInclude,
                user: { select: { id: true, name: true, email: true } },
            },
        });

        if (!order) throw new NotFoundException('Pedido não encontrado');

        if (role === 'CLIENT' && order.userId !== userId) {
            throw new ForbiddenException('Acesso negado');
        }

        return this.serializeOrder(order);
    }

    async getTicketByOrderId(orderId: string, userId: string, role: string) {
        const order = await this.getOrderById(orderId, userId, role);
        if (!order.ticket) throw new NotFoundException('Ticket não encontrado para este pedido');
        return order.ticket;
    }

    async getReadyOrders() {
        return this.prisma.order.findMany({
            where: { status: OrderStatus.READY },
            include: { ticket: true },
            orderBy: { updatedAt: 'asc' },
        });
    }

    private readonly orderInclude = {
        items: {
            select: {
                productId: true,
                productName: true,
                qty: true,
                subtotalCents: true,
                unitPriceCents: true,
            },
        },
        ticket: {
            select: {
                id: true,
                codeShort: true,
                expiresAt: true,
                consumedAt: true,
                createdAt: true,
            },
        },
        paymentTransactions: {
            orderBy: { createdAt: 'desc' as const },
            take: 1,
        },
    };

    private serializeOrder(order: any) {
        const latestPayment = order.paymentTransactions?.[0]
            ? this.serializeLatestPayment(order.paymentTransactions[0])
            : null;

        return {
            ...order,
            paymentTransactions: undefined,
            latestPayment,
            items: order.items.map((item: any) => ({
                productId: item.productId,
                productName: item.productName,
                qty: item.qty,
                subtotalCents: item.subtotalCents,
                unitPriceCents: item.unitPriceCents,
            })),
        };
    }

    private serializeLatestPayment(transaction: any) {
        let details: Record<string, unknown> | null = null;
        if (transaction.detailsJson) {
            try {
                details = JSON.parse(transaction.detailsJson);
            } catch {
                details = null;
            }
        }

        return {
            id: transaction.id,
            provider: transaction.provider,
            paymentMethod: transaction.paymentMethod,
            status: transaction.status,
            expiresAt: transaction.expiresAt,
            paidAt: transaction.paidAt,
            lastError: transaction.lastError,
            qrCode: details?.qrCode ?? null,
            qrCodeBase64: this.normalizeQrCodeBase64(details?.qrCodeBase64),
            ticketUrl: details?.ticketUrl ?? null,
            brand: details?.brand ?? null,
            lastFourDigits: details?.lastFourDigits ?? null,
            statusDetail: details?.statusDetail ?? null,
            receiptUrl: details?.receiptUrl ?? null,
        };
    }

    private normalizeQrCodeBase64(value: unknown) {
        if (typeof value !== 'string') return null;
        const normalized = value.trim();
        if (!normalized) return null;
        if (normalized.startsWith('data:image')) {
            return normalized;
        }
        return `data:image/png;base64,${normalized}`;
    }
}
