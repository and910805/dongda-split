// Full application + real touch events; all data and requests stay in the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';

const shown = selector => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;
const unobstructed = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),v=visualViewport;return r.width>0&&r.left>=v.offsetLeft-1&&r.right<=v.offsetLeft+v.width+1&&r.top>=v.offsetTop-1&&r.bottom<=v.offsetTop+v.height+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`;
async function tap(p,selector){
 await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
 await delay(50);
 assert.equal(await p.evaluate(unobstructed(selector)),true,`Touch target obstructed: ${selector}`);
 const point=await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
 await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await delay(70);
}
async function noOverflow(p){
 assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Body must not scroll horizontally');
 assert.deepEqual(await p.evaluate('__qa.errors'),[],'Unexpected runtime error');
}

test('Reference A mobile polish: safe areas, long lists and real touch targets',{timeout:180000},async t=>{
 const b=await launch();
 try {
  for(const [width,height] of [[320,568],[360,740],[375,667],[390,844],[430,932],[768,1024],[844,390]]){
   await t.test(`${width}x${height}: touch navigation, readable filters and reachable final row`,async()=>{
    const p=await page(b,width,height);
    try {
     await p.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
     await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
     await delay(80);
     assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.mobile-new-group'),'::after').content"),'"新帳本"');
     assert.equal(await p.evaluate(shown('.header-primary')),false,'Expense CTA is in the bottom bar on mobile');
     for(let round=0;round<2;round++){
      await tap(p,'.mobile-bottom-nav button:nth-child(2)');
      assert.equal(await p.evaluate(shown('.activity-column')),true);
      assert.equal(await p.evaluate(shown('.mobile-overview-v2')),false);
      assert.equal(await p.evaluate(shown('.settlements')),false);
      assert.equal(await p.evaluate(`(()=>{const e=document.querySelector('.expense-date-filter select'),c=document.createElement('canvas').getContext('2d');c.font=getComputedStyle(e).font;return e.clientWidth>=c.measureText('全部日期').width-1})()`),true,'Date placeholder must fit without clipping');
      await p.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await delay(60);
      assert.equal(await p.evaluate("document.querySelector('.record-pagination').getBoundingClientRect().bottom<=document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top-8"),true,'Pagination must scroll clear of the bottom nav');
      await tap(p,'.mobile-bottom-nav button:nth-child(4)');
      assert.equal(await p.evaluate(shown('.settlements')),true);
      assert.equal(await p.evaluate(shown('.activity-column')),false);
      await tap(p,'.mobile-bottom-nav button:first-child');
      assert.equal(await p.evaluate(shown('.mobile-overview-v2')),true);
      assert.equal(await p.evaluate(shown('.real-grid')),false);
     }
     await p.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await delay(50);
     assert.equal(await p.evaluate("document.querySelector('.mobile-recent-list').getBoundingClientRect().bottom<=document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top-8"),true,'The final overview row must be fully reachable');
     assert.equal(await p.evaluate(unobstructed('.mobile-bottom-add')),true);
     await noOverflow(p);
    }finally{await p.close()}
   });
  }
  await t.test('Safe-area padding, keyboard height and rotation preserve the same expense draft',async()=>{
   const p=await page(b,390,844);
   try {
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await p.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:24,bottom:34,left:0,right:0}});await delay(80);
    assert.ok(await p.evaluate("parseFloat(getComputedStyle(document.querySelector('.mobile-bottom-nav')).paddingBottom)>=42"));
    await tap(p,'.mobile-bottom-add');
    await p.setValue('#es-description','旋轉後保留草稿');await p.setValue('#es-amount','1500');
    await p.evaluate('void(window.draftModal=document.querySelector(".expense-single-modal"))');
    assert.equal(await p.evaluate(unobstructed('.es-save')),true);
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:390,deviceScaleFactor:3,mobile:true});await delay(120);
    assert.equal(await p.evaluate(unobstructed('.es-save')),true);
    await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true});
    await p.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:44,right:44}});await delay(120);
    assert.equal(await p.evaluate(unobstructed('.es-save')),true);
    assert.equal(await p.evaluate('document.querySelector(".expense-single-modal")===window.draftModal'),true);
    assert.equal(await p.evaluate('document.querySelector("#es-description").value'),'旋轉後保留草稿');
    await tap(p,'.es-cancel');await p.wait(shown('.es-discard'));
    assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
    await tap(p,'.es-discard .es-danger');
    assert.equal(await p.evaluate('document.querySelector("#root").inert'),false);
    assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'),0);
    await noOverflow(p);
   }finally{await p.close()}
  });
  await t.test('50 long member names remain scrollable in settings and in each split mode',async()=>{
   const data=structuredClone(fixture);
   data.name='一個名稱很長的旅行共同帳本｜十月山海小旅行';
   data.members=Array.from({length:50},(_,i)=>({id:i?`m${i-1}`:'you',displayName:i?'同行成員姓名很長的測試資料_'+i:'Andy'}));
   data.balances=data.members.map(m=>({...m,balanceCents:0}));
   const p=await page(b,320,700,'settled',data);
   try {
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await tap(p,'.mobile-group-settings');
    assert.equal(await p.evaluate('document.querySelectorAll(".mobile-tools-members li").length'),50);
    await p.click('.mobile-tools-members li:last-child button');
    assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
    await p.click('[aria-modal=true] .modal-x');
    await tap(p,'.mobile-bottom-add');await p.setValue('#es-description','五十人共同花費');await p.setValue('#es-amount','1500');
    await p.click('.es-quick-person:nth-child(2)');
    for(let i=1;i<=4;i++){
     await p.click(`.es-split-option:nth-child(${i})`);
     await p.evaluate('document.querySelector(".es-scroll").scrollTop=1e7');await delay(40);
     assert.equal(await p.evaluate('document.querySelector(".es-people-table").scrollWidth<=document.querySelector(".es-people-table").clientWidth+1'),true);
     assert.equal(await p.evaluate(unobstructed('.es-save')),true);
     assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);
    }
    await p.screenshot('reference-a-50-members');
    await noOverflow(p);
   }finally{await p.close()}
  });
  await t.test('Desktop more action has a readable icon and a 44px pointer target',async()=>{
   const p=await page(b,1672,941);
   try {
    const sizes=await p.evaluate("(()=>{const b=document.querySelector('.ledger-row-more').getBoundingClientRect(),i=document.querySelector('.ledger-row-more svg').getBoundingClientRect();return {button:b.width,icon:i.width,iconHeight:i.height}})()");
    assert.ok(sizes.button>=44&&sizes.icon>=20&&sizes.iconHeight>=20);
    await p.click('.ledger-row-more');assert.equal(await p.evaluate(unobstructed('.ledger-row-menu button')),true);
    await noOverflow(p);
   }finally{await p.close()}
  });
 }finally{await b.close()}
});
