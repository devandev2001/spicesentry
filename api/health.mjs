export default function handler(_req, res) {
  const secret = process.env.AUTH_SESSION_SECRET || '';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    authSecretConfigured: Buffer.byteLength(secret) >= 32,
    firebaseConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
    appOriginConfigured: Boolean(process.env.APP_ORIGIN),
  }));
}
