import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNativeLineChallenge,
  createNativeLineLimiter,
  nativeLineReturnTo,
  validNativeIdToken,
  validNativeLineProfile,
  NATIVE_LINE_CHALLENGE_TTL_MS,
} from '../native-line-auth.mjs';

test('native LINE challenge is fresh, short lived, and preserves only app or invite return paths', () => {
  const now = Date.now();
  const token = 'a'.repeat(24);
  const first = makeNativeLineChallenge(`/invite/${token}`, now);
  const second = makeNativeLineChallenge('/app', now);
  assert.match(first.id, /^[a-f0-9-]{36}$/);
  assert.match(first.nonce, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.nonce, second.nonce);
  assert.equal(first.returnTo, `/invite/${token}`);
  assert.equal(first.expiresAt.getTime(), now + NATIVE_LINE_CHALLENGE_TTL_MS);
  for (const path of ['//evil.example', '/api/me', '/invite/no', '/invite/' + token + '?x=1', '/\\evil.example', 'https://evil.example']) {
    assert.equal(nativeLineReturnTo(path), '/app', path);
  }
});

test('native LINE requests are bounded per client and per instance', () => {
  let now = 1_000;
  const allow = createNativeLineLimiter({windowMs:60_000, perClient:2, globalLimit:3, clock:()=>now});
  assert.equal(allow('one'), true);
  assert.equal(allow('one'), true);
  assert.equal(allow('one'), false);
  assert.equal(allow('two'), true);
  assert.equal(allow('three'), false);
  now += 60_000;
  assert.equal(allow('one'), true);
});

test('native LINE exchange accepts only compact ID token shape and matching verified claims', () => {
  assert.equal(validNativeIdToken('a.b.c'), true);
  for (const token of ['', null, 'a.b', 'a.b.c.d', 'a.b.c\n', 'x'.repeat(8193)]) {
    assert.equal(validNativeIdToken(token), false);
  }
  const now = Date.now();
  const profile = {iss:'https://access.line.me', aud:'channel-1', nonce:'fresh-nonce', sub:'U123', exp:Math.floor(now/1000)+600, iat:Math.floor(now/1000)};
  const expected = {channelId:'channel-1', nonce:'fresh-nonce', now};
  assert.equal(validNativeLineProfile(profile, expected), true);
  for (const changes of [{aud:'other-channel'}, {nonce:'wrong'}, {sub:''}, {exp:Math.floor(now/1000)-1}, {iss:'https://fake.example'}]) {
    assert.equal(validNativeLineProfile({...profile, ...changes}, expected), false);
  }
});
