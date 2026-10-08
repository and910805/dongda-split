import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Version 6 uses the selected artwork and shares the original scene coordinates', () => {
  const svg = read('public/ledger-signpost-v6.svg');
  assert.match(svg, /viewBox="0 0 1458 465"/);
  assert.match(svg, /<desc>Wander Far · Stay Close · Spend Wisely · Come Back Rich<\/desc>/);
  assert.match(svg, /<image x="1310" y="112" width="148" height="214"/);
  const image = svg.match(/href="data:image\/webp;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(image, 'The supplied signboard artwork must be self-contained');
  const bytes = Buffer.from(image[1], 'base64');
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  assert.ok(Buffer.byteLength(svg) < 25000);
  assert.doesNotMatch(svg, /<script|<foreignObject|\son\w+=|href="(?!data:image\/webp;base64,)/i);
  assert.doesNotMatch(svg, /Good People|Better Trips/);
  const css = read('src/ledger-fidelity.css');
  assert.match(css, /background-image: url\('\/ledger-signpost-v6\.svg'\), url\('\/ledger-coast-reference-v2\.webp'\)/);
  assert.match(css, /background-position: center top/);
  assert.match(css, /background-size: cover/);
  assert.match(read('scripts/verify-ledger-art-deployment.mjs'), /'ledger-signpost-v6\.svg'/);
});
