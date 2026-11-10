import crypto from 'node:crypto';

export const NATIVE_LINE_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const NATIVE_LINE_CHALLENGE_COOKIE = 'dongda_native_oauth';

const invitePath = /^\/invite\/[A-Za-z0-9_-]{16,128}\/?$/;
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function nativeLineReturnTo(value) {
  return value === '/app' || typeof value === 'string' && invitePath.test(value) ? value : '/app';
}

export function makeNativeLineChallenge(returnTo, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    nonce: crypto.randomBytes(24).toString('base64url'),
    returnTo: nativeLineReturnTo(returnTo),
    expiresAt: new Date(now + NATIVE_LINE_CHALLENGE_TTL_MS),
  };
}

export function validNativeIdToken(value) {
  return typeof value === 'string' && value.length <= 8192 && jwtPattern.test(value);
}

export function validNativeLineProfile(profile, {channelId, nonce, now = Date.now()}) {
  return Boolean(profile &&
    profile.iss === 'https://access.line.me' &&
    profile.aud === channelId &&
    profile.nonce === nonce &&
    typeof profile.sub === 'string' && profile.sub.length > 0 && profile.sub.length <= 128 &&
    Number.isFinite(profile.exp) && profile.exp * 1000 > now &&
    Number.isFinite(profile.iat) && profile.iat * 1000 <= now + 5 * 60 * 1000);
}

// The gateway can add its own distributed limit; this bounds work on each app instance.
export function createNativeLineLimiter({windowMs = 60_000, perClient = 60, globalLimit = 300, clock = Date.now} = {}) {
  let resetAt = clock() + windowMs;
  let total = 0;
  const clients = new Map();
  return client => {
    const now = clock();
    if (now >= resetAt) {
      resetAt = now + windowMs;
      total = 0;
      clients.clear();
    }
    const key = String(client || 'unknown');
    const count = clients.get(key) || 0;
    if (total >= globalLimit || count >= perClient) return false;
    total += 1;
    clients.set(key, count + 1);
    return true;
  };
}
