import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppSettingsService } from '../common/services/app-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasPaymentsService } from './asaas-payments.service';
import { AbacatePayPaymentsService } from './abacatepay-payments.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
    let service: PaymentsService;
    const prisma = { order: { findUnique: jest.fn() } };
    const asaas = { client: { configured: true, environment: 'sandbox' }, create: jest.fn(), reconcile: jest.fn(), cancel: jest.fn() };
    const abacatepay = { client: { configured: false, environment: 'development' }, create: jest.fn(), reconcile: jest.fn(), cancel: jest.fn() };

    beforeEach(async () => {
        jest.clearAllMocks();
        service = (await Test.createTestingModule({ providers: [
            PaymentsService,
            { provide: PrismaService, useValue: prisma },
            { provide: AsaasPaymentsService, useValue: asaas },
            { provide: AbacatePayPaymentsService, useValue: abacatepay },
            { provide: AppSettingsService, useValue: { getSettings: () => ({ allowOnPickupPayment: true }) } },
        ] }).compile()).get(PaymentsService);
    });

    it('keeps Asaas as the default Pix and card provider', () => {
        const previous = process.env.PIX_PROVIDER;
        delete process.env.PIX_PROVIDER;
        try {
            expect(service.getPublicConfig()).toMatchObject({
                pixEnabled: true, pixProvider: 'ASAAS', cardEnabled: true, cardProvider: 'ASAAS', cardFlow: 'HOSTED_INVOICE', sandbox: true,
            });
        } finally {
            if (previous === undefined) delete process.env.PIX_PROVIDER;
            else process.env.PIX_PROVIDER = previous;
        }
    });

    it('uses AbacatePay for Pix only when explicitly configured', async () => {
        const previous = process.env.PIX_PROVIDER;
        process.env.PIX_PROVIDER = 'ABACATEPAY';
        abacatepay.client.configured = true;
        prisma.order.findUnique.mockResolvedValue({ id: 'order-1', userId: 'user-1' });
        abacatepay.create.mockResolvedValue({ id: 'payment-1', provider: 'ABACATEPAY', paymentMethod: 'PIX', status: 'PENDING', externalId: 'pix_1', createdAt: new Date(), updatedAt: new Date(), expiresAt: null, paidAt: null, lastError: null, detailsJson: null });

        await service.createPixPayment('order-1', 'user-1', 'CLIENT', {});

        expect(abacatepay.create).toHaveBeenCalledWith('order-1');
        expect(asaas.create).not.toHaveBeenCalled();
        if (previous === undefined) delete process.env.PIX_PROVIDER;
        else process.env.PIX_PROVIDER = previous;
    });

    it('does not let a client start payment for another order', async () => {
        prisma.order.findUnique.mockResolvedValue({ id: 'order-1', userId: 'other-user' });
        await expect(service.createPixPayment('order-1', 'user-1', 'CLIENT', {})).rejects.toBeInstanceOf(ForbiddenException);
        expect(asaas.create).not.toHaveBeenCalled();
    });
});
