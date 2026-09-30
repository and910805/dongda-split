import assert from 'node:assert/strict';
import test from 'node:test';
import {canRememberLedger,chooseMemberLedger,readLedgerPreference,writeLedgerPreference} from '../src/ledger-preference.mjs';

const groups=[{id:'newest'},{id:'remembered'},{id:'invited'}];
test('重新整理恢復有效帳本，邀請加入的帳本優先於目前與記憶選擇',()=>{
  assert.equal(chooseMemberLedger(groups,{rememberedId:'remembered'}),'remembered');
  assert.equal(chooseMemberLedger(groups,{currentId:'newest',rememberedId:'remembered',preferredId:'invited'}),'invited');
  assert.equal(chooseMemberLedger(groups,{currentId:'remembered',rememberedId:'newest'}),'remembered');
});
test('已刪除或失去成員資格的帳本不會還原，沒有帳本時回傳空值',()=>{
  assert.equal(chooseMemberLedger(groups,{preferredId:'gone',currentId:'gone',rememberedId:'gone'}),'newest');
  assert.equal(chooseMemberLedger([],{rememberedId:'remembered'}),null);
});
test('每位使用者的帳本偏好互不覆蓋，數字識別碼也能比對',()=>{
  const records=new Map(),storage={getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value)};
  writeLedgerPreference('andy','remembered',storage);
  writeLedgerPreference('lin','newest',storage);
  assert.equal(readLedgerPreference('andy',storage),'remembered');
  assert.equal(readLedgerPreference('lin',storage),'newest');
  assert.equal(chooseMemberLedger([{id:3}],{rememberedId:'3'}),3);
});
test('瀏覽器拒絕儲存時仍可繼續使用帳本',()=>{
  const storage={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}};
  assert.equal(readLedgerPreference('andy',storage),null);
  assert.equal(writeLedgerPreference('andy','remembered',storage),false);
});
test('只記憶已驗證的成員帳本，管理者臨時檢視不得污染偏好',()=>{
  const group={id:'ledger',members:[{id:'andy'},{id:'fund',isFund:true}]};
  assert.equal(canRememberLedger(group,'andy'),true);
  assert.equal(canRememberLedger(group,'andy',{adminViewing:true}),false);
  assert.equal(canRememberLedger(group,'outsider'),false);
  assert.equal(canRememberLedger(group,'fund'),false);
});
