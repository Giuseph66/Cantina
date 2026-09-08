import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../apps/web/dist/', import.meta.url)));
const target = new URL(process.env.API_PROXY_URL || 'http://127.0.0.1:3000');
const transport = target.protocol === 'https:' ? https : http;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
function proxy(req, res) {
    const upstream = transport.request(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: target.host } }, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('API indisponível'); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
}
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (['/api/', '/uploads/', '/socket.io/'].some(prefix => url.pathname.startsWith(prefix))) return proxy(req, res);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    try {
        let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if ((file !== root && !file.startsWith(root + path.sep)) || url.pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); return res.end(); }
        let info = await stat(file).catch(() => null);
        if (!info?.isFile()) {
            if (path.extname(url.pathname)) { res.writeHead(404); return res.end(); }
            file = path.join(root, 'index.html');
            info = await stat(file);
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(400); res.end(); }
});
server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/socket.io/')) return socket.destroy();
    const upstream = transport.request(new URL(req.url, target), { headers: { ...req.headers, host: target.host } });
    upstream.on('upgrade', (response, peer, peerHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (peerHead.length) socket.write(peerHead);
        if (head.length) peer.write(head);
        socket.pipe(peer).pipe(socket);
        socket.on('error', () => peer.destroy());
        peer.on('error', () => socket.destroy());
        socket.on('close', () => peer.destroy());
    });
    upstream.on('response', response => { response.resume(); socket.destroy(); });
    upstream.on('error', () => socket.destroy());
    upstream.end();
});
server.listen(Number(process.env.WEB_PORT || 4173), process.env.WEB_HOST || '127.0.0.1', () => console.log('Frontend de produção disponível na porta ' + (process.env.WEB_PORT || 4173)));
