import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type AsaasEnvironment = 'sandbox' | 'production';
export type AsaasPayment = {
    id: string;
    customer: string;
    externalReference: string | null;
    billingType: string;
    status: string;
    value: number;
    deleted?: boolean;
    invoiceUrl?: string;
    transactionReceiptUrl?: string;
    paymentDate?: string;
    confirmedDate?: string;
    refunds?: { status: string; value: number }[];
};

export class AsaasRequestError extends Error {
    constructor(readonly status: number, readonly definitive: boolean) {
        super(status ? `Asaas HTTP ${status}` : 'Asaas indisponível; resultado da requisição desconhecido');
    }
}

@Injectable()
export class AsaasClient {
    get environment(): AsaasEnvironment {
        const value = process.env.ASAAS_ENV;
        if (value !== 'sandbox' && value !== 'production') {
            throw new ServiceUnavailableException('Configure ASAAS_ENV antes de usar o Asaas.');
        }
        return value;
    }

    get accountRef(): string {
        const value = process.env.ASAAS_ACCOUNT_REF?.trim();
        if (!value) throw new ServiceUnavailableException('Conta Asaas não configurada.');
        return value;
    }

    get configured(): boolean {
        try { this.credentials(this.environment); return !!this.accountRef && !!this.webhookToken; }
        catch { return false; }
    }

    get webhookToken(): string {
        const token = process.env[`ASAAS_WEBHOOK_TOKEN_${this.environment.toUpperCase()}`]?.trim();
        if (!token || token.length < 32 || token.length > 255 || /\s/.test(token)) {
            throw new ServiceUnavailableException('Token do webhook Asaas não configurado.');
        }
        return token;
    }

    private credentials(environment: AsaasEnvironment) {
        const token = process.env[`ASAAS_API_KEY_${environment.toUpperCase()}`]?.trim();
        const prefix = environment === 'sandbox' ? '$aact_hmlg_' : '$aact_prod_';
        if (!token?.startsWith(prefix)) throw new ServiceUnavailableException('Credencial Asaas incompatível com o ambiente.');
        return token;
    }

    async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
        const environment = this.environment;
        const token = this.credentials(environment);
        if (!path.startsWith('/') || path.includes('://')) throw new Error('Invalid Asaas path');
        const base = environment === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
        let response: Response;
        try {
            response = await fetch(base + path, {
                method,
                redirect: 'error',
                signal: AbortSignal.timeout(20_000),
                headers: { access_token: token, 'User-Agent': 'Cantina/1.0', 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch { throw new AsaasRequestError(0, false); }
        if (!response.ok) {
            // Never include gateway bodies, request headers or payer data in errors/logs.
            throw new AsaasRequestError(response.status, [400, 401, 403, 404, 422].includes(response.status));
        }
        try { return await response.json() as T; }
        catch { throw new AsaasRequestError(response.status, false); }
    }

    getPayment(id: string) { return this.request<AsaasPayment>(`/payments/${encodeURIComponent(id)}`); }

    async findPayments(reference: string): Promise<AsaasPayment[]> {
        const result = await this.request<{ data: AsaasPayment[]; hasMore: boolean }>(
            `/payments?externalReference=${encodeURIComponent(reference)}&limit=100`,
        );
        if (result.hasMore) throw new Error('Múltiplas cobranças Asaas exigem revisão.');
        return result.data;
    }

    getQrCode(id: string) {
        return this.request<{ payload: string; encodedImage: string; expirationDate: string }>(
            `/payments/${encodeURIComponent(id)}/pixQrCode`,
        );
    }

    async createPayment(input: { customer: string; method: 'PIX' | 'CARD'; amountCents: number; reference: string; orderId: string }) {
        const dueDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const callbackBaseUrl = process.env.ASAAS_CALLBACK_SUCCESS_URL?.trim();
        const payment = {
            customer: input.customer,
            billingType: input.method === 'CARD' ? 'CREDIT_CARD' : 'PIX',
            value: input.amountCents / 100,
            dueDate,
            externalReference: input.reference,
            description: `Cantina - pedido ${input.orderId.slice(0, 8)}`,
        } as Record<string, unknown>;
        if (callbackBaseUrl) {
            let callbackUrl: URL;
            try { callbackUrl = new URL(callbackBaseUrl); }
            catch { throw new ServiceUnavailableException('URL de retorno Asaas inválida.'); }
            if (callbackUrl.protocol !== 'https:' || callbackUrl.username || callbackUrl.password) {
                throw new ServiceUnavailableException('URL de retorno Asaas deve usar HTTPS.');
            }
            payment.callback = { successUrl: `${callbackUrl.href.replace(/\/$/, '')}/order/${encodeURIComponent(input.orderId)}`, autoRedirect: true };
        }
        return this.request<AsaasPayment>('/payments', 'POST', payment);
    }

    safeInvoiceUrl(value?: string): string | null {
        if (!value) return null;
        try {
            const url = new URL(value);
            const hosts = this.environment === 'sandbox' ? ['sandbox.asaas.com'] : ['www.asaas.com', 'asaas.com'];
            return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : null;
        } catch { return null; }
    }
}
