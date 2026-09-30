import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {allocateByWeights,allocateEqual,allocateHybrid} from '../finance.mjs';
import {amountCentsToInputValue,isSupportedCurrency,parseCurrencyAmount} from '../currency.mjs';
import {convertExpenseInputToLedger,normalizeExpenseRate} from '../expense-currency.mjs';
import {resolveExpenseDate} from '../expense-date.mjs';

const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const section=(start,end)=>{
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`找不到路由測試所需程式區段 ${start}`);
  return source.slice(from,to);
};
const ownerId='11111111-1111-4111-8111-111111111111';
const groupId='22222222-2222-4222-8222-222222222222';
const body={title:'補記晚餐',amount:'100',currency:'TWD',payerId:ownerId,participantIds:[ownerId],splitMode:'equal'};

// 執行正式路由與金額解析，僅以記憶體查詢器取代資料庫，避免連到正式資料
function createHarness(){
  const routes=new Map(),expenses=new Map(),idempotency=new Map();
  const group={id:groupId,name:'日期測試帳本',currency:'TWD',owner_id:ownerId,ledgerVersion:'0'};
  let now=new Date('2026-09-30T15:59:59Z'),locked=false;
  const client={
    release(){},
    async query(sql,params=[]){
      if(sql.includes('FROM groups WHERE'))return{rows:[group]};
      if(sql.includes('FROM group_members gm'))return{rows:[{id:ownerId,is_virtual:false,isCurrentUser:true}]};
      if(sql.includes('FROM users WHERE'))return{rows:[{isSuperuser:false}]};
      if(sql.includes('FROM expense_idempotency_keys')){
        const row=idempotency.get(params.join('|'));
        return{rows:row?[{...row,expenseExists:expenses.has(row.expenseId)}]:[]};
      }
      if(sql.startsWith('INSERT INTO expense_idempotency_keys')){
        idempotency.set(params.slice(0,4).join('|'),{requestFingerprint:params[4],expenseId:params[5]});
        return{rows:[]};
      }
      if(sql.startsWith('INSERT INTO expenses(')){
        const columns=sql.match(/INSERT INTO expenses\(([^)]+)\)/)[1].split(',').map(value=>value.trim());
        const row=Object.fromEntries(columns.map((column,index)=>[column,params[index]]));
        row.id=crypto.randomUUID();
        row.created_at=now.toISOString();
        expenses.set(row.id,row);
        return{rows:[{id:row.id}]};
      }
      if(sql.includes('FROM expenses WHERE id=')){
        const row=expenses.get(params[0]);
        return{rows:row?[{...row,expenseDate:row.expense_date}]:[]};
      }
      if(sql.startsWith('UPDATE expenses SET')){
        const idIndex=Number(sql.match(/WHERE id=\$(\d+)/)[1])-1;
        const row=expenses.get(params[idIndex]);
        for(const [,column,index] of sql.slice(0,sql.indexOf(' WHERE')).matchAll(/(\w+)=\$(\d+)/g))row[column]=params[Number(index)-1];
        return{rows:[]};
      }
      if(/^(BEGIN|COMMIT|ROLLBACK|INSERT INTO expense_payments|INSERT INTO expense_shares|DELETE FROM expense_payments|DELETE FROM expense_shares)/.test(sql))return{rows:[]};
      throw new Error(`測試未處理查詢 ${sql}`);
    }
  };
  const capture=method=>(path,...handlers)=>routes.set(`${method} ${path}`,handlers.at(-1));
  const context=vm.createContext({
    app:{post:capture('POST'),patch:capture('PATCH')},pool:{connect:async()=>client},
    asyncRoute:handler=>handler,requireUser(){},requireGroupUuid(){},requireExpenseUuids(){},
    UUID_PATTERN:/^[0-9a-f-]{36}$/i,IDEMPOTENCY_KEY_PATTERN:/^[A-Za-z0-9._:-]{8,128}$/,
    crypto,allocateByWeights,allocateEqual,allocateHybrid,amountCentsToInputValue,isSupportedCurrency,parseCurrencyAmount,
    convertExpenseInputToLedger,normalizeExpenseRate,
    resolveExpenseDate:(value,options)=>resolveExpenseDate(value,{...options,now}),
    canReadGroup:async()=>true,isExpenseSettlementLocked:async()=>locked,
    assertGroupExpenseTotalSafe:async()=>{},writeAudit:async()=>{},invalidateSettlementPlan:async()=>{group.ledgerVersion=String(BigInt(group.ledgerVersion)+1n)},
    safeLedgerNumber:value=>Number(value)
  });
  vm.runInContext([
    section('const IDEMPOTENCY_PAYLOAD_MAX_DEPTH=','async function writeAudit('),
    section('async function findExpenseIdempotency(','const BALANCE_SQL='),
    section("app.post('/api/groups/:id/expenses',","app.delete('/api/groups/:id/expenses/:expenseId',"),
    section("app.post('/api/groups/:id/expenses-v1',","app.post('/api/groups/:id/settlements-v1',")
  ].join('\n'),context);
  return{
    expenses,
    getLedgerVersion(){return group.ledgerVersion},
    setNow(value){now=new Date(value)},
    setLocked(value){locked=value},
    async request({method='POST',payload=body,expenseId,key,legacy=false,userId=ownerId}={}){
      const response={statusCode:200,body:null,status(code){this.statusCode=code;return this},json(value){this.body=value;return this},set(){return this}};
      const route=method==='PATCH'?'/api/groups/:id/expenses/:expenseId':legacy?'/api/groups/:id/expenses-v1':'/api/groups/:id/expenses';
      await routes.get(`${method} ${route}`)({body:payload,params:{id:groupId,expenseId},userId,get:()=>key},response);
      return response;
    }
  };
}

