import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInviteLink} from '../src/invite-link.mjs';

const origin = 'https://trip-tap.kuanlin.online';
const token = 'aBcD0123_-aBcD0123_-aBcD';

test('accepts only an invite on the current origin', () => {
  assert.equal(parseInviteLink(`${origin}/invite/${token}`, origin), token);
  assert.equal(parseInviteLink(`  /invite/${token}/  `, origin), token);
  assert.equal(parseInviteLink(`https://trip-tap.kuanlin.online:443/invite/${token}`, origin), token);
});

test('rejects another origin and lookalike links before any join request', () => {
  for (const link of [
    `https://trip-tap.kuanlin.online.evil.test/invite/${token}`,
    `//evil.test/invite/${token}`,
    `http://trip-tap.kuanlin.online/invite/${token}`,
    `https://attacker@trip-tap.kuanlin.online/invite/${token}`,
    `https://trip-tap.kuanlin.online:8443/invite/${token}`,
  ]) {
    assert.throws(() => parseInviteLink(link, origin), /目前旅帳網域/);
  }
});

test('rejects malformed paths and URL additions', () => {
  for (const link of [
    '',
    `${origin}/app`,
    `${origin}/invite/${token}/other`,
    `${origin}/invite/${token}%2Fother`,
    `${origin}/invite/${token}?next=/app`,
    `${origin}/invite/${token}#fragment`,
    `${origin}/invite/too-short`,
  ]) assert.throws(() => parseInviteLink(link, origin));
});
