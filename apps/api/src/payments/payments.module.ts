import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AsaasClient } from './asaas.client';
import { AsaasPaymentsService } from './asaas-payments.service';
import { AbacatePayClient } from './abacatepay.client';
import { AbacatePayPaymentsService } from './abacatepay-payments.service';

@Module({
    controllers: [PaymentsController],
    providers: [PaymentsService, AsaasClient, AsaasPaymentsService, AbacatePayClient, AbacatePayPaymentsService],
    exports: [PaymentsService, AsaasPaymentsService, AbacatePayPaymentsService],
})
export class PaymentsModule { }
