// Run the real build with fixture APIs and real webfont requests, not an installed-font substitute.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import helmet from 'helmet';
import {launch,fixture} from './helpers/ledger-browser.mjs';
const dist=resolve(process.env.ENTRY_TEST_DIST||new URL('../dist',import.meta.url).pathname);
const FAMILY='GenSenRoundedTW';
let guest=false;
const writes=[];
// Same font/style origins as production, with all unneeded test origins blocked.
const security=helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],fontSrc:["'self'",'https://font.emtech.cc','data:'],styleSrc:["'self'","'unsafe-inline'",'https://font.emtech.cc'],imgSrc:["'self'",'data:'],scriptSrc:["'self'"],upgradeInsecureRequests:null}}});
const server=createServer((req,res)=>security(req,res,()=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method!=='GET'){writes.push(path);return json({error:'Fixture is read-only'},405);}
  if(path==='/api/me')return guest?json({},401):json({...fixture.members[0],isSuperuser:true,bankAccount:{configured:false}});
  if(path==='/api/groups')return json([{...fixture,memberCount:15},{...fixture,id:'other',name:'日本關西行',currency:'JPY',memberCount:6}]);
  if(path==='/api/groups/coast')return json(fixture);
  if(path==='/api/groups/other')return json({...fixture,id:'other',name:'日本關西行',currency:'JPY'});
  if(path==='/api/currencies')return json({currencies:[]});
  if(path==='/api/admin/overview')return json({stats:{userCount:1,superuserCount:1,groupCount:1,expenseCount:21},users:[],groups:[],simulatedAccounts:[],auditLogs:[]});
  if(path.startsWith('/api/'))return json({},404);
  const file=resolve(dist,`.${path==='/'||path==='/app'?'/index.html':path}`);
  if(!file.startsWith(dist+'/')||!existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
}));

async function open(browser,width,height,blocked=false){
 const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
 const send=(method,params={})=>browser.send(method,params,sessionId);
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('DOM.enable');await send('CSS.enable');
 if(blocked)await send('Network.setBlockedURLs',{urls:['https://font.emtech.cc/*']});
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__fontQA={errors:[],csp:[]};addEventListener('error',e=>__fontQA.errors.push(e.message));addEventListener('unhandledrejection',e=>__fontQA.errors.push(String(e.reason)));addEventListener('securitypolicyviolation',e=>__fontQA.csp.push(e.blockedURI));`});
 await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/${guest?'':'app'}`});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,r.exceptionDetails?.exception?.description);return r.result.value;};
 const wait=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await delay(200);}throw Error('Not ready: '+expression);};
 await wait(guest?'!!document.querySelector(".site")':'!!document.querySelector(".real-dashboard")');
 const fonts=async()=>{
  if(blocked)return;
  await evaluate(`window.__loadedFonts=false;document.fonts.ready.then(()=>window.__loadedFonts=true);void 0`);
  await wait('window.__loadedFonts');
  assert.equal(await evaluate('document.fonts.check("400 16px GenSenRoundedTW", "旅帳金額NT$123")'),true);
 };
 const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await delay(80);const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);assert.ok(point.hit,selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});await delay(100);};
 const coverage=async selector=>{
  await fonts();
  const offenders=await evaluate(`(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),bad=[];while(walker.nextNode()){const n=walker.currentNode,e=n.parentElement;if(!n.textContent.trim()||!e?.getClientRects().length||['SCRIPT','STYLE','TITLE'].includes(e.tagName)||e.closest('svg'))continue;const s=getComputedStyle(e);if(s.visibility==='hidden'||s.display==='none')continue;if(!s.fontFamily.replaceAll('"','').startsWith('${FAMILY}'))bad.push({tag:e.tagName,class:e.className,font:s.fontFamily,text:n.textContent.slice(0,30)});}return bad;})()`);
  assert.deepEqual(offenders,[],'All displayed text must select the rounded TW font');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  assert.deepEqual(await evaluate('__fontQA.errors'),[]);
  const csp=await evaluate('__fontQA.csp.filter(url=>url.includes("font.emtech.cc"))');assert.deepEqual(csp,[]);
  if(!blocked){const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector});const {fonts:rendered}=await send('CSS.getPlatformFontsForNode',{nodeId});assert.ok(rendered.some(font=>font.isCustomFont&&font.glyphCount>0&&/GenSen/i.test(font.familyName+' '+font.postScriptName)),JSON.stringify({selector,rendered}));}
 };
 const screenshot=async name=>{await fonts();const dir=process.env.GENSEN_SCREENSHOTS;if(!dir)return;mkdirSync(dir,{recursive:true});const {data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,name+'.png'),Buffer.from(data,'base64'));};
 await fonts();
 return{send,evaluate,wait,click,coverage,screenshot,close:()=>browser.send('Target.closeTarget',{targetId})};
}

test('Real GenSen TW webfonts across desktop, mobile, portals, public and admin',{timeout:360000},async t=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await launch();
 try{
  for(const width of [320,390,900,1024,1672])await t.test(`${width}px ledger and expense input load real rounded fonts`,async()=>{
   const p=await open(b,width,900);
   try{
    await p.coverage(width>900?'.group-title-row h1':'.balance-total');
    if([390,1672].includes(width))await p.screenshot(`gensen-ledger-${width}`);
    if(width<901){await p.click('.mobile-group-picker');await p.coverage('.ledger-switcher-heading h2');if(width===390)await p.screenshot('gensen-switcher-390');await p.click('.ledger-switcher-modal .modal-x');await p.click('.mobile-bottom-nav button:nth-child(2)');await p.coverage('.mobile-expense-record-title b');if(width===390)await p.screenshot('gensen-expenses-390');await p.click('.record-list>article:nth-child(2) .mobile-expense-record-detail');await p.coverage('.expense-shares-modal-content h2');await p.click('[aria-modal=true] .modal-x');}
    await p.click(width>900?'.header-primary':'.mobile-bottom-add');await p.click('#es-amount');
    await p.coverage('.es-modal-header h2');
    if([390,1672].includes(width))await p.screenshot(`gensen-entry-${width}`);
    assert.equal(await p.evaluate(`(()=>{const e=document.querySelector('.es-save'),r=e.getBoundingClientRect();return r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`),true);
    await p.click('.es-close');
    if(width===1672){await p.click('.superuser-entry');await p.wait('!!document.querySelector(".admin-shell")');await p.coverage('.admin-shell h1');await p.screenshot('gensen-admin');}
   }finally{await p.close();}
  });
  for(const width of [390,1440])await t.test(`${width}px public page typography and original logo`,async()=>{
   guest=true;const p=await open(b,width,900);try{await p.coverage('.hero h1');await p.screenshot(`gensen-home-${width}`);}finally{guest=false;await p.close();}
  });
  await t.test('Provider unavailable: readable fallbacks and working save/close controls',async()=>{
   const p=await open(b,390,844,true);try{await p.coverage('.balance-total');await p.click('.mobile-bottom-add');await p.coverage('.es-modal-header h2');await p.click('.es-close');assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);}finally{await p.close();}
  });
  assert.deepEqual(writes,[],'No mutation may reach even the fixture API');
 }finally{await b.close();await new Promise(r=>server.close(r));}
});
