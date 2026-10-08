// Full built-app regression: no extra npm dependencies or production API calls.
// Run after pnpm build. Chrome/Chromium is required (CHROME_PATH may override).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

import {createFontFixture} from './helpers/font-fixture.mjs';
const root = resolve(import.meta.dirname, '..');
const dist = process.env.ENTRY_TEST_DIST || join(root, 'dist');
const fontFixture = await createFontFixture(dist);
const index = readFileSync(join(dist, 'index.html'), 'utf8');
const jsPath = index.match(/<script[^>]+src="([^"]+\.js)"/)[1];
const cssPath = index.match(/<link[^>]+href="([^"]+\.css)"/)[1];
const script = readFileSync(join(dist, jsPath.replace(/^\//, '')), 'utf8');
const styles = readFileSync(join(dist, cssPath.replace(/^\//, '')), 'utf8');
const screenshotDir = process.env.ENTRY_SCREENSHOTS;
const description = '晚餐。加飲料 12.34';
const fixture = {
  id: 'review', name: '週末旅行。帳本', description: 'Browser regression fixture',
  currency: 'TWD', ledgerVersion: 1, ownerId: 'you', createdBy: 'you',
  createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z',
  totalExpenseCents: 0, expenses: [], settlements: [], balances: [],
  members: [{id: 'you', displayName: 'Kaiyo'}, ...Array.from({length: 14}, (_, i) => ({
    id: `member-${i + 1}`, displayName: i === 12 ? '成員。需要完整保留的長姓名' : `Member ${i + 1}`,
  }))],
};
const mock = `
window.__entryQA = {requests: [], nextMode: 'success', saved: new Map()};
const store = new Map();
Object.defineProperty(window, 'sessionStorage', {configurable:true, value:{getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k)}});
const group = ${JSON.stringify(fixture)};
window.fetch = async (url, options = {}) => {
  const path=String(url), body=options.body?JSON.parse(options.body):null;
  const request={path,method:options.method||'GET',body,headers:options.headers||{}};
  window.__entryQA.requests.push(request);
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(path==='/api/me')return json({id:'you',displayName:'Kaiyo',bankAccount:{configured:false}});
  if(path==='/api/groups')return json([group]);
  if(path==='/api/groups/review')return json(group);
  if(path==='/api/currencies')return json({currencies:[]});
  if(path.endsWith('/expense-rate'))return json({rate:'0.215',exchangeRateToken:'fixture-quote',rateDate:'2026-10-05'});
  if(path.endsWith('/expenses')&&request.method==='POST'){
    const qa=window.__entryQA,key=request.headers['Idempotency-Key'];
    if(qa.saved.has(key))return json(qa.saved.get(key));
    const result={id:'fixture-expense'};qa.saved.set(key,result);
    const mode=qa.nextMode;qa.nextMode='success';
    return mode==='unknown'?json({error:'Gateway timeout'},504):json(result);
  }
  throw new Error('Unexpected mock request: '+path);
};
`;
const html = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${fontFixture.styles(styles)}</style></head><body><div id="root"></div><script>${mock}\n${script}</script></body></html>`;

async function launch() {
  const executable = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  assert.ok(executable, 'Install Chrome/Chromium or set CHROME_PATH to run built-app regressions.');
  const profile = mkdtempSync(join(tmpdir(), 'triptab-browser-'));
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  const endpoint = await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);
    let log='';child.stderr.on('data',data=>{log+=data;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chrome exited: ${code}`));});
  });
  const ws = new WebSocket(endpoint), pending = new Map();let serial=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Runtime.exceptionThrown')console.error('BROWSER EXCEPTION',JSON.stringify(message.params));if(!message.id)return;const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  return {send, async close(){for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Browser closed'));}pending.clear();ws.close();child.kill();await delay(150);rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
}
async function page(browser,width,height,initial='') {
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>browser.send(method,params,sessionId);
  await send('Page.enable');await send('Runtime.enable');
  // Mock fetch does not intercept CSS imports or images. Keep those offline too.
  await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['https://*']});
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await fontFixture.navigate(send);
  const {frameTree}=await send('Page.getFrameTree');
  await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:html.slice(0, html.indexOf('<script>')) + '</body></html>'});
  const startup=await send('Runtime.evaluate',{expression:mock+initial+'\n'+script,awaitPromise:true});
  assert.ok(!startup.exceptionDetails,startup.exceptionDetails?.exception?.description);
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!result.exceptionDetails,result.exceptionDetails?.text+' '+result.exceptionDetails?.exception?.description);return result.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(30);}throw new Error(`Condition not met: ${expression}; page=${await evaluate("document.body.innerText.slice(0,800)")}`);};
  const click=async selector=>{
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await delay(30);
    const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:el.contains(document.elementFromPoint(x,y))};})()`);
    assert.ok(point.hit,`Click is obstructed: ${selector}`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});await delay(40);
  };
  const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(30);};
  await wait('!!document.querySelector(".real-dashboard")');
  await evaluate('document.fonts.ready');
  return {send,evaluate,wait,click,input,close:()=>browser.send('Target.closeTarget',{targetId}),async screenshot(name){if(!screenshotDir)return;mkdirSync(screenshotDir,{recursive:true});const {data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(screenshotDir,`${name}.png`),Buffer.from(data,'base64'));}};
}
const saveIsVisible = `(()=>{
 const modal=document.querySelector('.expense-single-modal'), overlay=modal.parentElement, save=modal.querySelector('.es-save'), nav=document.querySelector('.mobile-bottom-nav'), root=document.querySelector('#root'), r=save.getBoundingClientRect(), view=window.visualViewport;
 return {portal:overlay.parentElement===document.body,aboveNav:!nav.getClientRects().length||Number(getComputedStyle(overlay).zIndex)>Number(getComputedStyle(nav).zIndex),rootInert:root.inert,rootHidden:root.getAttribute('aria-hidden'),locked:document.body.style.overflow==='hidden',visible:r.top>=0&&r.bottom<=view.height+view.offsetTop+1&&r.left>=0&&r.right<=innerWidth,hit:save.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),noOverflow:modal.scrollWidth<=modal.clientWidth+1,oneModal:document.querySelectorAll('[aria-modal="true"]').length===1};})()`;
function assertLayout(result) { for(const key of ['portal','aboveNav','rootInert','locked','visible','hit','noOverflow','oneModal'])assert.equal(result[key],true,key);assert.equal(result.rootHidden,'true'); }

async function assertCopy(p, saveLabel = '儲存支出') {
 const userText = [fixture.name, description, ...fixture.members.map(member => member.displayName)];
 const result = await p.evaluate(`(()=>{
  const modal=document.querySelector('.expense-single-modal');
  let text=modal.textContent + Array.from(modal.querySelectorAll('[aria-label], [placeholder], [title]')).map(el=>['aria-label','placeholder','title'].map(name=>el.getAttribute(name)||'').join(' ')).join(' ');
  for(const value of ${JSON.stringify(userText)})text=text.split(value).join('');
  return {lang:modal.lang,hasFullStop:text.includes(String.fromCharCode(0x3002)),save:modal.querySelector('.es-save').innerText.trim(),oldEnglish:/Save expense|View details|Split equally|Keep editing/.test(text)};
 })()`);
 assert.equal(result.lang,'zh-TW');assert.equal(result.save,saveLabel);
 assert.equal(result.hasFullStop,false,'System copy must not contain Chinese full stops');
 assert.equal(result.oldEnglish,false,'Expense entry must remain in Traditional Chinese');
}

// This starts the real ProductApp and its bottom navigation, not a modal-only shell.
test('Built expense entry: mobile layering and Traditional Chinese without full stops', {timeout:120000}, async t => {
 const browser=await launch();
 try {
  for(const [width,height] of [[320,700],[349,749],[390,844],[430,932],[760,650],[844,390],[1440,1000]]) {
   await t.test(`${width}x${height}: 15-member form keeps its save action above app navigation`, async()=>{
    const p=await page(browser,width,height);
    try {
     // A transformed application root must not become the overlay's containing block.
     await p.evaluate("document.querySelector('#root').style.transform='translateZ(0)'");
     const opener=await p.evaluate("document.querySelector('.mobile-bottom-add')?.getClientRects().length ? '.mobile-bottom-add' : '.header-primary'");
     await p.click(opener);await p.wait('!!document.querySelector("#es-amount")');
     assertLayout(await p.evaluate(saveIsVisible));await assertCopy(p);
     assert.equal(await p.evaluate("document.querySelector('#es-context > span').textContent"),fixture.name);
     assert.ok((await p.evaluate("document.querySelector('.es-people-table').textContent")).includes(fixture.members[13].displayName));
     await p.input('#es-amount','1500');await p.input('#es-description',description);
     await p.click('.es-quick-person:nth-child(2)');
     for(let i=0;i<4;i++) {
      await p.click(`.es-split-option:nth-child(${i+1})`);
      assertLayout(await p.evaluate(saveIsVisible));await assertCopy(p);
     }
     await p.click('.es-split-option:first-child');
     await p.evaluate("document.querySelector('.es-scroll').scrollTop=1e6");
     assertLayout(await p.evaluate(saveIsVisible));
     if([349,390,1440].includes(width))await p.screenshot(`fixed-${width}`);
     await p.click('.es-dock-detail');assertLayout(await p.evaluate(saveIsVisible));await assertCopy(p);
     assert.equal(await p.evaluate("document.querySelector('#es-details h4').textContent"),description);
     assert.equal(await p.evaluate("document.querySelector('#es-amount').value"),'1500');
     await p.click('.es-dock-detail');
     await p.click('.es-cancel');await p.wait('!!document.querySelector(".es-discard")');await assertCopy(p);
     assert.equal(await p.evaluate("document.querySelectorAll('[aria-modal=true]').length"),1);
     await p.click('.es-discard .es-secondary');
     await p.click('.es-save');await p.wait('!document.querySelector(".expense-single-modal")');
     const result=await p.evaluate("({inert:document.querySelector('#root').inert,hidden:document.querySelector('#root').getAttribute('aria-hidden'),overflow:document.body.style.overflow,requests:__entryQA.requests.filter(r=>r.path.endsWith('/expenses'))})");
     assert.equal(result.inert,false);assert.equal(result.hidden,null);assert.equal(result.overflow,'');
     assert.equal(result.requests.length,1);assert.equal(result.requests[0].body.participantIds.length,15);assert.equal(result.requests[0].body.category,'\u9910\u98f2');
     assert.equal(result.requests[0].body.title,description,'User punctuation must not be stripped');
    }finally{await p.close();}
   });
  }
  await t.test('Keyboard-height change retains the same form and keeps the save button visible',async()=>{
   const p=await page(browser,390,844);
   try{
    await p.click('.mobile-bottom-add');await p.input('#es-amount','1234');await p.input('#es-description','Draft');
    await p.evaluate('void(window.originalModal=document.querySelector(".expense-single-modal"))');
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:420,deviceScaleFactor:1,mobile:false});await delay(100);
    assertLayout(await p.evaluate(saveIsVisible));await assertCopy(p);
    assert.equal(await p.evaluate('document.querySelector(".expense-single-modal")===window.originalModal'),true);
    assert.equal(await p.evaluate('document.querySelector("#es-amount").value'),'1234');
    await p.click('.es-close');await p.wait('!!document.querySelector(".es-discard")');await p.click('.es-discard .es-danger');
    assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
    await p.click('.mobile-bottom-add');assertLayout(await p.evaluate(saveIsVisible));
   }finally{await p.close();}
  });
  await t.test('Unknown saves reuse their original key and localized recovery message',async()=>{
   const p=await page(browser,349,749);
   try{
    await p.click('.mobile-bottom-add');await p.input('#es-amount','1500');await p.input('#es-description',description);await p.click('.es-quick-person:nth-child(2)');
    await p.evaluate("__entryQA.nextMode='unknown'");await p.click('.es-save');await p.wait('!!document.querySelector(".es-unknown")');
    assertLayout(await p.evaluate(saveIsVisible));await assertCopy(p,'確認儲存結果');
    await p.click('.es-save');await p.wait('!document.querySelector(".expense-single-modal")');
    const requests=await p.evaluate("__entryQA.requests.filter(r=>r.path.endsWith('/expenses'))");
    assert.equal(requests.length,2);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
    assert.equal(requests[1].body.title,description);
   }finally{await p.close();}
  });
  await t.test('Refund and validation copy omit full stops without changing decimal values or user text',async()=>{
   const p=await page(browser,390,844);
   try{
    await p.click('.mobile-bottom-add');await p.click('.es-save');await p.wait('!!document.querySelector(".es-error")');await assertCopy(p);
    await p.input('#es-description',description);await p.input('#es-amount','12.34');
    await p.click('.es-card-head .es-switch button:nth-child(2)');
    await p.evaluate("(()=>{const el=document.querySelector('#es-currency');el.value='USD';el.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await p.wait("document.querySelector('#es-rate')?.value==='0.215'");
    await p.input('#es-rate','32.4');await assertCopy(p,'儲存退款');assertLayout(await p.evaluate(saveIsVisible));
    await p.click('.es-save');await p.wait('!document.querySelector(".expense-single-modal")');
    const requests=await p.evaluate("__entryQA.requests.filter(r=>r.path.endsWith('/expenses'))");
    assert.equal(requests.length,1);
    assert.equal(requests[0].body.kind,'refund');assert.equal(requests[0].body.amount,'12.34');
    assert.equal(requests[0].body.expenseCurrency,'USD');assert.equal(requests[0].body.exchangeRate,'32.4');assert.equal(requests[0].body.title,description);
   }finally{await p.close();}
  });
 }finally{await browser.close();}
});