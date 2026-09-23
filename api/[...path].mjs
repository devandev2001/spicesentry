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
      // Fall back to request host when APP_ORIGIN is unset (preview/prod aliases).
      allowedOrigin: process.env.APP_ORIGIN || undefined,
    });
    cached = serverless(app, {
      binary: false,
      request(request, event) {
        // Catch-all routes may arrive as "/auth/users" instead of "/api/auth/users".
        const raw = event.rawPath || event.path || request.url || '/';
        if (raw === '/api' || raw.startsWith('/api/') || raw.startsWith('/api?')) {
          request.url = event.rawQueryString ? `${raw}?${event.rawQueryString}` : raw;
          return;
        }
        const withPrefix = raw.startsWith('/') ? `/api${raw}` : `/api/${raw}`;
        request.url = event.rawQueryString ? `${withPrefix}?${event.rawQueryString}` : withPrefix;
      },
    });
    return cached;
  } catch (error) {
    initError = Object.assign(new Error(error?.message || 'Could not start the application API.'), { status: 503 });
    throw initError;
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  try {
    return await getHandler()(req, res);
  } catch (error) {
    const status = error?.status >= 400 && error?.status < 600 ? error.status : 503;
    sendJson(res, status, {
      error: error?.message || 'The application API is unavailable. Check Vercel function logs and environment variables.',
    });
  }
}
