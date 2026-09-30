import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Use the project's installed React/Vite; no test-only package is required.
let server,AdvancedExpenseModal;
before(async()=>{
  server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom'});
  ({AdvancedExpenseModal}=await server.ssrLoadModule('/src/AdvancedExpenseModal.jsx'));
});
after(async()=>{await server?.close()});
const group={id:'layout-fixture',name:'宜蘭兩日遊',currency:'TWD',ledgerVersion:1,
  members:[{id:'u1',displayName:'你'},{id:'u2',displayName:'安安'},{id:'u3',displayName:'阿哲'},{id:'u4',displayName:'小米'}]};
function render({compact=false,pending=null,props={}}={}){
  const replacements={window:{matchMedia:()=>({matches:compact})},document:{activeElement:null},
    sessionStorage:{getItem:()=>pending?JSON.stringify(pending):null}};
  const descriptors=new Map(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    return renderToStaticMarkup(React.createElement(AdvancedExpenseModal,{group,currentUserId:'u1',close:()=>{},done:()=>{},...props}));
  }finally{
    for(const [key,descriptor] of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
}
test('desktop exposes amount/currency, independent split column and personal footer',()=>{
  const html=render();
  assert.match(html,/class="entry-amount-heading"/);
  assert.match(html,/aria-label="支出幣別"/);
  assert.match(html,/class="entry-fields"/);
  assert.match(html,/class="entry-split" aria-label="分攤設定"/);
  assert.match(html,/誰要分攤？/);
  assert.match(html,/你分攤/);
  assert.match(html,/儲存支出/);
  assert.doesNotMatch(html,/class="entry-stepper"/);
});
test('mobile begins at content; continue is not a submit button',()=>{
  const html=render({compact:true});
  assert.match(html,/data-step="0"/);
  assert.match(html,/class="entry-stepper"/);
  assert.match(html,/class="entry-split" hidden=""/);
  assert.match(html,/<button type="button" class="primary">繼續：付款與分攤<\/button>/);
  assert.doesNotMatch(html,/<button[^>]+type="submit"/);
  assert.match(html,/aria-label="關閉共同支出表單"/);
});
test('restored uncertain submission goes to confirmation and locks the original draft',()=>{
  const pending={version:1,method:'POST',key:'pending-layout-12345',expenseId:null,createdAt:Date.now(),
    payload:{kind:'expense',amount:'1200'},form:{title:'晚餐',amount:'1200',expenseDate:'2026-09-30',selected:['u1','u2','u3','u4']}};
  const html=render({compact:true,pending});
  assert.match(html,/data-step="2"/);
  assert.match(html,/儲存結果尚未確認/);
  assert.match(html,/<fieldset class="expense-inputs" disabled=""/);
  assert.match(html,/確認儲存結果/);
  assert.match(html,/每人分攤金額/);
  assert.doesNotMatch(html,/繼續：付款與分攤/);
});
test('refund entry preserves currency and refund semantics',()=>{
  const html=render({props:{initialKind:'refund'}});
  assert.match(html,/退款金額/);
  assert.match(html,/aria-label="退款幣別"/);
  assert.match(html,/誰收到退款/);
  assert.match(html,/誰分回退款？/);
  assert.match(html,/儲存退款/);
});
test('untrusted ledger and member names remain escaped React text',()=>{
  const html=render({props:{group:{...group,name:'<img src=x onerror=alert(1)>',members:[...group.members,{id:'u5',displayName:'<script>alert(1)</script>'}]}}});
  assert.match(html,/&lt;img/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});
