import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url));

test('Reference scenery, dry-brush and paper remain three independent local assets', () => {
  for (const name of ['ledger-coast-reference-v2', 'ledger-summary-drybrush-v2', 'ledger-summary-note-v2']) {
    const bytes = read(`public/${name}.webp`);
    assert.equal(bytes.subarray(0,4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8,12).toString(), 'WEBP');
    assert.ok(bytes.length > 500 && bytes.length < 150000);
    assert.ok(read('src/ledger-fidelity.css').toString().includes(`/${name}.webp`));
  }
  const css = read('src/ledger-fidelity.css').toString();
  assert.match(css, /min-width: 901px/);
  assert.match(css, /height: var\(--ledger-art-height, 465px\)/);
  assert.match(css, /mask-image: none/);
  assert.doesNotMatch(css, /\.es-save|\.overlay|\.mobile-bottom-nav|url\(['"]?https?:|DFKai|BiauKai/);
});

test('Artwork measurement is scoped and cleaned up without changing financial inputs', () => {
  const source = read('src/LedgerBrushSummary.jsx').toString();
  assert.match(source, /observer.disconnect\(\)/);
  assert.match(source, /cancelAnimationFrame\(frame\)/);
  assert.match(source, /closest\('\.real-workspace'\)/);
  assert.doesNotMatch(source, /fetch\(|localStorage|innerHTML|。/);
  for (const prop of ['totalLabel','balanceLabel','balanceCents','isMember','expenseDates']) assert.ok(source.includes(prop));
});

test('Live verification only reads public resources with matching fingerprints', () => {
  const source = read('scripts/verify-ledger-art-deployment.mjs').toString();
  assert.match(source, /url.origin !== origin/);
  assert.match(source, /actual\[name\] !== expected\[name\]/);
  assert.doesNotMatch(source, /Bearer|\/api\/auth|POST|DELETE|GITHUB_TOKEN/);
  assert.match(read('.github/workflows/verify-ledger-deployment.yml').toString(), /contents: read/);
});
