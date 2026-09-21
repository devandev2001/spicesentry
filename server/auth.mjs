import { createHash, createHmac, randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
export const SESSION_MS = 8 * 60 * 60 * 1000;
export const publicUser = user => ({ uid: user.uid, name: user.name, role: user.role, shop: user.shop || null, active: user.active !== false });
export const credentialVersion = user => createHash('sha256').update(String(user.pin || '')).digest('hex');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(pin, salt, 64)).toString('hex')}`;
}

export async function verifyPin(pin, stored) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin) || typeof stored !== 'string') return false;
  if (stored.startsWith('scrypt:')) {
    const [, salt, expected] = stored.split(':');
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
    return equal((await scrypt(pin, salt, 64)).toString('hex'), expected);
  }
  return equal(createHash('sha256').update(pin + '_kvs_salt_2026').digest('hex'), stored);
}

export function issueSession(user, secret, now) {
  const payload = Buffer.from(JSON.stringify({ uid: user.uid, expires: now + SESSION_MS, version: credentialVersion(user) })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function readSession(token, secret, now) {
  try {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const [payload, signature, extra] = token.split('.');
    if (extra || !equal(signature, createHmac('sha256', secret).update(payload).digest('base64url'))) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof session.uid === 'string' && session.expires > now ? session : null;
  } catch { return null; }
}

export function createLoginLimiter(now) {
  const attempts = new Map();
  return {
    take(ip, uid) {
      const time = now();
      for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
      if (attempts.size > 10000) return false;
      const keys = [[`ip:${ip}`, 50], [`user:${uid}`, 5]];
      if (keys.some(([key, max]) => (attempts.get(key)?.count || 0) >= max)) return false;
      for (const [key] of keys) {
        const entry = attempts.get(key) || { count: 0, until: time + 15 * 60 * 1000 };
        attempts.set(key, { ...entry, count: entry.count + 1 });
      }
      return true;
    },
    success(uid) { attempts.delete(`user:${uid}`); },
  };
}
