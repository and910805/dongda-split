import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('All four authorized thumbnails retain their verified bytes without private account metadata', () => {
  const source = JSON.parse(read('src/hero-ledger-avatar-photos.json'));
  assert.equal(source.width, 38); assert.equal(source.height, 38);
  assert.equal(source.photos.length, 4);
  assert.match(source.authorization, /User confirmed permission/);
  assert.equal(new Set(source.photos.map(photo => photo.sha256)).size, 4);
  for (const photo of source.photos) {
    const bytes = Buffer.from(photo.webpBase64, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    assert.equal(hash(bytes), photo.sha256);
    assert.ok(bytes.length < 2000);
    const chunks = [];
    for (let offset = 12; offset + 8 <= bytes.length;) {
      chunks.push(bytes.subarray(offset, offset + 4).toString());
      const length = bytes.readUInt32LE(offset + 4);
      offset += 8 + length + (length % 2);
      assert.ok(offset <= bytes.length);
    }
    assert.ok(!chunks.includes('EXIF') && !chunks.includes('XMP '));
    assert.deepEqual(Object.keys(photo).sort(), ['id', 'sha256', 'webpBase64']);
  }
});

test('The photo layer remains registered to the unchanged real expense-page capture', () => {
  const component = read('src/HeroPreviewAvatars.jsx').toString();
  const screenshot = read('public/hero-ledger-expenses-v1.webp');
  assert.equal(hash(screenshot), 'a0230b4e3a91b032f38d91353b0b0f9e03c0acdf1997fa9fab3750bf6c9fbff8');
  assert.match(component, new RegExp(hash(screenshot)));
  assert.match(component, /viewBox="0 0 780 1512"/);
  assert.match(component, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(component, /authorized-photos-1/);
  assert.doesNotMatch(component, /\bfetch\s*\(|\/api\/|<iframe|onClick=/);
  const preview = read('src/HeroLedgerPreview.jsx').toString();
  assert.match(preview, /<HeroPreviewAvatars onError=/);
  assert.match(preview, /姓名與帳目為示範資料/);
});
