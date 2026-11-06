import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const publicPath = file => resolve(root, 'public', file);

function pngSize(file) {
  const image = readFileSync(publicPath(file));
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(image.toString('ascii', 12, 16), 'IHDR');
  return `${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`;
}

function createWorker(network = async () => new Response('online')) {
  const handlers = new Map();
  const writes = [];
  const networkRequests = [];
  const entries = new Map();
  const cache = {
    async add(url) {
      writes.push(url);
      entries.set(url, new Response('public offline message'));
    },
    async match(url) { return entries.get(url); },
  };
  const caches = {
    async open(name) {
      assert.equal(name, 'triptab-offline-v1');
      return cache;
    },
    async keys() { return ['triptab-offline-v0', 'another-app-cache', 'triptab-offline-v1']; },
    async delete(name) { writes.push(`delete:${name}`); return true; },
  };
  const self = {
    location: {origin: 'https://trip-tap.kuanlin.online'},
    addEventListener(type, handler) { handlers.set(type, handler); },
    async skipWaiting() {},
    clients: {async claim() {}},
  };
  runInNewContext(readFileSync(publicPath('sw.js'), 'utf8'), {
    self, caches, URL, Response,
    async fetch(request) {
      networkRequests.push(request.url);
      return network(request);
    },
  }, {filename: 'sw.js'});

  async function lifecycle(type) {
    let pending;
    handlers.get(type)({waitUntil(value) { pending = value; }});
    await pending;
  }
  function request(path, {method = 'GET', mode = 'navigate', origin = self.location.origin} = {}) {
    let response;
    handlers.get('fetch')({
      request: {url: `${origin}${path}`, method, mode},
      respondWith(value) { response = value; },
    });
    return response;
  }
  return {lifecycle, request, writes, networkRequests};
}

test('manifest keeps the current origin paths and has real install icons', () => {
  const manifest = JSON.parse(readFileSync(publicPath('manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'zh-TW');
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.equal(pngSize(icon.src.slice(1)), icon.sizes);
  }
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  const index = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert.match(index, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(index, /src="\/src\/register-service-worker\.js"/);
});

test('worker caches only the public offline page and removes only its old cache', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.deepEqual(worker.writes, ['/offline.html', 'delete:triptab-offline-v0']);
  const offlinePage = readFileSync(publicPath('offline.html'), 'utf8');
  assert.match(offlinePage, /目前無法連線/);
  assert.doesNotMatch(offlinePage, /<script\b/i);
});

test('worker never handles API, OAuth, invite, asset, or foreign requests', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  for (const path of ['/api/me', '/api/auth/line', '/api/auth/line/callback', '/api/invites/token/join', '/invite/token', '/invite']) {
    assert.equal(worker.request(path), undefined, path);
  }
  assert.equal(worker.request('/app', {method: 'POST'}), undefined);
  assert.equal(worker.request('/assets/app.js', {mode: 'no-cors'}), undefined);
  assert.equal(worker.request('/app', {origin: 'https://other.example'}), undefined);
  assert.deepEqual(worker.networkRequests, []);
  assert.deepEqual(worker.writes, ['/offline.html']);
});

test('normal pages are network-only and show the public offline page after a network failure', async () => {
  const online = createWorker();
  await online.lifecycle('install');
  assert.equal(await (await online.request('/app')).text(), 'online');
  assert.deepEqual(online.networkRequests, ['https://trip-tap.kuanlin.online/app']);
  assert.deepEqual(online.writes, ['/offline.html']);

  const offline = createWorker(async () => { throw new TypeError('network unavailable'); });
  await offline.lifecycle('install');
  assert.equal(await (await offline.request('/app')).text(), 'public offline message');
  assert.deepEqual(offline.writes, ['/offline.html']);
});
