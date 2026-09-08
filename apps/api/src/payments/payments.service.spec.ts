import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppSettingsService } from '../common/services/app-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasPaymentsService } from './asaas-payments.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
    let service: PaymentsService;
    const prisma = { order: { findUnique: jest.fn() } };
    const asaas = { client: { configured: true, environment: 'sandbox' }, create: jest.fn(), reconcile: jest.fn(), cancel: jest.fn() };

    beforeEach(async () => {
        jest.clearAllMocks();
        service = (await Test.createTestingModule({ providers: [
            PaymentsService,
            { provide: PrismaService, useValue: prisma },
            { provide: AsaasPaymentsService, useValue: asaas },
            { provide: AppSettingsService, useValue: { getSettings: () => ({ allowOnPickupPayment: true }) } },
        ] }).compile()).get(PaymentsService);
    });

    it('exposes only the Asaas hosted flow', () => {
        expect(service.getPublicConfig()).toMatchObject({
            pixEnabled: true, cardEnabled: true, cardProvider: 'ASAAS', cardFlow: 'HOSTED_INVOICE', sandbox: true,
        });
    });

    it('does not let a client start payment for another order', async () => {
        prisma.order.findUnique.mockResolvedValue({ id: 'order-1', userId: 'other-user' });
        await expect(service.createPixPayment('order-1', 'user-1', 'CLIENT', {})).rejects.toBeInstanceOf(ForbiddenException);
        expect(asaas.create).not.toHaveBeenCalled();
    });
});
