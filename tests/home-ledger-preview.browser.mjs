// Real public-page bundle, local assets and synthetic API responses, no live accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {launch} from './helpers/ledger-browser.mjs';
import {createFontFixture, assertRenderedTaipei} from './helpers/font-fixture.mjs';

const dist = resolve(process.env.ENTRY_TEST_DIST || new URL('../dist', import.meta.url).pathname);
const fontFixture = await createFontFixture(dist);
const index = readFileSync(join(dist, 'index.html'), 'utf8');
const script = readFileSync(join(dist, index.match(/<script[^>]+src="([^"]+\.js)"/)[1]), 'utf8');
const asset = path => `data:${path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.webp') ? 'image/webp' : 'image/png'};base64,${readFileSync(join(dist, path)).toString('base64')}`;
const css = fontFixture.styles(readFileSync(join(dist, index.match(/<link[^>]+href="([^"]+\.css)"/)[1]), 'utf8'))
  .replace(/url\((['"]?)(\/[^)'"?]+)(?:\?[^)'" ]+)?\1\)/g, (match, quote, path) => /\.(svg|webp|png)$/.test(path) && existsSync(join(dist, path)) ? `url("${asset(path)}")` : match)
  // Avoid the browser var() expansion size limit when inlining the large fixture background.
  .replace(/background:var\(--hero-surface\) (url\("[^"]+"\)) center bottom\/cover no-repeat/g, "background-color:var(--hero-surface);background-image:$1;background-position:center bottom;background-size:cover;background-repeat:no-repeat");
const images = Object.fromEntries(['triptab-logo.svg', 'triptab-logo-light.svg', 'triptab-mark.svg', 'xiaoluo-avatar.png', 'hero-airplane-watercolor.png', 'hero-ledger-expenses-v1.webp'].map(path => ['/' + path, asset(path)]));

async function openHome(browser, width, height) {
  const {targetId} = await browser.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true});
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', {urls: ['https://*']});
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
  await fontFixture.navigate(send);
  const {frameTree} = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', {frameId: frameTree.frame.id, html: `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>`});
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    assert.ok(!response.exceptionDetails, response.exceptionDetails?.exception?.description);
    return response.result.value;
  };
  await evaluate(`const images=${JSON.stringify(images)};
    new MutationObserver(()=>document.querySelectorAll('img[src^="/"]').forEach(image=>{const source=image.getAttribute('src'),bytes=images[source.split('?')[0]];if(bytes){image.dataset.originalSrc=source;image.src=bytes;}})).observe(document.documentElement,{childList:true,subtree:true});
    window.__homeQA={requests:[],errors:[]};
    addEventListener('error',event=>__homeQA.errors.push(event.message));
    addEventListener('unhandledrejection',event=>__homeQA.errors.push(String(event.reason)));
    window.fetch=async(url,options={})=>{
      const path=String(url);__homeQA.requests.push({path,method:options.method||'GET'});
      if(options.method&&options.method!=='GET')throw Error('Public preview must not write');
      if(path==='/api/me')return new Response('{}',{status:401,headers:{'content-type':'application/json'}});
      if(path==='/api/currencies')return new Response('{"currencies":[]}',{headers:{'content-type':'application/json'}});
      throw Error('Unexpected public-page request: '+path);
    };\n${script}`);
  const wait = async expression => {for (let n = 0; n < 120; n++) {if (await evaluate(expression)) return;await delay(30);}throw Error(`Not ready: ${expression}`);};
  await wait('!!document.querySelector(".hero-ledger-screenshot")?.naturalWidth');
  await wait('document.querySelectorAll(".hero-ledger-avatar-overlay image").length===4');
  const decoded = await evaluate(`Promise.all([...document.querySelectorAll('.hero-ledger-avatar-overlay image')].map(async node=>{
    const image=new Image();image.src=node.href.baseVal;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};}))`);
  assert.ok(decoded.every(image=>image.width===38&&image.height===38));
  await evaluate('document.fonts.ready'); await delay(100);
  return {send, evaluate, wait, close: () => browser.send('Target.closeTarget', {targetId}),
    async screenshot(name) {
      const directory = process.env.HOME_PREVIEW_SCREENSHOTS;
      if (!directory) return;
      mkdirSync(directory, {recursive: true});
      const {data} = await send('Page.captureScreenshot', {format: 'png'});
      writeFileSync(join(directory, name + '.png'), Buffer.from(data, 'base64'));
    }};
}

test('Homepage phone uses the genuine expense capture without clipped or overlapping UI', {timeout: 120000}, async t => {
  const browser = await launch();
  try {
    for (const width of [320, 390, 768, 1024, 1440, 1672, 1920]) await t.test(`${width}px: complete capture, coherent labels and unobstructed phone`, async () => {
      const p = await openHome(browser, width, width <= 900 ? 900 : 1000);
      try {
        await assertRenderedTaipei(p, '.site h1');
        assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
        const shape = await p.evaluate(`(()=>{const image=document.querySelector('.hero-ledger-screenshot'),phone=document.querySelector('.phone'),note=document.querySelector('.hero-ledger-preview .float-note'),r=phone.getBoundingClientRect(),n=note.getBoundingClientRect();return {width:image.naturalWidth,height:image.naturalHeight,fit:getComputedStyle(image).objectFit,phoneLeft:r.left,phoneRight:r.right,noteGap:n.top-r.bottom,noteBottom:n.bottom,heroBottom:document.querySelector('.hero').getBoundingClientRect().bottom,buttons:document.querySelector('.phone-content-real').querySelectorAll('button,a,input,select').length}})()`);
        assert.equal(shape.width, 780); assert.equal(shape.height, 1512);
        assert.equal(shape.fit, 'contain'); assert.equal(shape.buttons, 0);
        assert.ok(shape.phoneLeft >= 0 && shape.phoneRight <= width, JSON.stringify(shape));
        assert.ok(shape.noteGap >= 8, JSON.stringify(shape));
        assert.ok(shape.noteBottom <= shape.heroBottom - 1, JSON.stringify(shape));
        const layer = await p.evaluate(`(()=>{const a=document.querySelector('.hero-ledger-avatar-overlay'),i=document.querySelector('.hero-ledger-screenshot'),r=a.getBoundingClientRect(),b=i.getBoundingClientRect();return {aligned:['left','top','width','height'].every(key=>Math.abs(r[key]-b[key])<.1),viewBox:a.getAttribute('viewBox'),fit:a.getAttribute('preserveAspectRatio'),count:a.querySelectorAll('[data-avatar-instance]').length,badges:a.querySelectorAll('mask circle').length,revision:a.dataset.avatarRevision,pointer:getComputedStyle(a).pointerEvents,references:[...a.querySelectorAll('use')].every(u=>!!document.getElementById(u.href.baseVal.slice(1)))}})()`);
        assert.deepEqual(layer, {aligned:true,viewBox:'0 0 780 1512',fit:'xMidYMid meet',count:12,badges:2,revision:'authorized-photos-1',pointer:'none',references:true});
        assert.match(await p.evaluate('document.querySelector(".hero-ledger-preview").innerText'), /宜筆勾銷 · 示範資料/);
        assert.doesNotMatch(await p.evaluate('document.querySelector(".hero-ledger-preview").innerText'), /JPY|12,600|只需要轉帳/);
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.hero-ledger-preview .ticket')).display==='none'||Number(getComputedStyle(document.querySelector('.hero-ledger-preview .ticket')).zIndex)<Number(getComputedStyle(document.querySelector('.phone')).zIndex)"), true);
        assert.deepEqual(await p.evaluate('__homeQA.errors'), []);
        assert.equal(await p.evaluate('__homeQA.requests.every(r=>r.method==="GET"&&["/api/me","/api/currencies"].includes(r.path))'), true);
        if ([390, 1672].includes(width)) {
          await p.screenshot(`home-expenses-${width}`);
          await p.evaluate('document.querySelector(".phone").scrollIntoView({block:"center"})');
          await p.screenshot(`home-phone-${width}`);
        }
      } finally {await p.close();}
    });
    for(const selector of ['.hero-ledger-screenshot','.hero-ledger-avatar-overlay image']) await t.test(`Image failure remains understandable: ${selector}`, async () => {
      const p = await openHome(browser, 390, 900);
      try {
        await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('error'))`);
        await p.wait('!!document.querySelector(".hero-preview-fallback")');
        assert.match(await p.evaluate('document.querySelector(".hero-preview-fallback").innerText'), /暫時無法載入/);
        assert.equal(await p.evaluate('document.querySelector(".hero-actions .primary").disabled'), false);
        assert.equal(await p.evaluate('__homeQA.requests.some(r=>r.method!=="GET")'), false);
        assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
        assert.equal(await p.evaluate('document.querySelectorAll(".hero-ledger-avatar-overlay").length'), 0);
      } finally {await p.close();}
    });
  } finally {await browser.close();}
});
