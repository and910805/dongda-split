import {decimalToFraction,parseCurrencyAmount} from '../currency.mjs';
import {createExpenseRequestOptions,expenseSubmissionFingerprint} from './expense-idempotency.mjs';

const sortedRows=rows=>(rows||[]).map(row=>({userId:String(row.userId),amountCents:Number(row.amountCents)})).sort((left,right)=>left.userId.localeCompare(right.userId));
const normalizedRate=value=>{
  const {numerator,denominator}=decimalToFraction(value);
  const scale=10n**15n,rounded=(numerator*scale+denominator/2n)/denominator;
  const fraction=String(rounded%scale).padStart(15,'0').replace(/0+$/u,'');
  return fraction?`${rounded/scale}.${fraction}`:String(rounded/scale);
};
const normalizedSplit=(mode,meta={})=>{
  if(mode==='exact')return {shares:(meta.shares||[]).map(row=>({userId:String(row.userId),amount:Number(row.amount)})).sort((left,right)=>left.userId.localeCompare(right.userId))};
  if(mode==='weights')return {weights:(meta.weights||[]).map(row=>({userId:String(row.userId),weight:Number(row.weight)})).sort((left,right)=>left.userId.localeCompare(right.userId))};
  const result={participantIds:(meta.participantIds||[]).map(String).sort()};
  if(mode==='hybrid')result.fixedShares=(meta.fixedShares||[]).map(row=>({userId:String(row.userId),amount:Number(row.amount)})).sort((left,right)=>left.userId.localeCompare(right.userId));
  return result;
};

export function expenseSavedSnapshot(expense,ledgerCurrency){
  if(!expense)return null;
  const meta=expense.currencyMeta||{};
  return {
    title:String(expense.title||'').trim(),category:expense.category||'其他',
    expenseDate:String(expense.expenseDate||'').slice(0,10),splitMode:expense.splitMode||'equal',
    inputCurrency:meta.inputCurrency||ledgerCurrency,ledgerCurrency,
    inputAmountCents:Number(meta.inputAmountCents??expense.amountCents),
    payments:sortedRows(meta.inputPayments||expense.payments),shares:sortedRows(meta.inputShares||expense.shares),
    split:normalizedSplit(expense.splitMode||'equal',meta.inputSplitMeta||expense.splitMeta),
    rate:normalizedRate(meta.rate||'1'),
  };
}

export function expenseSubmittedSnapshot(payload){
  const currency=payload.expenseCurrency||payload.currency;
  const sign=payload.kind==='refund'?-1:1;
  const cents=value=>sign*Math.abs(parseCurrencyAmount(value,currency,{allowZero:false,allowNegative:false}));
  const amountCents=cents(payload.amount),mode=payload.splitMode||'equal';
  const payments=Array.isArray(payload.payers)?payload.payers.map(row=>({userId:String(row.userId),amountCents:cents(row.amount)})):[{userId:String(payload.payerId),amountCents}];
  return {
    title:String(payload.title||'').trim(),category:payload.category||'其他',expenseDate:payload.expenseDate,
    splitMode:mode,inputCurrency:currency,ledgerCurrency:payload.currency,inputAmountCents:amountCents,
    payments:sortedRows(payments),
    split:normalizedSplit(mode,payload),rate:normalizedRate(payload.exchangeRate||'1'),
  };
}

export function reconcileExpenseSubmission(record,latestGroup){
  if(!latestGroup||!Array.isArray(latestGroup.expenses))return 'unknown';
  const latest=latestGroup.expenses.find(item=>String(item.id)===String(record.expenseId));
  if(!latest)return 'changed';
  try{
    const snapshot=expenseSavedSnapshot(latest,latestGroup.currency);
    const fingerprint=expenseSubmissionFingerprint(snapshot);
    // 均分尾差由伺服器分配，確認原幣輸入與分攤規則，不假設尾差會落在某位成員
    const {shares,...inputSnapshot}=snapshot;
    if(expenseSubmissionFingerprint(inputSnapshot)===expenseSubmissionFingerprint(expenseSubmittedSnapshot(record.payload)))return 'applied';
    if(fingerprint===expenseSubmissionFingerprint(record.initialSnapshot))return 'unchanged';
    return 'changed';
  }catch{return 'unknown'}
}

export function createPendingExpenseSubmission({method,payload,keyStore,expenseId=null,initialSnapshot=null,form={},now=Date.now()}){
  const options=createExpenseRequestOptions({method,payload,keyStore});
  return {version:1,method:options.method,payload:JSON.parse(options.body),key:options.headers?.['Idempotency-Key']||null,expenseId,initialSnapshot,form,createdAt:now};
}

export function pendingExpenseRequestOptions(record){
  return {method:record.method,body:JSON.stringify(record.payload),...(record.method==='POST'?{headers:{'Idempotency-Key':record.key}}:{})};
}

export function canRetryPendingExpense(record,now=Date.now()){
  // 保留期限小於伺服器的 30 天，避免舊分頁重送已過期的新增識別碼
  return Number.isFinite(record?.createdAt)&&now-record.createdAt>=0&&now-record.createdAt<29*24*60*60*1000;
}

export function createExpensePendingStore({userId,groupId,expenseId=null,storage}={}){
  const key=`trip-tap:pending-expense:${userId}:${groupId}:${expenseId||'new'}`;
  const target=()=>storage===undefined?globalThis.sessionStorage:storage;
  return {
    load(){
      try{
        const value=JSON.parse(target()?.getItem(key)||'null');
        if(value?.version!==1||!['POST','PATCH'].includes(value.method)||!value.payload||typeof value.payload!=='object'||!value.form||typeof value.form!=='object')return null;
        if(value.method==='POST'&&(typeof value.key!=='string'||value.key.length<8||value.key.length>128))return null;
        if(String(value.expenseId||'new')!==String(expenseId||'new'))return null;
        return value;
      }catch{return null}
    },
    save(record){try{target()?.setItem(key,JSON.stringify(record));return Boolean(target())}catch{return false}},
    clear(){try{target()?.removeItem(key);return true}catch{return false}},
  };
}

export function isUncertainExpenseError(error){
  return !error?.status||error.status===408||error.status>=500;
}

export async function requestExpenseJson(url,options={}, {fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{...options,signal:controller.signal,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(data?.error||'伺服器未接受這次儲存');
      error.status=response.status;error.data=data;throw error;
    }
    if(!data||typeof data!=='object')throw new Error('尚未收到可確認的儲存結果');
    return data;
  }finally{clearTimeout(timer)}
}
