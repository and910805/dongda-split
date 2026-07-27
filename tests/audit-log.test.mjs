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

test('未知與既有系統動作都有安全的顯示文字',()=>{
  assert.equal(presentAuditItem({action:'grant_superuser',actorName:'Kai',metadata:{displayName:'Andy'}}).summary,'Kai 授予「Andy」管理者權限');
  assert.equal(presentAuditItem({action:'custom_action',actorName:'Kai'}).summary,'Kai 執行 custom_action');
  assert.equal(formatAuditAmount(undefined),'');
});
