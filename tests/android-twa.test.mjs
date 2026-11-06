import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [twaSource, webSource, bundledWebSource, gradle, androidManifest] = await Promise.all([
  readFile(new URL('mobile/android/twa-manifest.json', root), 'utf8'),
  readFile(new URL('public/manifest.webmanifest', root), 'utf8'),
  readFile(new URL('mobile/android/app/src/main/res/raw/web_app_manifest.json', root), 'utf8'),
  readFile(new URL('mobile/android/app/build.gradle', root), 'utf8'),
  readFile(new URL('mobile/android/app/src/main/AndroidManifest.xml', root), 'utf8')
]);

test('Android package keeps the deployed TripTab origin and browser session', () => {
  const twa = JSON.parse(twaSource);
  const web = JSON.parse(webSource);
  const origin = `https://${twa.host}`;
  assert.equal(origin, 'https://trip-tap.kuanlin.online');
  assert.equal(twa.startUrl, '/app');
  assert.equal(twa.fallbackType, 'customtabs');
  assert.equal(new URL(twa.webManifestUrl).origin, origin);
  assert.equal(new URL(twa.iconUrl).origin, origin);
  assert.equal(new URL(twa.maskableIconUrl).origin, origin);
  assert.equal(web.scope, '/');
  assert.deepEqual(JSON.parse(bundledWebSource), web);
  assert.match(androidManifest, /android:autoVerify="true"/);
  assert.match(androidManifest, /android:scheme="https"/);
  assert.match(gradle, /hostName: 'trip-tap\.kuanlin\.online'/);
  assert.match(gradle, /webManifestUrl", 'https:\/\/trip-tap\.kuanlin\.online\/manifest\.webmanifest'/);
  assert.doesNotMatch(gradle, /127\.0\.0\.1|localhost|trip-tap\.kuanlin\.pro/);
});
