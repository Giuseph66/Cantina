import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const express = require('express');
const { payloadCrypto } = require('../apps/api/dist/common/payload-crypto.js');

test('production browser and API: encrypted roundtrip, errors, tampering, required mode', async () => {
    const app = express();
    app.use(express.json());
    app.use(payloadCrypto());
    let calls = 0;
    app.all('/api/v1/example', (req, res) => { calls++; res.json({ received: req.body, secret: 'private-value' }); });
    app.get('/api/v1/failure', (_req, res) => res.status(401).json({ message: 'Sessão inválida' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const realFetch = globalThis.fetch;
    const priorWindow = globalThis.window;
    const priorRequired = process.env.PAYLOAD_ENCRYPTION_REQUIRED;
    const captured = [];
    globalThis.window = { location: { origin } };
    globalThis.fetch = async (url, init) => {
        const response = await realFetch(new URL(url, origin), init);
        if (!String(url).endsWith('/public-key')) captured.push({ url, init, response: await response.clone().text() });
        return response;
    };
    try {
        const compiled = await build({ entryPoints: ['apps/web/src/lib/encrypted-fetch.ts'], bundle: true, write: false, format: 'esm', define: { 'import.meta.env.PROD': 'true' } });
        const { encryptedFetch } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
        const result = await encryptedFetch('/api/v1/example', { method: 'POST', body: JSON.stringify({ password: 'not-visible-on-wire' }) });
        assert.deepEqual(await result.json(), { received: { password: 'not-visible-on-wire' }, secret: 'private-value' });
        assert.ok(!captured[0].init.body.includes('not-visible-on-wire'));
        assert.ok(!captured[0].response.includes('private-value'));
        const failed = await encryptedFetch('/api/v1/failure');
        assert.equal(failed.status, 401);
        assert.deepEqual(await failed.json(), { message: 'Sessão inválida' });
        const original = captured[0];
        const envelope = JSON.parse(original.init.body);
        const bytes = Buffer.from(envelope.data, 'base64');
        bytes[0] ^= 1;
        envelope.data = bytes.toString('base64');
        const tampered = await realFetch(origin + original.url, { ...original.init, body: JSON.stringify(envelope) });
        assert.equal(tampered.status, 400);
        const moved = await realFetch(origin + original.url + '?changed=1', original.init);
        assert.equal(moved.status, 400);
        assert.equal(calls, 1);
        process.env.PAYLOAD_ENCRYPTION_REQUIRED = 'true';
        assert.equal((await realFetch(origin + '/api/v1/example')).status, 400);
        assert.equal((await encryptedFetch('/api/v1/example')).status, 200);
        assert.equal((await realFetch(origin + '/api/v1/crypto/public-key')).headers.get('cache-control'), 'no-store');
    } finally {
        globalThis.fetch = realFetch;
        globalThis.window = priorWindow;
        if (priorRequired === undefined) delete process.env.PAYLOAD_ENCRYPTION_REQUIRED;
        else process.env.PAYLOAD_ENCRYPTION_REQUIRED = priorRequired;
        await new Promise(resolve => server.close(resolve));
    }
});
