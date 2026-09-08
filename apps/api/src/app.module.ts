import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { TicketsModule } from './tickets/tickets.module';
import { CounterModule } from './counter/counter.module';
import { CashModule } from './cash/cash.module';
import { AdminModule } from './admin/admin.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { EventsModule } from './events/events.module';
import { ReportsModule } from './reports/reports.module';
import { UploadsModule } from './uploads/uploads.module';
import { CreditNotesModule } from './credit-notes/credit-notes.module';
import { PaymentsModule } from './payments/payments.module';
import { BackupsModule } from './backups/backups.module';
import { HealthModule } from './health/health.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { LoggerMiddleware } from './common/middleware/logger.middleware';


@Module({
    imports: [
        ServeStaticModule.forRoot({
            rootPath: join(process.cwd(), 'uploads'),
            serveRoot: '/uploads',
        }),
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
        ScheduleModule.forRoot(),
        PrismaModule,
        CommonModule,
        AuthModule,
        UsersModule,
        CatalogModule,
        OrdersModule,
        TicketsModule,
        CounterModule,
        CashModule,
        AdminModule,
        SchedulerModule,
        EventsModule,
        ReportsModule,
        UploadsModule,
        CreditNotesModule,
        PaymentsModule,
        BackupsModule,
        HealthModule,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(RequestIdMiddleware, LoggerMiddleware).forRoutes('*');
    }

}
