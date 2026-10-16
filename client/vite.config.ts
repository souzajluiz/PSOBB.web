import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The BB key file comes from the local newserv checkout (vendor/, not committed)
// and is served at /keys/<name>.nsk during development.
const KEYS_DIR = resolve(import.meta.dirname, '../vendor/newserv/system/blueburst/keys');

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173 },
  plugins: [
    {
      name: 'newserv-keys',
      configureServer(server) {
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
