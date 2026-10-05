import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/ledger-coastal.css');

test('Coastal entry decorates the existing app rather than replacing its controls', () => {
  assert.match(read('index.html'), /src="\/src\/coastal-main\.jsx"/);
  assert.match(read('src/coastal-main.jsx'), /import '\.\/main\.jsx'/);
  assert.match(read('src/coastal-main.jsx'), /import '\.\/ledger-coastal\.css'/);
  for (const selector of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    const value = selector[1].trim();
    if (!value.startsWith('@')) assert.ok(value.startsWith('.real-app:has(.real-dashboard)'), value);
  }
  assert.doesNotMatch(css, /(?:\.expense-single-modal|\.es-save|\.overlay|\bbody\s*\{|\bhtml\s*\{)/);
  assert.doesNotMatch(css, /20,727|12,239|15 位|[\u3002]/u);
});

test('Decorative scenery is a small local WebP and never a screenshot of interactive controls', () => {
  const image = readFileSync(new URL('../public/ledger-coast.webp', import.meta.url));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  assert.ok(image.length < 50000);
  assert.match(css, /url\('\/ledger-coast\.webp'\)/);
  assert.doesNotMatch(css, /url\(['"]?https?:/);
  for (const asset of ['coastal-wallet.svg', 'coastal-settlement.svg']) {
    const svg = read(`public/${asset}`);
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /<script|onload=|<foreignObject|https?:\/\/(?!www\.w3\.org)/i);
  }
});

test('Desktop keeps the member-balance action and mobile preserves the existing navigation', () => {
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.mobile-shortcuts \.shortcut-card/);
  assert.doesNotMatch(css, /\.shortcut-balances\s*\{[^}]*display:\s*none/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.doesNotMatch(css, /z-index:\s*(?:999|9999)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
