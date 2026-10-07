// Exercise the actual compiled app with offline fixtures; never touch real accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, page, fixture} from './helpers/ledger-browser.mjs';
import {formatCurrencyAmount} from '../currency.mjs';
const shown = selector => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;
const hit = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
const historyFixture = () => {
  const data=structuredClone(fixture);
  data.settlementHistory=Array.from({length:15},(_,i)=>({...data.settlementHistory[0],id:`r${i}`,amountCents:i?120600:15400,canVoid:true}));
  return data;
};
async function safe(p) {
  assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  assert.deepEqual(await p.evaluate('__qa.errors'),[]);
  assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
}

test('Requested layout polish preserves controls and removes only the two decorations',{timeout:180000},async t=>{
  const b=await launch();
  try {
    for(const width of [901,1280,1672])await t.test(`${width}px desktop: remove leaf and heading mountain, retain coast and success artwork`,async()=>{
      const p=await page(b,width,1000);
      try {
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.side-footer'),'::before').content"),'none');
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.settlement-heading')).backgroundImage"),'none');
        assert.match(await p.evaluate("getComputedStyle(document.querySelector('.all-clear'),'::before').backgroundImage"),/data:image\/svg\+xml/);
        assert.match(await p.evaluate("getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundImage"),/data:image\/webp/);
        await p.click('.shortcut-balances');await p.wait(shown('[aria-modal=true]'));await p.click('[aria-modal=true] .modal-x');
        await safe(p);
        if(width===1672){await p.evaluate('window.scrollTo(0,0)');await p.screenshot('polish-desktop-1672');}
      } finally {await p.close();}
    });
    for(const [width,height] of [[320,568],[360,740],[390,844],[430,932],[768,1024],[900,900]])await t.test(`${width}px mobile: right aligned amounts, compact sorting/history, accessible input`,async()=>{
      const p=await page(b,width,height,'settled',historyFixture());
      try {
        assert.equal(await p.evaluate(`([...document.querySelectorAll('.mobile-recent-list .mobile-expense-row')]).every(e=>{const r=e.getBoundingClientRect(),a=e.querySelector('.mobile-expense-share').getBoundingClientRect();return Math.abs(r.right-parseFloat(getComputedStyle(e).paddingRight)-a.right)<1})`),true);
        if(width===390)await p.screenshot('polish-overview-390');
        await p.click('.mobile-bottom-nav button:nth-child(2)');
        const sort=await p.evaluate(`(()=>{const e=document.querySelector('.mobile-expense-sort'),s=getComputedStyle(e),r=e.getBoundingClientRect(),n=document.querySelector('.expense-record-table').getBoundingClientRect();return {left:s.paddingLeft,right:s.paddingRight,top:s.paddingTop,gap:n.top-r.bottom,targets:[...e.children].every(b=>b.getBoundingClientRect().height>=44)}})()`);
        assert.deepEqual(sort,{left:'12px',right:'12px',top:'4px',gap:0,targets:true});
        await p.click('.mobile-expense-sort button:nth-child(2)');
        assert.equal(await p.evaluate("document.querySelector('.mobile-expense-sort button:nth-child(2)').getAttribute('aria-pressed')"),'true');
        if(width===390){await p.evaluate('window.scrollTo(0,0)');await p.screenshot('polish-expenses-390');}
        await p.click('.activity-tabs button:nth-child(2)');
        const history=await p.evaluate(`(()=>{const p=document.querySelector('.repayment-panel'),r=p.querySelector('.repayment-log article'),c=getComputedStyle(p),b=p.getBoundingClientRect(),a=r.getBoundingClientRect();return {padding:c.padding,rowWidth:Math.abs(a.width-b.width)<1,rowHeight:a.height,refresh:document.querySelector('.history-refresh').getBoundingClientRect().width}})()`);
        assert.equal(history.padding,'0px');assert.equal(history.rowWidth,true);assert.ok(history.rowHeight<=142,JSON.stringify(history));assert.ok(history.refresh>=44);
        await p.click('.history-refresh');
        await p.click('.repayment-void-button');await p.wait(shown('[aria-modal=true]'));await p.click('[aria-modal=true] .modal-x');
        if(width===390){await p.evaluate('window.scrollTo(0,0)');await p.screenshot('polish-repayments-390');}
        await p.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await delay(60);
        assert.equal(await p.evaluate("document.querySelector('.repayment-panel .record-pagination').getBoundingClientRect().bottom<=document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top-8"),true);
        await p.click('.mobile-bottom-nav button:nth-child(4)');
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.settlement-heading')).backgroundImage"),'none');
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.settlement-heading')).paddingLeft"),'16px');
        if(width===390)await p.screenshot('polish-settlement-390');
        await p.click('.mobile-bottom-add');await p.click('#es-amount');await p.setValue('#es-amount','12345');
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('#es-amount')).outlineStyle"),'none');
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.es-amount-block')).borderTopColor"),'rgb(55, 116, 84)');
        assert.equal(await p.evaluate("document.querySelector('#es-amount').value"),'12345');
        assert.equal(await p.evaluate(hit('.es-save')),true);
        if(width===390)await p.screenshot('polish-amount-390');
        await p.send('Emulation.setDeviceMetricsOverride',{width,height:390,deviceScaleFactor:1,mobile:false});await delay(100);
        assert.equal(await p.evaluate(hit('.es-save')),true);
        await p.click('.es-cancel');await p.wait(shown('.es-discard'));await p.click('.es-discard .es-danger');
        assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
        await safe(p);
      } finally {await p.close();}
    });
    for(const currency of ['TWD','USD'])await t.test(`320px: long names and large ${currency} refund shares remain complete`,async()=>{
      const data=historyFixture();data.currency=currency;
      const shareCents=currency==='TWD'?12345678901200:12345678901234;

      data.expenses=data.expenses.slice(0,3).map((e,i)=>({...e,title:'旅伴共同支出名稱很長ABC'.repeat(3),amountCents:-shareCents*2,payerName:'付款人姓名很長'.repeat(3),shares:i===1?[]:[{userId:'you',amountCents:-shareCents}]}));
      data.settlementHistory[0]={...data.settlementHistory[0],from:{...data.members[1],displayName:'付款人姓名很長'.repeat(4)},to:{...data.members[0],displayName:'收款人姓名很長'.repeat(4)},amountCents:shareCents*2,reportedCurrency:currency==='TWD'?'USD':'JPY',reportedAmountCents:123456700};
      data.settlementHistory[1]={...data.settlementHistory[1],reportStatus:'voided',voidedAt:'2026-07-28T10:00:00Z',canVoid:false};
      const p=await page(b,320,700,'settled',data);
      try {
        assert.equal(await p.evaluate("document.querySelector('.mobile-expense-share b').textContent"),formatCurrencyAmount(shareCents,currency));
        assert.equal(await p.evaluate("document.querySelectorAll('.mobile-expense-share b')[1].textContent"),'未參與');
        assert.equal(await p.evaluate("document.querySelector('.mobile-expense-share small').textContent"),'退回給你');
        assert.equal(await p.evaluate(`([...document.querySelectorAll('.mobile-expense-copy,.mobile-expense-share')]).every(e=>e.scrollWidth<=e.clientWidth+1)`),true);
        await p.evaluate("document.querySelector('.mobile-expense-row').scrollIntoView({block:'center'})");
        await p.screenshot(`polish-large-${currency.toLowerCase()}-320`);
        await p.click('.mobile-bottom-nav button:nth-child(2)');await p.click('.activity-tabs button:nth-child(2)');
        assert.equal(await p.evaluate(`([...document.querySelectorAll('.repayment-log article')]).every(e=>e.scrollWidth<=e.clientWidth+1)`),true);
        assert.match(await p.evaluate("document.querySelector('.repayment-amount').textContent"),/原回報/);
        assert.equal(await p.evaluate('document.querySelectorAll(".repayment-log article.is-voided .repayment-void-button").length'),0);
        await p.screenshot(`polish-history-long-${currency.toLowerCase()}-320`);
        await safe(p);
      } finally {await p.close();}
    });
    await t.test('High contrast mode retains a visible focus cue on the amount container',async()=>{
      const p=await page(b,390,844);
      try {
        await p.click('.mobile-bottom-add');
        await p.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
        await p.click('#es-amount');
        assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.es-amount-block')).outlineWidth"),'2px');
        assert.equal(await p.evaluate(hit('.es-save')),true);
        await safe(p);
      } finally {await p.close();}
    });
  } finally {await b.close();}
});
