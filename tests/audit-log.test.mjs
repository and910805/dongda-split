import test from 'node:test';
import assert from 'node:assert/strict';
import {formatAuditAmount,presentAuditItem} from '../src/audit-log.mjs';

test('支出異動會整理成包含操作者、群組、項目與動作的摘要',()=>{
  const item=presentAuditItem({
    action:'update_expense',
    actorName:'Andy',
    metadata:{
      groupName:'宜筆勾銷',
      itemType:'支出',
      itemName:'燒烤',
      amountCents:100000,
      changedFields:['名稱','金額']
    }
  });
  assert.equal(item.actionLabel,'修改');
  assert.equal(item.actionTone,'update');
  assert.equal(item.summary,'Andy 在「宜筆勾銷」修改支出「燒烤」');
  assert.equal(item.detail,'NT$ 1,000 · 修改：名稱、金額');
});

test('刪除紀錄使用 metadata 快照保留已刪除項目的名稱',()=>{
  const item=presentAuditItem({
    action:'delete_expense',
    actorName:'Kai',
    metadata:{groupName:'東京五日',itemName:'築地早餐',amountCents:268000}
  });
  assert.equal(item.summary,'Kai 在「東京五日」刪除支出「築地早餐」');
  assert.equal(item.detail,'NT$ 2,680');
});

test('撤銷轉帳回報會保留群組、路徑與金額',()=>{
  const item=presentAuditItem({
    action:'void_settlement',
    actorName:'Andy',
    metadata:{
      groupName:'開發測試旅程',
      itemType:'轉帳',
      itemName:'Andy → 本機小羅',
      amountCents:50000
    }
  });
  assert.equal(item.actionLabel,'撤銷');
  assert.equal(item.actionTone,'delete');
  assert.equal(item.summary,'Andy 在「開發測試旅程」撤銷轉帳回報「Andy → 本機小羅」');
  assert.equal(item.detail,'NT$ 500');
});

test('未知與既有系統動作都有安全的顯示文字',()=>{
  assert.equal(presentAuditItem({action:'grant_superuser',actorName:'Kai',metadata:{displayName:'Andy'}}).summary,'Kai 授予「Andy」管理者權限');
  assert.equal(presentAuditItem({action:'custom_action',actorName:'Kai'}).summary,'Kai 執行 custom_action');
  assert.equal(formatAuditAmount(undefined),'');
});

test('稽核金額與群組換算依實際幣別顯示',()=>{
  assert.equal(formatAuditAmount(1234,'USD'),'US$ 12.34');
  assert.equal(formatAuditAmount(126000,'JPY'),'¥ 1,260');
  const item=presentAuditItem({
    action:'convert_group_currency',
    actorName:'Andy',
    metadata:{
      groupName:'東京旅行',
      fromCurrency:'TWD',
      toCurrency:'JPY',
      currency:'JPY',
      rate:'5.05',
      rateDate:'2026-07-27'
    }
  });
  assert.equal(item.summary,'Andy 將「東京旅行」幣別由 TWD 變更為 JPY');
  assert.equal(item.detail,'匯率 5.05 · 2026-07-27');
});

test('英文稽核摘要翻譯動作與舊中文 metadata，但保留使用者輸入',()=>{
  const item=presentAuditItem({
    action:'update_expense',
    actorName:'王小明',
    metadata:{
      groupName:'東京五日旅行',
      itemType:'支出',
      itemName:'築地早餐',
      amountCents:100000,
      changedFields:['名稱','金額','自訂欄位']
    }
  },{language:'en'});
  assert.equal(item.actionLabel,'Updated');
  assert.equal(item.actionTone,'update');
  assert.equal(item.summary,'王小明 updated expense “築地早餐” in “東京五日旅行”');
  assert.equal(item.detail,'NT$ 1,000 · Changed: Name, Amount, 自訂欄位');
  assert.equal(item.groupName,'東京五日旅行');
  assert.equal(item.itemName,'築地早餐');
  assert.equal(item.itemType,'Expense');
});

test('英文稽核摘要涵蓋轉帳、換算、模擬身分與未知動作',()=>{
  const voided=presentAuditItem({
    action:'void_settlement',
    actorName:'Andy',
    metadata:{
      groupName:'Trip A',
      itemType:'轉帳',
      itemName:'Andy → Kai',
      amountCents:50000,
      actedAsName:'測試帳號'
    }
  },{language:'en'});
  assert.equal(voided.summary,'Andy voided transfer report “Andy → Kai” in “Trip A”');
  assert.equal(voided.detail,'NT$ 500 · Simulated identity: 測試帳號');
  assert.equal(voided.itemType,'Transfer');

  const converted=presentAuditItem({
    action:'convert_group_currency',
    actorName:'Andy',
    metadata:{groupName:'東京旅行',fromCurrency:'TWD',toCurrency:'JPY',rate:'5.05'}
  },{language:'en'});
  assert.equal(converted.summary,'Andy changed “東京旅行” currency from TWD to JPY');
  assert.equal(converted.detail,'Rate 5.05 · Date not recorded');

  assert.equal(
    presentAuditItem({action:'custom_action',actorName:'Kai'},{language:'en'}).summary,
    'Kai performed custom_action'
  );
});
