import serverless from 'serverless-http';
import { createApi } from '../server/api.mjs';
import { productionStore } from '../server/store.mjs';

let cached;
let initError;

function missingConfig() {
  const problems = [];
  if (!process.env.AUTH_SESSION_SECRET || Buffer.byteLength(process.env.AUTH_SESSION_SECRET) < 32) {
    problems.push('AUTH_SESSION_SECRET (random secret, at least 32 bytes)');
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    problems.push('FIREBASE_SERVICE_ACCOUNT_JSON (full Firebase Admin service-account JSON as one line)');
  }
  return problems;
}

function getHandler() {
  if (cached) return cached;
  if (initError) throw initError;

  const problems = missingConfig();
  if (problems.length) {
    initError = Object.assign(
      new Error(`Server API is not configured. Set these Vercel env vars, then redeploy: ${problems.join('; ')}.`),
      { status: 503 },
    );
    throw initError;
  }

  try {
    const app = createApi({
      store: productionStore(),
      sessionSecret: process.env.AUTH_SESSION_SECRET,
      secureCookies: true,
      allowedOrigin: process.env.APP_ORIGIN || undefined,
    });
    cached = serverless(app, { binary: false });
    return cached;
  } catch (error) {
    initError = Object.assign(new Error(error?.message || 'Could not start the application API.'), { status: 503 });
    throw initError;
  }
}

/** Vercel filesystem catch-alls only match one segment; restore the real /api/... path from rewrite. */
function restoreApiUrl(req) {
  const raw = req.url || '/';
  const qIndex = raw.indexOf('?');
  const pathname = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const search = qIndex === -1 ? '' : raw.slice(qIndex + 1);
  const params = new URLSearchParams(search);
  const forwarded = params.get('__path');
  if (!forwarded) {
    if (pathname === '/api' || pathname.startsWith('/api/')) return;
    Object.defineProperty(req, 'url', {
      value: pathname.startsWith('/') ? `/api${pathname}` : `/api/${pathname}`,
      configurable: true,
    });
    return;
  }
  params.delete('__path');
  const rest = params.toString();
  const path = forwarded.startsWith('/') ? forwarded : `/${forwarded}`;
  const next = path.startsWith('/api/') || path === '/api' ? path : `/api${path}`;
  Object.defineProperty(req, 'url', {
    value: rest ? `${next}?${rest}` : next,
    configurable: true,
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  try {
    restoreApiUrl(req);
    return await getHandler()(req, res);
  } catch (error) {
    const status = error?.status >= 400 && error?.status < 600 ? error.status : 503;
    sendJson(res, status, {
      error: error?.message || 'The application API is unavailable. Check Vercel function logs and environment variables.',
    });
  }
}
