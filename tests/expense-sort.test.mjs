import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_EXPENSE_SORT,expenseParticipantAmount,filterExpenses,nextExpenseSort,sortExpenses} from '../src/expense-sort.mjs';

const expenses=[
  {id:'old-large',createdAt:'2026-07-20T08:00:00.000Z',amountCents:500000,shares:[{userId:'member-a',amountCents:100000}]},
  {id:'new-small',createdAt:'2026-07-25T08:00:00.000Z',amountCents:8000,shares:[{userId:'member-a',amountCents:4000}]},
  {id:'middle-no-share',createdAt:'2026-07-23T08:00:00.000Z',amountCents:-2000,shares:[]},
  {id:'same-share',createdAt:'2026-07-24T08:00:00.000Z',amountCents:12000,shares:[{userId:'member-a',amountCents:4000}]}
];

test('最近支出預設依日期由新到舊排序，且不改動原始陣列',()=>{
  const original=[...expenses];
  assert.deepEqual(sortExpenses(expenses,DEFAULT_EXPENSE_SORT,'member-a').map(item=>item.id),['new-small','same-share','middle-no-share','old-large']);
  assert.deepEqual(expenses,original);
});

test('日期相同時維持原始順序，無效日期固定排在最後',()=>{
  const sameDate='2026-07-25T08:00:00.000Z';
  const rows=[{id:'first',createdAt:sameDate},{id:'invalid',createdAt:'not-a-date'},{id:'second',createdAt:sameDate}];
  assert.deepEqual(sortExpenses(rows,{key:'date',direction:'asc'}).map(item=>item.id),['first','second','invalid']);
  assert.deepEqual(sortExpenses(rows,{key:'date',direction:'desc'}).map(item=>item.id),['first','second','invalid']);
});

test('參與金額可升降冪排序，未參與項目固定排在最後',()=>{
  assert.deepEqual(sortExpenses(expenses,{key:'participantAmount',direction:'desc'},'member-a').map(item=>item.id),['old-large','new-small','same-share','middle-no-share']);
  assert.deepEqual(sortExpenses(expenses,{key:'participantAmount',direction:'asc'},'member-a').map(item=>item.id),['new-small','same-share','old-large','middle-no-share']);
  assert.equal(expenseParticipantAmount(expenses[2],'member-a'),null);
});

test('總金額以實際正負數值排序',()=>{
  assert.deepEqual(sortExpenses(expenses,{key:'amount',direction:'desc'},'member-a').map(item=>item.id),['old-large','same-share','new-small','middle-no-share']);
  assert.deepEqual(sortExpenses(expenses,{key:'amount',direction:'asc'},'member-a').map(item=>item.id),['middle-no-share','new-small','same-share','old-large']);
});

test('同欄位切換方向，新欄位預設由高到低',()=>{
  assert.deepEqual(nextExpenseSort({key:'date',direction:'desc'},'date'),{key:'date',direction:'asc'});
  assert.deepEqual(nextExpenseSort({key:'date',direction:'asc'},'amount'),{key:'amount',direction:'desc'});
});

test('支出搜尋可比對項目、付款人、分類與退款狀態',()=>{
  const rows=[
    {id:'ramen',title:'新宿拉麵',payerName:'Andy',category:'餐飲',amountCents:18000},
    {id:'hotel',title:'河口湖旅館',payerName:'小美',category:'住宿',amountCents:360000},
    {id:'refund',title:'車票取消',payerName:'哲宇',category:'交通',amountCents:-24000},
    {id:'fallback',title:'伴手禮',payerName:'KAI',amountCents:12000}
  ];
  assert.deepEqual(filterExpenses(rows,'拉麵').map(item=>item.id),['ramen']);
  assert.deepEqual(filterExpenses(rows,'andy').map(item=>item.id),['ramen']);
  assert.deepEqual(filterExpenses(rows,'住宿').map(item=>item.id),['hotel']);
  assert.deepEqual(filterExpenses(rows,'退款').map(item=>item.id),['refund']);
  assert.deepEqual(filterExpenses(rows,'其他').map(item=>item.id),['fallback']);
});

test('支出搜尋會正規化全形字元，空白查詢不改動來源資料',()=>{
  const rows=[{id:'one',title:'Trip 2026',payerName:'Kai',category:'交通',amountCents:1000}];
  const original=[...rows];
  assert.deepEqual(filterExpenses(rows,' ＴＲＩＰ ').map(item=>item.id),['one']);
  const result=filterExpenses(rows,'   ');
  assert.deepEqual(result,rows);
  assert.notEqual(result,rows);
  assert.deepEqual(rows,original);
});
