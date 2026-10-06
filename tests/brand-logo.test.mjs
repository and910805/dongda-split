import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Shared branding uses the supplied signature without duplicated typeset words', () => {
  const source = read('src/BrandLogo.jsx');
  assert.match(source, /brand-handwritten/);
  assert.match(source, /role="img" aria-label="旅帳 TripTab"/);
  assert.match(source, /width="176" height="100"/);
  assert.doesNotMatch(source, /brand-wordmark|brand-name|brand-english/);
  for (const asset of ['triptab-logo.svg', 'triptab-logo-light.svg', 'triptab-mark.svg']) {
    assert.ok(source.includes(`/${asset}?v=handwritten-sun-1`), asset);
  }
});

test('Logo assets are self-contained scalable artwork, not the reference presentation board', () => {
  for (const name of ['triptab-logo.svg', 'triptab-logo-light.svg', 'triptab-mark.svg']) {
    const svg = read(`public/${name}`);
    assert.match(svg, /<svg[^>]+viewBox=/);
    assert.match(svg, /<path/);
    assert.match(svg, /<circle/);
    assert.match(svg, /旅帳 TripTab/);
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|<text\b|on\w+=|url\(|href=|版本六|Travel More|手寫字|色票/i);
    assert.ok(Buffer.byteLength(svg) < 16000, 'SVG must remain lightweight');
  }
  const dark = read('public/triptab-logo.svg').match(/\bd="([^"]+)"/)[1];
  const light = read('public/triptab-logo-light.svg').match(/\bd="([^"]+)"/)[1];
  assert.equal(dark, light, 'Dark-footer variant preserves the same letterforms');
});

test('Browser and home-screen icons use the versioned sun signature', () => {
  const html = read('index.html');
  assert.match(html, /rel="icon"[^>]+triptab-mark\.svg\?v=handwritten-sun-1/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
  const png = readFileSync(new URL('../public/triptab-apple-touch-icon.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
});

test('Brand styles do not change the page, ledger actions or modal layers', () => {
  const css = read('src/brand-logo.css');
  assert.match(css, /aspect-ratio: 176 \/ 100/);
  assert.match(css, /object-fit: contain/);
  assert.doesNotMatch(css, /z-index|position:\s*fixed|\.overlay|\.es-save|\.mobile-bottom-nav|!important/);
});
