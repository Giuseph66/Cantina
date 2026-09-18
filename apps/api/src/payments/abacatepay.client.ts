import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const ABACATEPAY_BASE_URL = 'https://api.abacatepay.com/v2';
// Public verification key published by AbacatePay for HMAC-SHA256 webhooks.
const ABACATEPAY_WEBHOOK_PUBLIC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export type AbacatePayEnvironment = 'development' | 'production';

export type AbacatePayTransparentPayment = {
    id: string;
    amount: number;
    status: string;
    brCode: string;
    brCodeBase64: string;
    expiresAt: string;
    receiptUrl?: string | null;
};

export class AbacatePayRequestError extends Error {
    constructor(readonly status: number, readonly definitive: boolean) {
        super(status ? `AbacatePay HTTP ${status}` : 'AbacatePay indisponível; resultado da requisição desconhecido');
    }
}

@Injectable()
export class AbacatePayClient {
    get environment(): AbacatePayEnvironment {
        const value = process.env.ABACATEPAY_ENV?.trim();
        if (value !== 'development' && value !== 'production') {
            throw new ServiceUnavailableException('Configure ABACATEPAY_ENV como development ou production.');
        }
        return value;
    }

    get accountRef() { return process.env.ABACATEPAY_ACCOUNT_REF?.trim() || 'default'; }

    get scope() { return { environment: this.environment, accountRef: this.accountRef }; }

    get apiKey(): string {
        const value = process.env.ABACATEPAY_API_KEY?.trim();
        if (!value || /\s/.test(value)) throw new ServiceUnavailableException('Chave AbacatePay não configurada.');
        return value;
    }

    get webhookSecret(): string {
        const value = process.env.ABACATEPAY_WEBHOOK_SECRET?.trim();
        if (!value || value.length < 32 || value.length > 255 || /\s/.test(value)) {
            throw new ServiceUnavailableException('Segredo do webhook AbacatePay não configurado.');
        }
        return value;
    }

    get webhookEndpoint(): string {
        const base = process.env.APP_PUBLIC_URL?.trim();
        let url: URL;
        try { url = new URL(base ?? ''); }
        catch { throw new ServiceUnavailableException('APP_PUBLIC_URL inválida para o webhook AbacatePay.'); }
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new ServiceUnavailableException('O webhook AbacatePay exige APP_PUBLIC_URL com HTTPS.');
        }
        url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/webhooks/abacatepay`;
        url.search = '';
        url.searchParams.set('webhookSecret', this.webhookSecret);
        return url.href;
    }

    get configured(): boolean {
        try {
            void this.apiKey;
            void this.environment;
            void this.webhookEndpoint;
            return true;
        } catch { return false; }
    }

    async createTransparentPix(input: {
        amountCents: number; expiresInSeconds: number; description: string; externalId: string;
        orderId: string; paymentId: string; customer: { name: string; email: string; taxId: string; cellphone: string };
    }): Promise<AbacatePayTransparentPayment> {
        const response = await this.request<AbacatePayTransparentPayment>('/transparents/create', 'POST', {
            method: 'PIX',
            data: {
                amount: input.amountCents,
                expiresIn: input.expiresInSeconds,
                description: input.description,
                externalId: input.externalId,
                metadata: { orderId: input.orderId, paymentId: input.paymentId },
                customer: input.customer,
            },
        });
        if (!this.isTransparentPayment(response) || response.amount !== input.amountCents) {
            throw new AbacatePayRequestError(502, false);
        }
        return response;
    }

    async checkTransparent(id: string) {
        if (!id || id.length > 255) throw new Error('Identificador AbacatePay inválido.');
        return this.request<{ id: string; status: string; expiresAt?: string }>('/transparents/check?id=' + encodeURIComponent(id));
    }

    verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
        if (!signature || !rawBody.length) return false;
        const expected = createHmac('sha256', ABACATEPAY_WEBHOOK_PUBLIC_KEY).update(rawBody).digest('base64');
        const expectedBuffer = Buffer.from(expected);
        const receivedBuffer = Buffer.from(signature);
        return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
    }

    safeReceiptUrl(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password
                && (url.hostname === 'abacatepay.com' || url.hostname.endsWith('.abacatepay.com')) ? url.href : null;
        } catch { return null; }
    }

    private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
        if (!path.startsWith('/') || path.includes('://')) throw new Error('Caminho AbacatePay inválido.');
        let response: Response;
        try {
            response = await fetch(ABACATEPAY_BASE_URL + path, {
                method,
                redirect: 'error',
                signal: AbortSignal.timeout(20_000),
                headers: { Authorization: `Bearer ${this.apiKey}`, 'User-Agent': 'Cantina/1.0', 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch { throw new AbacatePayRequestError(0, false); }
        if (!response.ok) throw new AbacatePayRequestError(response.status, [400, 401, 403, 404, 422].includes(response.status));
        let payload: unknown;
        try { payload = await response.json(); }
        catch { throw new AbacatePayRequestError(response.status, false); }
        const envelope = payload as { data?: unknown; success?: unknown };
        if (!envelope || typeof envelope !== 'object' || !envelope.data || envelope.success === false) {
            throw new AbacatePayRequestError(response.status, false);
        }
        return envelope.data as T;
    }

    private isTransparentPayment(value: unknown): value is AbacatePayTransparentPayment {
        const payment = value as Partial<AbacatePayTransparentPayment>;
        return !!payment && typeof payment.id === 'string' && typeof payment.amount === 'number'
            && typeof payment.status === 'string' && typeof payment.brCode === 'string'
            && typeof payment.brCodeBase64 === 'string' && typeof payment.expiresAt === 'string';
    }
}
