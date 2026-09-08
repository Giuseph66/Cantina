import { appendCsrfHeader } from '../lib/csrf';
import { encryptedFetch as fetch } from '../lib/encrypted-fetch';
import { reportFailure, reportSuccess } from '../lib/server-status';
import { useMemo } from 'react';

const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('ngrok-skip-browser-warning', '1');
    if (!(options?.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    appendCsrfHeader(headers, options?.method);

    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            ...options,
            credentials: 'include',
            headers,
        });
    } catch (error) {
        // Falha de rede/canal: deixa o monitor decidir se o servidor caiu.
        reportFailure(error);
        throw error;
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro desconhecido' }));
        const message = typeof err.message === 'string' ? err.message : JSON.stringify(err.message);
        const error = new Error(`[${res.status}] ${message}`);
        reportFailure(error);
        throw error;
    }

    reportSuccess();
    return res.json() as Promise<T>;
}

export function useApi() {
    return useMemo(() => ({
        get: <T>(path: string) => request<T>(path, { method: 'GET' }),
        post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
        put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
        patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
        delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    }), []);
}
