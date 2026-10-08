// Run the actual build offline: local assets, fixture API, no remote requests
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createFontFixture, assertRenderedTaipei} from './helpers/font-fixture.mjs';
import {launch, fixture} from './helpers/ledger-browser.mjs';

const dist = resolve(process.env.ENTRY_TEST_DIST || new URL('../dist', import.meta.url).pathname);
const fontFixture = await createFontFixture(dist);
const index = readFileSync(join(dist,'index.html'),'utf8');
const builtScript = readFileSync(join(dist,index.match(/<script[^>]+src="([^"]+\.js)"/)[1]),'utf8');
const assetData = name => {
  const type=name.endsWith('.svg')?'image/svg+xml':name.endsWith('.webp')?'image/webp':'image/png';
  return `data:${type};base64,${readFileSync(join(dist,name)).toString('base64')}`;
};
const builtCss = readFileSync(join(dist,index.match(/<link[^>]+href="([^"]+\.css)"/)[1]),'utf8')
  .replace(/url\((['"]?)(\/[^)'"?]+)(?:\?[^)'" ]+)?\1\)/g,(m,q,path)=>/\.(svg|webp|png)$/.test(path)?`url(${assetData(path.slice(1))})`:m);
const brands = Object.fromEntries(['triptab-logo.svg','triptab-logo-light.svg','triptab-mark.svg'].map(n=>[`/${n}`,assetData(n)]));

async function openPage(browser, width, height, guest = false) {
  const {targetId} = await browser.send('Target.createTarget', {url:'about:blank'});
  const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten:true});
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['https://*']});
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false});
  const mock = `const brands=${JSON.stringify(brands)};
    new MutationObserver(()=>document.querySelectorAll('img[src^="/triptab-"]').forEach(i=>{const original=i.getAttribute('src'),asset=brands[original.split('?')[0]];if(asset){i.dataset.brandAsset=original;i.src=asset;}})).observe(document.documentElement,{childList:true,subtree:true});
    const group=${JSON.stringify(fixture)};
    window.__brandQA={errors:[],writes:[]};
    addEventListener('error',e=>__brandQA.errors.push(e.message));
    addEventListener('unhandledrejection',e=>__brandQA.errors.push(String(e.reason)));
    window.fetch=async(url,options={})=>{
      const path=String(url), json=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
      if(options.method && options.method!=='GET') {__brandQA.writes.push(path); throw Error('No mutation is allowed in the branding fixture');}
      if(path==='/api/me')return ${guest ? "json({},401)" : "json({...group.members[0],isSuperuser:true,bankAccount:{configured:false}})"};
      if(path==='/api/groups')return json([group]);
      if(path==='/api/groups/coast')return json(group);
      if(path==='/api/currencies')return json({currencies:[]});
      if(path==='/api/admin/overview')return json({stats:{userCount:1,superuserCount:1,groupCount:1,expenseCount:21},users:[],groups:[],simulatedAccounts:[],auditLogs:[]});
      throw Error('Unexpected fixture request: '+path);
    };`;
  await fontFixture.navigate(send);
  const {frameTree}=await send('Page.getFrameTree');
  await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:`<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="icon" href="${assetData('triptab-mark.svg')}"><link rel="apple-touch-icon" href="${assetData('triptab-apple-touch-icon.png')}"><style>${fontFixture.styles(builtCss)}</style></head><body><div id="root"></div></body></html>`});
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description);
    return r.result.value;
  };
  await evaluate(mock+'\n'+builtScript);
  const wait = async expression => {for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(35);}throw Error(`Not ready: ${expression}; ${await evaluate("JSON.stringify({text:document.body?.innerText,errors:window.__brandQA?.errors,url:location.href})")}`);};
  await wait(guest ? '!!document.querySelector(".site")' : '!!document.querySelector(".real-dashboard")');
  await evaluate('document.fonts.ready');
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`); await delay(50);
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);
    assert.ok(p.hit, `Obstructed ${selector}`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed', x:p.x, y:p.y, button:'left', clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased', x:p.x, y:p.y, button:'left', clickCount:1});
    await delay(80);
  };
  const screenshot = async name => {
    if(!process.env.BRAND_SCREENSHOTS)return;
    mkdirSync(process.env.BRAND_SCREENSHOTS,{recursive:true});
    await evaluate('document.fonts.ready');
    const {data}=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.BRAND_SCREENSHOTS,name+'.png'),Buffer.from(data,'base64'));
  };
  return {send,evaluate,wait,click,screenshot,close:()=>browser.send('Target.closeTarget',{targetId})};
}

async function assertLogos(p) {
  await p.evaluate('document.fonts.ready');
  const selector=await p.evaluate("document.querySelector('.site h1')?'.site h1':document.querySelector('.admin-workspace h1')?'.admin-workspace h1':document.querySelector('.mobile-ledger-heading h1')?.getClientRects().length?'.mobile-ledger-heading h1':'.group-title-row h1'");
  await assertRenderedTaipei(p,selector);
  await p.wait('[...document.querySelectorAll(".brand-lockup,.brand-signature-mark img")].every(i=>i.complete&&i.naturalWidth>0)');
  const logos=await p.evaluate(`([...document.querySelectorAll('.brand-lockup,.brand-signature-mark img')].filter(i=>i.getClientRects().length).map(i=>{const r=i.getBoundingClientRect();return{src:i.dataset.brandAsset,ratio:parseFloat(getComputedStyle(i).width)/parseFloat(getComputedStyle(i).height),expected:i.naturalWidth/i.naturalHeight,right:r.right,left:r.left}}))`);
  assert.ok(logos.length > 0);
  for(const l of logos){assert.ok(l.src.includes('handwritten-sun-1'));assert.ok(Math.abs(l.ratio-l.expected)<.02,'Logo must not be squashed');assert.ok(l.left>=-1&&l.right<=await p.evaluate('innerWidth')+1,'Logo must fit its viewport');}
  assert.deepEqual(await p.evaluate('__brandQA.errors'),[]);
  assert.deepEqual(await p.evaluate('__brandQA.writes'),[]);
}

test('Signature branding: complete public, ledger and admin surfaces',{timeout:120000},async t=>{
  const b=await launch();
  try {
    for(const width of [320,390,768,1440,1672]){
      await t.test(`${width}px ledger: brand loads and primary actions remain reachable`,async()=>{
        const p=await openPage(b,width,width<901?844:1000);
        try{
          await assertLogos(p);
          assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
          if([390,1672].includes(width))await p.screenshot(`logo-ledger-${width}`);
          await p.click(width<901?'.mobile-bottom-add':'.header-primary');
          await p.wait('!!document.querySelector(".expense-single-modal")');
          assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
          await p.click('.es-close');
          await p.wait('!document.querySelector(".expense-single-modal")');
        }finally{await p.close()}
      });
    }
    for(const width of [320,390,1440]){
      await t.test(`${width}px public page: signature, demo and reversed footer`,async()=>{
        const p=await openPage(b,width,900,true);
        try{
          await assertLogos(p);
          assert.ok(await p.evaluate('document.querySelector("footer .brand-lockup").dataset.brandAsset.includes("triptab-logo-light.svg")'));
          const icon = await p.send('Runtime.evaluate', {expression:`Promise.all([...document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]')].map(l=>new Promise(r=>{const i=new Image();i.onload=()=>r(i.naturalWidth>0);i.onerror=()=>r(false);i.src=l.href})))`,awaitPromise:true,returnByValue:true});
          assert.deepEqual(icon.result.value,[true,true]);
          if(width===1440)await p.screenshot('logo-home-desktop');
          await p.evaluate('document.querySelector("footer").scrollIntoView()');await delay(80);
          if(width===1440)await p.screenshot('logo-footer');
        }finally{await p.close()}
      });
    }
    for(const width of [390,1440]){
      await t.test(`${width}px administrator uses the same identity`,async()=>{
        const p=await openPage(b,width,900);
        try{
          if(width<901){await p.click('.mobile-group-settings');await p.click('.mobile-tools-actions button:nth-child(4)');}
          else await p.click('.superuser-entry');
          await p.wait('!!document.querySelector(".admin-shell")');
          await assertLogos(p);
          if(width===1440)await p.screenshot('logo-admin');
        }finally{await p.close()}
      });
    }
  }finally{await b.close();}
});
