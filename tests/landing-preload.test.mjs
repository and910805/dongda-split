import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [indexHtml,mainSource,styleSource] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
]);

test('/app 不會由 index.html 預載首頁 Hero 圖片', () => {
  assert.doesNotMatch(indexHtml, /rel=["']preload["'][^>]+hero-fuji-sakura/);
  assert.doesNotMatch(indexHtml, /rel=["']preload["'][^>]+hero-airplane-watercolor/);
});

test('首頁仍保留 Hero 背景與飛機圖片載入來源', () => {
  assert.match(styleSource, /hero-fuji-sakura\.png/);
  assert.match(mainSource, /hero-airplane-watercolor\.png/);
  assert.match(mainSource, /waitForImage\(heroBackground\)/);
  assert.match(mainSource, /waitForImage\(heroAirplane\)/);
});
