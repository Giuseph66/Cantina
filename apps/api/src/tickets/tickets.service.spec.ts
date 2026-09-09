import { Test, TestingModule } from '@nestjs/testing';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppSettingsService } from '../common/services/app-settings.service';

describe('TicketsService', () => {
    let service: TicketsService;
    let prisma: PrismaService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TicketsService,
                {
                    provide: PrismaService,
                    useValue: {
                        ticket: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
                        order: { update: jest.fn() },
                        $transaction: jest.fn((cb) => {
                            if (Array.isArray(cb)) return cb;
                            return cb(prisma);
                        }),
                    },
                },
                { provide: AuditService, useValue: { log: jest.fn() } },
                { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
                { provide: AppSettingsService, useValue: { getTicketExpiresAt: jest.fn(() => new Date(Date.now() + 1800000)) } },
            ],
        }).compile();

        service = module.get<TicketsService>(TicketsService);
        prisma = module.get<PrismaService>(PrismaService);
    });

    it('deve consumir ticket não expirado e não consumido', async () => {
        const mockTicket = { id: 'tk1', expiresAt: new Date(Date.now() + 100000), consumedAt: null, orderId: 'ord1', order: { status: 'PAID' } };
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue(mockTicket as any);
        jest.spyOn(prisma.ticket, 'update').mockResolvedValue({ ...mockTicket, consumedAt: new Date() } as any);

        const result = await service.consumeTicket('tk1', 'cashier-1');
        expect(result.alreadyConsumed).toBe(false);
    });

    it.each(['PIX', 'CARD'])('só libera retirada online %s após o pedido ficar pronto', async (paymentMethod) => {
        const baseTicket = {
            id: 'tk-online',
            expiresAt: new Date(Date.now() + 100000),
            consumedAt: null,
            orderId: 'ord-online',
            order: { channel: 'ONLINE', status: 'PAID', paymentMethod, paidAt: new Date() },
        };
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue(baseTicket as any);

        await expect(service.consumeTicket('tk-online', 'cashier-1')).rejects.toThrow(
            'Este pedido ainda está sendo separado',
        );

        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue({
            ...baseTicket,
            order: { ...baseTicket.order, status: 'IN_PREP' },
        } as any);
        await expect(service.consumeTicket('tk-online', 'cashier-1')).rejects.toThrow(
            'Este pedido ainda está sendo separado',
        );

        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue({
            ...baseTicket,
            order: { ...baseTicket.order, status: 'READY' },
        } as any);
        jest.spyOn(prisma.ticket, 'update').mockResolvedValue({ ...baseTicket, consumedAt: new Date() } as any);

        await expect(service.consumeTicket('tk-online', 'cashier-1')).resolves.toMatchObject({ alreadyConsumed: false });
        expect(prisma.order.update).toHaveBeenCalledWith({
            where: { id: 'ord-online' },
            data: { status: 'PICKED_UP' },
        });
    });

    it('deve ser idempotente caso tente consumir novamente', async () => {
        const mockTicket = { id: 'tk1', expiresAt: new Date(Date.now() + 100000), consumedAt: new Date(), orderId: 'ord1', order: { status: 'PAID' } };
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue(mockTicket as any);

        const result = await service.consumeTicket('tk1', 'cashier-1');
        expect(result.alreadyConsumed).toBe(true);
    });

    it('deve rejeitar ticket expirado', async () => {
        const mockTicket = { id: 'tk1', expiresAt: new Date(Date.now() - 100000), consumedAt: null, orderId: 'ord1', order: { status: 'PAID' } };
        jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue(mockTicket as any);

        await expect(service.consumeTicket('tk1', 'cashier-1')).rejects.toThrow(BadRequestException);
    });
});
