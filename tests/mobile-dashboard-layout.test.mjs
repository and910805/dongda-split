import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('最近支出排序列不受空帳本與篩選結果狀態影響',async()=>{
  const source=await readFile(new URL('../src/ProductApp.jsx',import.meta.url),'utf8');
  const sortControlsIndex=source.indexOf('<div className="mobile-expense-sort"');
  const emptyStateIndex=source.indexOf('{!group.expenses.length?');

  assert.notEqual(sortControlsIndex,-1);
  assert.notEqual(emptyStateIndex,-1);
  assert.ok(sortControlsIndex<emptyStateIndex);
});

test('手機版主要資訊卡採單欄排列且摘要採二乘二格線',async()=>{
  const styles=await readFile(new URL('../src/mobile-dashboard.css',import.meta.url),'utf8');

  assert.match(styles,/\.mobile-overview-pair\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles,/\.mobile-summary-cluster \.real-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(styles,/grid-template-columns:\s*\d+px\s+\d+px/);
});

test('手機版篩選器與支出卡片使用可伸縮的語意格線',async()=>{
  const styles=await readFile(new URL('../src/mobile-dashboard.css',import.meta.url),'utf8');

  assert.match(styles,/grid-template-areas:\s*"search search"\s*"member count"/);
  assert.match(styles,/grid-template-areas:\s*"name name actions"\s*"payer payer status"\s*"share price price"\s*"date people category"/);
  assert.doesNotMatch(styles,/!important/);
});

test('手機成員頭像會收斂為五人與加總數量',async()=>{
  const source=await readFile(new URL('../src/ProductApp.jsx',import.meta.url),'utf8');

  assert.match(source,/expenseMembers\.slice\(0,5\)/);
  assert.match(source,/mobile-group-avatar-more/);
});

test('已移除舊版針對單一裝置的重複樣式區塊',async()=>{
  const styles=await readFile(new URL('../src/operation.css',import.meta.url),'utf8');

  assert.doesNotMatch(styles,/Reference-led mobile dashboard/);
  assert.doesNotMatch(styles,/167px\s+9px\s+142px/);
});
