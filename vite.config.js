import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { randomBytes } from 'node:crypto'
import { createApi } from './server/api.mjs'
import { productionStore } from './server/store.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'spicesentry-local-api',
    configureServer(server) {
      const api = createApi({ store: productionStore(server.config.root), sessionSecret: randomBytes(32).toString('hex') });
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/')) return api(req, res, next);
        next();
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem,key}', '**/.git/**', '**/*firebase-adminsdk*.json', '**/service-account*.json', '**/server/**'] },
  },
})
