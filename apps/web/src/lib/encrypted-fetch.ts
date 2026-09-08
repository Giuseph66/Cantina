const encode = (value: Uint8Array) => btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const text = new TextEncoder();

/** JSON transport only. TLS authenticates the public key and remains mandatory. */
export async function encryptedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (!import.meta.env.PROD) return fetch(url, init);
    const keyResponse = await fetch('/api/v1/crypto/public-key', { cache: 'no-store', credentials: 'include', signal: init.signal });
    if (!keyResponse.ok) throw new Error('Não foi possível estabelecer o canal criptografado.');
    const { spki } = await keyResponse.json();
    const publicKey = await crypto.subtle.importKey('spki', decode(spki), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const wrapped = await crypto.subtle.encrypt('RSA-OAEP', publicKey, rawKey);
    const headers = new Headers(init.headers);
    headers.set('x-payload-key', encode(new Uint8Array(wrapped)));
    const method = (init.method ?? 'GET').toUpperCase();
    const parsed = new URL(url, window.location.origin);
    const context = `${method} ${parsed.pathname}${parsed.search}`;
    let body = init.body;
    if (body != null) {
        if (typeof body !== 'string') throw new Error('Canal criptografado aceita somente JSON.');
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(`request ${context}`) }, key, text.encode(body));
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify({ version: 1, iv: encode(iv), data: encode(new Uint8Array(encrypted)) });
    }
    const response = await fetch(url, { ...init, headers, body, cache: 'no-store' });
    if (response.status === 204) return response;
    if (response.headers.get('x-payload-encrypted') !== '1') throw new Error('Resposta sem criptografia. Recarregue a página.');
    const envelope = await response.json();
    if (envelope.version !== 1) throw new Error('Envelope criptográfico incompatível.');
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: text.encode(`response ${context} ${response.status}`) }, key, decode(envelope.data));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-length');
    responseHeaders.delete('content-encoding');
    return new Response(decrypted, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}
