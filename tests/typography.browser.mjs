// Actual compiled app and actual downloaded Taipei shards, never production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';
import {assertRenderedTaipei} from './helpers/font-fixture.mjs';
const hit=s=>`(()=>{const e=document.querySelector(${JSON.stringify(s)}),r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
async function checkAllText(p){
  await p.evaluate('document.fonts.ready');
  const wrong=await p.evaluate(`([...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&!['SCRIPT','STYLE'].includes(e.tagName)&&!getComputedStyle(e).fontFamily.startsWith('"Taipei Sans TC"')).map(e=>({tag:e.tagName,class:e.className,font:getComputedStyle(e).fontFamily})))`);
  assert.deepEqual(wrong,[]);
  assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  assert.deepEqual(await p.evaluate('__qa.errors'),[]);
}

test('Taipei Sans TC: whole-site typography with live webfont rendering',{timeout:180000},async t=>{
  const browser=await launch();
  try {
    for(const [width,height] of [[320,568],[390,844],[768,1024],[900,900],[1024,900],[1672,941]])await t.test(`${width}px: headings, amounts, controls, picker and expense dialog render Taipei glyphs`,async()=>{
      const groups=[{...fixture,memberCount:15},{...fixture,id:'other',name:'日本關西行',currency:'JPY',memberCount:6}];
      const p=await page(browser,width,height,'settled',fixture,{groups});
      try {
        await checkAllText(p);
        await assertRenderedTaipei(p,width>900?'.group-title-row h1':'.mobile-ledger-heading h1');
        await assertRenderedTaipei(p,width>900?'.ledger-brush-value':'.mobile-ledger-total strong');
        if([390,1672].includes(width))await p.screenshot(`taipei-overview-${width}`);
        if(width<=900){
          await p.click('.mobile-group-picker');await p.wait('!!document.querySelector(".ledger-switcher-modal")');
          await assertRenderedTaipei(p,'.ledger-switcher-heading h2');await checkAllText(p);
          if(width===390)await p.screenshot('taipei-switcher-390');
          await p.click('.ledger-switcher-item.is-current');
          await p.click('.mobile-bottom-nav button:nth-child(2)');await checkAllText(p);
          await assertRenderedTaipei(p,'.mobile-expense-record-title b');
          await p.click('.record-list > article:nth-child(2) .mobile-expense-record-detail');
          await assertRenderedTaipei(p,'.expense-detail-actions button');
          await p.click('[aria-modal=true] .modal-x');
        }
        await p.click(width>900?'.header-primary':'.mobile-bottom-add');
        await p.setValue('#es-description','測試台北黑體 與金額 12.34');await p.setValue('#es-amount','1234567');
        await assertRenderedTaipei(p,'.es-save');await checkAllText(p);
        assert.equal(await p.evaluate(hit('.es-save')),true);
        assert.equal(await p.evaluate('getComputedStyle(document.querySelector("#es-amount")).fontFamily.startsWith("\\\"Taipei Sans TC\\\"")'),true);
        assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
        if([390,1672].includes(width))await p.screenshot(`taipei-expense-${width}`);
        await p.click('.es-cancel');await p.wait('!!document.querySelector(".es-discard")');await p.click('.es-discard .es-danger');
        assert.equal(await p.evaluate('__qa.requests.some(r=>r.method!=="GET")'),false);
      }finally{await p.close();}
    });
    await t.test('Three real weights, Latin/digits, Traditional Chinese and an uncommon name',async()=>{
      const p=await page(browser,390,844);
      try {
        const suffixes={300:'Light',400:'Regular',700:'Bold'};
        for(const weight of [300,400,700]){
          await p.evaluate(`(()=>{document.querySelector('#font-probe')?.remove();const p=document.createElement('span');p.id='font-probe';p.style.cssText='position:fixed;top:0;left:0;font-size:20px;font-weight:${weight};z-index:9999';p.textContent='旅行記帳NT$0123456789𠮷';document.body.append(p)})()`);
          const fonts=await assertRenderedTaipei(p,'#font-probe');
          assert.ok(fonts.some(f=>(f.postScriptName||'').endsWith('-'+suffixes[weight])),JSON.stringify(fonts));
        }
        await p.evaluate('document.querySelector("#font-probe").remove()');await checkAllText(p);
      }finally{await p.close();}
    });
    await t.test('Font delivery failure leaves readable fallback text and usable save controls',async()=>{
      const p=await page(browser,320,568,'settled',fixture,{blockFonts:true});
      try {
        assert.match(await p.evaluate('document.body.innerText'),/帳本總覽/);
        await p.click('.mobile-bottom-add');assert.equal(await p.evaluate(hit('.es-save')),true);
        assert.equal(await p.evaluate('document.querySelector(".es-save").innerText.trim()'),'儲存支出');
        assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
      }finally{await p.close();}
    });
  }finally{await browser.close();}
});
