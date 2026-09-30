import test from 'node:test';
import assert from 'node:assert/strict';
import {formatEntryAmount,formatEntryDate,isSelectedMember} from '../src/expense-entry-presentation.mjs';

test('amount display adds grouping without floating point conversion',()=>{
  assert.equal(formatEntryAmount('1200'),'1,200');
  assert.equal(formatEntryAmount('90071992547409931234'),'90,071,992,547,409,931,234');
});
test('amount display preserves decimal precision and partially typed input',()=>{
  assert.equal(formatEntryAmount('1200.00'),'1,200.00');
  assert.equal(formatEntryAmount('1200.'),'1,200.');
  assert.equal(formatEntryAmount('0.01'),'0.01');
});
test('invalid amount text is not converted into a different valid amount',()=>{
  for(const value of ['','-12','1e3','1..2','abc'])assert.equal(formatEntryAmount(value),value);
  assert.equal(formatEntryAmount(null),'');
});
test('date chips retain calendar dates and distinguish other years',()=>{
  assert.equal(formatEntryDate('2026-09-30','2026-09-30'),'今天 · 9/30');
  assert.equal(formatEntryDate('2026-01-02','2026-09-30'),'1/2');
  assert.equal(formatEntryDate('2025-12-31','2026-09-30'),'2025/12/31');
  assert.equal(formatEntryDate(null,'2026-09-30'),'選擇日期');
});
test('selection recognizes numeric and restored string IDs without mutation',()=>{
  const ids=[1,'u2'];
  assert.equal(isSelectedMember(ids,'1'),true);
  assert.equal(isSelectedMember(ids,'u2'),true);
  assert.equal(isSelectedMember(ids,2),false);
  assert.equal(isSelectedMember(ids,undefined),false);
  assert.deepEqual(ids,[1,'u2']);
});
