import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AsaasClient } from './asaas.client';
import { AsaasPaymentsService } from './asaas-payments.service';

@Module({
    controllers: [PaymentsController],
    providers: [PaymentsService, AsaasClient, AsaasPaymentsService],
    exports: [PaymentsService, AsaasPaymentsService],
})
export class PaymentsModule { }
