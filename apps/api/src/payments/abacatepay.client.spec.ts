import { createHmac } from 'node:crypto';
import { AbacatePayClient } from './abacatepay.client';

const PUBLIC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

describe('AbacatePayClient', () => {
    const original = { ...process.env };

    beforeEach(() => {
        process.env.ABACATEPAY_ENV = 'development';
        process.env.ABACATEPAY_API_KEY = 'abacatepay-test-key';
        process.env.ABACATEPAY_WEBHOOK_SECRET = 'a'.repeat(48);
        process.env.APP_PUBLIC_URL = 'https://cantina.example.com';
    });

    afterAll(() => { process.env = original; });

    it('validates the raw body with the documented HMAC signature', () => {
        const client = new AbacatePayClient();
        const rawBody = Buffer.from('{"id":"log_1","event":"transparent.completed"}');
        const signature = createHmac('sha256', PUBLIC_KEY).update(rawBody).digest('base64');

        expect(client.verifyWebhookSignature(rawBody, signature)).toBe(true);
        expect(client.verifyWebhookSignature(Buffer.from('{"id":"log_2"}'), signature)).toBe(false);
    });

    it('requires HTTPS and includes the private URL secret in the webhook endpoint', () => {
        const client = new AbacatePayClient();

        expect(client.configured).toBe(true);
        expect(client.webhookEndpoint).toBe(`https://cantina.example.com/api/v1/webhooks/abacatepay?webhookSecret=${'a'.repeat(48)}`);
    });

    it('sends the transparent Pix amount in centavos to the server-only API', async () => {
        const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            data: {
                id: 'pix_1', amount: 500, status: 'PENDING', brCode: 'pix-copy-paste',
                brCodeBase64: 'data:image/png;base64,abc', expiresAt: '2026-09-18T16:00:00.000Z',
            }, success: true, error: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const client = new AbacatePayClient();

        await expect(client.createTransparentPix({
            amountCents: 500, expiresInSeconds: 900, description: 'Cantina - pedido 12345678', externalId: 'cantina:payment-1',
            orderId: 'order-1', paymentId: 'payment-1', customer: { name: 'Giuseppe', email: 'giuseppe@example.com', taxId: '52998224725', cellphone: '65999999999' },
        })).resolves.toMatchObject({ id: 'pix_1', amount: 500 });

        expect(fetchMock).toHaveBeenCalledWith('https://api.abacatepay.com/v2/transparents/create', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer abacatepay-test-key' }),
            body: expect.stringContaining('"amount":500'),
        }));
        fetchMock.mockRestore();
    });
});
