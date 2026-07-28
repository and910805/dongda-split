import test from 'node:test';
import assert from 'node:assert/strict';
import {convertExpenseInputToLedger,normalizeExpenseRate} from '../expense-currency.mjs';

const input=overrides=>({
  title:'晚餐',
  amountCents:100_00,
  payments:[{userId:'a',paymentCents:100_00}],
  shares:[
    {userId:'a',shareCents:34_00},
    {userId:'b',shareCents:33_00},
    {userId:'c',shareCents:33_00}
  ],
  mode:'exact',
  splitMeta:{shares:[
    {userId:'a',amount:34},
    {userId:'b',amount:33},
    {userId:'c',amount:33}
  ]},
  category:'餐飲',
  participantIds:['a','b','c'],
  ...overrides
});

test('群組預設幣別不做換算並保留原幣快照',()=>{
  const result=convertExpenseInputToLedger({
    input:input(),
    sourceCurrency:'TWD',
    targetCurrency:'TWD',
    rate:'1'
  });
  assert.equal(result.amountCents,100_00);
  assert.equal(result.currencyMeta.inputCurrency,'TWD');
  assert.equal(result.currencyMeta.ledgerCurrency,'TWD');
  assert.equal(result.currencyMeta.rateMode,'identity');
  assert.equal(result.currencyMeta.inputPayments[0].amountCents,100_00);
});

test('每筆 USD 支出只在儲存時換成群組 TWD 並維持零和',()=>{
  const result=convertExpenseInputToLedger({
    input:input(),
    sourceCurrency:'USD',
    targetCurrency:'TWD',
    rate:'30',
    rateMode:'manual',
    rateSource:'member'
  });
  assert.equal(result.amountCents,3000_00);
  assert.equal(result.payments.reduce((sum,row)=>sum+row.paymentCents,0),3000_00);
  assert.equal(result.shares.reduce((sum,row)=>sum+row.shareCents,0),3000_00);
  assert.equal(result.currencyMeta.inputAmountCents,100_00);
  assert.equal(result.currencyMeta.inputCurrency,'USD');
  assert.equal(result.currencyMeta.rate,'30');
});

test('外幣退款保留負數方向與原始輸入',()=>{
  const result=convertExpenseInputToLedger({
    input:input({
      amountCents:-10_00,
      payments:[{userId:'a',paymentCents:-10_00}],
      shares:[{userId:'a',shareCents:-5_00},{userId:'b',shareCents:-5_00}],
      splitMeta:{shares:[{userId:'a',amount:5},{userId:'b',amount:5}]}
    }),
    sourceCurrency:'USD',
    targetCurrency:'TWD',
    rate:'31.5'
  });
  assert.equal(result.amountCents,-315_00);
  assert.equal(result.shares.reduce((sum,row)=>sum+row.shareCents,0),-315_00);
  assert.equal(result.currencyMeta.inputAmountCents,-10_00);
});

test('自訂匯率使用精確分數而不是浮點乘法',()=>{
  assert.deepEqual(normalizeExpenseRate('0.333333333333333'),{
    rate:'0.333333333333333',
    ratioNumerator:'333333333333333',
    ratioDenominator:'1000000000000000'
  });
  assert.throws(()=>normalizeExpenseRate('0'),/匯率必須大於 0/);
  assert.throws(()=>normalizeExpenseRate('1e-100'),/精度/);
});

test('14 人外幣平均分攤換算後仍與帳本總額完全一致',()=>{
  const members=Array.from({length:14},(_,index)=>`member-${index+1}`);
  const result=convertExpenseInputToLedger({
    input:input({
      title:'日圓包棟',
      amountCents:140_000_00,
      payments:[{userId:members[0],paymentCents:140_000_00}],
      shares:members.map(userId=>({userId,shareCents:10_000_00})),
      mode:'equal',
      splitMeta:{participantIds:members},
      participantIds:members
    }),
    sourceCurrency:'JPY',
    targetCurrency:'TWD',
    rate:'0.22'
  });
  assert.equal(result.amountCents,30_800_00);
  assert.equal(result.shares.length,14);
  assert.equal(result.shares.reduce((sum,row)=>sum+row.shareCents,0),result.amountCents);
  assert.ok(result.shares.every(row=>row.shareCents%100===0));
});

test('換算後不足目標幣別最小單位時拒絕儲存',()=>{
  assert.throws(()=>convertExpenseInputToLedger({
    input:input({
      amountCents:1,
      payments:[{userId:'a',paymentCents:1}],
      shares:[{userId:'a',shareCents:1}],
      splitMeta:{shares:[{userId:'a',amount:0.01}]}
    }),
    sourceCurrency:'USD',
    targetCurrency:'JPY',
    rate:'0.01'
  }),/最小單位/);
});
