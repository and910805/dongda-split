// Serve only checked-in font shards over loopback, never a real ledger API.
// This lets browser regressions use downloaded webfonts rather than OS fallbacks.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function createFontFixture(dist) {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (path === '/') {
        response.writeHead(200, {'content-type':'text/html'});
        response.end('<!doctype html><html><head><title>Font fixture</title></head><body></body></html>');
        return;
      }
      if (!/^\/fonts\/gensen-tw-2\.1\.0\/[\w.-]+\.woff2$/.test(path)) {
        response.writeHead(404); response.end(); return;
      }
      const bytes = await readFile(join(dist, path));
      response.writeHead(200, {'content-type':'font/woff2', 'access-control-allow-origin':'*', 'cache-control':'public,max-age=3600'});
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  server.unref();
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    styles(css) { return css.replace(/url\((["']?)(\/fonts\/gensen-tw-2\.1\.0\/[\w.-]+\.woff2)\1\)/g, (_, quote, path) => `url("${origin}${path}")`); },
    async navigate(send) {
      await send('Page.navigate', {url: origin});
      // A minimal local document establishes a same-origin base for @font-face.
      for (let n = 0; n < 100; n++) {
        const r = await send('Runtime.evaluate', {expression:`location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`, returnByValue:true});
        if (r.result?.value) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Font fixture navigation timed out');
    },
  };
}

export async function assertRenderedGenSen(p, selector) {
  await p.evaluate('document.fonts.ready');
  assert.match(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontFamily`), /^"?GenSen Rounded TW/);
  await p.send('DOM.enable'); await p.send('CSS.enable');
  const {root} = await p.send('DOM.getDocument');
  const {nodeId} = await p.send('DOM.querySelector', {nodeId:root.nodeId, selector});
  const {fonts} = await p.send('CSS.getPlatformFontsForNode', {nodeId});
  assert.ok(fonts.some(font => font.isCustomFont && /GenSenRounded2TW|GenSenRounded2 TW/.test(font.familyName + font.postScriptName) && font.glyphCount > 0), `No rendered GenSen TW glyphs in ${selector}: ${JSON.stringify(fonts)}`);
  return fonts;
}
