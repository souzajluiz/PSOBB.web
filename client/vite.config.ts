import { defineConfig } from 'vite';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

// The BB key file comes from the local newserv checkout (vendor/, not committed)
// and is served at /keys/<name>.nsk during development.
const KEYS_DIR = resolve(import.meta.dirname, '../vendor/newserv/system/blueburst/keys');

// Development only: a local PSOBB data/ folder exposed at /psobb-data/ so the map
// viewer can be tested without the (unscriptable) native folder picker.
// Set PSOBB_DATA to override. Bound to 127.0.0.1 with the rest of the dev server.
const DATA_DIR = resolve(process.env.PSOBB_DATA ?? resolve(homedir(), 'Downloads/psobb-client/data'));

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173 },
  plugins: [
    {
      name: 'newserv-keys',
      configureServer(server) {
        server.middlewares.use('/psobb-data', (req, res, next) => {
          if (!existsSync(DATA_DIR)) return next();
          const url = new URL(req.url ?? '/', 'http://dev');
          const list = url.searchParams.get('list');
          const target = resolve(DATA_DIR, decodeURIComponent(list ?? url.pathname.slice(1)));
          if (target !== DATA_DIR && !target.startsWith(DATA_DIR + sep)) {
            res.statusCode = 403;
            return res.end();
          }
          try {
            if (list !== null) {
              const files = readdirSync(target).filter((f) => statSync(resolve(target, f)).isFile());
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify(files.sort()));
            }
            res.setHeader('Content-Type', 'application/octet-stream');
            res.end(readFileSync(target));
          } catch {
            res.statusCode = 404;
            res.end();
          }
        });
        // Development only: the classic UI posts renders here for pixel
        // comparison with captures of the original client (../.captures, ignored).
        server.middlewares.use('/__capture', (req, res) => {
          const name = new URL(req.url ?? '/', 'http://dev').searchParams.get('name') ?? '';
          if (req.method !== 'POST' || !/^[a-z0-9_-]{1,40}$/.test(name)) {
            res.statusCode = 400;
            return res.end();
          }
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            const dir = resolve(import.meta.dirname, '../.captures');
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${name}.png`), Buffer.concat(chunks));
            res.end('ok');
          });
        });
        server.middlewares.use('/keys', (req, res, next) => {
          const name = (req.url ?? '').replace(/^\//, '');
          if (!/^[a-z0-9]+\.nsk$/.test(name)) return next();
          try {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.end(readFileSync(resolve(KEYS_DIR, name)));
          } catch {
            res.statusCode = 404;
            res.end();
          }
        });
      },
    },
  ],
});