test('新增 API 保存合法消費日，拒絕不存在的曆日且不建立支出',async()=>{
  for(const legacy of [false,true]){
    const api=createHarness();
    const valid=await api.request({payload:{...body,expenseDate:'2024-02-29'},legacy});
    assert.equal(valid.statusCode,201);
    assert.equal(api.expenses.get(valid.body.id).expense_date,'2024-02-29');
    for(const expenseDate of ['2026-02-29','2026-04-31',null,'']){
      const result=await api.request({payload:{...body,expenseDate},legacy});
      assert.equal(result.statusCode,400);
      assert.match(result.body.error,/消費日期/);
    }
    assert.equal(api.expenses.size,1);
  }
});

test('修改 API 省略日期保留原值，明確補記會更新消費日而不更動建立時間',async()=>{
  const api=createHarness();
  const created=await api.request({payload:{...body,expenseDate:'2026-09-29'}});
  const expenseId=created.body.id,createdAt=api.expenses.get(expenseId).created_at;
  api.setNow('2026-10-01T10:00:00Z');
  const unchanged=await api.request({method:'PATCH',expenseId,payload:{...body,title:'更新晚餐名稱'}});
  assert.equal(unchanged.statusCode,200);
  assert.equal(api.expenses.get(expenseId).expense_date,'2026-09-29');
  const updated=await api.request({method:'PATCH',expenseId,payload:{...body,expenseDate:'2026-09-28'}});
  assert.equal(updated.statusCode,200);
  assert.equal(api.expenses.get(expenseId).expense_date,'2026-09-28');
  assert.equal(api.expenses.get(expenseId).created_at,createdAt);
  const invalid=await api.request({method:'PATCH',expenseId,payload:{...body,expenseDate:'2026-02-29'}});
  assert.equal(invalid.statusCode,400);
  assert.equal(api.expenses.get(expenseId).expense_date,'2026-09-28');
  api.setLocked(true);
  const locked=await api.request({method:'PATCH',expenseId,payload:{...body,expenseDate:'2026-01-01'}});
  assert.equal(locked.statusCode,409);
  assert.equal(locked.body.code,'EXPENSE_SETTLEMENT_LOCKED');
});

