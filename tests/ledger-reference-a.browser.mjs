// Full built application, real controls, offline API fixtures; no test-only UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';
const visible = selector => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;
const hit = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),v=visualViewport;return r.width>0&&r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height+1&&r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
const overlayCheck = `(()=>{const e=document.querySelector('[aria-modal=true]'),r=e.getBoundingClientRect(),v=visualViewport;return {count:document.querySelectorAll('[aria-modal=true]').length,within:r.left>=0&&r.right<=innerWidth+1&&r.top>=v.offsetTop-1&&r.bottom<=v.offsetTop+v.height+1,overflow:document.body.scrollWidth>innerWidth+1}})()`;
test('Reference A: touch layouts, controls and preserved workflows',{timeout:180000},async t=>{
 const b=await launch();
 try {
  for(const [w,h] of [[320,568],[349,749],[375,667],[390,844],[430,932],[760,900],[844,390]]) {
   await t.test(`${w}x${h}: only selected mobile view is visible and bottom actions remain reachable`,async()=>{
    const p=await page(b,w,h);
    try {
     await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
     assert.equal(await p.evaluate(visible('.mobile-overview-v2')),true);
     assert.equal(await p.evaluate(visible('.real-grid')),false);
     await p.click('.mobile-bottom-nav button:nth-child(2)');
     assert.equal(await p.evaluate(visible('.activity-column')),true);
     assert.equal(await p.evaluate(visible('.settlements')),false);
     await p.setValue('.expense-date-filter select','2026-07-25',true);
     const rows=await p.evaluate("[...document.querySelectorAll('.record-list>article time')].map(e=>e.dateTime)");
     assert.ok(rows.length&&rows.every(value=>value==='2026-07-25'));
     const filters=await p.evaluate("(()=>{const a=document.querySelector('.expense-date-filter').getBoundingClientRect(),b=document.querySelector('.expense-member-filter').getBoundingClientRect();return {same:Math.abs(a.top-b.top)<1,apart:a.right<=b.left,width:a.width}})()");
     assert.ok(filters.same&&filters.apart&&filters.width>100);
     await p.click('.mobile-expense-record-more');
     assert.deepEqual(await p.evaluate(overlayCheck),{count:1,within:true,overflow:false});
     await p.click('.mobile-expense-action-list button:nth-child(2)');
     await p.wait(visible('.expense-single-modal'));
     assert.equal(await p.evaluate(hit('.es-save')),true);
     assert.equal(await p.evaluate("document.querySelector('.expense-single-modal').lang"),'zh-TW');
     await p.click('.es-close');
     await p.click('.mobile-bottom-nav button:nth-child(4)');
     assert.equal(await p.evaluate(visible('.activity-column')),false);
     assert.equal(await p.evaluate(visible('.settlements')),true);
     await p.click('.settlement-balances');
     assert.deepEqual(await p.evaluate(overlayCheck),{count:1,within:true,overflow:false});
     await p.click('[aria-modal=true] .modal-x');
     await p.click('.mobile-bottom-nav button:first-child');
     await p.click('.mobile-group-settings');
     assert.deepEqual(await p.evaluate(overlayCheck),{count:1,within:true,overflow:false});
     await p.click('[aria-modal=true] .modal-x');
     await p.click('.mobile-bottom-add');
     await p.setValue('#es-description','手機草稿');await p.setValue('#es-amount','1234');
     await p.evaluate("document.querySelector('.es-scroll').scrollTop=1e6");
     assert.equal(await p.evaluate(hit('.es-save')),true);
     if([349,390].includes(w))await p.screenshot(`reference-a-modal-${w}`);
     await p.click('.es-cancel');await p.wait(visible('.es-discard'));
     assert.equal(await p.evaluate("document.querySelectorAll('[aria-modal=true]').length"),1);
     await p.click('.es-discard .es-danger');
     await p.evaluate('window.scrollTo(0,document.body.scrollHeight)');
     assert.equal(await p.evaluate(hit('.mobile-bottom-add')),true);
     assert.deepEqual(await p.evaluate('__qa.errors'),[]);
    }finally{await p.close();}
   });
  }
  await t.test('Date/search/member filters compose, clear correctly and leave ledger totals unchanged',async()=>{
   const p=await page(b,1672,941);
   try {
    const total=await p.evaluate("document.querySelector('[data-summary-metric=total] .ledger-brush-value').innerText");
    await p.setValue('.expense-date-filter select','2026-07-25',true);
    await p.setValue('.expense-search input','不存在');
    assert.match(await p.evaluate("document.querySelector('.expense-panel').innerText"),/沒有符合/);
    await p.click('.expense-panel .empty-primary');
    assert.equal(await p.evaluate("document.querySelector('.expense-date-filter select').value"),'all');
    assert.equal(await p.evaluate("document.querySelector('.expense-member-filter select').value"),'all');
    assert.equal(await p.evaluate("document.querySelector('[data-summary-metric=total] .ledger-brush-value').innerText"),total);
    assert.equal(await p.evaluate("__qa.requests.filter(r=>r.method!=='GET').length"),0);
   }finally{await p.close();}
  });
  await t.test('Desktop row menu is on-screen, keyboard operable, and respects locked rows',async()=>{
   const p=await page(b,1672,941);
   try {
    await p.click('.record-list>article:first-child .ledger-row-more');
    assert.equal(await p.evaluate("document.querySelectorAll('.ledger-row-menu button').length"),1);
    assert.equal(await p.evaluate(hit('.ledger-row-menu button')),true);
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await p.wait('!document.querySelector(".ledger-row-menu")');
    assert.equal(await p.evaluate("document.activeElement.classList.contains('ledger-row-more')"),true);
    await p.click('.record-list>article:nth-child(2) .ledger-row-more');
    assert.equal(await p.evaluate("document.querySelectorAll('.ledger-row-menu button').length"),3);
    await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End'});
    assert.match(await p.evaluate('document.activeElement.innerText'),/刪除/);
    await p.click('.ledger-row-menu button:last-child');
    assert.equal(await p.evaluate("document.querySelectorAll('[aria-modal=true]').length"),1);
    assert.equal(await p.evaluate("__qa.requests.filter(r=>r.method==='DELETE').length"),0);
    await p.click('[aria-modal=true] .modal-x');
    await p.click('.record-list>article:last-child .ledger-row-more');
    assert.equal(await p.evaluate(hit('.ledger-row-menu button')),true);
    await p.click('.ledger-row-menu button:first-child');
    assert.equal(await p.evaluate('!!document.querySelector(".ledger-row-menu")'),false);
    await p.click('[aria-modal=true] .modal-x');
    await p.click('.ledger-members-more');
    assert.equal(await p.evaluate("document.querySelectorAll('.mobile-tools-members li').length"),15);
    await p.click('[aria-modal=true] .modal-x');
    assert.deepEqual(await p.evaluate('__qa.errors'),[]);
   }finally{await p.close();}
  });
  await t.test('Visual viewport offset and reduced height keep the same editable modal',async()=>{
   const p=await page(b,390,844);
   try {
    await p.click('.mobile-bottom-add');await p.setValue('#es-description','保留草稿');
    await p.evaluate('void(window.sameModal=document.querySelector(".expense-single-modal"))');
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:360,deviceScaleFactor:1,mobile:false});await delay(120);
    assert.equal(await p.evaluate(hit('.es-save')),true);
    assert.equal(await p.evaluate('document.querySelector(".expense-single-modal")===window.sameModal'),true);
    assert.equal(await p.evaluate('document.querySelector("#es-description").value'),'保留草稿');
    await p.evaluate(`Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:42});Object.defineProperty(visualViewport,'height',{configurable:true,value:300});visualViewport.dispatchEvent(new Event('resize'))`);await delay(60);
    assert.equal(await p.evaluate(hit('.es-save')),true);
   }finally{await p.close();}
  });
 }finally{await b.close();}
});
