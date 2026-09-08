import { Body, Controller, Get, Param, Post, Headers, UseGuards, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { CreateCardPaymentDto, CreatePixPaymentDto } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { AsaasPaymentsService } from './asaas-payments.service';

@Controller()
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService, private readonly asaas: AsaasPaymentsService) { }

    @Post('webhooks/asaas')
    @HttpCode(200)
    asaasWebhook(@Headers('asaas-access-token') token: string | undefined, @Body() body: Record<string, unknown>) {
        return this.asaas.receiveWebhook(token, body);
    }

    @Get('payments/public-config')
    getPublicConfig() {
        return this.paymentsService.getPublicConfig();
    }

    @Post('payments/orders/:orderId/pix')
    @UseGuards(JwtAuthGuard, CsrfGuard)
    @Throttle({ default: { ttl: 60000, limit: 8 } })
    createPixPayment(@Param('orderId') orderId: string, @Body() dto: CreatePixPaymentDto, @CurrentUser() user: User) {
        return this.paymentsService.createPixPayment(orderId, user.id, user.role, dto);
    }

    @Post('payments/orders/:orderId/card')
    @UseGuards(JwtAuthGuard, CsrfGuard)
    @Throttle({ default: { ttl: 60000, limit: 8 } })
    createCardPayment(@Param('orderId') orderId: string, @Body() dto: CreateCardPaymentDto, @CurrentUser() user: User) {
        return this.paymentsService.createCardPayment(orderId, user.id, user.role, dto);
    }

    @Get('payments/orders/:orderId/reconcile')
    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { ttl: 60000, limit: 20 } })
    reconcileOrderPayment(@Param('orderId') orderId: string, @CurrentUser() user: User) {
        return this.paymentsService.reconcileOrderPayment(orderId, user.id, user.role);
    }

    @Post('payments/orders/:orderId/cancel')
    @UseGuards(JwtAuthGuard, CsrfGuard)
    @Throttle({ default: { ttl: 60000, limit: 8 } })
    cancelPayment(@Param('orderId') orderId: string, @CurrentUser() user: User) {
        return this.paymentsService.cancelPendingPayment(orderId, user.id, user.role);
    }

}
