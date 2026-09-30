import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseSubmissionKeyStore} from '../src/expense-idempotency.mjs';
import {canRetryPendingExpense,createExpensePendingStore,createPendingExpenseSubmission,expenseSavedSnapshot,expenseSubmittedSnapshot,isUncertainExpenseError,pendingExpenseRequestOptions,reconcileExpenseSubmission,requestExpenseJson} from '../src/expense-submission.mjs';

const payload={title:'晚餐',kind:'expense',amount:'101',currency:'TWD',expenseCurrency:'TWD',expenseDate:'2026-09-29',category:'餐飲',payerId:'安安',participantIds:['安安','小明'],splitMode:'equal',exchangeRate:'1',expectedUserId:'安安',ledgerVersion:'3'};
const memoryStorage=()=>{const values=new Map();return{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
const recordFor=(input=payload,extra={})=>createPendingExpenseSubmission({method:'POST',payload:input,keyStore:createExpenseSubmissionKeyStore({createKey:()=> 'recoverable-key-123'}),form:{title:input.title,amount:input.amount},...extra});
const savedExpense=(input=payload)=>{
  const expected=expenseSubmittedSnapshot(input);
  return {id:'expense-1',title:input.title,category:input.category,expenseDate:input.expenseDate,splitMode:input.splitMode,amountCents:expected.inputAmountCents,
    currencyMeta:{inputCurrency:input.expenseCurrency,inputAmountCents:expected.inputAmountCents,inputPayments:expected.payments,inputShares:[{userId:'小明',amountCents:5100},{userId:'安安',amountCents:5000}],inputSplitMeta:expected.split,rate:input.exchangeRate},
  };
};

test('結果未知的新增支出在重開後沿用原內容、原帳號與原識別碼',()=>{
  const storage=memoryStorage(),context={userId:'安安',groupId:'東京帳本',storage};
  const firstStore=createExpensePendingStore(context),record=recordFor();
  assert.equal(firstStore.save(record),true);
  const restored=createExpensePendingStore(context).load();
  assert.deepEqual(pendingExpenseRequestOptions(restored),pendingExpenseRequestOptions(record));
  assert.equal(restored.payload.expectedUserId,'安安');
  assert.equal(restored.key,'recoverable-key-123');
  assert.equal(restored.form.amount,'101');
  firstStore.clear();
  assert.equal(createExpensePendingStore(context).load(),null);
});

test('未確認提交依帳號、帳本及修改項目隔離',()=>{
  const storage=memoryStorage();
  createExpensePendingStore({userId:'安安',groupId:'東京',storage}).save(recordFor());
  assert.equal(createExpensePendingStore({userId:'小明',groupId:'東京',storage}).load(),null);
  assert.equal(createExpensePendingStore({userId:'安安',groupId:'大阪',storage}).load(),null);
  assert.equal(createExpensePendingStore({userId:'安安',groupId:'東京',expenseId:'expense-1',storage}).load(),null);
});

test('瀏覽器拒絕暫存時回傳降級訊號，不中斷表單',()=>{
  const storage={getItem(){throw new Error('禁止存取')},setItem(){throw new Error('空間不足')},removeItem(){throw new Error('禁止存取')}};
  const store=createExpensePendingStore({userId:'安安',groupId:'東京',storage});
  assert.equal(store.load(),null);
  assert.equal(store.save(recordFor()),false);
  assert.equal(store.clear(),false);
});

test('提交內容凍結後不因輸入物件變動產生另一筆請求',()=>{
  const input={...payload,participantIds:[...payload.participantIds]};
  const record=recordFor(input);
  input.title='另一餐';input.participantIds.push('第三位');
  const retry=JSON.parse(pendingExpenseRequestOptions(record).body);
  assert.equal(retry.title,'晚餐');
  assert.deepEqual(retry.participantIds,['安安','小明']);
});

test('識別碼保留期限前可重試，期限後停止新增以免形成重複帳目',()=>{
  const now=100000000000;
  assert.equal(canRetryPendingExpense(recordFor(payload,{now}),now+1000),true);
  assert.equal(canRetryPendingExpense(recordFor(payload,{now}),now+29*24*60*60*1000),false);
});

test('修改結果核對完整輸入，允許伺服器隨機分配均分尾差',()=>{
  const record=recordFor(payload,{method:'PATCH',expenseId:'expense-1'});
  const latest=savedExpense();
  assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[latest]}),'applied');
  assert.equal(pendingExpenseRequestOptions(record).headers,undefined);
  latest.currencyMeta.inputShares.reverse();
  assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[latest]}),'applied');
  latest.expenseDate='2026-09-30';
  assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[latest]}),'changed');
});

test('修改尚未套用與他人改動有不同核對結果',()=>{
  const original=savedExpense(),changedPayload={...payload,title:'晚餐補記'};
  const record=recordFor(changedPayload,{method:'PATCH',expenseId:'expense-1',initialSnapshot:expenseSavedSnapshot(original,'TWD')});
  assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[original]}),'unchanged');
  assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[{...original,title:'其他人修改'}]}),'changed');
  assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[]}),'changed');
  assert.equal(reconcileExpenseSubmission(record,{}),'unknown');
});

test('外幣退款、多人付款及特殊分攤必須核對原幣金額與規則',()=>{
  for(const split of [{splitMode:'exact',shares:[{userId:'安安',amount:'1.25'},{userId:'小明',amount:'2.75'}]},
    {splitMode:'hybrid',fixedShares:[{userId:'安安',amount:'1.25'}]},
    {splitMode:'weights',weights:[{userId:'安安',weight:'1'},{userId:'小明',weight:'3'}]}]){
    const input={...payload,...split,kind:'refund',amount:'4.00',expenseCurrency:'USD',exchangeRate:'31.050000000000000',payers:[{userId:'安安',amount:'3.00'},{userId:'小明',amount:'1.00'}]};
    const latest=savedExpense(input),record=recordFor(input,{method:'PATCH',expenseId:'expense-1'});
    assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[latest]}),'applied');
    latest.currencyMeta.inputPayments[0].amountCents-=100;
    assert.equal(reconcileExpenseSubmission(record,{currency:'TWD',expenses:[latest]}),'changed');
  }
});

test('未取得有效成功回應或伺服器錯誤不能宣稱未儲存',async()=>{
  for(const status of [408,500,503]){
    await assert.rejects(requestExpenseJson('/支出',{}, {fetchImpl:async()=>({ok:false,status,json:async()=>({error:'暫時無法回應'})})}),error=>isUncertainExpenseError(error));
  }
  await assert.rejects(requestExpenseJson('/支出',{}, {fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw new Error('回應不完整')}})}),error=>isUncertainExpenseError(error));
  await assert.rejects(requestExpenseJson('/支出',{}, {fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:'金額不符'})})}),error=>!isUncertainExpenseError(error)&&error.message==='金額不符');
});

test('逾時會中止等待並保留結果未知狀態',async()=>{
  await assert.rejects(requestExpenseJson('/支出',{}, {timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('等候逾時'))))}),error=>isUncertainExpenseError(error));
});
