import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  bankAccountRemovalConfirmation,
  expenseDeletionConfirmation,
  groupDeletionConfirmation,
  roleChangeConfirmation,
  settlementVoidConfirmation
} from '../src/confirmation-actions.mjs';

test('刪除支出確認會顯示項目名稱與不可復原影響',()=>{
  const confirmation=expenseDeletionConfirmation('燒烤');
  assert.equal(confirmation.title,'刪除「燒烤」？');
  assert.match(confirmation.description,/無法復原/);
  assert.equal(confirmation.confirmLabel,'刪除支出');
  assert.equal(confirmation.tone,'danger');
});

test('刪除群組確認會說明支出、分攤與結算都會刪除',()=>{
  const confirmation=groupDeletionConfirmation('日本五日遊');
  assert.equal(confirmation.title,'刪除群組「日本五日遊」？');
  assert.match(confirmation.description,/支出、分攤與結算/);
  assert.equal(confirmation.confirmLabel,'刪除群組');
});

test('移除帳戶確認會說明付款人將失去轉帳資訊',()=>{
  const confirmation=bankAccountRemovalConfirmation();
  assert.match(confirmation.description,/無法查看這組轉帳資訊/);
  assert.equal(confirmation.confirmLabel,'移除帳戶');
  assert.equal(confirmation.tone,'danger');
});

test('撤銷轉帳回報會說明只重算帳本、不會取消實際轉帳',()=>{
  const confirmation=settlementVoidConfirmation({
    from:{displayName:'Andy'},
    to:{displayName:'本機小羅'}
  });
  assert.equal(confirmation.title,'撤銷「Andy → 本機小羅」的轉帳回報？');
  assert.match(confirmation.description,/重新計算群組結餘/);
  assert.match(confirmation.description,/不會取消銀行/);
  assert.equal(confirmation.confirmLabel,'撤銷回報');
  assert.equal(confirmation.tone,'danger');
});

test('授予管理權限使用主要操作並凍結下一個角色狀態',()=>{
  const confirmation=roleChangeConfirmation({displayName:'Andy',isSuperuser:false});
  assert.equal(confirmation.title,'將「Andy」設為管理者？');
  assert.equal(confirmation.nextValue,true);
  assert.equal(confirmation.tone,'primary');
  assert.equal(confirmation.action,'授予管理者權限');
});

test('移除管理權限使用危險操作並保留一般分帳資料',()=>{
  const confirmation=roleChangeConfirmation({displayName:'Andy',isSuperuser:true});
  assert.equal(confirmation.title,'移除「Andy」的管理權限？');
  assert.equal(confirmation.nextValue,false);
  assert.equal(confirmation.tone,'danger');
  assert.match(confirmation.description,/一般分帳資料不受影響/);
});

test('產品與管理者介面不再使用瀏覽器原生 confirm',async()=>{
  const sources=await Promise.all([
    readFile(new URL('../src/ProductApp.jsx',import.meta.url),'utf8'),
    readFile(new URL('../src/AdminConsole.jsx',import.meta.url),'utf8')
  ]);
  for(const source of sources)assert.doesNotMatch(source,/\b(?:window\.)?confirm\s*\(/);
});
