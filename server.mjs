import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handler } from './api/game.mjs';
import { MemoryStore, RedisStore } from './cloud/store.mjs';

const persistent = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
const api = handler(persistent ? new RedisStore() : new MemoryStore(), {
  ...process.env,
  HOST_KEY: process.env.HOST_KEY || 'deluxe'
});

const files = {
  '/admin.html': ['admin.html', 'text/html; charset=utf-8'],
  '/fondo-hdc.webp': ['fondo-hdc.webp', 'image/webp'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/demo.mp4': ['demo.mp4', 'video/mp4'],
  '/demo-intro.mp4': ['demo-intro.mp4', 'video/mp4'],
  '/demo-reveal.mp4': ['demo-reveal.mp4', 'video/mp4']
};

http
  .createServer(async (req, res) => {
    if (req.url.startsWith('/api/game')) return api(req, res);
    try {
      const p = new URL(req.url, 'http://localhost').pathname;
      const file =
        files[p] ||
        (/^\/$|^\/(admin|play|tv)$|^\/(host|screen|j)\/(?:[0-9]{6}|[A-Z2-9]{6})$/.test(p)
          ? ['index.html', 'text/html; charset=utf-8']
          : null);
      if (!file) {
        res.writeHead(404);
        return res.end('No encontrado');
      }
      res.setHeader('Content-Type', file[1]);
      res.end(await readFile(new URL('./cloud/public/' + file[0], import.meta.url)));
    } catch {
      res.writeHead(500);
      res.end('Error local');
    }
  })
  .listen(Number(process.env.PORT || 3000), '127.0.0.1', () =>
    console.log(
      'http://localhost:' +
        (process.env.PORT || 3000) +
        ' — ' +
        (persistent ? 'Redis conectado' : 'ENSAYO DELUXE: memoria temporal; clave ensayo-local')
    )
  );
