import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  APP_ORIGIN, CHALLENGE_PATH, NATIVE_PATH, CHALLENGE_COOKIE,
  createNativeServer, cookieValue, requestCookie
} from './helpers/native-line-server.mjs';

const idToken = 'test.id.token';
const sessionCookie = response => cookieValue(response, 'dongda_session');
const exchange = (harness, cookie, body = {idToken}) => harness.request(NATIVE_PATH, {cookie, body});

// These tests use the real Express middleware/routes, isolated DB/fetch doubles,
// and loopback HTTP only. They neither load .env nor contact LINE or production.
test('native routes require exact same-origin and native header before any work', async t => {
  const h = await createNativeServer(t);
  for (const route of [CHALLENGE_PATH, NATIVE_PATH]) {
    for (const headers of [
      {origin: ''}, {origin: 'null'}, {origin: 'https://attacker.test'},
      {origin: `${APP_ORIGIN}.attacker.test`}, {origin: APP_ORIGIN + '/'},
      {'x-triptab-native': ''}, {'x-triptab-native': 'true'}
    ]) {
      const response = await h.request(route, {headers, body: {idToken}});
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.cookies.length, 0);
    }
  }
  assert.equal(h.queries.length, 0);
  assert.equal(h.upstream.length, 0);
});

test('missing native and fallback configuration fails closed', async t => {
  const h = await createNativeServer(t, {env: {LINE_IOS_CHANNEL_ID: '', LINE_CHANNEL_ID: ''}});
  assert.equal((await h.request(CHALLENGE_PATH)).status, 503);
  assert.equal((await exchange(h)).status, 401);
  assert.equal(h.queries.length, 0);
  assert.equal(h.upstream.length, 0);
});

test('challenge binds nonce to a signed short-lived, secure HttpOnly cookie', async t => {
  const h = await createNativeServer(t);
  const before = Date.now();
  const returnTo = '/invite/' + 'a'.repeat(24);
  const response = await h.request(CHALLENGE_PATH, {body: {returnTo}});
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.data), ['nonce']);
  assert.match(response.data.nonce, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const header = response.cookies[0];
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=300', 'Path=/']) assert.ok(header.includes(attribute));
  assert.ok(!header.includes(response.data.nonce), 'nonce must stay server-side, not in the signed cookie');
  const signed = h.unsign(cookieValue(response, CHALLENGE_COOKIE));
  assert.equal(signed.kind, 'native-line-login');
  assert.ok(signed.exp >= before + 300000 && signed.exp <= Date.now() + 300000);
  const row = h.challenges.get(signed.id);
  assert.equal(row.nonce, response.data.nonce);
  assert.equal(row.returnTo, returnTo);
  assert.equal(row.expiresAt.getTime(), signed.exp);
  const fresh = await h.request(CHALLENGE_PATH, {body: {returnTo: '//attacker.test'}});
  assert.notEqual(fresh.data.nonce, response.data.nonce);
  assert.equal(h.challenges.get(h.unsign(cookieValue(fresh, CHALLENGE_COOKIE)).id).returnTo, '/app');
});

test('valid native exchange verifies LINE and establishes the ordinary web session', async t => {
  const h = await createNativeServer(t);
  const returnTo = '/invite/' + 'b'.repeat(24);
  const challenge = await h.request(CHALLENGE_PATH, {body: {returnTo}});
  const response = await exchange(h, requestCookie(challenge), {idToken, nonce: 'ignored-client-nonce', returnTo: '//attacker.test'});
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, {returnTo});
  assert.equal(h.upstream.length, 1);
  const request = h.upstream[0];
  assert.equal(request.options.body.get('id_token'), idToken);
  assert.equal(request.options.body.get('client_id'), '2010790929');
  assert.equal(request.options.body.get('nonce'), challenge.data.nonce);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(h.users, [['U_TEST_NATIVE', 'LINE Test', 'https://profile.line-scdn.net/test']]);
  assert.equal(h.challenges.size, 0);
  assert.equal(h.unsign(sessionCookie(response)).userId, h.userId);
  const header = response.cookies.find(value => value.startsWith('dongda_session='));
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=1209600', 'Path=/']) assert.ok(header.includes(attribute));
  const cleared = response.cookies.find(value => value.startsWith(`${CHALLENGE_COOKIE}=`));
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  assert.match(cleared, /Secure; SameSite=Strict/);
  const me = await h.request('/api/me', {method: 'GET', cookie: requestCookie(response, 'dongda_session')});
  assert.equal(me.status, 200);
  assert.equal(me.data.id, h.userId);
});

