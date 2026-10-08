// User-selected sign text: Wander Far / Stay Close / Spend Wisely / Come Back Rich.
// All financial data is a fixture; the actual production artwork/fonts are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';
const overlay=readFileSync(new URL('../dist/ledger-signpost-v6.webp',import.meta.url));
const overlayUri='data:image/webp;base64,'+overlay.toString('base64');
const shown=selector=>`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;

test('Version 6 sign replacement stays registered to the coastline',{timeout:120000},async t=>{
 const browser=await launch();
 try {
  for(const width of [901,1280,1672,1920])await t.test(`${width}px desktop: two aligned image layers and unchanged controls`,async()=>{
   const p=await page(browser,width,941);
   try {
    const background=await p.evaluate("getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundImage");
    assert.ok(background.startsWith(`url(\"${overlayUri}\")`),'The selected artwork must cover only the original sign');
    assert.equal((background.match(/data:image\/webp/g)||[]).length,2);
    assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundSize.split(',').every(v=>v.trim()==='cover')"),true);
    assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    if(width===1672)await p.screenshot('version6-desktop');
    await p.click('.header-ledger-settings summary');
    await p.click('.header-ledger-settings summary');
    await p.click('.header-primary');await p.wait(shown('.expense-single-modal'));
    assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
    await p.click('.es-cancel');
    assert.deepEqual(await p.evaluate('__qa.errors'),[]);
    assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
   }finally{await p.close()}
  });
  for(const width of [320,390,900])await t.test(`${width}px mobile: keep the existing mobile backdrop and single expense dialog`,async()=>{
   const p=await page(browser,width,844);
   try {
    const bg=await p.evaluate("getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundImage");
    assert.equal(bg.includes(overlayUri),false,'Do not put the desktop sign over mobile content');
    if(width===390)await p.screenshot('version6-mobile');
    await p.click('.mobile-bottom-add');await p.wait(shown('.expense-single-modal'));
    await p.click('.es-save');
    assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
    assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    if(width===390)await p.screenshot('version6-mobile-modal');
    assert.deepEqual(await p.evaluate('__qa.errors'),[]);
    assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
   }finally{await p.close()}
  });
 }finally{await browser.close()}
});
