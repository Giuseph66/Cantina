import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sonda pública de disponibilidade.
 * Sem autenticação e sem envelope criptográfico: precisa responder mesmo
 * quando o resto da aplicação está degradado.
 */
@Controller('health')
export class HealthController {
    private readonly startedAt = Date.now();

    constructor(private readonly prisma: PrismaService) { }

    @Get()
    async check(@Res({ passthrough: true }) res: Response) {
        let database: 'up' | 'down' = 'up';
        try {
            await this.prisma.$queryRaw`SELECT 1`;
        } catch {
            database = 'down';
        }

        res.setHeader('Cache-Control', 'no-store');
        if (database === 'down') res.status(503);

        return {
            status: database === 'up' ? 'ok' : 'degraded',
            database,
            uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
            timestamp: new Date().toISOString(),
        };
    }
}