test('web channel is used only as the fallback when iOS channel is absent', async t => {
  const h = await createNativeServer(t, {env: {LINE_IOS_CHANNEL_ID: ''}});
  const challenge = await h.request(CHALLENGE_PATH);
  assert.equal((await exchange(h, requestCookie(challenge))).status, 200);
  assert.equal(h.upstream[0].options.body.get('client_id'), 'web-channel');
});

test('missing, forged, expired, wrong-kind and malformed challenge cookies are rejected', async t => {
  const h = await createNativeServer(t);
  const challenge = await h.request(CHALLENGE_PATH);
  const original = cookieValue(challenge, CHALLENGE_COOKIE);
  const claims = h.unsign(original);
  const values = [undefined, original + 'tampered',
    h.sign({...claims, exp: Date.now() - 1000}),
    h.sign({...claims, kind: 'other'}), h.sign({...claims, id: 'not-a-uuid'})];
  const initialQueries = h.queries.length;
  for (const value of values) {
    const response = await exchange(h, value === undefined ? undefined : `${CHALLENGE_COOKIE}=${encodeURIComponent(value)}`);
    assert.equal(response.status, 401);
    assert.equal(sessionCookie(response), undefined);
  }
  assert.equal(h.queries.length, initialQueries);
  assert.equal(h.upstream.length, 0);
});

test('malformed ID token is rejected before LINE verification or challenge consumption', async t => {
  const h = await createNativeServer(t);
  const challenge = await h.request(CHALLENGE_PATH);
  for (const token of ['', null, 7, 'a.b', 'a.b.c.d', 'x'.repeat(8193)]) {
    const response = await exchange(h, requestCookie(challenge), {idToken: token});
    assert.equal(response.status, 400);
    assert.equal(sessionCookie(response), undefined);
  }
  assert.equal(h.challenges.size, 1);
  assert.equal(h.upstream.length, 0);
});

test('expired server challenge is rejected even while cookie remains valid', async t => {
  const h = await createNativeServer(t);
  const challenge = await h.request(CHALLENGE_PATH);
  const claims = h.unsign(cookieValue(challenge, CHALLENGE_COOKIE));
  h.challenges.get(claims.id).expiresAt = new Date(Date.now() - 1000);
  const response = await exchange(h, requestCookie(challenge));
  assert.equal(response.status, 401);
  assert.equal(sessionCookie(response), undefined);
  assert.equal(h.upstream.length, 0);
});

