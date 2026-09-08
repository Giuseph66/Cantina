import { appendCsrfHeader } from '../lib/csrf';
import { encryptedFetch as fetch } from '../lib/encrypted-fetch';

const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('ngrok-skip-browser-warning', '1');
    if (!(options?.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    appendCsrfHeader(headers, options?.method);

    const res = await fetch(`${BASE}${path}`, {
        ...options,
        credentials: 'include',
        headers,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro desconhecido' }));
        const message = typeof err.message === 'string' ? err.message : JSON.stringify(err.message);
        throw new Error(`[${res.status}] ${message}`);
    }
    return res.json() as Promise<T>;
}

export function useApi() {
    return {
        get: <T>(path: string) => request<T>(path, { method: 'GET' }),
        post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
        put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
        patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
        delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    };
}
