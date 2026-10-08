import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url));

test('Version 6 is the reviewed transparent artwork on the original 1458x465 canvas', () => {
  const bytes = read('public/ledger-signpost-v6.webp');
  assert.equal(bytes.subarray(0,4).toString(),'RIFF');
  assert.equal(bytes.subarray(8,16).toString(),'WEBPVP8L');
  assert.equal(bytes[20],0x2f);
  const dimensions = bytes.readUInt32LE(21);
  assert.equal((dimensions & 0x3fff)+1,1458);
  assert.equal(((dimensions >>> 14) & 0x3fff)+1,465);
  assert.equal((dimensions >>> 28) & 1,1,'Transparency keeps the coast unchanged');
  assert.ok(bytes.length < 16000,'Decorative copy must not add a full backdrop download');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'985a90d578f281003ab0f45f876529ae9d7b65c4a96ad82dcfe7a1ee21f27208');
});

test('The sign uses the same responsive background plane without new UI or font rules', () => {
  const css=read('src/ledger-fidelity.css').toString();
  assert.match(css,/background-image: url\('\/ledger-signpost-v6\.webp'\), url\('\/ledger-coast-reference-v2\.webp'\)/);
  assert.equal(css.match(/ledger-signpost-v6/g)?.length,1);
  assert.doesNotMatch(css,/font-family|\.es-save|\.mobile-bottom-nav/);
  const verify=read('scripts/verify-ledger-art-deployment.mjs').toString();
  assert.ok(verify.includes("'ledger-signpost-v6.webp'"));
  assert.ok(verify.includes("'taipei-sans-tc-beta-1'"));
  assert.match(verify,/actual\[name\] !== expected\[name\]/);
});
