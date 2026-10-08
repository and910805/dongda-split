// Exercise the complete built ProductApp with fixtures, never production accounts
// No added packages: Node 22 WebSocket + the runner's Chrome DevTools protocol
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createFontFixture} from './font-fixture.mjs';
const root = resolve(import.meta.dirname, '../..');
const dist = process.env.ENTRY_TEST_DIST || join(root, 'dist');
const fontFixture = await createFontFixture(dist);
const index = readFileSync(join(dist, 'index.html'), 'utf8');
const script = readFileSync(join(dist, index.match(/<script[^>]+src="([^"]+\.js)"/)[1].replace(/^\//, '')), 'utf8');
let css = readFileSync(join(dist, index.match(/<link[^>]+href="([^"]+\.css)"/)[1].replace(/^\//, '')), 'utf8');
css = fontFixture.styles(css);
// Embed only same-build decorative files in the offline fixture
css = css.replace(/url\((['"]?)(\/[^)'"?]+)\1\)/g, (match, quote, path) => {
  const file = join(dist, path.slice(1));
  if (!existsSync(file) || !/\.(webp|svg|png)$/.test(path)) return match;
  const type = path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.webp') ? 'image/webp' : 'image/png';
  return `url(data:${type};base64,${readFileSync(file).toString('base64')})`;
});
const brandAssets = Object.fromEntries(['triptab-mark.svg','triptab-logo.svg','triptab-logo-light.svg'].map(name => [`/${name}`, 'data:image/svg+xml;base64,' + readFileSync(join(dist,name)).toString('base64')]));
const members = [{id: 'you', displayName: 'Andy'}, ...Array.from({length: 14}, (_, i) => ({id: `m${i}`, displayName: i === 12 ? '姓名較長的同行成員' : `旅伴 ${i + 1}`}))];
const fixture = {
  id: 'coast', name: '宜筆勾銷', description: '一起記下每筆共同花費，最後輕鬆結清', currency: 'TWD', ledgerVersion: 1,
  ownerId: 'you', createdBy: 'you', members, totalExpenseCents: 210000, settlements: [],
  balances: members.map(m => ({...m, balanceCents: 0})),
  expenses: Array.from({length: 21}, (_, i) => ({id: `e${i}`, title: i === 0 ? '午餐' : `共同花費 ${i}`, category: '餐飲', amountCents: 10000,
    payerName: 'Andy', payerId: 'you', payerCount: 1, shareCount: 2, splitMode: 'equal', createdBy: 'you', isLocked: i === 0,
    expenseDate: `2026-07-${String(28 - i % 4).padStart(2, '0')}`, createdAt: '2026-07-28T09:57:00Z',
    shares: [{userId: 'you', amountCents: 5000}, {userId: 'm0', amountCents: 5000}], payments: [{userId: 'you', amountCents: 10000}]})),
  settlementHistory: [{id: 'r1', from: members[1], to: members[0], fromUserId: 'm0', toUserId: 'you', amountCents: 5000, reportStatus: 'confirmed', reportedBy: members[1], createdAt: '2026-07-28T10:00:00Z'}],
};
async function launch() {
  const path = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(p => p && existsSync(p));
  assert.ok(path, 'Chrome is required');
  const profile = mkdtempSync(join(tmpdir(), 'coastal-'));
  const child = spawn(path, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => {child.kill('SIGKILL');reject(new Error('Chrome startup timeout'));}, 30000);
      child.stderr.on('data', data => {log += data;const found = log.match(/DevTools listening on (ws:\/\/\S+)/);if (found) {clearTimeout(timer);resolve(found[1]);}});
      child.once('error', error => {clearTimeout(timer);reject(error);});
      child.once('exit', code => {clearTimeout(timer);reject(new Error(`Chrome exited ${code}`));});
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 10000);ws.addEventListener('open', () => {clearTimeout(timeout);resolve();}, {once: true});ws.addEventListener('error', () => {clearTimeout(timeout);reject(new Error('WebSocket failed'));}, {once: true});});
  } catch (error) {ws?.close();child.kill('SIGKILL');await delay(100);rmSync(profile, {recursive: true, force: true, maxRetries: 5});throw error;}
  const waiting = new Map();let serial = 0;
  ws.addEventListener('message', event => {const message = JSON.parse(String(event.data));const item = waiting.get(message.id);if (!item) return;waiting.delete(message.id);clearTimeout(item.timer);message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);});
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {const id = ++serial;const timer = setTimeout(() => {waiting.delete(id);reject(new Error(`CDP timeout: ${method}`));}, 10000);waiting.set(id, {resolve, reject, timer});ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));});
  return {send, async close() {for (const item of waiting.values()) {clearTimeout(item.timer);item.reject(new Error('Browser closed'));}waiting.clear();ws.close();child.kill();await delay(100);rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});}};
}
async function page(browser, width, height, mode = 'settled', data = fixture, options = {}) {
  const {targetId} = await browser.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true});
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setBlockedURLs', {urls: ['https://*', ...(options.blockFonts ? ['*.woff2'] : [])]});
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
  await fontFixture.navigate(send);
  const {frameTree} = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', {frameId: frameTree.frame.id, html: `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>`});
  const evaluate = async expression => {const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);return result.result.value;};
  const mock = `const brands=${JSON.stringify(brandAssets)};new MutationObserver(()=>document.querySelectorAll('img[src^="/triptab-"]').forEach(img=>{const asset=brands[img.getAttribute('src').split('?')[0]];if(asset)img.src=asset;})).observe(document.documentElement,{childList:true,subtree:true});const group=${JSON.stringify(data)};const mode=${JSON.stringify(mode)};const qaOptions=${JSON.stringify(options)};
    if(mode==='empty'){group.expenses=[];group.settlementHistory=[];group.totalExpenseCents=0;}
    if(mode==='payable'){group.settlements=[{from:group.members[0],to:group.members[1],amountCents:5000,bankAccountAccess:{shared:false}}];group.balances[0].balanceCents=-5000;group.balances[1].balanceCents=5000;}
    window.__qa={requests:[],errors:[]};window.addEventListener('error',e=>__qa.errors.push(e.message));window.addEventListener('unhandledrejection',e=>__qa.errors.push(String(e.reason)));
    for(const key of ['localStorage','sessionStorage']){const store=new Map();Object.defineProperty(window,key,{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});}
    window.fetch=async(url,options={})=>{const path=String(url);__qa.requests.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
      if(path==='/api/me')return json(qaOptions.me||{...group.members[0],isSuperuser:true,bankAccount:{configured:false}});
      const ledgers=qaOptions.groups||[group];
      if(path==='/api/groups')return json(ledgers);
      const ledger=ledgers.find(item=>path==='/api/groups/'+item.id);if(ledger&&(!options.method||options.method==='GET'))return json(ledger);
      if(path==='/api/currencies')return json({currencies:[]});
      if(path.endsWith('/expenses')&&options.method==='POST')return json({id:'new-fixture'});
      if(path.includes('/invite'))return json({token:'local-fixture',url:'https://example.invalid/invite/local'});
      throw new Error('Unexpected fixture request: '+path);
    };`;
  await evaluate(mock + '\n' + script);
  const wait = async expression => {for (let i = 0; i < 100; i++) {if (await evaluate(expression)) return;await delay(30);}throw new Error(`Not ready: ${expression}`);};
  const click = async selector => {await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await delay(50);const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:el.contains(document.elementFromPoint(x,y))}})()`);assert.ok(point.hit, `Obstructed: ${selector}`);await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1});await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1});await delay(50);};
  const setValue = async (selector, value, select = false) => {await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));})()`);await delay(70);};
  await wait('!!document.querySelector(".real-dashboard")');
  await evaluate('document.fonts.ready');
  return {send, evaluate, wait, click, setValue, close: () => browser.send('Target.closeTarget', {targetId}), async screenshot(name) {const dir = process.env.COASTAL_SCREENSHOTS;if (!dir) return;mkdirSync(dir, {recursive: true});await evaluate('document.fonts.ready');const {data} = await send('Page.captureScreenshot', {format: 'png'});writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));}};
}

export {launch, page, fixture};
