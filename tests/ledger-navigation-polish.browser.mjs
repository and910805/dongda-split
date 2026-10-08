import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';
const shown=s=>`!!document.querySelector(${JSON.stringify(s)})?.getClientRects().length`;
const hit=s=>`(()=>{const e=document.querySelector(${JSON.stringify(s)}),r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
const oneDialog=p=>p.evaluate('document.querySelectorAll("[aria-modal=true]").length');
const keys=async(p,key,shiftKey=false)=>{await p.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers:shiftKey?8:0});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers:shiftKey?8:0});await delay(60)};
async function safe(p){assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);assert.deepEqual(await p.evaluate('__qa.errors'),[])}
const ledgerOptions=count=>Array.from({length:count},(_,i)=>({...structuredClone(fixture),id:i?'ledger-'+i:'coast',name:i===1?'日本關西行':i?'旅行帳本 '+i:fixture.name,currency:i===1?'JPY':'TWD',memberCount:15,expenses:fixture.expenses.map(e=>({...e})),adminOnly:i===count-1}));

test('Mobile navigation and details: one entry per expense, ledger sheet and desktop amount focus',{timeout:240000},async t=>{
 const b=await launch();
 try{
  for(const [width,height] of [[320,568],[390,844],[768,1024],[900,1000]])await t.test(`${width}px: one row target, direct permitted detail actions and compact overview`,async()=>{
   const p=await page(b,width,height);
   try{
    assert.equal(await p.evaluate('document.querySelectorAll(".mobile-ledger-metrics button,.mobile-ledger-metrics a").length'),0);
    assert.match(await p.evaluate('document.querySelector(".mobile-ledger-total").innerText'),/帳本總支出.*2,100/s);
    assert.match(await p.evaluate('document.querySelector(".mobile-ledger-count").innerText'),/已記錄 21 筆/);
    if(width===390)await p.screenshot('navigation-overview-390');
    await p.click('.mobile-bottom-nav button:nth-child(2)');
    assert.equal(await p.evaluate('document.querySelectorAll(".mobile-expense-record-more").length'),0);
    assert.equal(await p.evaluate('[...document.querySelectorAll(".mobile-expense-record")].every(e=>e.querySelectorAll("button").length===1)'),true);
    if(width===390)await p.screenshot('navigation-expenses-390');
    // Locked expenses retain their notice and history/refund entries, never edit/delete.
    await p.click('.mobile-expense-record-detail');
    assert.equal(await oneDialog(p),1);assert.equal(await p.evaluate(shown('.expense-lock-notice')),true);
    assert.equal(await p.evaluate(shown('.expense-detail-actions')),false);
    await p.click('.expense-lock-actions button:last-child');
    assert.equal(await oneDialog(p),0);assert.equal(await p.evaluate(shown('.repayment-panel')),true);
    await p.click('.activity-tabs button:first-child');
    const row='.record-list > article:nth-child(2) .mobile-expense-record-detail';
    await p.click(row);assert.equal(await oneDialog(p),1);
    assert.equal(await p.evaluate(shown('.expense-detail-actions')),true);
    if(width===390)await p.screenshot('navigation-details-390');
    await p.click('.expense-detail-actions button:first-child');await p.wait(shown('.expense-single-modal'));
    assert.equal(await oneDialog(p),1);assert.equal(await p.evaluate(hit('.es-save')),true);
    await p.click('.es-close');
    await p.click(row);await p.click('.expense-detail-actions .is-danger');await p.wait(shown('[aria-modal=true]'));
    assert.equal(await oneDialog(p),1);assert.equal(await p.evaluate('__qa.requests.some(r=>r.method==="DELETE")'),false);
    await p.click('[aria-modal=true] .modal-x');
    const before=await p.evaluate('__qa.requests.length');
    await p.click('.mobile-group-picker');assert.equal(await oneDialog(p),1);
    assert.equal(await p.evaluate('document.querySelectorAll(".mobile-group-picker select").length'),0);
    await p.click('.ledger-switcher-item[aria-pressed=true]');
    assert.equal(await oneDialog(p),0);assert.equal(await p.evaluate('__qa.requests.length'),before);
    assert.equal(await p.evaluate('document.activeElement.matches(".mobile-group-picker")'),true);
    assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
    await safe(p);
   }finally{await p.close()}
  });
  for(const width of [390,1024,1672])await t.test(`${width}px: amount field uses outer green focus without a brown box`,async()=>{
   const p=await page(b,width,900);
   try{
    await p.click(width>900?'.header-primary':'.mobile-bottom-add');await p.click('#es-amount');await p.setValue('#es-amount','123456.00');
    assert.equal(await p.evaluate('getComputedStyle(document.querySelector("#es-amount")).outlineStyle'),'none');
    assert.equal(await p.evaluate('getComputedStyle(document.querySelector(".es-amount-block")).borderTopColor'),'rgb(55, 116, 84)');
    assert.equal(await p.evaluate(hit('.es-save')),true);
    assert.doesNotMatch(await p.evaluate('getComputedStyle(document.querySelector("#es-amount")).fontFamily'),/DFKai|Kaiti|Serif/);
    if(width===1672)await p.screenshot('navigation-desktop-amount');
    await p.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
    assert.equal(await p.evaluate('getComputedStyle(document.querySelector(".es-amount-block")).outlineWidth'),'2px');
    await safe(p);
   }finally{await p.close()}
  });
  await t.test('Two ledgers: sheet, exact selection, loading guard and remembered destination',async()=>{
   const groups=ledgerOptions(2);groups[1].adminOnly=false;
   const p=await page(b,390,844,'settled',fixture,{groups});
   try{
    await p.click('.mobile-group-picker');assert.equal(await oneDialog(p),1);
    assert.equal(await p.evaluate(shown('.ledger-switcher-search')),false);
    await p.screenshot('navigation-switcher-390');
    await p.evaluate(`window.originalFetch=window.fetch;window.fetch=(url,options)=>String(url)==='/api/groups/ledger-1'?new Promise(resolve=>{window.resolveLedger=()=>originalFetch(url,options).then(resolve)}):originalFetch(url,options)`);
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    const point=await p.evaluate(`(()=>{const r=document.querySelector('.ledger-switcher-item:not(.is-current)').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.wait('!!window.resolveLedger');
    assert.equal(await oneDialog(p),0);assert.equal(await p.evaluate('document.querySelector(".mobile-group-picker").disabled'),true);
    await p.evaluate('window.resolveLedger()');await p.wait('document.querySelector(".mobile-group-picker b")?.textContent==="日本關西行"');
    await p.wait('!!document.querySelector(".real-dashboard")');
    assert.equal(await p.evaluate('__qa.requests.filter(r=>r.path==="/api/groups/ledger-1").length'),1);
    assert.match(await p.evaluate('document.querySelector(".mobile-ledger-heading").textContent'),/JPY/);
    await p.click('.mobile-group-picker');
    assert.equal(await p.evaluate('document.querySelector(".ledger-switcher-item.is-current b").textContent'),'日本關西行');
    await keys(p,'Escape');assert.equal(await oneDialog(p),0);
    assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
    await safe(p);
   }finally{await p.close()}
  });
  await t.test('50 ledgers: search, long Unicode names, focus trap, safe-area and resize cleanup',async()=>{
   const groups=ledgerOptions(50);groups[49].name='非常長的共同旅遊帳本名稱'.repeat(4)+' ABC';
   const p=await page(b,320,568,'settled',fixture,{groups});
   try{
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await p.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:24,bottom:34,left:0,right:0}});
    await p.click('.mobile-group-picker');assert.equal(await oneDialog(p),1);
    assert.equal(await p.evaluate(shown('.ledger-switcher-search')),true);
    await p.setValue('.ledger-switcher-search input','沒有這個帳本');
    assert.equal(await p.evaluate(shown('.ledger-switcher-empty')),true);
    await p.setValue('.ledger-switcher-search input','ａｂｃ');
    assert.equal(await p.evaluate('document.querySelectorAll(".ledger-switcher-item").length'),1);
    assert.equal(await p.evaluate('document.querySelector(".ledger-switcher-item").scrollWidth<=document.querySelector(".ledger-switcher-item").clientWidth+1'),true);
    await p.setValue('.ledger-switcher-search input','');
    await p.evaluate('document.querySelector(".ledger-switcher-list").scrollTop=1e7');await delay(60);
    assert.equal(await p.evaluate(hit('.ledger-switcher-list li:last-child button')),true);
    await p.evaluate('document.querySelector(".ledger-switcher-list li:last-child button").focus()');await keys(p,'Tab');
    assert.equal(await p.evaluate('document.activeElement.matches(".ledger-switcher-modal .modal-x")'),true);
    await p.screenshot('navigation-switcher-long-320');
    await p.send('Emulation.setDeviceMetricsOverride',{width:320,height:350,deviceScaleFactor:1,mobile:false});await delay(100);
    assert.equal(await p.evaluate(hit('.ledger-switcher-modal .modal-x')),true);
    await p.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});await delay(100);
    assert.equal(await oneDialog(p),0);assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
    assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
    await safe(p);
   }finally{await p.close()}
  });
  await t.test('Non-owner details never expose edit/delete; large totals stay complete',async()=>{
   const data=structuredClone(fixture);data.ownerId='m1';data.expenses[0].isLocked=false;data.expenses[0].amountCents=123456789012300;
   const p=await page(b,320,700,'settled',data,{me:{id:'m0',displayName:'旅伴',isSuperuser:false,bankAccount:{configured:false}}});
   try{
    assert.equal(await p.evaluate('[...document.querySelectorAll(".mobile-ledger-total,.mobile-ledger-count")].every(e=>e.scrollWidth<=e.clientWidth+1)'),true);
    await p.click('.mobile-bottom-nav button:nth-child(2)');await p.click('.mobile-expense-record-detail');
    assert.equal(await p.evaluate('document.querySelectorAll(".expense-detail-actions button").length'),0);
    assert.equal(await oneDialog(p),1);
    await safe(p);
   }finally{await p.close()}
  });
 }finally{await b.close()}
});
