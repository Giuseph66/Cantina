import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AsaasPaymentsService } from '../payments/asaas-payments.service';

@Injectable()
export class PaymentReconciliationTask {
    constructor(private readonly asaas: AsaasPaymentsService) { }

    @Cron(CronExpression.EVERY_10_SECONDS)
    async handleAsaasPayments() {
        await this.asaas.processPending();
    }
}
