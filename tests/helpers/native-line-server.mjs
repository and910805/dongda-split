import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const serverUrl = new URL('../../server.js', import.meta.url);
const source = await readFile(serverUrl, 'utf8');
const importPattern = /^import (?:([^;]+?) from )?['"]([^'"]+)['"];\n/gm;
const bindings = {};
for (const [, names, specifier] of source.matchAll(importPattern)) {
  // Never load a real .env or database in this contract harness.
  if (!names || specifier === 'pg') continue;
  const module = await import(specifier.startsWith('.') ? new URL(specifier, serverUrl).href : specifier);
  if (names.startsWith('{')) {
    for (const name of names.slice(1, -1).split(',').map(value => value.trim())) {
      const [exported, local = exported] = name.split(/\s+as\s+/);
      bindings[local] = module[exported];
    }
  } else {
    bindings[names] = module.default;
  }
}
const bootstrap = source.indexOf('\nmigrate().then(');
assert.ok(bootstrap > 0, 'Server bootstrap boundary must remain explicit');
// Execute the actual server's complete Express route/middleware registration.
// Replace only ESM loading and startup; no route implementation is duplicated.
const script = new vm.Script(source.slice(0, bootstrap)
  .replace(importPattern, '')
  .replaceAll('import.meta.url', JSON.stringify(serverUrl.href))
  + '\n;({app,sign,unsign});', {filename: serverUrl.pathname});

export const APP_ORIGIN = 'https://triptab.test';
export const CHALLENGE_PATH = '/api/auth/line/native/challenge';
export const NATIVE_PATH = '/api/auth/line/native';
export const CHALLENGE_COOKIE = 'dongda_native_oauth';
const USER_ID = '11111111-1111-4111-8111-111111111111';

export function cookieValue(response, name) {
  const cookie = response.cookies.find(value => value.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split(';')[0].slice(name.length + 1)) : undefined;
}
export function requestCookie(response, name = CHALLENGE_COOKIE) {
  const value = cookieValue(response, name);
  return value === undefined ? undefined : `${name}=${encodeURIComponent(value)}`;
}

export async function createNativeServer(t, {env = {}, verify = {}} = {}) {
  const challenges = new Map();
  const queries = [];
  const upstream = [];
  const users = [];
  const errors = [];
  const pool = {
    async connect() {throw new Error('Unexpected DB connection: migration and scheduler must not run in auth tests');},
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({sql: normalized, values});
      if (normalized === 'DELETE FROM native_line_login_challenges WHERE expires_at<=now()') {
        for (const [id, row] of challenges) if (row.expiresAt <= Date.now()) challenges.delete(id);
        return {rows: []};
      }
      if (normalized.startsWith('INSERT INTO native_line_login_challenges')) {
        const [id, nonce, returnTo, expiresAt] = values;
        challenges.set(id, {nonce, returnTo, expiresAt});
        return {rows: []};
      }
      if (normalized.startsWith('DELETE FROM native_line_login_challenges')) {
        assert.equal(normalized, 'DELETE FROM native_line_login_challenges WHERE id=$1 AND expires_at>now() RETURNING nonce,return_to AS "returnTo"');
        const row = challenges.get(values[0]);
        if (!row || row.expiresAt <= Date.now()) return {rows: []};
        // Atomic consumption happens before any asynchronous LINE verification.
        challenges.delete(values[0]);
        return {rows: [row]};
      }
      if (normalized.startsWith('INSERT INTO users(line_user_id,display_name,picture_url)')) {
        users.push(Array.from(values));
        return {rows: [{id: USER_ID}]};
      }
      if (normalized.startsWith('SELECT u.id,u.display_name AS "displayName"')) {
        assert.equal(values[0], USER_ID);
        return {rows: [{id: USER_ID, displayName: 'LINE Test', isSuperuser: false, isSimulated: false}]};
      }
      throw new Error(`Unexpected database operation in auth test: ${normalized}`);
    }
  };
  const fetchMock = async (url, options) => {
    upstream.push({url, options});
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
    if (url === 'https://api.line.me/oauth2/v2.1/token') return {ok: true, json: async () => ({id_token: 'web.id.token'})};
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    if (verify.error) throw verify.error;
    const status = verify.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        if (verify.jsonError) throw verify.jsonError;
        return {
          iss: 'https://access.line.me', aud: options.body.get('client_id'),
          nonce: options.body.get('nonce'), sub: 'U_TEST_NATIVE', name: 'LINE Test',
          picture: 'https://profile.line-scdn.net/test',
          iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600,
          ...verify.claims
        };
      }
    };
  };
  const context = {
    ...bindings, pg: {Pool: class {constructor() {return pool;}}},
    process: {env: {
      NODE_ENV: 'production', APP_URL: APP_ORIGIN, SESSION_SECRET: 'auth-contract-test-only-secret',
      LINE_CHANNEL_ID: 'web-channel', LINE_CHANNEL_SECRET: 'test-web-secret',
      LINE_IOS_CHANNEL_ID: '2010790929', ...env
    }},
    Buffer, URL, URLSearchParams, AbortSignal, Date, Promise, setTimeout, clearTimeout,
    console: {error: error => errors.push(error)}, fetch: fetchMock
  };
  const {app, sign, unsign} = script.runInNewContext(context);
  const server = await new Promise(resolve => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const request = async (route, {method = 'POST', headers = {}, body, rawBody, cookie} = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: {
        ...(method === 'POST' ? {'content-type': 'application/json', origin: APP_ORIGIN, 'x-triptab-native': '1'} : {}),
        ...(cookie ? {cookie} : {}), ...headers
      },
      body: rawBody ?? (method === 'POST' ? JSON.stringify(body ?? {}) : undefined)
    });
    const text = await response.text();
    let data;
    try {data = JSON.parse(text);} catch {data = text;}
    return {status: response.status, data, headers: response.headers, cookies: response.headers.getSetCookie()};
  };
  return {request, challenges, queries, upstream, users, errors, sign, unsign, userId: USER_ID, verify};
}