test('challenge consumption rejects sequential and concurrent replays', async t => {
  const h = await createNativeServer(t);
  const challenge = await h.request(CHALLENGE_PATH);
  const cookie = requestCookie(challenge);
  const responses = await Promise.all([exchange(h, cookie), exchange(h, cookie)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  assert.equal((await exchange(h, cookie)).status, 401);
  assert.equal(h.upstream.length, 1);
  assert.equal(h.users.length, 1);
});

test('verified token still requires exact issuer, audience, nonce, subject and times', async t => {
  const h = await createNativeServer(t);
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const claims of [
    {iss: 'https://attacker.test'}, {aud: 'web-channel'}, {aud: ['2010790929']},
    {nonce: 'other-nonce'}, {nonce: undefined}, {sub: ''}, {sub: 'x'.repeat(129)},
    {sub: 42}, {exp: nowSeconds - 1}, {exp: String(nowSeconds + 600)},
    {iat: nowSeconds + 301}, {iat: undefined}
  ]) {
    h.verify.claims = claims;
    const challenge = await h.request(CHALLENGE_PATH);
    const response = await exchange(h, requestCookie(challenge));
    assert.equal(response.status, 401, JSON.stringify(claims));
    assert.equal(sessionCookie(response), undefined);
    assert.equal(h.challenges.size, 0, 'failed verification must not leave a reusable challenge');
  }
  assert.equal(h.users.length, 0);
});

test('LINE failure, timeout and invalid JSON cannot create sessions or reuse challenges', async t => {
  const h = await createNativeServer(t);
  for (const [settings, status] of [
    [{status: 400}, 401], [{status: 503}, 502],
    [{error: new Error('mock verification timeout')}, 500],
    [{jsonError: new SyntaxError('mock invalid JSON')}, 500]
  ]) {
    Object.assign(h.verify, {status: undefined, error: undefined, jsonError: undefined}, settings);
    const challenge = await h.request(CHALLENGE_PATH);
    const response = await exchange(h, requestCookie(challenge));
    assert.equal(response.status, status);
    assert.equal(sessionCookie(response), undefined);
    assert.equal((await exchange(h, requestCookie(challenge))).status, 401);
  }
  assert.equal(h.upstream.length, 4);
  assert.equal(h.users.length, 0);
});

test('rate limit bounds database and upstream work and advertises retry delay', async t => {
  const h = await createNativeServer(t);
  for (let index = 0; index < 60; index++) assert.equal((await h.request(CHALLENGE_PATH)).status, 200);
  const queryCount = h.queries.length;
  const response = await h.request(CHALLENGE_PATH);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(h.queries.length, queryCount);
  assert.equal(h.upstream.length, 0);
});

test('existing JSON middleware continues to reject malformed and oversized bodies', async t => {
  const h = await createNativeServer(t);
  assert.equal((await h.request(NATIVE_PATH, {rawBody: '{'})).status, 400);
  assert.equal((await h.request(NATIVE_PATH, {body: {idToken: 'x'.repeat(70 * 1024)}})).status, 413);
  assert.equal(h.queries.length, 0);
  assert.equal(h.upstream.length, 0);
});

test('existing browser OAuth keeps web channel, state/nonce and callback session behavior', async t => {
  const h = await createNativeServer(t);
  const returnTo = '/invite/' + 'c'.repeat(24);
  const start = await h.request('/api/auth/line?returnTo=' + encodeURIComponent(returnTo), {method: 'GET'});
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.origin, 'https://access.line.me');
  assert.equal(location.searchParams.get('client_id'), 'web-channel');
  assert.equal(location.searchParams.get('redirect_uri'), APP_ORIGIN + '/api/auth/line/callback');
  assert.equal(location.searchParams.get('scope'), 'openid profile');
  const oauth = h.unsign(cookieValue(start, 'dongda_oauth'));
  assert.equal(location.searchParams.get('state'), oauth.state);
  assert.equal(location.searchParams.get('nonce'), oauth.nonce);
  assert.equal(oauth.returnTo, returnTo);
  const bad = await h.request('/api/auth/line/callback?state=wrong&code=mock-code', {method: 'GET', cookie: requestCookie(start, 'dongda_oauth')});
  assert.equal(bad.headers.get('location'), '/?login=failed');
  assert.equal(h.upstream.length, 0);
  const callback = await h.request(`/api/auth/line/callback?state=${oauth.state}&code=mock-code`, {method: 'GET', cookie: requestCookie(start, 'dongda_oauth')});
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), returnTo);
  assert.equal(h.unsign(sessionCookie(callback)).userId, h.userId);
  assert.equal(h.upstream.length, 2);
  assert.equal(h.upstream[0].options.body.get('client_id'), 'web-channel');
  assert.equal(h.upstream[0].options.body.get('client_secret'), 'test-web-secret');
  assert.equal(h.upstream[1].options.body.get('nonce'), oauth.nonce);
  assert.equal(h.upstream[1].options.body.get('client_id'), 'web-channel');
  assert.equal(h.challenges.size, 0);
});

test('native challenge schema is additive and idempotent with expiry index', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS native_line_login_challenges \(\s*id UUID PRIMARY KEY,\s*nonce TEXT NOT NULL,\s*return_to TEXT NOT NULL,\s*expires_at TIMESTAMPTZ NOT NULL\s*\);/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS native_line_login_challenges_expiry\s+ON native_line_login_challenges\(expires_at\)/);
});
