import { constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';

// Per-process keys: obtain the public key for each request (no stale-key retries of writes).
export function payloadCrypto(): RequestHandler {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    return (req, res, next) => {
        if (!req.path.startsWith('/api/v1/')) return next();
        if (req.path === '/api/v1/crypto/public-key' && req.method === 'GET') {
            res.setHeader('Cache-Control', 'no-store');
            res.json({ version: 1, spki });
            return;
        }
        // Provider callbacks, binary files and the liveness probe are transported using HTTPS directly.
        if (req.path === '/api/v1/webhooks/asaas' || req.path.startsWith('/api/v1/uploads') || req.path === '/api/v1/health') return next();
        const wrappedKey = req.get('x-payload-key');
        if (!wrappedKey) {
            if (process.env.PAYLOAD_ENCRYPTION_REQUIRED === 'true') {
                res.status(400).json({ message: 'Canal criptografado obrigatório.' });
                return;
            }
            res.setHeader('Cache-Control', 'no-store');
            return next();
        }
        try {
            if (wrappedKey.length > 512) throw new Error('Invalid key');
            const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(wrappedKey, 'base64'));
            if (key.length !== 32) throw new Error('Invalid key');
            const context = `${req.method} ${req.originalUrl}`;
            if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length) {
                const { version, iv, data } = req.body;
                if (version !== 1 || typeof iv !== 'string' || typeof data !== 'string') throw new Error('Invalid envelope');
                const nonce = Buffer.from(iv, 'base64');
                const ciphertext = Buffer.from(data, 'base64');
                if (nonce.length !== 12 || ciphertext.length < 16) throw new Error('Invalid envelope');
                const decipher = createDecipheriv('aes-256-gcm', key, nonce);
                decipher.setAAD(Buffer.from(`request ${context}`));
                decipher.setAuthTag(ciphertext.subarray(-16));
                req.body = JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'));
            }
            const originalJson = res.json.bind(res);
            res.json = (body: unknown) => {
                const iv = randomBytes(12);
                const cipher = createCipheriv('aes-256-gcm', key, iv);
                cipher.setAAD(Buffer.from(`response ${context} ${res.statusCode}`));
                const data = Buffer.concat([cipher.update(JSON.stringify(body ?? null)), cipher.final(), cipher.getAuthTag()]);
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('X-Payload-Encrypted', '1');
                return originalJson({ version: 1, iv: iv.toString('base64'), data: data.toString('base64') });
            };
            next();
        } catch {
            res.status(400).json({ message: 'Envelope criptográfico inválido. Recarregue a página.' });
        }
    };
}
