import { createApi } from '../server/api.mjs';
import { productionStore } from '../server/store.mjs';

let app;

function getApp() {
  if (app) return app;
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('Set AUTH_SESSION_SECRET to a random secret of at least 32 bytes in the Vercel project environment.');
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON (full service-account JSON string) in the Vercel project environment.');
  }
  // Prefer APP_ORIGIN in production. When unset, createApi falls back to the request host
  // so Vercel preview deployments can still accept same-origin login requests.
  app = createApi({
    store: productionStore(),
    sessionSecret: secret,
    secureCookies: true,
    allowedOrigin: process.env.APP_ORIGIN || undefined,
  });
  return app;
}

export default function handler(req, res) {
  return getApp()(req, res);
}
