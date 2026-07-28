function normalizeForFingerprint(value) {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = normalizeForFingerprint(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function expenseSubmissionFingerprint(payload) {
  return JSON.stringify(normalizeForFingerprint(payload));
}

export function createExpenseIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createExpenseSubmissionKeyStore({createKey = createExpenseIdempotencyKey} = {}) {
  let activeSubmission = null;

  return {
    acquire(payload) {
      const fingerprint = expenseSubmissionFingerprint(payload);
      if (!activeSubmission || activeSubmission.fingerprint !== fingerprint) {
        activeSubmission = {fingerprint, key: createKey()};
      }
      return activeSubmission.key;
    },
    complete() {
      activeSubmission = null;
    },
    current() {
      return activeSubmission ? {...activeSubmission} : null;
    },
  };
}

export function createExpenseRequestOptions({method, payload, keyStore}) {
  const normalizedMethod = String(method || 'POST').toUpperCase();
  const options = {
    method: normalizedMethod,
    body: JSON.stringify(payload),
  };
  if (normalizedMethod === 'POST') {
    options.headers = {'Idempotency-Key': keyStore.acquire(payload)};
  }
  return options;
}