test('新增 API 跨台北午夜重試沿用既有支出，改日期重用同一識別碼則拒絕',async()=>{
  for(const legacy of [false,true]){
    const api=createHarness();
    const first=await api.request({key:'date-regression-legacy',legacy});
    assert.equal(first.statusCode,201);
    assert.equal(api.expenses.get(first.body.id).expense_date,'2026-09-30');
    api.setNow('2026-09-30T16:00:00Z');
    const retry=await api.request({key:'date-regression-legacy',legacy});
    assert.equal(retry.statusCode,200);
    assert.equal(retry.body.id,first.body.id);
    assert.equal(retry.body.alreadyApplied,true);
    assert.equal(api.expenses.size,1);
    assert.equal(api.expenses.get(first.body.id).expense_date,'2026-09-30');
    const next=await api.request({key:'date-regression-next',legacy});
    assert.equal(api.expenses.get(next.body.id).expense_date,'2026-10-01');
    const dated=await api.request({payload:{...body,expenseDate:'2026-09-29'},key:'date-regression-explicit',legacy});
    assert.equal(dated.statusCode,201);
    const conflict=await api.request({payload:{...body,expenseDate:'2026-09-28'},key:'date-regression-explicit',legacy});
    assert.equal(conflict.statusCode,409);
    assert.equal(conflict.body.code,'IDEMPOTENCY_KEY_REUSED');
    assert.equal(api.expenses.size,3);
  }
});

test('修改 API 在交易內拒絕過期帳本版本，避免核對後重試覆蓋其他修改',async()=>{
  const api=createHarness();
  const created=await api.request({payload:{...body,expenseDate:'2026-09-29'}});
  const expenseId=created.body.id,checkedVersion=api.getLedgerVersion();
  const competing=await api.request({method:'PATCH',expenseId,payload:{...body,title:'其他人修正的晚餐',ledgerVersion:checkedVersion}});
  assert.equal(competing.statusCode,200);
  const staleRetry=await api.request({method:'PATCH',expenseId,payload:{...body,title:'舊分頁重試的晚餐',ledgerVersion:checkedVersion}});
  assert.equal(staleRetry.statusCode,409);
  assert.equal(staleRetry.body.code,'LEDGER_VERSION_CHANGED');
  assert.equal(api.expenses.get(expenseId).title,'其他人修正的晚餐');
  const refreshed=await api.request({method:'PATCH',expenseId,payload:{...body,title:'核對後的新修改',ledgerVersion:api.getLedgerVersion()}});
  assert.equal(refreshed.statusCode,200);
  assert.equal(api.expenses.get(expenseId).title,'核對後的新修改');
});

test('其他分頁切換帳號後不可用原提交識別碼重建支出或覆寫修改',async()=>{
  const otherUserId='33333333-3333-4333-8333-333333333333';
  for(const legacy of [false,true]){
    const api=createHarness();
    const payload={...body,expenseDate:'2026-09-29',expectedUserId:ownerId};
    const key='account-switch-regression';
    const created=await api.request({payload,key,legacy});
    assert.equal(created.statusCode,201);
    const switched=await api.request({payload,key,legacy,userId:otherUserId});
    assert.equal(switched.statusCode,409);
    assert.equal(switched.body.code,'ACCOUNT_CHANGED');
    assert.equal(api.expenses.size,1);
    const restored=await api.request({payload,key,legacy});
    assert.equal(restored.statusCode,200);
    assert.equal(restored.body.id,created.body.id);
    const switchedEdit=await api.request({method:'PATCH',expenseId:created.body.id,payload:{...payload,title:'其他登入帳號的重試'},userId:otherUserId});
    assert.equal(switchedEdit.statusCode,409);
    assert.equal(switchedEdit.body.code,'ACCOUNT_CHANGED');
    assert.equal(api.expenses.get(created.body.id).title,body.title);
  }
});
