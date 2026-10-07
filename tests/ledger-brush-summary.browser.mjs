// Full compiled app; fixture API only, never a production account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, page, fixture} from './helpers/ledger-browser.mjs';
const summary = '.ledger-brush-summary';
const visible = selector => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;
const text = selector => `document.querySelector(${JSON.stringify(selector)}).innerText`;
const hits = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;

test('Brush summary: real ledger data, screenshot layout and unchanged mobile flow', {timeout:180000}, async t => {
  const browser = await launch();
  try {
    for (const width of [901,1024,1280,1440,1672,1920]) {
      await t.test(`${width}px: three unboxed metrics and a separate paper note`, async () => {
        const p = await page(browser,width,1000);
        try {
          assert.equal(await p.evaluate(visible(summary)),true);
          assert.equal(await p.evaluate('document.querySelectorAll(".ledger-brush-metric").length'),3);
          assert.equal(await p.evaluate('document.querySelectorAll(".real-stats,.stat-card").length'),0);
          assert.match(await p.evaluate(text('[data-summary-metric=members] .ledger-brush-value')),/15/);
          assert.match(await p.evaluate(text('[data-summary-metric=total] .ledger-brush-value')),/2,100/);
          assert.match(await p.evaluate(text('.ledger-summary-date')),/2026.7.25.*2026.7.28/);
          const layout=await p.evaluate(`(()=>{const a=document.querySelector('.ledger-brush-metrics').getBoundingClientRect(),b=document.querySelector('.ledger-summary-note').getBoundingClientRect();return {separate:a.right<b.left,aligned:Math.abs(a.y+a.height/2-b.y-b.height/2)<2,clear:a.bottom<=document.querySelector('.real-grid').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
          assert.deepEqual(layout,{separate:true,aligned:true,clear:true,overflow:false});
          const style=await p.evaluate(`(()=>{const e=document.querySelector('.ledger-brush-metric'),c=getComputedStyle(e);return {background:c.backgroundColor,shadow:c.boxShadow,radius:c.borderRadius,font:getComputedStyle(document.querySelector('.ledger-brush-value')).fontFamily,brush:getComputedStyle(document.querySelector('.ledger-brush-metrics'),'::before').backgroundImage}})()`);
          assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.shadow,'none');assert.equal(style.radius,'0px');
          assert.match(style.font,/sans-serif/);assert.doesNotMatch(style.font,/DFKai|BiauKai|Noto Serif|標楷/);
          assert.match(style.brush,/data:image\/svg\+xml/);
          assert.equal(await p.evaluate(text(summary)).then(value=>value.includes('\u3002')),false);
          await p.click('.header-ledger-settings summary');assert.equal(await p.evaluate(hits('.group-currency-action')),true);
          await p.click('.header-ledger-settings summary');
          await p.click('.shortcut-balances');await p.wait(visible('[aria-modal=true]'));
          await p.click('[aria-modal=true] .modal-x');
          assert.deepEqual(await p.evaluate('__qa.errors'),[]);
          if([901,1672].includes(width))await p.screenshot(`brush-summary-${width}`);
        } finally {await p.close();}
      });
    }
    for (const [mode,expected] of [['empty','從第一筆'],['payable','你尚需支付'],['settled','我的餘額']]) {
      await t.test(`${mode}: no fabricated balance or trip dates`, async () => {
        const p=await page(browser,1672,941,mode);
        try {
          assert.match(await p.evaluate(text(summary)),new RegExp(expected));
          if(mode==='empty') {
            assert.equal(await p.evaluate('document.querySelectorAll(".ledger-summary-date time").length'),0);
            assert.match(await p.evaluate(text('.ledger-summary-date')),/尚無日期紀錄/);
          }
          if(mode==='payable')assert.match(await p.evaluate(text('.ledger-summary-balance')),/50/);
          assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
        } finally {await p.close();}
      });
    }
    await t.test('Currency precision, refunds, one date and user punctuation remain intact',async()=>{
      const data=structuredClone(fixture);
      data.name='旅帳。<script>TEST</script>';
      data.currency='USD';data.expenses=[{...data.expenses[0],amountCents:-1234,expenseDate:'2026-10-07'}];
      data.balances[0].balanceCents=1234;
      const p=await page(browser,1672,941,'settled',data);
      try {
        assert.match(await p.evaluate(text('[data-summary-metric=total] .ledger-brush-value')),/-.*12\.34/);
        assert.match(await p.evaluate(text('.ledger-summary-balance')),/你尚可收回.*12\.34/s);
        assert.equal(await p.evaluate('document.querySelectorAll(".ledger-summary-date time").length'),1);
        assert.equal(await p.evaluate(text('.ledger-summary-note-title strong')),data.name);
        assert.equal(await p.evaluate('document.querySelectorAll(".ledger-summary-note script").length'),0);
        const before=await p.evaluate(text(summary));
        await p.setValue('.expense-search input','不存在');
        assert.equal(await p.evaluate(text(summary)),before,'Filters must not change ledger-wide summary');
        assert.deepEqual(await p.evaluate('__qa.errors'),[]);
      } finally {await p.close();}
    });
    await t.test('Long names and large valid totals wrap inside their allocated width',async()=>{
      const data=structuredClone(fixture);
      data.name='名稱很長的共同旅行帳本ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4);
      data.expenses=[{...data.expenses[0],amountCents:9007199254740900,expenseDate:'2026-07-28'}];
      const p=await page(browser,901,1200,'settled',data);
      try {
        assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
        assert.equal(await p.evaluate(`['.ledger-brush-metric','.ledger-summary-note-title','.ledger-summary-date','.ledger-summary-balance'].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})`),true);
        assert.deepEqual(await p.evaluate('__qa.errors'),[]);
      } finally {await p.close();}
    });
    for(const [width,height] of [[320,568],[390,844],[768,1024],[900,900]]) {
      await t.test(`${width}px mobile: no duplicated summary or footer obstruction`,async()=>{
        const p=await page(browser,width,height);
        try {
          assert.equal(await p.evaluate(visible(summary)),false);
          assert.equal(await p.evaluate(visible('.mobile-overview-v2')),true);
          await p.click('.mobile-bottom-nav button:nth-child(2)');
          assert.equal(await p.evaluate(visible(summary)),false);
          await p.click('.mobile-bottom-add');await p.wait(visible('.expense-single-modal'));
          await p.setValue('#es-amount','1500');await p.setValue('#es-description','摘要改版草稿');
          await p.evaluate('document.querySelector(".es-scroll").scrollTop=1e7');
          assert.equal(await p.evaluate(hits('.es-save')),true);
          assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
          if(width===390)await p.screenshot('brush-summary-modal-390');
          await p.click('.es-cancel');await p.wait(visible('.es-discard'));await p.click('.es-discard .es-danger');
          await p.click('.mobile-bottom-nav button:nth-child(4)');assert.equal(await p.evaluate(visible('.settlements')),true);
          await p.click('.mobile-bottom-nav button:first-child');
          assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
          assert.deepEqual(await p.evaluate('__qa.errors'),[]);
          assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
          if(width===390)await p.screenshot('brush-summary-mobile-390');
        } finally {await p.close();}
      });
    }
  } finally {await browser.close();}
});
