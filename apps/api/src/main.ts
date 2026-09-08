import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { payloadCrypto } from './common/payload-crypto';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
        rawBody: true,
    });

    const logger = new Logger('Bootstrap');

    // CORS
    const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
        .split(',')
        .map(o => o.trim());
    app.enableCors({
        origin: corsOrigins,
        credentials: true,
        exposedHeaders: ['X-Payload-Encrypted'],
    });
    app.useBodyParser('json', { limit: '128kb' });
    app.use(payloadCrypto());

    // Global validation pipe
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    // Global prefix
    app.setGlobalPrefix('api/v1');

    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    logger.log(`🚀 Cantina API rodando em http://localhost:${port}/api/v1`);
}

bootstrap();
