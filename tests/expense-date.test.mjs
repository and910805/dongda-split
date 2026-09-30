import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {currentExpenseDate,expenseCalendarDate,formatExpenseDate,isValidExpenseDate,resolveExpenseDate} from '../expense-date.mjs';
import {expenseSubmissionFingerprint} from '../src/expense-idempotency.mjs';

test('消費日期只接受四位年份的真實曆日，包含世紀閏年規則',()=>{
  for(const date of ['0001-01-01','2000-02-29','2024-02-29','2026-09-30','9999-12-31']){
    assert.equal(isValidExpenseDate(date),true,date);
    assert.equal(resolveExpenseDate(date),date);
  }
  for(const date of ['0000-01-01','1900-02-29','2026-02-29','2026-04-31','2026-00-10','2026-13-01','2026-09-00','2026-9-30','2026-09-30T00:00:00Z',' 2026-09-30','2026-09-30\n','',null,123]){
    assert.equal(isValidExpenseDate(date),false,String(date));
    assert.throws(()=>resolveExpenseDate(date),error=>error.code==='INVALID_EXPENSE_DATE'&&error.status===400);
  }
});

test('舊客戶端新增省略日期時使用台北今天，修改省略日期則保留原日期',()=>{
  const beforeMidnight=new Date('2026-09-30T15:59:59Z');
  const afterMidnight=new Date('2026-09-30T16:00:00Z');
  assert.equal(currentExpenseDate(beforeMidnight),'2026-09-30');
  assert.equal(currentExpenseDate(afterMidnight),'2026-10-01');
  assert.equal(resolveExpenseDate(undefined,{now:afterMidnight}),'2026-10-01');
  assert.equal(resolveExpenseDate(undefined,{existingDate:'2026-09-29',now:afterMidnight}),'2026-09-29');
  assert.equal(resolveExpenseDate('2026-09-28',{existingDate:'2026-09-29'}),'2026-09-28');
});

test('消費日期優先於建立時間，無合法日期的舊資料才回退',()=>{
  const expense={expenseDate:'2026-09-29',createdAt:'2026-09-30T12:00:00Z'};
  assert.equal(expenseCalendarDate(expense),'2026-09-29');
  assert.equal(formatExpenseDate(expense),'2026/9/29');
  assert.equal(formatExpenseDate(expense,{short:true}),'9/29');
  const legacy={expenseDate:'invalid',createdAt:'2026-09-30T12:00:00Z'};
  const expected=new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'numeric',day:'numeric'}).format(new Date(legacy.createdAt));
  assert.equal(formatExpenseDate(legacy),expected);
  assert.equal(expenseCalendarDate({}),null);
  assert.equal(formatExpenseDate({createdAt:'invalid'}),'日期未提供');
});

test('不同系統時區不會改變消費日期或台北預設日，舊資料保留當地建立日期',()=>{
  const moduleUrl=new URL('../expense-date.mjs',import.meta.url).href;
  const script=`import {currentExpenseDate,expenseCalendarDate,formatExpenseDate} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify({date:expenseCalendarDate({expenseDate:'2026-09-30',createdAt:'2026-09-30T00:30:00Z'}),text:formatExpenseDate({expenseDate:'2026-09-30'}),today:currentExpenseDate(new Date('2026-09-30T16:30:00Z')),legacy:expenseCalendarDate({createdAt:'2026-09-30T00:30:00Z'})}));`;
  for(const [timezone,legacy] of [['Asia/Taipei','2026-09-30'],['America/Los_Angeles','2026-09-29'],['Pacific/Kiritimati','2026-09-30']]){
    const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:timezone},encoding:'utf8'}));
    assert.deepEqual(result,{date:'2026-09-30',text:'2026/9/30',today:'2026-10-01',legacy});
  }
});

test('消費日期納入提交識別，省略日期的請求不會被補入變動的今天',()=>{
  const payload={title:'補記晚餐',amount:'200',expenseDate:'2026-09-29'};
  assert.notEqual(expenseSubmissionFingerprint(payload),expenseSubmissionFingerprint({...payload,expenseDate:'2026-09-30'}));
  const legacy={title:'舊客戶端晚餐',amount:'200'};
  const fingerprint=expenseSubmissionFingerprint(legacy);
  resolveExpenseDate(legacy.expenseDate,{now:new Date('2026-09-30T15:59:59Z')});
  resolveExpenseDate(legacy.expenseDate,{now:new Date('2026-09-30T16:00:00Z')});
  assert.equal(expenseSubmissionFingerprint(legacy),fingerprint);
  assert.equal(Object.hasOwn(legacy,'expenseDate'),false);
});
