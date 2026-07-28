import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCurrencyConversionPlan} from '../group-currency-conversion.mjs';

const rate=(numerator,denominator)=>({
  ratioNumerator:String(numerator),
  ratioDenominator:String(denominator)
});

test('TWD 轉 JPY 會保留付款與分攤零和',()=>{
  const plan=buildCurrencyConversionPlan({
    sourceCurrency:'TWD',
    targetCurrency:'JPY',
    rate:rate(5,1),
    expenses:[{
      id:'expense-1',
      title:'住宿',
      amountCents:1_001_00,
      splitMode:'equal',
      splitMeta:{participantIds:['a','b','c']},
      payments:[
        {userId:'a',amountCents:700_00},
        {userId:'b',amountCents:301_00}
      ],
      shares:[
        {userId:'a',amountCents:334_00},
        {userId:'b',amountCents:334_00},
        {userId:'c',amountCents:333_00}
      ]
    }]
  });
  assert.deepEqual(plan.blockedIssues,[]);
  assert.equal(plan.expenses[0].amountCents,5_005_00);
  assert.equal(plan.expenses[0].payments.reduce((sum,row)=>sum+row.amountCents,0),5_005_00);
  assert.equal(plan.expenses[0].shares.reduce((sum,row)=>sum+row.amountCents,0),5_005_00);
  assert.ok(plan.expenses[0].shares.every(row=>row.amountCents%100===0));
});

test('USD 小數幣別以 cent 尾差精確守恆',()=>{
  const plan=buildCurrencyConversionPlan({
    sourceCurrency:'TWD',
    targetCurrency:'USD',
    rate:rate(1,3),
    expenses:[{
      id:'expense-2',
      title:'三人餐費',
      amountCents:100_00,
      splitMode:'exact',
      splitMeta:{shares:[]},
      payments:[{userId:'a',amountCents:100_00}],
      shares:[
        {userId:'a',amountCents:34_00},
        {userId:'b',amountCents:33_00},
        {userId:'c',amountCents:33_00}
      ]
    }]
  });
  assert.deepEqual(plan.blockedIssues,[]);
  assert.equal(plan.expenses[0].amountCents,3333);
  assert.equal(plan.expenses[0].shares.reduce((sum,row)=>sum+row.amountCents,0),3333);
  assert.deepEqual(plan.expenses[0].splitMeta.shares.map(row=>row.amount),[11.33,11,11]);
});

test('退款與已撤銷還款都會保留方向並換算',()=>{
  const plan=buildCurrencyConversionPlan({
    sourceCurrency:'USD',
    targetCurrency:'TWD',
    rate:rate(30,1),
    expenses:[{
      id:'refund',
      title:'退押金',
      amountCents:-1250,
      splitMode:'equal',
      splitMeta:{participantIds:['a','b']},
      payments:[{userId:'a',amountCents:-1250}],
      shares:[{userId:'a',amountCents:-625},{userId:'b',amountCents:-625}]
    }],
    settlements:[{
      id:'settlement-1',
      amountCents:500,
      reportedCurrency:'USD',
      reportedAmountCents:500,
      voidedAt:'2026-07-01T00:00:00.000Z'
    }]
  });
  assert.deepEqual(plan.blockedIssues,[]);
  assert.equal(plan.expenses[0].amountCents,-37_500);
  assert.equal(plan.expenses[0].shares.reduce((sum,row)=>sum+row.amountCents,0),-37_500);
  assert.equal(plan.settlements[0].amountCents,15_000);
  assert.equal(plan.settlements[0].reportedCurrency,'USD');
  assert.equal(plan.settlements[0].reportedAmountCents,500);
});

test('目標幣別最小單位不足時 Preview 會指出問題支出',()=>{
  const plan=buildCurrencyConversionPlan({
    sourceCurrency:'USD',
    targetCurrency:'JPY',
    rate:rate(1,100),
    expenses:[{
      id:'tiny',
      title:'極小支出',
      amountCents:100,
      splitMode:'equal',
      splitMeta:{participantIds:['a','b']},
      payments:[{userId:'a',amountCents:100}],
      shares:[{userId:'a',amountCents:50},{userId:'b',amountCents:50}]
    }]
  });
  assert.equal(plan.expenses.length,0);
  assert.equal(plan.blockedIssues.length,1);
  assert.equal(plan.blockedIssues[0].id,'tiny');
});

test('比例與指定加均分會依原規則重建',()=>{
  const plan=buildCurrencyConversionPlan({
    sourceCurrency:'TWD',
    targetCurrency:'USD',
    rate:rate(1,30),
    expenses:[
      {
        id:'weights',
        title:'住宿',
        amountCents:900_00,
        splitMode:'weights',
        splitMeta:{weights:[{userId:'a',weight:1},{userId:'b',weight:2}]},
        payments:[{userId:'a',amountCents:900_00}],
        shares:[{userId:'a',amountCents:300_00},{userId:'b',amountCents:600_00}]
      },
      {
        id:'hybrid',
        title:'聚餐',
        amountCents:1_200_00,
        splitMode:'hybrid',
        splitMeta:{
          participantIds:['a','b','c'],
          fixedShares:[{userId:'a',amount:600}]
        },
        payments:[{userId:'b',amountCents:1_200_00}],
        shares:[
          {userId:'a',amountCents:600_00},
          {userId:'b',amountCents:300_00},
          {userId:'c',amountCents:300_00}
        ]
      }
    ]
  });
  assert.deepEqual(plan.blockedIssues,[]);
  const weighted=plan.expenses.find(item=>item.id==='weights');
  assert.deepEqual(weighted.shares.map(item=>item.amountCents),[1000,2000]);
  const hybrid=plan.expenses.find(item=>item.id==='hybrid');
  assert.deepEqual(hybrid.shares.map(item=>item.amountCents),[2000,1000,1000]);
  assert.deepEqual(hybrid.splitMeta.fixedShares,[{userId:'a',amount:20}]);
});
