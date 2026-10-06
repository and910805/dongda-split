// Real compiled app with offline fixture data; do not write production accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';
const visible = selector => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;
const hit = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),v=visualViewport;return r.width>0&&r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height+1&&r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
test('Ledger header: settings placement and removed travel copy',{timeout:120000},async t=>{
 const b=await launch();
 try {
  for(const width of [901,1024,1280,1440,1672]) {
   await t.test(`${width}px: settings follows invite and precedes add in the header`,async()=>{
    const data=structuredClone(fixture);
    if(width===901)data.name='名稱很長的共同旅行帳本與旅伴的十月山海小旅行';
    const p=await page(b,width,941,'settled',data);
    try {
     assert.equal(await p.evaluate('document.querySelectorAll(".group-admin-menu").length'),1);
     assert.equal(await p.evaluate('document.querySelectorAll(".group-hero .group-admin-menu,.ledger-travel-note").length'),0);
     const order=await p.evaluate("(()=>{const a=document.querySelector('.header-secondary'),s=document.querySelector('.header-ledger-settings summary'),n=document.querySelector('.header-primary'),ra=a.getBoundingClientRect(),rs=s.getBoundingClientRect(),rn=n.getBoundingClientRect();return {dom:Boolean(a.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(s.compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING),layout:ra.right<=rs.left&&rs.right<=rn.left,aligned:Math.abs(ra.top+ra.height/2-rs.top-rs.height/2)<2&&Math.abs(rn.top+rn.height/2-rs.top-rs.height/2)<2}})()");
     assert.deepEqual(order,{dom:true,layout:true,aligned:true});
     for(const selector of ['.header-secondary','.header-ledger-settings summary','.header-primary'])assert.equal(await p.evaluate(hit(selector)),true,selector);
     await p.evaluate("document.querySelector('.header-secondary').focus()");
     await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});
     await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
     assert.equal(await p.evaluate("document.activeElement.matches('.header-ledger-settings summary')"),true);
     await p.click('.header-ledger-settings summary');
     assert.equal(await p.evaluate(hit('.group-currency-action')),true);
     await p.click('.group-currency-action');
     await p.wait(visible('.currency-conversion-modal'));
     assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
     await p.click('[aria-modal=true] .modal-x');
     await p.click('.header-ledger-settings summary');
     await p.click('.group-admin-menu .danger-action');
     await p.wait(visible('[aria-modal=true]'));
     assert.equal(await p.evaluate('__qa.requests.some(r=>r.method==="DELETE")'),false);
     await p.click('[aria-modal=true] .modal-x');
     assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
     assert.deepEqual(await p.evaluate('__qa.errors'),[]);
     if([901,1672].includes(width))await p.screenshot(`header-settings-${width}`);
    }finally{await p.close()}
   });
  }
  for(const [width,height] of [[320,568],[390,844],[768,1024],[900,900]]) {
   await t.test(`${width}px: preserve one mobile settings entry and unobstructed save`,async()=>{
    const p=await page(b,width,height);
    try {
     assert.equal(await p.evaluate(visible('.header-ledger-settings')),false);
     assert.equal(await p.evaluate('document.querySelectorAll(".ledger-travel-note").length'),0);
     assert.equal(await p.evaluate(hit('.mobile-group-settings')),true);
     await p.click('.mobile-group-settings');
     assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
     await p.click('[aria-modal=true] .modal-x');
     await p.click('.mobile-bottom-add');
     assert.equal(await p.evaluate(hit('.es-save')),true);
     await p.click('.es-close');
     assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
     assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
     assert.deepEqual(await p.evaluate('__qa.errors'),[]);
     if(width===390)await p.screenshot('header-settings-mobile-390');
    }finally{await p.close()}
   });
  }
 }finally{await b.close()}
});
