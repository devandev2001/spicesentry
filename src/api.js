let accountId = null;
export async function api(path, body) {
  if (path.startsWith('data/')) body = { ...body, expectedUserId: body?.expectedUserId || accountId };
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if ((response.status === 401 || result.code === 'account-mismatch') && path.startsWith('data/')) {
      accountId = null;
      window.dispatchEvent(new Event('spicesentry-session-expired'));
    }
    throw Object.assign(new Error(result.error || 'Could not reach the application server. Please retry.'), { status: response.status });
  }
  if (['auth/login', 'auth/session'].includes(path)) accountId = result.user?.uid || null;
  if (path === 'auth/logout') accountId = null;
  return result;
}
