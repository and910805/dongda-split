import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';
test('Coastal ledger: complete app layout and unchanged controls', {timeout: 120000}, async t => {
  const browser = await launch();
  try {
    for (const [width, height] of [[320,700],[349,749],[390,844],[760,900],[900,900],[1024,900],[1280,900],[1440,1000],[1672,941]]) {
      await t.test(`${width}px: responsive layout, member access and modal layering`, async () => {
        const p = await page(browser, width, height);
        try {
          assert.equal(await p.evaluate('document.body.scrollWidth <= innerWidth+1'), true, 'Body must not scroll sideways');
          if (width > 900) {
            assert.equal(await p.evaluate("[...document.querySelectorAll('.ledger-brush-metric')].filter(e=>e.getClientRects().length).length"), 3);
            assert.equal(await p.evaluate("document.querySelectorAll('.group-member-avatar').length"), 13);
            assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundImage.includes('data:image/webp')"), true);
            assert.ok(await p.evaluate("document.querySelector('.shortcut-balances').getClientRects().length"));
          }
          if (width === 1672) {
            const geometry = await p.evaluate("(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {side:r('.real-side'),stats:r('.ledger-brush-metrics'),list:r('.activity-column'),settlement:r('.settlements')}})()");
            assert.equal(geometry.side.width, 214);
            assert.ok(Math.abs(geometry.list.y-geometry.settlement.y)<2, 'Panels must align');
            assert.ok(geometry.stats.y > 280 && geometry.stats.y < 430);
            assert.ok(geometry.list.width > geometry.settlement.width);
          }
          if ([349,390,1672].includes(width)) await p.screenshot(`ledger-${width}`);
          await p.click(width <= 900 ? '.mobile-bottom-add' : '.header-primary');
          await p.wait('!!document.querySelector(".expense-single-modal")');
          assert.equal(await p.evaluate("document.querySelector('.expense-single-overlay').parentElement===document.body"), true);
          assert.equal(await p.evaluate("document.querySelector('.expense-single-modal').lang"), 'zh-TW');
          assert.equal(await p.evaluate("(()=>{const e=document.querySelector('.es-save'),r=e.getBoundingClientRect();return r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()"), true);
          await p.click('.es-close');await p.wait('!document.querySelector(".expense-single-modal")');
          assert.deepEqual(await p.evaluate('__qa.errors'), []);
        } finally {await p.close();}
      });
    }
    await t.test('Search, member filtering, tabs, settings and balances remain real controls', async () => {
      const p = await page(browser, 1672, 941);
      try {
        await p.setValue('.expense-search input', '午餐');
        assert.equal(await p.evaluate("document.querySelectorAll('.record-list > article').length"), 1);
        await p.setValue('.expense-search input', '');
        await p.setValue('.expense-member-filter select', 'm13', true);
        assert.match(await p.evaluate("document.querySelector('.expense-panel').innerText"), /沒有符合/);
        await p.setValue('.expense-member-filter select', 'all', true);
        await p.click('.ledger-row-more');await p.click('.ledger-row-menu button');await p.wait('!!document.querySelector("[aria-modal=true]")');
        await p.click('[aria-modal=true] .modal-x');
        await p.click('[id^=activity-tab-repayments]');
        assert.equal(await p.evaluate("document.querySelector('[id^=activity-tab-repayments]').getAttribute('aria-selected')"), 'true');
        await p.click('[id^=activity-tab-expenses]');
        await p.click('.group-admin-menu summary');
        assert.ok(await p.evaluate("document.querySelector('.group-currency-action').getClientRects().length"));
        await p.click('.group-admin-menu summary');
        await p.click('.shortcut-balances');await p.wait('!!document.querySelector("[aria-modal=true]")');
        await p.click('[aria-modal=true] .modal-x');
        await p.click('.group-member-avatar');await p.wait('!!document.querySelector("[aria-modal=true]")');
        await p.click('[aria-modal=true] .modal-x');
        assert.deepEqual(await p.evaluate('__qa.errors'), []);
      } finally {await p.close();}
    });
    for (const mode of ['empty', 'payable']) {
      await t.test(`${mode}: no fabricated settled state`, async () => {
        const p = await page(browser, 1672, 941, mode);
        try {
          const text = await p.evaluate("document.querySelector('.settlements').innerText");
          assert.ok(!text.includes('所有成員目前無待結算款項'));
          if (mode === 'empty') assert.match(text, /帳本還沒有支出/);
          else {assert.match(text, /記錄已付款/);assert.equal(await p.evaluate("document.querySelectorAll('.settlements .all-clear').length"), 0);}
          assert.deepEqual(await p.evaluate('__qa.errors'), []);
        } finally {await p.close();}
      });
    }
  } finally {await browser.close();}
});
