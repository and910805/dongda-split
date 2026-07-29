import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pg from 'pg';
import {allocateByWeights,allocateEqual,allocateHybrid,minimizeSettlements} from './finance.mjs';
import {
  SUPPORTED_CURRENCIES,
  allocateLargestRemainder,
  amountCentsToInputValue,
  convertAmountCents,
  convertAmountCentsDetailed,
  getCurrency,
  isSupportedCurrency,
  parseCurrencyAmount
} from './currency.mjs';
import {
  createExchangeRateScheduler,
  createExchangeRateService,
  ExchangeRateUnavailableError,
  exchangeRateInternals
} from './exchange-rates.mjs';
import {buildCurrencyConversionPlan} from './group-currency-conversion.mjs';
import {convertExpenseInputToLedger,normalizeExpenseRate} from './expense-currency.mjs';
import {
  LedgerIntegerSafetyError,
  assertGroupExpenseAbsoluteTotalSafe,
  postgresBigIntToSafeNumber
} from './ledger-integer-safety.mjs';
// bank-account.mjs is required at runtime and must be copied into the production image.
import {createBankAccountCipher,normalizeBankAccount} from './bank-account.mjs';
import {normalizeSimulatedAccountInput} from './account-simulation.mjs';

const {Pool}=pg;
const app=express();
const DATABASE_MIGRATION_LOCK_KEY=1_915_240_816;
const LEGACY_TWD_SHARE_MIGRATION='2026-07-28-legacy-twd-share-rounding';
const LEDGER_SAFE_INTEGER_MIGRATION='2026-07-28-ledger-safe-integer-plan-reset';
const PORT=Number(process.env.PORT||8080);
const APP_URL=(process.env.APP_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const isProduction=process.env.NODE_ENV==='production';
if(isProduction&&!process.env.SESSION_SECRET)throw new Error('SESSION_SECRET is required in production');
const SESSION_SECRET=process.env.SESSION_SECRET||'development-only-change-me';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:false}:false});
const exchangeRateService=createExchangeRateService({pool});
const exchangeRateScheduler=createExchangeRateScheduler({service:exchangeRateService});
const bankAccountCipher=createBankAccountCipher({
  keyBase64:process.env.BANK_ACCOUNT_ENCRYPTION_KEY,
  fallbackSecret:process.env.SESSION_SECRET||(isProduction?undefined:'development-only-bank-account')
});
const __dirname=path.dirname(fileURLToPath(import.meta.url));

app.set('trust proxy',1);
app.use(helmet({
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      baseUri:["'self'"],
      connectSrc:["'self'"],
      fontSrc:["'self'",'https://fonts.gstatic.com','data:'],
      formAction:["'self'"],
      frameAncestors:["'none'"],
      imgSrc:["'self'",'data:','https:'],
      objectSrc:["'none'"],
      scriptSrc:["'self'"],
      scriptSrcAttr:["'none'"],
      styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],
      upgradeInsecureRequests:isProduction?[]:null
    }
  },
  crossOriginResourcePolicy:{policy:'cross-origin'}
}));
app.use(express.json({limit:'64kb'}));
app.use(cookieParser());

const cookieOptions={httpOnly:true,secure:isProduction,sameSite:'lax',path:'/',maxAge:1000*60*60*24*14};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(value){const body=encode(value);const sig=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest('base64url');return `${body}.${sig}`}
function unsign(token,{ignoreExpiry=false}={}){try{const [body,sig]=String(token||'').split('.');if(!body||!sig)return null;const expected=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest();const actual=Buffer.from(sig,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;const data=JSON.parse(Buffer.from(body,'base64url').toString());if(!ignoreExpiry&&data.exp&&Date.now()>data.exp)return null;return data}catch{return null}}
function safeReturnTo(value){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')?value:'/app'}
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
function attachSignedSession(req,res){
  const session=unsign(req.cookies.dongda_session);
  if(!session?.userId){res.status(401).json({error:'請先使用 LINE 登入'});return false}
  req.userId=session.userId;
  req.session=session;
  return true;
}
function requireSignedUser(req,res,next){if(attachSignedSession(req,res))next()}
const requireUser=asyncRoute(async(req,res,next)=>{
  if(!attachSignedSession(req,res))return;
  const hasSimulationClaims=Boolean(req.session.impersonatorId||req.session.simulationSessionId);
  if(!hasSimulationClaims)return next();
  const actorId=String(req.session.impersonatorId||'');
  const simulationSessionId=String(req.session.simulationSessionId||'');
  if(!UUID_PATTERN.test(actorId)||!UUID_PATTERN.test(simulationSessionId)){
    res.clearCookie('dongda_session',{path:'/'});
    return res.status(401).json({error:'帳戶模擬工作階段已失效，請重新登入'});
  }
  const {rows:[simulation]}=await pool.query(`SELECT session.id,session.actor_id AS "actorId",session.subject_id AS "subjectId",
    actor.display_name AS "actorDisplayName",actor.picture_url AS "actorPictureUrl",subject.display_name AS "subjectDisplayName"
    FROM account_simulation_sessions session
    JOIN users actor ON actor.id=session.actor_id
    JOIN users subject ON subject.id=session.subject_id
    WHERE session.id=$1 AND session.actor_id=$2 AND session.subject_id=$3
      AND session.ended_at IS NULL AND session.expires_at>now()
      AND actor.is_superuser=true AND actor.is_virtual=false AND actor.is_simulated=false
      AND subject.is_virtual=false AND subject.is_simulated=true`,
    [simulationSessionId,actorId,req.userId]);
  if(!simulation){
    res.clearCookie('dongda_session',{path:'/'});
    return res.status(401).json({error:'帳戶模擬已結束或管理權限已失效'});
  }
  req.simulationSession=simulation;
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    res.once('finish',()=>{
      if(res.statusCode<200||res.statusCode>=400||req.auditRecorded)return;
      const route=String(req.route?.path||req.path||'').replace(/[?#].*$/,'').slice(0,160);
      pool.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
        VALUES($1,'simulation_action','simulation_session',$2,$3::jsonb)`,
        [simulation.actorId,simulation.id,JSON.stringify({displayName:simulation.subjectDisplayName,subjectId:req.userId,method:req.method,route,statusCode:res.statusCode})])
        .catch(error=>console.error('Failed to audit simulation action',error));
    });
  }
  next();
});
async function isSuperuser(userId){const {rows:[user]}=await pool.query('SELECT is_superuser FROM users WHERE id=$1',[userId]);return Boolean(user?.is_superuser)}
const requireSuperuser=asyncRoute(async(req,res,next)=>{if(!await isSuperuser(req.userId))return res.status(403).json({error:'此功能僅限管理者'});next()});
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN=/^[A-Za-z0-9._:-]{8,128}$/;
const requireUuidParams=(...names)=>(req,res,next)=>{
  if(names.every(name=>UUID_PATTERN.test(String(req.params[name]||''))))return next();
  return res.status(400).json({code:'INVALID_UUID',error:'資料識別碼格式不正確'});
};
const requireGroupUuid=requireUuidParams('id');
const requireExpenseUuids=requireUuidParams('id','expenseId');
const requireSettlementUuids=requireUuidParams('id','settlementId');
const requireFromUserUuids=requireUuidParams('id','fromUserId');
const requireToUserUuids=requireUuidParams('id','toUserId');
const IDEMPOTENCY_PAYLOAD_MAX_DEPTH=32;
function assertIdempotencyPayloadComplexity(value){
  const stack=[{value,depth:0}];
  while(stack.length){
    const current=stack.pop();
    if(current.depth>IDEMPOTENCY_PAYLOAD_MAX_DEPTH){
      const error=new Error(`Idempotency-Key 請求內容最多允許 ${IDEMPOTENCY_PAYLOAD_MAX_DEPTH} 層`);
      error.status=400;
      error.code='IDEMPOTENCY_PAYLOAD_TOO_COMPLEX';
      error.expose=true;
      throw error;
    }
    if(!current.value||typeof current.value!=='object')continue;
    const children=Array.isArray(current.value)?current.value:Object.values(current.value);
    for(const child of children)stack.push({value:child,depth:current.depth+1});
  }
}
function stableJson(value){
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object'){
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function readIdempotencyRequest(req,operation){
  const header=req.get('Idempotency-Key');
  if(header===undefined)return null;
  const key=String(header).trim();
  if(!IDEMPOTENCY_KEY_PATTERN.test(key)){
    const error=new Error('Idempotency-Key 格式不正確');
    error.status=400;
    error.code='INVALID_IDEMPOTENCY_KEY';
    error.expose=true;
    throw error;
  }
  assertIdempotencyPayloadComplexity(req.body??null);
  return{
    key,
    operation,
    fingerprint:crypto.createHash('sha256').update(`${operation}\n${stableJson(req.body??null)}`).digest('hex')
  };
}
const amountCentsAsInputNumber=(amountCents,currency)=>Number(amountCentsToInputValue(Math.abs(amountCents),currency));
function splitMetaFromResolved(mode,participantIds,currency,{shares=[],fixedShares=[],weights=[]}={}){
  if(mode==='exact')return{shares:shares.map(item=>({userId:String(item.userId),amount:amountCentsAsInputNumber(item.shareCents,currency)}))};
  if(mode==='hybrid')return{participantIds,fixedShares:fixedShares.map(item=>({userId:String(item.userId),amount:amountCentsAsInputNumber(item.shareCents,currency)}))};
  if(mode==='weights')return{weights:weights.map(item=>({userId:String(item.userId),weight:Number(item.weight)}))};
  return{participantIds};
}
function resolveExpenseInput(body,currency,allowed){
  const title=String(body?.title||'').trim();
  if(!title||title.length>100)throw new Error('項目名稱需為 1–100 字');
  const parsedAmount=parseCurrencyAmount(body?.amount,currency,{allowNegative:true,allowZero:false});
  const sign=body?.kind==='refund'||parsedAmount<0?-1:1;
  const amountCents=sign*Math.abs(parsedAmount);
  const participantIds=[...new Set(Array.isArray(body?.participantIds)?body.participantIds.map(String):[])];
  const parseSignedPart=(value,label)=>{
    try{return sign*Math.abs(parseCurrencyAmount(value,currency,{allowNegative:false,allowZero:false}))}
    catch(error){throw new Error(`${label}：${error.message}`)}
  };

  let payments=[];
  if(Array.isArray(body?.payers)){
    const seen=new Set();
    for(const item of body.payers){
      const userId=String(item?.userId||'');
      if(!allowed.has(userId)||seen.has(userId))throw new Error('共同付款成員不正確');
      seen.add(userId);
      payments.push({userId,paymentCents:parseSignedPart(item?.amount,'共同付款金額')});
    }
  }else{
    const userId=String(body?.payerId||'');
    if(!allowed.has(userId))throw new Error('付款人不在群組中');
    payments=[{userId,paymentCents:amountCents}];
  }
  if(!payments.length||payments.reduce((sum,item)=>sum+item.paymentCents,0)!==amountCents){
    throw new Error('多人付款加總必須等於總額');
  }

  const requestedMode=String(body?.splitMode||'');
  const mode=requestedMode|| (Array.isArray(body?.shares)?'exact':'equal');
  if(!['equal','exact','hybrid','weights'].includes(mode))throw new Error('不支援的分攤方式');
  let shares=[];
  let fixedShares=[];
  let weights=[];
  if(mode==='exact'){
    const seen=new Set();
    shares=(body?.shares||[]).map(item=>{
      const userId=String(item?.userId||'');
      if(!allowed.has(userId)||seen.has(userId))throw new Error('自訂分攤成員不正確');
      seen.add(userId);
      return{userId,shareCents:parseSignedPart(item?.amount,'自訂分攤金額')};
    });
    if(!shares.length||shares.reduce((sum,item)=>sum+item.shareCents,0)!==amountCents)throw new Error('每人金額加總必須等於支出總額');
  }else if(mode==='weights'){
    weights=(body?.weights||[]).map(item=>({userId:String(item?.userId||''),weight:item?.weight}));
    if(!weights.length||weights.some(item=>!allowed.has(item.userId)))throw new Error('比例分攤成員不正確');
    shares=allocateByWeights(amountCents,weights,{currency});
  }else if(mode==='hybrid'){
    if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))throw new Error('指定成員不正確');
    fixedShares=(body?.fixedShares||[]).map(item=>({
      userId:String(item?.userId||''),
      shareCents:parseSignedPart(item?.amount,'指定分攤金額')
    }));
    shares=allocateHybrid(amountCents,participantIds,fixedShares,{currency});
  }else{
    if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))throw new Error('請選擇有效的分攤成員');
    shares=allocateEqual(amountCents,participantIds,{currency});
  }
  const category=String(body?.category||'其他').slice(0,20);
  const splitMeta=splitMetaFromResolved(mode,participantIds,currency,{shares,fixedShares,weights});
  return{title,amountCents,participantIds,payments,shares,mode,splitMeta,category};
}
function hasExpectedCurrencyMismatch(body,currentCurrency){
  const expected=String(body?.currency??'TWD').trim().toUpperCase();
  return expected!==String(currentCurrency||'TWD').toUpperCase();
}
async function resolveExpenseLedgerInput(body,group,allowed,userId){
  const sourceCurrency=String(body?.expenseCurrency||group.currency||'TWD').trim().toUpperCase();
  if(!isSupportedCurrency(sourceCurrency))throw new Error('不支援這個支出幣別');
  const sourceInput=resolveExpenseInput(body,sourceCurrency,allowed);
  if(sourceCurrency===group.currency){
    return convertExpenseInputToLedger({
      input:sourceInput,
      sourceCurrency,
      targetCurrency:group.currency,
      rate:'1'
    });
  }

  const rateMode=body?.exchangeRateMode==='manual'?'manual':'quoted';
  let rate,rateDate=null,rateSource='member';
  if(rateMode==='manual'){
    rate=normalizeExpenseRate(body?.exchangeRate);
  }else{
    const quote=unsign(body?.exchangeRateToken);
    if(!quote||quote.kind!=='expense-exchange-rate'
      ||String(quote.actorId)!==String(userId)
      ||String(quote.groupId)!==String(group.id)
      ||quote.sourceCurrency!==sourceCurrency
      ||quote.targetCurrency!==group.currency){
      const error=new Error('匯率預覽已過期，請重新取得匯率');
      error.code='EXPENSE_RATE_EXPIRED';
      throw error;
    }
    rate={
      rate:quote.rate,
      ratioNumerator:quote.ratioNumerator,
      ratioDenominator:quote.ratioDenominator
    };
    rateDate=quote.rateDate;
    rateSource=quote.source||'exchange-api';
  }
  return convertExpenseInputToLedger({
    input:sourceInput,
    sourceCurrency,
    targetCurrency:group.currency,
    rate,
    rateDate,
    rateSource,
    rateMode
  });
}
async function writeAudit(client,req,{action,targetType,targetId,metadata={}}){
  const simulation=req.simulationSession;
  const actorId=simulation?.actorId||req.userId;
  const auditMetadata=simulation
    ?{...metadata,actedAsId:req.userId,actedAsName:simulation.subjectDisplayName}
    :metadata;
  await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
    VALUES($1,$2,$3,$4,$5::jsonb)`,
  [actorId,action,targetType,String(targetId),JSON.stringify(auditMetadata)]);
  req.auditRecorded=true;
}

async function migrate(){
  const client=await pool.connect();
  let locked=false;
  try{
    await client.query('SELECT pg_advisory_lock($1)',[DATABASE_MIGRATION_LOCK_KEY]);
    locked=true;
    await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      line_user_id TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      picture_url TEXT,
      is_virtual BOOLEAN NOT NULL DEFAULT false,
      is_superuser BOOLEAN NOT NULL DEFAULT false,
      is_simulated BOOLEAN NOT NULL DEFAULT false,
      simulated_note TEXT NOT NULL DEFAULT '',
      simulated_created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
      description TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'TWD',
      invite_token TEXT UNIQUE NOT NULL,
      owner_id UUID NOT NULL REFERENCES users(id),
      settlement_plan_ready BOOLEAN NOT NULL DEFAULT false,
      ledger_version BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS settlement_plan_ready BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS ledger_version BIGINT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS group_members (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(group_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
      amount_cents BIGINT NOT NULL CHECK (amount_cents<>0),
      payer_id UUID NOT NULL REFERENCES users(id),
      created_by UUID NOT NULL REFERENCES users(id),
      category TEXT NOT NULL DEFAULT '其他',
      split_mode TEXT NOT NULL DEFAULT 'equal',
      split_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      currency_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS expense_shares (
      expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL CHECK (amount_cents<>0),
      PRIMARY KEY(expense_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS expense_payments (
      expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL CHECK (amount_cents<>0),
      PRIMARY KEY(expense_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS expense_idempotency_keys (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
      request_fingerprint TEXT NOT NULL CHECK (char_length(request_fingerprint)=64),
      expense_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(group_id,actor_id,operation,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS settlement_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user_id UUID NOT NULL REFERENCES users(id),
      to_user_id UUID NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL CHECK (amount_cents>0),
      reported_currency TEXT NOT NULL DEFAULT 'TWD',
      reported_amount_cents BIGINT NOT NULL CHECK (reported_amount_cents>0),
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by UUID REFERENCES users(id),
      CHECK (from_user_id<>to_user_id),
      CONSTRAINT settlement_payments_void_consistency_check CHECK (
        (voided_at IS NULL AND voided_by IS NULL)
        OR
        (voided_at IS NOT NULL AND voided_by IS NOT NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS settlement_plan_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user_id UUID NOT NULL REFERENCES users(id),
      to_user_id UUID NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL CHECK (amount_cents>0),
      sort_order INTEGER NOT NULL CHECK (sort_order>=0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (from_user_id<>to_user_id)
    );
    CREATE TABLE IF NOT EXISTS user_bank_accounts (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ciphertext BYTEA NOT NULL,
      iv BYTEA NOT NULL CHECK (octet_length(iv)=12),
      auth_tag BYTEA NOT NULL CHECK (octet_length(auth_tag)=16),
      key_version SMALLINT NOT NULL DEFAULT 1,
      share_version UUID NOT NULL DEFAULT gen_random_uuid(),
      account_last4 TEXT NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE user_bank_accounts ADD COLUMN IF NOT EXISTS share_version UUID NOT NULL DEFAULT gen_random_uuid();
    CREATE TABLE IF NOT EXISTS bank_account_access_grants (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id UUID NOT NULL REFERENCES user_bank_accounts(user_id) ON DELETE CASCADE,
      bank_account_version UUID NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(group_id,from_user_id,to_user_id),
      CHECK (from_user_id<>to_user_id)
    );
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id UUID NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS exchange_rates (
      rate_date DATE NOT NULL,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate NUMERIC(30,15) NOT NULL CHECK (rate>0),
      provider TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(rate_date,base_currency,quote_currency)
    );
    CREATE TABLE IF NOT EXISTS exchange_rate_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','success','failed','skipped_locked')),
      provider TEXT,
      endpoint TEXT,
      source_url TEXT,
      rate_date DATE,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS group_currency_conversions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL,
      group_name TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate NUMERIC(40,20) NOT NULL CHECK (rate>0),
      rate_numerator NUMERIC(78,0) NOT NULL CHECK (rate_numerator>0),
      rate_denominator NUMERIC(78,0) NOT NULL CHECK (rate_denominator>0),
      rate_date DATE NOT NULL,
      source TEXT NOT NULL,
      source_decimals SMALLINT NOT NULL CHECK (source_decimals BETWEEN 0 AND 6),
      target_decimals SMALLINT NOT NULL CHECK (target_decimals BETWEEN 0 AND 6),
      preview_token_id UUID NOT NULL,
      actor_id UUID NOT NULL REFERENCES users(id),
      rounding_delta_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(group_id,preview_token_id)
    );
    CREATE TABLE IF NOT EXISTS group_currency_conversion_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversion_id UUID NOT NULL REFERENCES group_currency_conversions(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      record_key TEXT NOT NULL,
      before_currency TEXT NOT NULL,
      before_amount_cents BIGINT NOT NULL,
      after_currency TEXT NOT NULL,
      after_amount_cents BIGINT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(conversion_id,entity_type,record_key)
    );
    ALTER TABLE group_currency_conversions ADD COLUMN IF NOT EXISTS group_name TEXT;
    UPDATE group_currency_conversions conversion
      SET group_name=COALESCE(NULLIF(conversion.group_name,''),ledger.name,'已刪除群組')
      FROM groups ledger
      WHERE ledger.id=conversion.group_id
        AND (conversion.group_name IS NULL OR conversion.group_name='');
    UPDATE group_currency_conversions
      SET group_name='已刪除群組'
      WHERE group_name IS NULL OR group_name='';
    ALTER TABLE group_currency_conversions ALTER COLUMN group_name SET NOT NULL;
    ALTER TABLE group_currency_conversions
      DROP CONSTRAINT IF EXISTS group_currency_conversions_group_id_fkey;
    CREATE TABLE IF NOT EXISTS account_simulation_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      CHECK (actor_id<>subject_id)
    );
    ALTER TABLE settlement_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
    ALTER TABLE settlement_payments ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);
    ALTER TABLE settlement_payments ADD COLUMN IF NOT EXISTS reported_currency TEXT;
    ALTER TABLE settlement_payments ADD COLUMN IF NOT EXISTS reported_amount_cents BIGINT;
    UPDATE settlement_payments payment
      SET reported_currency=COALESCE(payment.reported_currency,ledger.currency),
          reported_amount_cents=COALESCE(payment.reported_amount_cents,payment.amount_cents)
      FROM groups ledger
      WHERE ledger.id=payment.group_id
        AND (payment.reported_currency IS NULL OR payment.reported_amount_cents IS NULL);
    ALTER TABLE settlement_payments ALTER COLUMN reported_currency SET DEFAULT 'TWD';
    ALTER TABLE settlement_payments ALTER COLUMN reported_currency SET NOT NULL;
    ALTER TABLE settlement_payments ALTER COLUMN reported_amount_cents SET NOT NULL;
    CREATE INDEX IF NOT EXISTS expenses_group_created_idx ON expenses(group_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS expenses_group_created_id_idx ON expenses(group_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS expense_idempotency_keys_created_idx ON expense_idempotency_keys(created_at);
    DELETE FROM expense_idempotency_keys
      WHERE created_at<now()-INTERVAL '30 days';
    CREATE INDEX IF NOT EXISTS settlement_payments_group_created_id_idx ON settlement_payments(group_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS settlement_plan_items_group_order_idx ON settlement_plan_items(group_id,sort_order,id);
    CREATE INDEX IF NOT EXISTS bank_account_access_grants_to_idx ON bank_account_access_grants(to_user_id);
    CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS exchange_rates_latest_idx ON exchange_rates(base_currency,rate_date DESC,quote_currency);
    CREATE INDEX IF NOT EXISTS exchange_rate_sync_runs_started_idx ON exchange_rate_sync_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS group_currency_conversions_group_idx ON group_currency_conversions(group_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS account_simulation_sessions_actor_idx ON account_simulation_sessions(actor_id,started_at DESC);
    CREATE INDEX IF NOT EXISTS account_simulation_sessions_active_idx ON account_simulation_sessions(subject_id,expires_at) WHERE ended_at IS NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS simulated_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS simulated_created_by UUID REFERENCES users(id) ON DELETE RESTRICT;
    UPDATE users simulated
      SET simulated_created_by=(
        SELECT log.actor_id
        FROM admin_audit_log log
        WHERE log.action='create_simulated_account'
          AND log.target_type='simulated_account'
          AND log.target_id=simulated.id::text
        ORDER BY log.created_at DESC
        LIMIT 1
      )
      WHERE simulated.is_simulated=true
        AND simulated.simulated_created_by IS NULL
        AND EXISTS(
          SELECT 1 FROM admin_audit_log log
          WHERE log.action='create_simulated_account'
            AND log.target_type='simulated_account'
            AND log.target_id=simulated.id::text
        );
    DO $$ BEGIN
      IF NOT EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='users_simulated_created_by_fkey'
          AND conrelid='users'::regclass
          AND contype='f'
          AND confdeltype IN ('a','r')
      ) THEN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_simulated_created_by_fkey;
        ALTER TABLE users ADD CONSTRAINT users_simulated_created_by_fkey
          FOREIGN KEY(simulated_created_by) REFERENCES users(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='users_account_type_check' AND conrelid='users'::regclass) THEN
        ALTER TABLE users ADD CONSTRAINT users_account_type_check CHECK (NOT (is_virtual AND is_simulated));
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='users_simulated_role_check' AND conrelid='users'::regclass) THEN
        ALTER TABLE users ADD CONSTRAINT users_simulated_role_check CHECK (NOT (is_simulated AND is_superuser));
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='users_simulated_creator_check' AND conrelid='users'::regclass) THEN
        ALTER TABLE users ADD CONSTRAINT users_simulated_creator_check CHECK (NOT is_simulated OR simulated_created_by IS NOT NULL);
      END IF;
    END $$;
    DROP INDEX IF EXISTS users_simulated_name_unique_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS users_simulated_creator_name_unique_idx ON users(simulated_created_by,lower(display_name)) WHERE is_simulated=true;
    UPDATE account_simulation_sessions
      SET ended_at=expires_at
      WHERE ended_at IS NULL AND expires_at<=now();
    DELETE FROM account_simulation_sessions
      WHERE COALESCE(ended_at,expires_at)<now()-INTERVAL '90 days';
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'equal';
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
    DO $$ BEGIN
      IF NOT EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='groups_currency_check' AND conrelid='groups'::regclass
      ) THEN
        ALTER TABLE groups ADD CONSTRAINT groups_currency_check CHECK (currency IN ('TWD','JPY','KRW','USD','CNY','THB'));
      END IF;
      IF EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='expenses_amount_cents_check'
          AND conrelid='expenses'::regclass
          AND pg_get_constraintdef(oid) NOT LIKE '%<> 0%'
      ) THEN
        ALTER TABLE expenses DROP CONSTRAINT expenses_amount_cents_check;
        ALTER TABLE expenses ADD CONSTRAINT expenses_amount_cents_check CHECK (amount_cents<>0);
      END IF;
      IF EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='expense_shares_amount_cents_check'
          AND conrelid='expense_shares'::regclass
          AND pg_get_constraintdef(oid) NOT LIKE '%<> 0%'
      ) THEN
        ALTER TABLE expense_shares DROP CONSTRAINT expense_shares_amount_cents_check;
        ALTER TABLE expense_shares ADD CONSTRAINT expense_shares_amount_cents_check CHECK (amount_cents<>0);
      END IF;
    END $$;
    INSERT INTO expense_payments(expense_id,user_id,amount_cents)
      SELECT id,payer_id,amount_cents FROM expenses ON CONFLICT DO NOTHING;
    DO $legacy_twd_share_migration$
    BEGIN
      IF NOT EXISTS(
        SELECT 1 FROM schema_migrations
        WHERE migration_key='${LEGACY_TWD_SHARE_MIGRATION}'
      ) THEN
        WITH ranked_shares AS (
          SELECT es.expense_id,es.user_id,SIGN(es.amount_cents)::bigint AS direction,
                 (ABS(es.amount_cents)/100)::bigint AS base_units,
                 ROW_NUMBER() OVER(PARTITION BY es.expense_id ORDER BY ABS(es.amount_cents)%100 DESC,es.user_id) AS unit_rank,
                 ((ABS(e.amount_cents)/100)-SUM(ABS(es.amount_cents)/100) OVER(PARTITION BY es.expense_id))::bigint AS extra_units
          FROM expense_shares es
          JOIN expenses e ON e.id=es.expense_id
          JOIN groups g ON g.id=e.group_id
          WHERE g.currency='TWD'
            AND e.amount_cents%100=0
            AND EXISTS(
              SELECT 1 FROM expense_shares fractional
              WHERE fractional.expense_id=es.expense_id
                AND fractional.amount_cents%100<>0
            )
        )
        UPDATE expense_shares es
          SET amount_cents=ranked.direction
            *(ranked.base_units+CASE WHEN ranked.unit_rank<=ranked.extra_units THEN 1 ELSE 0 END)
            *100
          FROM ranked_shares ranked
          WHERE es.expense_id=ranked.expense_id
            AND es.user_id=ranked.user_id;

        INSERT INTO schema_migrations(migration_key)
        VALUES('${LEGACY_TWD_SHARE_MIGRATION}');
      END IF;
    END
    $legacy_twd_share_migration$;
    UPDATE expenses expense
      SET currency_meta=JSONB_BUILD_OBJECT(
        'inputCurrency',ledger.currency,
        'inputAmountCents',expense.amount_cents,
        'inputPayments',COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'userId',payment.user_id,
            'amountCents',payment.amount_cents
          ) ORDER BY payment.user_id)
          FROM expense_payments payment
          WHERE payment.expense_id=expense.id
        ),'[]'::jsonb),
        'inputShares',COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'userId',share.user_id,
            'amountCents',share.amount_cents
          ) ORDER BY share.user_id)
          FROM expense_shares share
          WHERE share.expense_id=expense.id
        ),'[]'::jsonb),
        'inputSplitMeta',expense.split_meta,
        'ledgerCurrency',ledger.currency,
        'rate','1',
        'ratioNumerator','1',
        'ratioDenominator','1',
        'rateDate',NULL,
        'rateSource','legacy',
        'rateMode','identity'
      )
      FROM groups ledger
      WHERE expense.group_id=ledger.id
        AND (expense.currency_meta='{}'::jsonb OR NOT (expense.currency_meta ? 'inputCurrency'));
    DO $ledger_safe_integer_migration$
    BEGIN
      IF NOT EXISTS(
        SELECT 1 FROM schema_migrations
        WHERE migration_key='${LEDGER_SAFE_INTEGER_MIGRATION}'
      ) THEN
        DELETE FROM settlement_plan_items;
        UPDATE groups SET settlement_plan_ready=false;
        INSERT INTO schema_migrations(migration_key)
        VALUES('${LEDGER_SAFE_INTEGER_MIGRATION}');
      END IF;
    END
    $ledger_safe_integer_migration$;
    DO $$ BEGIN
      ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_whole_twd_check;
      ALTER TABLE expense_payments DROP CONSTRAINT IF EXISTS expense_payments_whole_twd_check;
      ALTER TABLE expense_shares DROP CONSTRAINT IF EXISTS expense_shares_whole_twd_check;
      ALTER TABLE settlement_payments DROP CONSTRAINT IF EXISTS settlement_payments_whole_twd_check;
      ALTER TABLE settlement_plan_items DROP CONSTRAINT IF EXISTS settlement_plan_items_amount_cents_check;
      IF NOT EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='settlement_plan_items_positive_amount_check'
          AND conrelid='settlement_plan_items'::regclass
      ) THEN
        ALTER TABLE settlement_plan_items ADD CONSTRAINT settlement_plan_items_positive_amount_check CHECK (amount_cents>0);
      END IF;
      IF NOT EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='settlement_payments_reported_amount_check'
          AND conrelid='settlement_payments'::regclass
      ) THEN
        ALTER TABLE settlement_payments ADD CONSTRAINT settlement_payments_reported_amount_check CHECK (reported_amount_cents>0);
      END IF;
      IF NOT EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='settlement_payments_void_consistency_check'
          AND conrelid='settlement_payments'::regclass
      ) THEN
        ALTER TABLE settlement_payments ADD CONSTRAINT settlement_payments_void_consistency_check CHECK (
          (voided_at IS NULL AND voided_by IS NULL)
          OR
          (voided_at IS NOT NULL AND voided_by IS NOT NULL)
        );
      END IF;
    END $$;
    `);
  }finally{
    if(locked){
      try{await client.query('SELECT pg_advisory_unlock($1)',[DATABASE_MIGRATION_LOCK_KEY])}catch{}
    }
    client.release();
  }
}

app.get('/api/health',asyncRoute(async(_req,res)=>{
  await pool.query('SELECT 1');
  let exchangeRates;
  try{exchangeRates=await exchangeRateService.getHealth()}
  catch(error){exchangeRates={status:'missing',available:false,stale:true,blocked:true,warning:'暫時無法讀取匯率狀態',error:error.message}}
  res.json({ok:true,exchangeRates});
}));
app.get('/api/currencies',asyncRoute(async(_req,res)=>{
  let exchangeRates;
  try{exchangeRates=await exchangeRateService.getHealth()}
  catch{exchangeRates={status:'missing',available:false,stale:true,blocked:true,warning:'暫時無法讀取匯率狀態'}}
  res.json({
    currencies:SUPPORTED_CURRENCIES.map(code=>{
      const currency=getCurrency(code);
      return{code:currency.code,name:currency.name,symbol:currency.symbol,decimals:currency.decimals,step:currency.step};
    }),
    exchangeRates
  });
}));
app.post('/api/groups/:id/expense-rate',requireUser,asyncRoute(async(req,res)=>{
  if(!UUID_PATTERN.test(req.params.id))return res.status(400).json({error:'群組資料格式不正確'});
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const sourceCurrency=String(req.body?.sourceCurrency||'').trim().toUpperCase();
  if(!isSupportedCurrency(sourceCurrency))return res.status(400).json({error:'不支援這個支出幣別'});
  const {rows:[group]}=await pool.query('SELECT id,currency FROM groups WHERE id=$1',[req.params.id]);
  if(!group)return res.status(404).json({error:'找不到群組'});
  if(sourceCurrency===group.currency){
    return res.json({
      sourceCurrency,
      targetCurrency:group.currency,
      rate:'1',
      ratioNumerator:'1',
      ratioDenominator:'1',
      rateDate:null,
      source:'identity',
      exchangeRateToken:null,
      expiresAt:null
    });
  }
  let quote;
  try{
    quote=await exchangeRateService.getConversionQuote({
      sourceCurrency,
      targetCurrency:group.currency
    });
  }catch(error){
    if(error instanceof ExchangeRateUnavailableError||error.code==='EXCHANGE_RATE_UNAVAILABLE'){
      return res.status(503).json({code:'EXCHANGE_RATE_UNAVAILABLE',error:error.message});
    }
    throw error;
  }
  if(quote.health?.blocked){
    return res.status(503).json({
      code:'EXCHANGE_RATE_STALE',
      error:quote.health.warning||'匯率資料過期，請改用自訂匯率',
      exchangeRateHealth:quote.health
    });
  }
  const expiresAt=Date.now()+10*60*1000;
  const exchangeRateToken=sign({
    kind:'expense-exchange-rate',
    actorId:req.userId,
    groupId:group.id,
    sourceCurrency,
    targetCurrency:group.currency,
    rate:quote.rate,
    ratioNumerator:quote.ratioNumerator,
    ratioDenominator:quote.ratioDenominator,
    rateDate:quote.rateDate,
    source:quote.source,
    exp:expiresAt
  });
  res.json({
    ...quote,
    exchangeRateToken,
    expiresAt:new Date(expiresAt).toISOString()
  });
}));
app.get('/api/auth/line',(req,res)=>{
  if(!process.env.LINE_CHANNEL_ID||!process.env.LINE_CHANNEL_SECRET){
    const message=String(req.query.lang||'').toLowerCase().startsWith('en')
      ?'LINE Login is not configured'
      :'LINE Login 尚未設定';
    return res.status(503).send(message);
  }
  const state=crypto.randomBytes(24).toString('base64url');
  const nonce=crypto.randomBytes(24).toString('base64url');
  const returnTo=safeReturnTo(req.query.returnTo);
  res.cookie('dongda_oauth',sign({state,nonce,returnTo,exp:Date.now()+10*60*1000}),{...cookieOptions,maxAge:10*60*1000});
  const params=new URLSearchParams({response_type:'code',client_id:process.env.LINE_CHANNEL_ID,redirect_uri:`${APP_URL}/api/auth/line/callback`,state,scope:'openid profile',nonce});
  res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
});
app.get('/api/auth/line/callback',asyncRoute(async(req,res)=>{
  const oauth=unsign(req.cookies.dongda_oauth);
  res.clearCookie('dongda_oauth',{path:'/'});
  if(!oauth||req.query.state!==oauth.state||!req.query.code)return res.redirect('/?login=failed');
  const tokenBody=new URLSearchParams({grant_type:'authorization_code',code:String(req.query.code),redirect_uri:`${APP_URL}/api/auth/line/callback`,client_id:process.env.LINE_CHANNEL_ID,client_secret:process.env.LINE_CHANNEL_SECRET});
  const tokenResponse=await fetch('https://api.line.me/oauth2/v2.1/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:tokenBody});
  if(!tokenResponse.ok)throw new Error(`LINE token exchange failed: ${tokenResponse.status}`);
  const token=await tokenResponse.json();
  const verifyBody=new URLSearchParams({id_token:token.id_token,client_id:process.env.LINE_CHANNEL_ID,nonce:oauth.nonce});
  const verifyResponse=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:verifyBody});
  if(!verifyResponse.ok)throw new Error(`LINE ID token verification failed: ${verifyResponse.status}`);
  const profile=await verifyResponse.json();
  const {rows:[user]}=await pool.query(`INSERT INTO users(line_user_id,display_name,picture_url) VALUES($1,$2,$3)
    ON CONFLICT(line_user_id) DO UPDATE SET display_name=excluded.display_name,picture_url=excluded.picture_url,updated_at=now()
    RETURNING id,display_name,picture_url`,[profile.sub,profile.name||'LINE 使用者',profile.picture||null]);
  res.cookie('dongda_session',sign({userId:user.id,exp:Date.now()+14*24*60*60*1000}),cookieOptions);
  res.redirect(oauth.returnTo);
}));
app.post('/api/auth/logout',(_req,res)=>{res.clearCookie('dongda_session',{path:'/'});res.json({ok:true})});
app.get('/api/me',requireUser,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const {rows:[user]}=await pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_superuser AS "isSuperuser",u.is_simulated AS "isSimulated",
    (ba.user_id IS NOT NULL) AS "bankAccountConfigured",ba.account_last4 AS "bankAccountLast4",ba.updated_at AS "bankAccountUpdatedAt"
    FROM users u LEFT JOIN user_bank_accounts ba ON ba.user_id=u.id WHERE u.id=$1`,[req.userId]);
  if(!user)return res.status(404).json({error:'找不到使用者'});
  const {bankAccountConfigured,bankAccountLast4,bankAccountUpdatedAt,...profile}=user;
  let simulation=null;
  if(user.isSimulated&&req.simulationSession){
    simulation={active:true,actor:{
      id:req.simulationSession.actorId,
      displayName:req.simulationSession.actorDisplayName,
      pictureUrl:req.simulationSession.actorPictureUrl
    }};
  }
  res.json({...profile,simulation,bankAccount:{configured:bankAccountConfigured,last4:bankAccountLast4||null,updatedAt:bankAccountUpdatedAt||null}});
}));
app.get('/api/me/bank-account',requireUser,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const {rows:[row]}=await pool.query(`SELECT ciphertext,iv,auth_tag AS "authTag",key_version AS "keyVersion",updated_at AS "updatedAt"
    FROM user_bank_accounts WHERE user_id=$1`,[req.userId]);
  if(!row)return res.json({bankAccount:null});
  const bankAccount=bankAccountCipher.decrypt(req.userId,row);
  res.json({bankAccount:{...bankAccount,updatedAt:row.updatedAt}});
}));
app.put('/api/me/bank-account',requireUser,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  let bankAccount;
  try{bankAccount=normalizeBankAccount(req.body)}catch(error){return res.status(400).json({error:error.message})}
  const encrypted=bankAccountCipher.encrypt(req.userId,bankAccount);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[saved]}=await client.query(`INSERT INTO user_bank_accounts(user_id,ciphertext,iv,auth_tag,key_version,share_version,account_last4)
      VALUES($1,$2,$3,$4,$5,gen_random_uuid(),$6)
      ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,key_version=excluded.key_version,share_version=gen_random_uuid(),account_last4=excluded.account_last4,updated_at=now()
      RETURNING account_last4 AS "last4",updated_at AS "updatedAt"`,
      [req.userId,encrypted.ciphertext,encrypted.iv,encrypted.authTag,encrypted.keyVersion,bankAccount.accountNumber.slice(-4)]);
    await client.query('DELETE FROM bank_account_access_grants WHERE to_user_id=$1',[req.userId]);
    await client.query('COMMIT');
    res.json({bankAccount:{configured:true,...saved}});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.delete('/api/me/bank-account',requireUser,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  await pool.query('DELETE FROM user_bank_accounts WHERE user_id=$1',[req.userId]);
  res.json({ok:true,bankAccount:{configured:false,last4:null,updatedAt:null}});
}));

if(!isProduction){app.post('/api/dev-login',asyncRoute(async(req,res)=>{const name=String(req.body?.name||'本機小羅').slice(0,40);const lineId=`dev-${name}`;const {rows}=await pool.query(`INSERT INTO users(line_user_id,display_name,picture_url) VALUES($1,$2,$3) ON CONFLICT(line_user_id) DO UPDATE SET display_name=excluded.display_name RETURNING id`,[lineId,name,'/xiaoluo-avatar.png']);res.cookie('dongda_session',sign({userId:rows[0].id,exp:Date.now()+14*86400000}),cookieOptions);res.json({ok:true})}))}

app.get('/api/admin/overview',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  const [statsResult,usersResult,groupsResult,auditResult,simulatedResult]=await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM users WHERE is_virtual=false AND is_simulated=false) AS "userCount",
      (SELECT COUNT(*)::int FROM users WHERE is_superuser=true AND is_virtual=false AND is_simulated=false) AS "superuserCount",
      (SELECT COUNT(*)::int FROM users WHERE is_virtual=false AND is_simulated=true) AS "simulatedAccountCount",
      (SELECT COUNT(*)::int FROM groups) AS "groupCount",
      (SELECT COUNT(*)::int FROM expenses) AS "expenseCount"`),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_superuser AS "isSuperuser",u.created_at AS "createdAt",COUNT(gm.group_id)::int AS "groupCount"
      FROM users u LEFT JOIN group_members gm ON gm.user_id=u.id
      WHERE u.is_virtual=false AND u.is_simulated=false
      GROUP BY u.id
      ORDER BY u.is_superuser DESC,u.created_at DESC
      LIMIT 200`),
    pool.query(`SELECT g.id,g.name,g.description,g.currency,g.created_at AS "createdAt",owner.display_name AS "ownerName",
      members.member_count AS "memberCount",expenses.expense_count AS "expenseCount",expenses.total_cents::bigint::text AS "totalCents"
      FROM groups g
      JOIN users owner ON owner.id=g.owner_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER(WHERE u.is_virtual=false)::int AS member_count
        FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=g.id
      ) members ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS expense_count,COALESCE(SUM(amount_cents),0)::bigint AS total_cents
        FROM expenses e WHERE e.group_id=g.id
      ) expenses ON true
      ORDER BY g.created_at DESC
      LIMIT 200`),
    pool.query(`SELECT log.id,log.action,log.target_type AS "targetType",log.target_id AS "targetId",log.metadata,log.created_at AS "createdAt",
      actor.id AS "actorId",actor.display_name AS "actorName",actor.picture_url AS "actorPictureUrl"
      FROM admin_audit_log log JOIN users actor ON actor.id=log.actor_id
      ORDER BY log.created_at DESC LIMIT 200`),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_simulated AS "isSimulated",u.simulated_note AS "note",u.created_at AS "createdAt",
      creator.display_name AS "createdByName",COUNT(gm.group_id)::int AS "groupCount"
      FROM users u
      LEFT JOIN users creator ON creator.id=u.simulated_created_by
      LEFT JOIN group_members gm ON gm.user_id=u.id
      WHERE u.is_virtual=false AND u.is_simulated=true
      GROUP BY u.id,creator.display_name
      ORDER BY u.created_at DESC
      LIMIT 100`)
  ]);
  res.json({
    stats:statsResult.rows[0],
    users:usersResult.rows,
    groups:groupsResult.rows.map(group=>({...group,totalCents:safeLedgerNumber(group.totalCents,'群組支出合計')})),
    auditLog:auditResult.rows,
    simulatedAccounts:simulatedResult.rows
  });
}));

app.post('/api/admin/exchange-rates/sync',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  const result=await exchangeRateService.sync({reason:`admin:${req.userId}`});
  const health=await exchangeRateService.getHealth();
  await pool.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
    VALUES($1,'sync_exchange_rates','exchange_rates',$2,$3::jsonb)`,
  [req.userId,health.rateDate||'missing',JSON.stringify({
    provider:health.provider,
    rateDate:health.rateDate,
    skipped:Boolean(result.skipped)
  })]);
  res.json({ok:true,skipped:Boolean(result.skipped),exchangeRates:health});
}));

app.post('/api/admin/simulated-accounts',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  let account;
  try{account=normalizeSimulatedAccountInput(req.body)}catch(error){return res.status(400).json({error:error.message})}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[existing]}=await client.query('SELECT id FROM users WHERE is_simulated=true AND simulated_created_by=$1 AND lower(display_name)=lower($2)',[req.userId,account.displayName]);
    if(existing){await client.query('ROLLBACK');return res.status(409).json({error:'已經有同名的模擬帳號'})}
    const {rows:[created]}=await client.query(`INSERT INTO users(line_user_id,display_name,is_simulated,simulated_note,simulated_created_by)
      VALUES($1,$2,true,$3,$4)
      RETURNING id,display_name AS "displayName",picture_url AS "pictureUrl",simulated_note AS "note",created_at AS "createdAt"`,
      [`simulated-${crypto.randomUUID()}`,account.displayName,account.note,req.userId]);
    await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
      VALUES($1,'create_simulated_account','simulated_account',$2,$3::jsonb)`,
      [req.userId,created.id,JSON.stringify({displayName:created.displayName,note:account.note})]);
    await client.query('COMMIT');
    res.status(201).json({...created,isSimulated:true,createdByName:null,groupCount:0});
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23505')return res.status(409).json({error:'已經有同名的模擬帳號'});
    throw error;
  }finally{client.release()}
}));

app.post('/api/admin/simulated-accounts/:id/session',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  const targetId=String(req.params.id||'');
  if(!UUID_PATTERN.test(targetId))return res.status(400).json({error:'模擬帳號格式不正確'});
  const sessionExpiresAt=Number.isFinite(Number(req.session.exp))&&Number(req.session.exp)>Date.now()
    ?Number(req.session.exp)
    :Date.now()+cookieOptions.maxAge;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[actor]}=await client.query(`SELECT id FROM users
      WHERE id=$1 AND is_superuser=true AND is_virtual=false AND is_simulated=false
      FOR UPDATE`,[req.userId]);
    if(!actor){await client.query('ROLLBACK');return res.status(403).json({error:'此功能僅限管理者'})}
    const {rows:[target]}=await client.query(`SELECT id,display_name AS "displayName"
      FROM users WHERE id=$1 AND is_virtual=false AND is_simulated=true AND simulated_created_by IS NOT NULL`,[targetId]);
    if(!target){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這個模擬帳號'})}
    await client.query(`UPDATE account_simulation_sessions SET ended_at=now()
      WHERE actor_id=$1 AND ended_at IS NULL`,[req.userId]);
    const {rows:[simulation]}=await client.query(`INSERT INTO account_simulation_sessions(actor_id,subject_id,expires_at)
      VALUES($1,$2,$3) RETURNING id`,[req.userId,target.id,new Date(sessionExpiresAt)]);
    await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
      VALUES($1,'start_account_simulation','simulated_account',$2,$3::jsonb)`,
      [req.userId,target.id,JSON.stringify({displayName:target.displayName,simulationSessionId:simulation.id})]);
    await client.query('COMMIT');
    res.cookie('dongda_session',sign({
      userId:target.id,
      impersonatorId:req.userId,
      simulationSessionId:simulation.id,
      exp:sessionExpiresAt
    }),cookieOptions);
    res.json({ok:true,account:target});
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release()}
}));

app.post('/api/admin/simulation/exit',requireSignedUser,asyncRoute(async(req,res)=>{
  const actorId=String(req.session?.impersonatorId||'');
  const simulationSessionId=String(req.session?.simulationSessionId||'');
  if(!UUID_PATTERN.test(actorId)||!UUID_PATTERN.test(simulationSessionId))return res.status(400).json({error:'目前沒有啟用帳戶模擬'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[simulation]}=await client.query(`SELECT session.id,actor.id AS "actorId",subject.id AS "subjectId",
      subject.display_name AS "subjectDisplayName"
      FROM account_simulation_sessions session
      JOIN users actor ON actor.id=session.actor_id
      JOIN users subject ON subject.id=session.subject_id
      WHERE session.id=$1 AND session.actor_id=$2 AND session.subject_id=$3
        AND session.ended_at IS NULL
        AND actor.is_virtual=false AND actor.is_simulated=false
        AND subject.is_virtual=false AND subject.is_simulated=true
      FOR UPDATE OF session`,[simulationSessionId,actorId,req.userId]);
    if(!simulation){
      await client.query('ROLLBACK');
      res.clearCookie('dongda_session',{path:'/'});
      return res.status(400).json({error:'模擬工作階段已失效，請重新登入'});
    }
    await client.query('UPDATE account_simulation_sessions SET ended_at=now() WHERE id=$1',[simulation.id]);
    await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
      VALUES($1,'end_account_simulation','simulated_account',$2,$3::jsonb)`,
      [simulation.actorId,simulation.subjectId,JSON.stringify({displayName:simulation.subjectDisplayName,simulationSessionId:simulation.id})]);
    await client.query('COMMIT');
    res.cookie('dongda_session',sign({userId:simulation.actorId,exp:req.session.exp}),cookieOptions);
    res.json({ok:true});
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release()}
}));

app.patch('/api/admin/users/:id/superuser',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  const targetId=String(req.params.id||'');
  const nextValue=req.body?.isSuperuser;
  if(!UUID_PATTERN.test(targetId)||typeof nextValue!=='boolean')return res.status(400).json({error:'權限設定格式不正確'});
  if(targetId===req.userId&&!nextValue)return res.status(400).json({error:'不能移除自己的管理者權限'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const {rows:[target]}=await client.query('SELECT id,display_name,is_virtual,is_simulated,is_superuser FROM users WHERE id=$1',[targetId]);
    if(!target){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這位使用者'})}
    if(target.is_virtual||target.is_simulated){await client.query('ROLLBACK');return res.status(400).json({error:'公費或模擬帳號不能設為管理者'})}
    if(target.is_superuser&&!nextValue){
      const {rows:[count]}=await client.query('SELECT COUNT(*)::int AS total FROM users WHERE is_superuser=true AND is_virtual=false AND is_simulated=false');
      if(count.total<=1){await client.query('ROLLBACK');return res.status(400).json({error:'系統至少需要保留一位管理者'})}
    }
    const {rows:[updated]}=await client.query('UPDATE users SET is_superuser=$1,updated_at=now() WHERE id=$2 RETURNING id,display_name AS "displayName",is_superuser AS "isSuperuser"',[nextValue,targetId]);
    await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
      VALUES($1,$2,'user',$3,$4::jsonb)`,[req.userId,nextValue?'grant_superuser':'revoke_superuser',targetId,JSON.stringify({displayName:target.display_name})]);
    await client.query('COMMIT');
    res.json(updated);
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));

app.get('/api/groups',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query(`SELECT g.id,g.name,g.description,g.currency,g.invite_token AS "inviteToken",COUNT(gm2.user_id) FILTER(WHERE COALESCE(u2.is_virtual,false)=false)::int AS "memberCount" FROM groups g JOIN group_members mine ON mine.group_id=g.id AND mine.user_id=$1 LEFT JOIN group_members gm2 ON gm2.group_id=g.id LEFT JOIN users u2 ON u2.id=gm2.user_id GROUP BY g.id ORDER BY g.created_at DESC`,[req.userId]);res.json(rows)}));
app.post('/api/groups',requireUser,asyncRoute(async(req,res)=>{
  if(typeof req.body?.name!=='string')return res.status(400).json({code:'INVALID_GROUP_NAME_TYPE',error:'群組名稱必須是文字'});
  if(req.body?.description!==undefined&&typeof req.body.description!=='string')return res.status(400).json({code:'INVALID_GROUP_DESCRIPTION_TYPE',error:'群組說明必須是文字'});
  if(req.body?.currency!==undefined&&typeof req.body.currency!=='string')return res.status(400).json({code:'INVALID_GROUP_CURRENCY_TYPE',error:'帳本幣別格式不正確'});
  const name=req.body.name.trim();
  const description=(req.body.description||'').trim().slice(0,200);
  const currency=(req.body.currency||'TWD').trim().toUpperCase();
  if(!name||name.length>60)return res.status(400).json({error:'群組名稱需為 1–60 字'});
  if(!isSupportedCurrency(currency))return res.status(400).json({error:'不支援這個帳本幣別'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const token=crypto.randomBytes(18).toString('base64url');
    const {rows}=await client.query('INSERT INTO groups(name,description,currency,invite_token,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,currency,invite_token AS "inviteToken"',[name,description,currency,token,req.userId]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[rows[0].id,req.userId]);
    await writeAudit(client,req,{
      action:'create_group',
      targetType:'group',
      targetId:rows[0].id,
      metadata:{groupId:rows[0].id,groupName:name,itemType:'群組',itemName:name,currency}
    });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/invites/:token/join',requireUser,asyncRoute(async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query(`SELECT g.id,g.name,owner.is_simulated AS "ownerIsSimulated",owner.simulated_created_by AS "ownerSimulationCreator",
      joining.display_name AS "joiningName",joining.is_simulated AS "joiningIsSimulated",joining.simulated_created_by AS "joiningSimulationCreator"
      FROM groups g JOIN users owner ON owner.id=g.owner_id JOIN users joining ON joining.id=$2
      WHERE g.invite_token=$1`,[req.params.token,req.userId]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'邀請連結無效'})}
    if(group.ownerIsSimulated||group.joiningIsSimulated){
      const sameSimulationOwner=group.ownerIsSimulated&&group.joiningIsSimulated&&
        group.ownerSimulationCreator&&group.joiningSimulationCreator&&
        String(group.ownerSimulationCreator||'')===String(group.joiningSimulationCreator||'');
      if(!sameSimulationOwner){await client.query('ROLLBACK');return res.status(403).json({error:'模擬帳號只能加入同一位管理者建立的測試群組'})}
    }
    const {rows:[membership]}=await client.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',[group.id,req.userId]);
    if(membership)await writeAudit(client,req,{
      action:'join_group',
      targetType:'member',
      targetId:req.userId,
      metadata:{groupId:group.id,groupName:group.name,itemType:'成員',itemName:group.joiningName}
    });
    await client.query('COMMIT');
    res.json({groupId:group.id});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));

async function assertMember(groupId,userId){const {rows}=await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[groupId,userId]);return Boolean(rows[0])}
async function canReadGroup(groupId,userId){return await assertMember(groupId,userId)||await isSuperuser(userId)}
const safeLedgerNumber=(value,label)=>postgresBigIntToSafeNumber(value,{label});
async function assertGroupExpenseTotalSafe(queryable,groupId){
  const {rows}=await queryable.query(`SELECT amount_cents::bigint::text AS "amountCents"
    FROM expenses WHERE group_id=$1 ORDER BY created_at,id`,[groupId]);
  return assertGroupExpenseAbsoluteTotalSafe(rows,{label:'群組支出總額'});
}
async function findExpenseIdempotency(queryable,groupId,actorId,{operation,key}){
  const {rows:[record]}=await queryable.query(`SELECT expense_id AS "expenseId",
    request_fingerprint AS "requestFingerprint",
    EXISTS(
      SELECT 1 FROM expenses expense
      WHERE expense.id=expense_idempotency_keys.expense_id
        AND expense.group_id=expense_idempotency_keys.group_id
    ) AS "expenseExists"
    FROM expense_idempotency_keys
    WHERE group_id=$1 AND actor_id=$2 AND operation=$3 AND idempotency_key=$4`,
  [groupId,actorId,operation,key]);
  return record||null;
}
async function saveExpenseIdempotency(queryable,groupId,actorId,idempotency,expenseId){
  if(!idempotency)return;
  await queryable.query(`INSERT INTO expense_idempotency_keys(
    group_id,actor_id,operation,idempotency_key,request_fingerprint,expense_id
  ) VALUES($1,$2,$3,$4,$5,$6)`,
  [groupId,actorId,idempotency.operation,idempotency.key,idempotency.fingerprint,expenseId]);
}
const BALANCE_SQL=`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role,(COALESCE(p.paid,0)-COALESCE(o.owed,0)+COALESCE(sout.sent,0)-COALESCE(sin.received,0))::bigint::text AS "balanceCents" FROM group_members gm JOIN users u ON u.id=gm.user_id LEFT JOIN (SELECT ep.user_id,SUM(ep.amount_cents) paid FROM expense_payments ep JOIN expenses e ON e.id=ep.expense_id WHERE e.group_id=$1 GROUP BY ep.user_id)p ON p.user_id=u.id LEFT JOIN (SELECT es.user_id,SUM(es.amount_cents) owed FROM expense_shares es JOIN expenses e ON e.id=es.expense_id WHERE e.group_id=$1 GROUP BY es.user_id)o ON o.user_id=u.id LEFT JOIN (SELECT from_user_id,SUM(amount_cents) sent FROM settlement_payments WHERE group_id=$1 AND voided_at IS NULL GROUP BY from_user_id)sout ON sout.from_user_id=u.id LEFT JOIN (SELECT to_user_id,SUM(amount_cents) received FROM settlement_payments WHERE group_id=$1 AND voided_at IS NULL GROUP BY to_user_id)sin ON sin.to_user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.joined_at`;
const SETTLEMENT_PLAN_SQL=`SELECT item.id,item.amount_cents::bigint::text AS "amountCents",item.sort_order AS "sortOrder",
  JSONB_BUILD_OBJECT('id',fu.id,'displayName',fu.display_name,'pictureUrl',fu.picture_url,'isFund',fu.is_virtual) AS "from",
  JSONB_BUILD_OBJECT('id',tu.id,'displayName',tu.display_name,'pictureUrl',tu.picture_url,'isFund',tu.is_virtual) AS "to"
  FROM settlement_plan_items item
  JOIN users fu ON fu.id=item.from_user_id
  JOIN users tu ON tu.id=item.to_user_id
  WHERE item.group_id=$1
  ORDER BY item.sort_order,item.id`;
async function invalidateSettlementPlan(client,groupId){
  await client.query('DELETE FROM settlement_plan_items WHERE group_id=$1',[groupId]);
  await client.query('UPDATE groups SET settlement_plan_ready=false,ledger_version=ledger_version+1 WHERE id=$1',[groupId]);
  await client.query('DELETE FROM bank_account_access_grants WHERE group_id=$1',[groupId]);
}
async function isExpenseSettlementLocked(client,groupId,expenseId){
  const {rows:[result]}=await client.query(`SELECT EXISTS(
    SELECT 1
    FROM settlement_payments sp
    JOIN expenses e ON e.id=$2 AND e.group_id=$1
    WHERE sp.group_id=$1
      AND sp.voided_at IS NULL
      AND sp.created_at>=e.created_at
  ) AS locked`,[groupId,expenseId]);
  return Boolean(result?.locked);
}
async function ensureSettlementPlan(client,groupId){
  const {rows:[group]}=await client.query(`SELECT id,name,owner_id,currency,ledger_version AS "ledgerVersion",
    settlement_plan_ready AS "settlementPlanReady" FROM groups WHERE id=$1 FOR UPDATE`,[groupId]);
  if(!group)return null;
  await assertGroupExpenseTotalSafe(client,groupId);
  if(group.settlementPlanReady)return group;
  const {rows}=await client.query(BALANCE_SQL,[groupId]);
  const balances=rows.map(row=>({...row,balanceCents:safeLedgerNumber(row.balanceCents,'成員結餘')}));
  const settlements=minimizeSettlements(balances);
  await client.query('DELETE FROM settlement_plan_items WHERE group_id=$1',[groupId]);
  for(let index=0;index<settlements.length;index++){
    const settlement=settlements[index];
    await client.query(`INSERT INTO settlement_plan_items(group_id,from_user_id,to_user_id,amount_cents,sort_order)
      VALUES($1,$2,$3,$4,$5)`,[groupId,settlement.from.id,settlement.to.id,settlement.amountCents,index]);
  }
  await client.query('UPDATE groups SET settlement_plan_ready=true WHERE id=$1',[groupId]);
  return group;
}
async function ensureSettlementPlanForGroup(groupId){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const group=await ensureSettlementPlan(client,groupId);
    await client.query('COMMIT');
    return group;
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
async function pruneInactiveBankAccessGrants(client,groupId){
  const {rows:grants}=await client.query(`SELECT from_user_id AS "fromUserId",to_user_id AS "toUserId"
    FROM bank_account_access_grants WHERE group_id=$1`,[groupId]);
  if(!grants.length)return;
  const {rows}=await client.query(`SELECT from_user_id AS "fromUserId",to_user_id AS "toUserId"
    FROM settlement_plan_items WHERE group_id=$1`,[groupId]);
  const activePairs=new Set(rows.map(settlement=>`${settlement.fromUserId}:${settlement.toUserId}`));
  for(const grant of grants){
    if(activePairs.has(`${grant.fromUserId}:${grant.toUserId}`))continue;
    await client.query(`DELETE FROM bank_account_access_grants
      WHERE group_id=$1 AND from_user_id=$2 AND to_user_id=$3`,[groupId,grant.fromUserId,grant.toUserId]);
  }
}
async function loadCurrencyLedger(client,groupId){
  const [expenseResult,paymentResult,shareResult,settlementResult]=await Promise.all([
    client.query(`SELECT id,title,amount_cents::bigint::text AS "amountCents",
      split_mode AS "splitMode",split_meta AS "splitMeta"
      FROM expenses WHERE group_id=$1 ORDER BY created_at,id`,[groupId]),
    client.query(`SELECT ep.expense_id AS "expenseId",ep.user_id AS "userId",
      ep.amount_cents::bigint::text AS "amountCents"
      FROM expense_payments ep JOIN expenses e ON e.id=ep.expense_id
      WHERE e.group_id=$1 ORDER BY ep.expense_id,ep.user_id`,[groupId]),
    client.query(`SELECT es.expense_id AS "expenseId",es.user_id AS "userId",
      es.amount_cents::bigint::text AS "amountCents"
      FROM expense_shares es JOIN expenses e ON e.id=es.expense_id
      WHERE e.group_id=$1 ORDER BY es.expense_id,es.user_id`,[groupId]),
    client.query(`SELECT id,amount_cents::bigint::text AS "amountCents",
      reported_currency AS "reportedCurrency",
      reported_amount_cents::bigint::text AS "reportedAmountCents",
      voided_at AS "voidedAt"
      FROM settlement_payments WHERE group_id=$1 ORDER BY created_at,id`,[groupId])
  ]);
  const paymentsByExpense=new Map();
  for(const row of paymentResult.rows){
    const list=paymentsByExpense.get(String(row.expenseId))||[];
    list.push({...row,amountCents:safeLedgerNumber(row.amountCents,'付款金額')});
    paymentsByExpense.set(String(row.expenseId),list);
  }
  const sharesByExpense=new Map();
  for(const row of shareResult.rows){
    const list=sharesByExpense.get(String(row.expenseId))||[];
    list.push({...row,amountCents:safeLedgerNumber(row.amountCents,'分攤金額')});
    sharesByExpense.set(String(row.expenseId),list);
  }
  return{
    expenses:expenseResult.rows.map(row=>({
      ...row,
      amountCents:safeLedgerNumber(row.amountCents,'支出金額'),
      payments:paymentsByExpense.get(String(row.id))||[],
      shares:sharesByExpense.get(String(row.id))||[]
    })),
    settlements:settlementResult.rows.map(row=>({
      ...row,
      amountCents:safeLedgerNumber(row.amountCents,'還款金額'),
      reportedAmountCents:safeLedgerNumber(row.reportedAmountCents,'原回報金額')
    }))
  };
}
const currencyPreviewResponse=(plan,quote,previewToken,expiresAt)=>({
  previewToken,
  expiresAt:expiresAt?new Date(expiresAt).toISOString():null,
  fromCurrency:plan.sourceCurrency,
  toCurrency:plan.targetCurrency,
  rate:quote.rate,
  rateDate:quote.rateDate,
  source:quote.source,
  sourceUrl:quote.sourceUrl,
  rateMode:quote.rateMode||'quoted',
  targetDecimals:plan.targetDecimals,
  counts:plan.counts,
  roundingDeltaCents:plan.roundingDeltaCents,
  examples:plan.examples,
  blockedIssues:plan.blockedIssues,
  exchangeRateHealth:quote.health
});
async function findAppliedCurrencyConversion(queryable,groupId,previewId){
  const {rows:[conversion]}=await queryable.query(`SELECT id,to_currency AS currency,
    from_currency AS "fromCurrency",rate::text,rate_date AS "rateDate",source,
    rounding_delta_cents::bigint::text AS "roundingDeltaCents"
    FROM group_currency_conversions WHERE group_id=$1 AND preview_token_id=$2`,
  [groupId,previewId]);
  return conversion||null;
}
const appliedCurrencyConversionResponse=conversion=>({
  ok:true,
  alreadyApplied:true,
  conversionId:conversion.id,
  ...conversion,
  roundingDeltaCents:safeLedgerNumber(conversion.roundingDeltaCents,'換算尾差')
});
app.get('/api/groups/:id',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  if(!await ensureSettlementPlanForGroup(req.params.id))return res.status(404).json({error:'找不到群組'});
  const elevated=await isSuperuser(req.userId);
  const [groupResult,membersResult,expensesResult,balancesResult,settlementHistoryResult,bankAccessResult,settlementPlanResult]=await Promise.all([
    pool.query(`SELECT id,name,description,currency,invite_token AS "inviteToken",
      owner_id AS "ownerId",ledger_version::bigint::text AS "ledgerVersion"
      FROM groups WHERE id=$1`,[req.params.id]),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY gm.joined_at`,[req.params.id]),
    pool.query(`SELECT e.id,e.title,e.amount_cents::bigint::text AS "amountCents",e.category,e.split_mode AS "splitMode",e.split_meta AS "splitMeta",e.currency_meta AS "currencyMeta",e.expense_date AS "expenseDate",e.created_at AS "createdAt",e.created_by AS "createdBy",EXISTS(SELECT 1 FROM settlement_payments sp WHERE sp.group_id=e.group_id AND sp.voided_at IS NULL AND sp.created_at>=e.created_at) AS "isLocked",STRING_AGG(DISTINCT pu.display_name,'、') AS "payerName",COUNT(DISTINCT es.user_id)::int AS "shareCount",COUNT(DISTINCT ep.user_id)::int AS "payerCount",JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('userId',ep.user_id,'amountCents',ep.amount_cents::text)) AS payments,JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('userId',es.user_id,'amountCents',es.amount_cents::text)) FILTER (WHERE es.user_id IS NOT NULL) AS shares FROM expenses e JOIN expense_payments ep ON ep.expense_id=e.id JOIN users pu ON pu.id=ep.user_id LEFT JOIN expense_shares es ON es.expense_id=e.id WHERE e.group_id=$1 GROUP BY e.id ORDER BY e.created_at DESC,e.id DESC`,[req.params.id]),
    pool.query(BALANCE_SQL,[req.params.id]),
    pool.query(`SELECT sp.id,sp.amount_cents::bigint::text AS "amountCents",
      sp.reported_currency AS "reportedCurrency",sp.reported_amount_cents::bigint::text AS "reportedAmountCents",
      sp.created_at AS "createdAt",sp.voided_at AS "voidedAt",
      JSONB_BUILD_OBJECT('id',fu.id,'displayName',fu.display_name,'pictureUrl',fu.picture_url,'isFund',fu.is_virtual) AS "from",
      JSONB_BUILD_OBJECT('id',tu.id,'displayName',tu.display_name,'pictureUrl',tu.picture_url,'isFund',tu.is_virtual) AS "to",
      JSONB_BUILD_OBJECT('id',cu.id,'displayName',cu.display_name) AS "confirmedBy",
      CASE WHEN vu.id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT('id',vu.id,'displayName',vu.display_name) END AS "voidedBy"
      FROM settlement_payments sp
      JOIN users fu ON fu.id=sp.from_user_id
      JOIN users tu ON tu.id=sp.to_user_id
      JOIN users cu ON cu.id=sp.created_by
      LEFT JOIN users vu ON vu.id=sp.voided_by
      WHERE sp.group_id=$1
      ORDER BY sp.created_at DESC,sp.id DESC`,[req.params.id]),
    pool.query(`SELECT access.from_user_id AS "fromUserId",access.to_user_id AS "toUserId"
      FROM bank_account_access_grants access
      JOIN user_bank_accounts account ON account.user_id=access.to_user_id AND account.share_version=access.bank_account_version
      WHERE access.group_id=$1`,[req.params.id]),
    pool.query(SETTLEMENT_PLAN_SQL,[req.params.id])
  ]);
  if(!groupResult.rows[0])return res.status(404).json({error:'找不到群組'});
  const balances=balancesResult.rows.map(x=>({...x,balanceCents:safeLedgerNumber(x.balanceCents,'成員結餘')}));
  const activeBankAccess=new Set(bankAccessResult.rows.map(row=>`${row.fromUserId}:${row.toUserId}`));
  const settlements=settlementPlanResult.rows.map(row=>({...row,amountCents:safeLedgerNumber(row.amountCents,'待轉帳金額')})).map(settlement=>{
    const canView=String(settlement.from.id)===String(req.userId)||(settlement.from.isFund&&String(groupResult.rows[0].ownerId)===String(req.userId));
    const canShare=String(settlement.to.id)===String(req.userId);
    if(!canView&&!canShare)return settlement;
    return{...settlement,bankAccountAccess:{shared:activeBankAccess.has(`${settlement.from.id}:${settlement.to.id}`),canView,canShare}};
  });
  const settlementHistory=settlementHistoryResult.rows.map(x=>({
    ...x,
    reportedBy:x.confirmedBy,
    reportStatus:x.voidedAt?'voided':'reported',
    verificationStatus:'unverified',
    amountCents:safeLedgerNumber(x.amountCents,'還款金額'),
    reportedAmountCents:safeLedgerNumber(x.reportedAmountCents,'原回報金額'),
    canVoid:!x.voidedAt&&(
      String(x.confirmedBy.id)===String(req.userId)
      ||String(x.from.id)===String(req.userId)
      ||String(groupResult.rows[0].ownerId)===String(req.userId)
      ||elevated
    )
  }));
  res.json({...groupResult.rows[0],members:membersResult.rows,expenses:expensesResult.rows.map(x=>({...x,amountCents:safeLedgerNumber(x.amountCents,'支出金額'),payments:(x.payments||[]).map(p=>({...p,amountCents:safeLedgerNumber(p.amountCents,'付款金額')})),shares:(x.shares||[]).map(s=>({...s,amountCents:safeLedgerNumber(s.amountCents,'分攤金額')}))})),balances,settlements,settlementHistory});
}));
app.post('/api/groups/:id/currency/preview',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  if(typeof req.body?.targetCurrency!=='string')return res.status(400).json({error:'目標幣別格式不正確'});
  const targetCurrency=req.body.targetCurrency.trim().toUpperCase();
  if(!isSupportedCurrency(targetCurrency))return res.status(400).json({error:'不支援這個目標幣別'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const {rows:[group]}=await client.query(`SELECT id,name,owner_id,currency,
      ledger_version::bigint::text AS "ledgerVersion",
      EXISTS(SELECT 1 FROM group_members WHERE group_id=groups.id AND user_id=$2) AS "isMember"
      FROM groups WHERE id=$1`,[req.params.id,req.userId]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const {rows:[actor]}=await client.query('SELECT is_superuser AS "isSuperuser" FROM users WHERE id=$1',[req.userId]);
    if(!group.isMember&&!actor?.isSuperuser){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'只有群組成員或管理者能變更帳本幣別'});
    }
    if(group.currency===targetCurrency){
      await client.query('ROLLBACK');
      return res.status(400).json({error:`這個群組目前已使用 ${targetCurrency}`});
    }
    const rateMode=req.body?.exchangeRateMode==='manual'?'manual':'quoted';
    let quote;
    if(rateMode==='manual'){
      let manualRate;
      try{manualRate=normalizeExpenseRate(req.body?.exchangeRate)}
      catch(error){await client.query('ROLLBACK');return res.status(400).json({error:`自訂匯率：${error.message}`})}
      quote={
        sourceCurrency:group.currency,
        targetCurrency,
        ...manualRate,
        rateDate:new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),
        source:'member',
        sourceUrl:null,
        rateMode:'manual',
        health:{status:'manual',available:true,stale:false,blocked:false,warning:null}
      };
    }else{
      try{quote=await exchangeRateService.getConversionQuote({
        sourceCurrency:group.currency,
        targetCurrency,
        queryable:client
      })}
      catch(error){
        await client.query('ROLLBACK');
        if(error instanceof ExchangeRateUnavailableError||error.code==='EXCHANGE_RATE_UNAVAILABLE'){
          return res.status(503).json({code:'EXCHANGE_RATE_UNAVAILABLE',error:error.message});
        }
        throw error;
      }
      quote={...quote,rateMode:'quoted'};
      if(quote.health?.blocked){
        await client.query('ROLLBACK');
        return res.status(503).json({
          code:'EXCHANGE_RATE_STALE',
          error:quote.health.warning||'匯率資料過期，暫時無法切換幣別',
          exchangeRateHealth:quote.health
        });
      }
    }
    await assertGroupExpenseTotalSafe(client,group.id);
    const ledger=await loadCurrencyLedger(client,group.id);
    const plan=buildCurrencyConversionPlan({
      ...ledger,
      sourceCurrency:group.currency,
      targetCurrency,
      rate:quote
    });
    assertGroupExpenseAbsoluteTotalSafe(plan.expenses.map(expense=>String(expense.amountCents)),{label:'換算後群組支出總額'});
    await client.query('COMMIT');
    if(plan.blockedIssues.length){
      return res.status(422).json({
        ...currencyPreviewResponse(plan,quote,null,null),
        code:'CURRENCY_CONVERSION_BLOCKED',
        error:'部分帳務換算後小於目標幣別最小單位，請先調整下列項目'
      });
    }
    const expiresAt=Date.now()+10*60*1000;
    const previewId=crypto.randomUUID();
    const previewToken=sign({
      kind:'currency-conversion',
      previewId,
      groupId:group.id,
      actorId:req.userId,
      fromCurrency:group.currency,
      toCurrency:targetCurrency,
      rate:quote.rate,
      ratioNumerator:quote.ratioNumerator,
      ratioDenominator:quote.ratioDenominator,
      rateDate:quote.rateDate,
      source:quote.source,
      sourceUrl:quote.sourceUrl,
      rateMode:quote.rateMode,
      ledgerVersion:String(group.ledgerVersion),
      exp:expiresAt
    });
    res.json(currencyPreviewResponse(plan,quote,previewToken,expiresAt));
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{client.release()}
}));

app.patch('/api/groups/:id/currency',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  const preview=unsign(req.body?.previewToken,{ignoreExpiry:true});
  if(!preview||preview.kind!=='currency-conversion'||String(preview.groupId)!==String(req.params.id)
    ||String(preview.actorId)!==String(req.userId)||!UUID_PATTERN.test(String(preview.previewId||''))){
    return res.status(409).json({code:'CURRENCY_PREVIEW_EXPIRED',error:'換算預覽已過期，請重新預覽最新匯率'});
  }

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const appliedBeforeLock=await findAppliedCurrencyConversion(client,req.params.id,preview.previewId);
    if(appliedBeforeLock){
      await client.query('COMMIT');
      return res.json(appliedCurrencyConversionResponse(appliedBeforeLock));
    }
    if(!Number.isFinite(Number(preview.exp))||Date.now()>Number(preview.exp)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'CURRENCY_PREVIEW_EXPIRED',error:'換算預覽已過期，請重新預覽最新匯率'});
    }
    const {rows:[group]}=await client.query(`SELECT id,name,owner_id,currency,
      ledger_version::bigint::text AS "ledgerVersion",
      EXISTS(SELECT 1 FROM group_members WHERE group_id=groups.id AND user_id=$2) AS "isMember"
      FROM groups WHERE id=$1 FOR UPDATE`,[req.params.id,req.userId]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const appliedAfterLock=await findAppliedCurrencyConversion(client,group.id,preview.previewId);
    if(appliedAfterLock){
      await client.query('COMMIT');
      return res.json(appliedCurrencyConversionResponse(appliedAfterLock));
    }
    const {rows:[actor]}=await client.query('SELECT is_superuser AS "isSuperuser" FROM users WHERE id=$1',[req.userId]);
    if(!group.isMember&&!actor?.isSuperuser){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'只有群組成員或管理者能變更帳本幣別'});
    }
    if(group.currency!==preview.fromCurrency||String(group.ledgerVersion)!==String(preview.ledgerVersion)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'CURRENCY_LEDGER_CHANGED',error:'預覽後帳本已有異動，請重新預覽再確認'});
    }
    if(preview.rateMode!=='manual'){
      await client.query('SELECT pg_advisory_xact_lock($1)',[exchangeRateInternals.EXCHANGE_RATE_LOCK_KEY]);
      let latestQuote;
      try{latestQuote=await exchangeRateService.getConversionQuote({
        sourceCurrency:preview.fromCurrency,
        targetCurrency:preview.toCurrency,
        queryable:client
      })}
      catch(error){
        await client.query('ROLLBACK');
        if(error instanceof ExchangeRateUnavailableError||error.code==='EXCHANGE_RATE_UNAVAILABLE'){
          return res.status(503).json({code:'EXCHANGE_RATE_UNAVAILABLE',error:error.message});
        }
        throw error;
      }
      if(latestQuote.health?.blocked){
        await client.query('ROLLBACK');
        return res.status(503).json({code:'EXCHANGE_RATE_STALE',error:latestQuote.health.warning||'匯率資料過期，暫時無法切換幣別'});
      }
      if(String(latestQuote.rateDate)!==String(preview.rateDate)
        ||String(latestQuote.ratioNumerator)!==String(preview.ratioNumerator)
        ||String(latestQuote.ratioDenominator)!==String(preview.ratioDenominator)){
        await client.query('ROLLBACK');
        return res.status(409).json({code:'CURRENCY_RATE_CHANGED',error:'匯率資料已更新，請重新預覽後再確認'});
      }
    }
    await assertGroupExpenseTotalSafe(client,group.id);
    const ledger=await loadCurrencyLedger(client,group.id);
    const plan=buildCurrencyConversionPlan({
      ...ledger,
      sourceCurrency:preview.fromCurrency,
      targetCurrency:preview.toCurrency,
      rate:preview
    });
    assertGroupExpenseAbsoluteTotalSafe(plan.expenses.map(expense=>String(expense.amountCents)),{label:'換算後群組支出總額'});
    if(plan.blockedIssues.length){
      await client.query('ROLLBACK');
      return res.status(409).json({
        code:'CURRENCY_CONVERSION_BLOCKED',
        error:'帳本內容已無法依此預覽換算，請調整問題項目後重試',
        blockedIssues:plan.blockedIssues
      });
    }
    const sourceDefinition=getCurrency(preview.fromCurrency);
    const targetDefinition=getCurrency(preview.toCurrency);
    const {rows:[conversion]}=await client.query(`INSERT INTO group_currency_conversions(
      group_id,group_name,from_currency,to_currency,rate,rate_numerator,rate_denominator,rate_date,source,
      source_decimals,target_decimals,preview_token_id,actor_id,rounding_delta_cents
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      group.id,group.name,preview.fromCurrency,preview.toCurrency,preview.rate,
      preview.ratioNumerator,preview.ratioDenominator,preview.rateDate,preview.source,
      sourceDefinition.decimals,targetDefinition.decimals,preview.previewId,req.userId,
      plan.roundingDeltaCents
    ]);
    const saveSnapshot=async(entityType,recordKey,beforeAmountCents,afterAmountCents,metadata={})=>{
      await client.query(`INSERT INTO group_currency_conversion_items(
        conversion_id,entity_type,record_key,before_currency,before_amount_cents,
        after_currency,after_amount_cents,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [conversion.id,entityType,String(recordKey),preview.fromCurrency,beforeAmountCents,preview.toCurrency,afterAmountCents,JSON.stringify(metadata)]);
    };
    for(const expense of plan.expenses){
      const beforeExpense=ledger.expenses.find(item=>String(item.id)===String(expense.id));
      await saveSnapshot('expense',expense.id,expense.beforeAmountCents,expense.amountCents,{
        title:expense.title,
        splitMode:expense.splitMode,
        beforeSplitMeta:beforeExpense?.splitMeta||{},
        afterSplitMeta:expense.splitMeta||{},
        payerUserIds:(beforeExpense?.payments||[]).map(item=>String(item.userId)),
        participantUserIds:(beforeExpense?.shares||[]).map(item=>String(item.userId))
      });
      await client.query('UPDATE expenses SET amount_cents=$1,split_meta=$2::jsonb WHERE id=$3',
        [expense.amountCents,JSON.stringify(expense.splitMeta),expense.id]);
      for(const payment of expense.payments){
        const before=beforeExpense?.payments.find(item=>String(item.userId)===String(payment.userId));
        await saveSnapshot('expense_payment',`${expense.id}:${payment.userId}`,before.amountCents,payment.amountCents,{expenseId:expense.id,userId:payment.userId});
        await client.query('UPDATE expense_payments SET amount_cents=$1 WHERE expense_id=$2 AND user_id=$3',
          [payment.amountCents,expense.id,payment.userId]);
      }
      for(const share of expense.shares){
        const before=beforeExpense?.shares.find(item=>String(item.userId)===String(share.userId));
        await saveSnapshot('expense_share',`${expense.id}:${share.userId}`,before.amountCents,share.amountCents,{expenseId:expense.id,userId:share.userId});
        await client.query('UPDATE expense_shares SET amount_cents=$1 WHERE expense_id=$2 AND user_id=$3',
          [share.amountCents,expense.id,share.userId]);
      }
    }
    for(const settlement of plan.settlements){
      await saveSnapshot('settlement_payment',settlement.id,settlement.beforeAmountCents,settlement.amountCents,{
        reportedCurrency:settlement.reportedCurrency,
        reportedAmountCents:settlement.reportedAmountCents,
        voided:Boolean(settlement.voidedAt)
      });
      await client.query('UPDATE settlement_payments SET amount_cents=$1 WHERE id=$2',[settlement.amountCents,settlement.id]);
    }
    await client.query('DELETE FROM settlement_plan_items WHERE group_id=$1',[group.id]);
    await client.query('DELETE FROM bank_account_access_grants WHERE group_id=$1',[group.id]);
    await client.query(`UPDATE groups SET currency=$1,settlement_plan_ready=false,
      ledger_version=ledger_version+1 WHERE id=$2`,[preview.toCurrency,group.id]);
    await ensureSettlementPlan(client,group.id);
    await writeAudit(client,req,{
      action:'convert_group_currency',
      targetType:'group',
      targetId:group.id,
      metadata:{
        groupId:group.id,
        groupName:group.name,
        itemType:'群組幣別',
        itemName:`${preview.fromCurrency} → ${preview.toCurrency}`,
        fromCurrency:preview.fromCurrency,
        toCurrency:preview.toCurrency,
        currency:preview.toCurrency,
        rate:preview.rate,
        rateDate:preview.rateDate,
        source:preview.source,
        rateMode:preview.rateMode||'quoted',
        sourceUrl:preview.sourceUrl,
        counts:plan.counts,
        roundingDeltaCents:plan.roundingDeltaCents,
        conversionId:conversion.id
      }
    });
    await client.query('COMMIT');
    res.json({
      ok:true,
      alreadyApplied:false,
      conversionId:conversion.id,
      currency:preview.toCurrency,
      fromCurrency:preview.fromCurrency,
      rate:preview.rate,
      rateDate:preview.rateDate,
      source:preview.source,
      rateMode:preview.rateMode||'quoted',
      roundingDeltaCents:plan.roundingDeltaCents
    });
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23505'){
      const conversion=await findAppliedCurrencyConversion(pool,req.params.id,preview.previewId);
      if(conversion)return res.json(appliedCurrencyConversionResponse(conversion));
    }
    throw error;
  }finally{client.release()}
}));
app.delete('/api/groups/:id',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  const elevated=await isSuperuser(req.userId);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,owner_id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    if(group.owner_id!==req.userId&&!elevated){await client.query('ROLLBACK');return res.status(403).json({error:'只有群組建立者或管理者能刪除群組'})}
    await client.query('DELETE FROM groups WHERE id=$1',[req.params.id]);
    await writeAudit(client,req,{
      action:'delete_group',
      targetType:'group',
      targetId:group.id,
      metadata:{groupId:group.id,groupName:group.name,itemType:'群組',itemName:group.name}
    });
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.post('/api/groups/:id/funds',requireUser,requireGroupUuid,(_req,res)=>res.status(410).json({error:'公費功能已移除'}));
app.post('/api/groups/:id/funds/:fundId/contributions',requireUser,requireGroupUuid,(_req,res)=>res.status(410).json({error:'公費功能已移除'}));
app.post('/api/groups/:id/expenses',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  const idempotency=readIdempotencyRequest(req,'create_expense');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,currency FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const {rows:memberRows}=await client.query(`SELECT gm.user_id::text id,u.is_virtual,
      (gm.user_id=$2) AS "isCurrentUser"
      FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1`,[req.params.id,req.userId]);
    if(!memberRows.some(row=>row.isCurrentUser)){await client.query('ROLLBACK');return res.status(403).json({error:'你不是這個群組的成員'})}
    if(idempotency){
      const existing=await findExpenseIdempotency(client,group.id,req.userId,idempotency);
      if(existing){
        await client.query('ROLLBACK');
        res.set('Idempotency-Key',idempotency.key);
        if(existing.requestFingerprint!==idempotency.fingerprint){
          return res.status(409).json({code:'IDEMPOTENCY_KEY_REUSED',error:'這個送出識別碼已用於不同內容，請重新送出'});
        }
        if(!existing.expenseExists){
          return res.status(410).json({code:'IDEMPOTENT_RESOURCE_DELETED',error:'這筆支出已刪除，不能用舊的送出識別碼重新建立'});
        }
        return res.status(200).json({id:existing.expenseId,alreadyApplied:true});
      }
    }
    if(hasExpectedCurrencyMismatch(req.body,group.currency)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'GROUP_CURRENCY_CHANGED',error:'帳本幣別已變更，請重新整理後再送出'});
    }
    const allowed=new Set(memberRows.filter(row=>!row.is_virtual).map(row=>row.id));
    let input;
    try{input=await resolveExpenseLedgerInput(req.body,group,allowed,req.userId)}
    catch(error){await client.query('ROLLBACK');return res.status(error.code==='EXPENSE_RATE_EXPIRED'?409:400).json({code:error.code,error:error.message,blockedIssues:error.issues})}
    const {title,amountCents,payments,shares,mode,splitMeta,category,currencyMeta}=input;
    const {rows:[expense]}=await client.query(`INSERT INTO expenses(
      group_id,title,amount_cents,payer_id,created_by,category,split_mode,split_meta,currency_meta
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING id`,
    [req.params.id,title,amountCents,payments[0].userId,req.userId,category,mode,JSON.stringify(splitMeta),JSON.stringify(currencyMeta)]);
    for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,payment.userId,payment.paymentCents]);
    for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,share.userId,share.shareCents]);
    await assertGroupExpenseTotalSafe(client,group.id);
    await saveExpenseIdempotency(client,group.id,req.userId,idempotency,expense.id);
    await writeAudit(client,req,{
      action:'create_expense',
      targetType:'expense',
      targetId:expense.id,
      metadata:{
        groupId:group.id,
        groupName:group.name,
        itemType:'支出',
        itemName:title,
        amountCents,
        category,
        currency:group.currency,
        inputCurrency:currencyMeta.inputCurrency,
        inputAmountCents:currencyMeta.inputAmountCents,
        exchangeRate:currencyMeta.rate,
        exchangeRateMode:currencyMeta.rateMode
      }
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    if(idempotency)res.set('Idempotency-Key',idempotency.key);
    res.status(201).json({id:expense.id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.patch('/api/groups/:id/expenses/:expenseId',requireUser,requireExpenseUuids,asyncRoute(async(req,res)=>{
  if(!UUID_PATTERN.test(req.params.id)||!UUID_PATTERN.test(req.params.expenseId))return res.status(400).json({error:'支出資料格式不正確'});
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,owner_id,currency FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    if(hasExpectedCurrencyMismatch(req.body,group.currency)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'GROUP_CURRENCY_CHANGED',error:'帳本幣別已變更，請重新整理後再送出'});
    }
    const {rows:[existing]}=await client.query(`SELECT id,created_by,title,amount_cents,category,split_mode,currency_meta
      FROM expenses WHERE id=$1 AND group_id=$2 FOR UPDATE`,[req.params.expenseId,req.params.id]);
    if(!existing){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這筆支出'})}
    const {rows:[actor]}=await client.query('SELECT is_superuser AS "isSuperuser" FROM users WHERE id=$1',[req.userId]);
    if(existing.created_by!==req.userId&&group.owner_id!==req.userId&&!actor?.isSuperuser){await client.query('ROLLBACK');return res.status(403).json({error:'只有記帳人、群組建立者或管理者能修改'})}
    if(await isExpenseSettlementLocked(client,req.params.id,req.params.expenseId)){await client.query('ROLLBACK');return res.status(409).json({code:'EXPENSE_SETTLEMENT_LOCKED',error:'這筆支出已有轉帳回報，不能改寫帳務歷史；請新增一筆調整或退款。只有回報本身錯誤時，才到還款紀錄撤銷回報'})}
    const {rows:memberRows}=await client.query(`SELECT gm.user_id::text id,u.is_virtual
      FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1`,[req.params.id]);
    const allowed=new Set(memberRows.filter(row=>!row.is_virtual).map(row=>row.id));
    let input;
    try{input=await resolveExpenseLedgerInput(req.body,group,allowed,req.userId)}
    catch(error){await client.query('ROLLBACK');return res.status(error.code==='EXPENSE_RATE_EXPIRED'?409:400).json({code:error.code,error:error.message,blockedIssues:error.issues})}
    const {title,amountCents,payments,shares,mode,splitMeta,category,currencyMeta}=input;
    const changedFields=[
      existing.title!==title&&'名稱',
      safeLedgerNumber(String(existing.amount_cents),'原支出金額')!==amountCents&&'金額',
      existing.category!==category&&'分類',
      existing.split_mode!==mode&&'分攤方式',
      '付款與分攤'
    ].filter(Boolean);
    await client.query(`UPDATE expenses SET title=$1,amount_cents=$2,payer_id=$3,category=$4,
      split_mode=$5,split_meta=$6::jsonb,currency_meta=$7::jsonb WHERE id=$8`,
    [title,amountCents,payments[0].userId,category,mode,JSON.stringify(splitMeta),JSON.stringify(currencyMeta),req.params.expenseId]);
    await client.query('DELETE FROM expense_payments WHERE expense_id=$1',[req.params.expenseId]);
    await client.query('DELETE FROM expense_shares WHERE expense_id=$1',[req.params.expenseId]);
    for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[req.params.expenseId,payment.userId,payment.paymentCents]);
    for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[req.params.expenseId,share.userId,share.shareCents]);
    await assertGroupExpenseTotalSafe(client,group.id);
    await writeAudit(client,req,{
      action:'update_expense',
      targetType:'expense',
      targetId:req.params.expenseId,
      metadata:{
        groupId:req.params.id,
        groupName:group.name,
        itemType:'支出',
        itemName:title,
        amountCents,
        category,
        previousItemName:existing.title,
        previousAmountCents:safeLedgerNumber(String(existing.amount_cents),'原支出金額'),
        currency:group.currency,
        inputCurrency:currencyMeta.inputCurrency,
        inputAmountCents:currencyMeta.inputAmountCents,
        exchangeRate:currencyMeta.rate,
        exchangeRateMode:currencyMeta.rateMode,
        changedFields
      }
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    res.json({id:req.params.expenseId});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.delete('/api/groups/:id/expenses/:expenseId',requireUser,requireExpenseUuids,asyncRoute(async(req,res)=>{
  if(!UUID_PATTERN.test(req.params.id)||!UUID_PATTERN.test(req.params.expenseId))return res.status(400).json({error:'支出資料格式不正確'});
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,owner_id,currency FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const {rows:[expense]}=await client.query(`SELECT id,created_by,title,amount_cents,category
      FROM expenses WHERE id=$1 AND group_id=$2 FOR UPDATE`,[req.params.expenseId,req.params.id]);
    if(!expense){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這筆支出'})}
    const {rows:[actor]}=await client.query('SELECT is_superuser AS "isSuperuser" FROM users WHERE id=$1',[req.userId]);
    if(expense.created_by!==req.userId&&group.owner_id!==req.userId&&!actor?.isSuperuser){await client.query('ROLLBACK');return res.status(403).json({error:'只有記帳人、群組建立者或管理者能刪除'})}
    if(await isExpenseSettlementLocked(client,req.params.id,req.params.expenseId)){await client.query('ROLLBACK');return res.status(409).json({code:'EXPENSE_SETTLEMENT_LOCKED',error:'這筆支出已有轉帳回報，不能刪除帳務歷史；請新增一筆調整或退款。只有回報本身錯誤時，才到還款紀錄撤銷回報'})}
    await client.query('DELETE FROM expenses WHERE id=$1',[req.params.expenseId]);
    await writeAudit(client,req,{
      action:'delete_expense',
      targetType:'expense',
      targetId:req.params.expenseId,
      metadata:{
        groupId:req.params.id,
        groupName:group.name,
        itemType:'支出',
        itemName:expense.title,
        amountCents:safeLedgerNumber(String(expense.amount_cents),'支出金額'),
        category:expense.category,
        currency:group.currency
      }
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.post('/api/groups/:id/settlements/:fromUserId/bank-account-access',requireUser,requireFromUserUuids,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'目前無法提供這筆轉帳資訊'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await ensureSettlementPlan(client,req.params.id);
    const {rows:[settlement]}=await client.query(`SELECT id,from_user_id AS "fromUserId",to_user_id AS "toUserId"
      FROM settlement_plan_items WHERE group_id=$1 AND from_user_id=$2 AND to_user_id=$3 LIMIT 1`,
      [req.params.id,req.params.fromUserId,req.userId]);
    if(!settlement){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'目前無法提供這筆轉帳資訊'});
    }
    const {rows:[account]}=await client.query('SELECT share_version FROM user_bank_accounts WHERE user_id=$1',[req.userId]);
    if(!account){
      await client.query('ROLLBACK');
      return res.status(400).json({error:'請先在個人資料設定常用收款帳戶'});
    }
    await client.query(`INSERT INTO bank_account_access_grants(group_id,from_user_id,to_user_id,bank_account_version)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(group_id,from_user_id,to_user_id) DO UPDATE SET bank_account_version=excluded.bank_account_version,granted_at=now()`,
      [req.params.id,settlement.fromUserId,req.userId,account.share_version]);
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.delete('/api/groups/:id/settlements/:fromUserId/bank-account-access',requireUser,requireFromUserUuids,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'目前無法調整這筆轉帳資訊'});
  await pool.query('DELETE FROM bank_account_access_grants WHERE group_id=$1 AND from_user_id=$2 AND to_user_id=$3',[req.params.id,req.params.fromUserId,req.userId]);
  res.json({ok:true});
}));
app.get('/api/groups/:id/settlements/:toUserId/bank-account',requireUser,requireToUserUuids,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'目前無法查看這筆轉帳資訊'});
  await ensureSettlementPlanForGroup(req.params.id);
  const [{rows:[group]},{rows:planRows}]=await Promise.all([
    pool.query('SELECT owner_id FROM groups WHERE id=$1',[req.params.id]),
    pool.query(SETTLEMENT_PLAN_SQL,[req.params.id])
  ]);
  if(!group)return res.status(403).json({error:'目前無法查看這筆轉帳資訊'});
  const actionable=planRows.map(row=>({...row,amountCents:safeLedgerNumber(row.amountCents,'待轉帳金額')})).filter(settlement=>
    String(settlement.to.id)===String(req.params.toUserId)&&(
      String(settlement.from.id)===String(req.userId)||
      (settlement.from.isFund&&String(group.owner_id)===String(req.userId))
    )
  );
  if(!actionable.length)return res.status(403).json({error:'目前無法查看這筆轉帳資訊'});
  const recipient={id:actionable[0].to.id,displayName:actionable[0].to.displayName,pictureUrl:actionable[0].to.pictureUrl,isFund:actionable[0].to.isFund};
  const amountCents=actionable.reduce((sum,settlement)=>sum+settlement.amountCents,0);
  const {rows:[accountRow]}=await pool.query(`SELECT ciphertext,iv,auth_tag AS "authTag",key_version AS "keyVersion",share_version AS "shareVersion"
    FROM user_bank_accounts WHERE user_id=$1`,[recipient.id]);
  if(!accountRow)return res.status(403).json({error:'收款人尚未提供轉帳資訊'});
  const actionableFromIds=[...new Set(actionable.map(settlement=>settlement.from.id))];
  const {rows:[grant]}=await pool.query(`SELECT 1 FROM bank_account_access_grants
    WHERE group_id=$1 AND from_user_id=ANY($2::uuid[]) AND to_user_id=$3 AND bank_account_version=$4 LIMIT 1`,
    [req.params.id,actionableFromIds,recipient.id,accountRow.shareVersion]);
  if(!grant)return res.status(403).json({error:'收款人尚未提供轉帳資訊'});
  res.json({recipient,amountCents,bankAccount:bankAccountCipher.decrypt(recipient.id,accountRow)});
}));
app.patch('/api/groups/:id/settlements/:settlementId/void',requireUser,requireSettlementUuids,asyncRoute(async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,owner_id,currency FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const {rows:[access]}=await client.query(`SELECT
      EXISTS(SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2) AS "isMember",
      EXISTS(SELECT 1 FROM users WHERE id=$2 AND is_superuser=true) AS "isSuperuser"`,[req.params.id,req.userId]);
    if(!access?.isMember&&!access?.isSuperuser){await client.query('ROLLBACK');return res.status(403).json({error:'你不是這個群組的成員'})}
    const {rows:[settlement]}=await client.query(`SELECT sp.id,sp.amount_cents::bigint::text AS "amountCents",sp.created_by AS "createdBy",
      sp.from_user_id AS "fromUserId",sp.voided_at AS "voidedAt",
      fu.display_name AS "fromName",tu.display_name AS "toName"
      FROM settlement_payments sp
      JOIN users fu ON fu.id=sp.from_user_id
      JOIN users tu ON tu.id=sp.to_user_id
      WHERE sp.id=$1 AND sp.group_id=$2
      FOR UPDATE OF sp`,[req.params.settlementId,req.params.id]);
    if(!settlement){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這筆轉帳回報'})}
    if(settlement.voidedAt){await client.query('ROLLBACK');return res.status(409).json({error:'這筆轉帳回報已撤銷，請重新整理帳本'})}
    const canVoid=access.isSuperuser||String(group.owner_id)===String(req.userId)||String(settlement.createdBy)===String(req.userId)||String(settlement.fromUserId)===String(req.userId);
    if(!canVoid){await client.query('ROLLBACK');return res.status(403).json({error:'只有付款人、原回報人、群組建立者或管理者能撤銷回報'})}
    const {rows:[voided]}=await client.query(`UPDATE settlement_payments
      SET voided_at=now(),voided_by=$1
      WHERE id=$2 AND voided_at IS NULL
      RETURNING voided_at AS "voidedAt"`,[req.userId,settlement.id]);
    if(!voided){await client.query('ROLLBACK');return res.status(409).json({error:'這筆轉帳回報已撤銷，請重新整理帳本'})}
    await writeAudit(client,req,{
      action:'void_settlement',
      targetType:'settlement',
      targetId:settlement.id,
      metadata:{
        groupId:group.id,
        groupName:group.name,
        itemType:'轉帳',
        itemName:`${settlement.fromName} → ${settlement.toName}`,
        amountCents:safeLedgerNumber(settlement.amountCents,'還款金額'),
        currency:group.currency
      }
    });
    await invalidateSettlementPlan(client,group.id);
    await client.query('COMMIT');
    res.json({ok:true,reportStatus:'voided',voidedAt:voided.voidedAt});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.post('/api/groups/:id/settlements',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const requestedFrom=String(req.body?.fromUserId||req.userId);
  const toUserId=String(req.body?.toUserId||'');
  if(!UUID_PATTERN.test(requestedFrom)||!UUID_PATTERN.test(toUserId)||toUserId===requestedFrom)return res.status(400).json({error:'轉帳資料不正確'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const group=await ensureSettlementPlan(client,req.params.id);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    if(hasExpectedCurrencyMismatch(req.body,group.currency)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'GROUP_CURRENCY_CHANGED',error:'帳本幣別已變更，請重新整理後再送出'});
    }
    let amountCents;
    try{amountCents=parseCurrencyAmount(req.body?.amount,group.currency,{allowNegative:false,allowZero:false})}
    catch(error){await client.query('ROLLBACK');return res.status(400).json({error:`轉帳金額：${error.message}`})}
    const {rows:[planItem]}=await client.query(`SELECT item.id,fu.is_virtual AS "isFund",
      fu.display_name AS "fromName",tu.display_name AS "toName"
      FROM settlement_plan_items item
      JOIN users fu ON fu.id=item.from_user_id
      JOIN users tu ON tu.id=item.to_user_id
      WHERE item.group_id=$1 AND item.from_user_id=$2 AND item.to_user_id=$3 AND item.amount_cents=$4
      FOR UPDATE`,[req.params.id,requestedFrom,toUserId,amountCents]);
    if(!planItem){await client.query('ROLLBACK');return res.status(400).json({error:'這筆轉帳已完成或結算方案已更新，請重新整理'})}
    const isGroupOwner=String(group.owner_id)===String(req.userId);
    const isAssisted=String(requestedFrom)!==String(req.userId);
    if(isAssisted&&!isGroupOwner){await client.query('ROLLBACK');return res.status(403).json({error:'只有付款人本人或群組建立者能回報轉帳'})}
    const {rows:[report]}=await client.query(`INSERT INTO settlement_payments(
      group_id,from_user_id,to_user_id,amount_cents,reported_currency,reported_amount_cents,created_by
    ) VALUES($1,$2,$3,$4,$5,$4,$6) RETURNING id,created_at AS "reportedAt"`,
    [req.params.id,requestedFrom,toUserId,amountCents,group.currency,req.userId]);
    await client.query('DELETE FROM settlement_plan_items WHERE id=$1',[planItem.id]);
    await client.query('UPDATE groups SET ledger_version=ledger_version+1 WHERE id=$1',[group.id]);
    await writeAudit(client,req,{
      action:'report_settlement',
      targetType:'settlement',
      targetId:report.id,
      metadata:{
        groupId:group.id,
        groupName:group.name,
        itemType:'轉帳',
        itemName:`${planItem.fromName} → ${planItem.toName}`,
        amountCents,
        currency:group.currency,
        payerId:requestedFrom,
        assisted:isAssisted
      }
    });
    await pruneInactiveBankAccessGrants(client,req.params.id);
    await client.query('COMMIT');
    res.status(201).json({ok:true,reportStatus:'reported',verificationStatus:'unverified',reportedAt:report.reportedAt,assisted:isAssisted,currency:group.currency});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/expenses-v1',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  const idempotency=readIdempotencyRequest(req,'create_expense_v1');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,currency FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const {rows:memberRows}=await client.query(`SELECT gm.user_id::text id,u.is_virtual,
      (gm.user_id=$2) AS "isCurrentUser"
      FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1`,[req.params.id,req.userId]);
    if(!memberRows.some(row=>row.isCurrentUser)){await client.query('ROLLBACK');return res.status(403).json({error:'你不是這個群組的成員'})}
    if(idempotency){
      const existing=await findExpenseIdempotency(client,group.id,req.userId,idempotency);
      if(existing){
        await client.query('ROLLBACK');
        res.set('Idempotency-Key',idempotency.key);
        if(existing.requestFingerprint!==idempotency.fingerprint){
          return res.status(409).json({code:'IDEMPOTENCY_KEY_REUSED',error:'這個送出識別碼已用於不同內容，請重新送出'});
        }
        if(!existing.expenseExists){
          return res.status(410).json({code:'IDEMPOTENT_RESOURCE_DELETED',error:'這筆支出已刪除，不能用舊的送出識別碼重新建立'});
        }
        return res.status(200).json({id:existing.expenseId,alreadyApplied:true});
      }
    }
    if(hasExpectedCurrencyMismatch(req.body,group.currency)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'GROUP_CURRENCY_CHANGED',error:'帳本幣別已變更，請重新整理後再送出'});
    }
    const allowed=new Set(memberRows.filter(row=>!row.is_virtual).map(row=>row.id));
    const legacyBody={...req.body,splitMode:Array.isArray(req.body?.shares)?'exact':'equal'};
    let input;
    try{input=resolveExpenseInput(legacyBody,group.currency,allowed)}
    catch(error){await client.query('ROLLBACK');return res.status(400).json({error:error.message})}
    const {title,amountCents,payments,shares,mode,splitMeta,category}=input;
    const {rows}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category,split_mode,split_meta)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
    [req.params.id,title,amountCents,payments[0].userId,req.userId,category,mode,JSON.stringify(splitMeta)]);
    await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[rows[0].id,payments[0].userId,amountCents]);
    for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[rows[0].id,share.userId,share.shareCents]);
    await assertGroupExpenseTotalSafe(client,group.id);
    await saveExpenseIdempotency(client,group.id,req.userId,idempotency,rows[0].id);
    await writeAudit(client,req,{
      action:'create_expense',
      targetType:'expense',
      targetId:rows[0].id,
      metadata:{groupId:group.id,groupName:group.name,itemType:'支出',itemName:title,amountCents,category,currency:group.currency}
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    if(idempotency)res.set('Idempotency-Key',idempotency.key);
    res.status(201).json({id:rows[0].id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/settlements-v1',requireUser,requireGroupUuid,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const toUserId=String(req.body?.toUserId||'');
  if(!UUID_PATTERN.test(toUserId)||toUserId===req.userId)return res.status(400).json({error:'轉帳資料不正確'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const group=await ensureSettlementPlan(client,req.params.id);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    if(hasExpectedCurrencyMismatch(req.body,group.currency)){
      await client.query('ROLLBACK');
      return res.status(409).json({code:'GROUP_CURRENCY_CHANGED',error:'帳本幣別已變更，請重新整理後再送出'});
    }
    let amountCents;
    try{amountCents=parseCurrencyAmount(req.body?.amount,group.currency,{allowNegative:false,allowZero:false})}
    catch(error){await client.query('ROLLBACK');return res.status(400).json({error:`轉帳金額：${error.message}`})}
    const {rows:[planItem]}=await client.query(`SELECT item.id,fu.display_name AS "fromName",tu.display_name AS "toName"
      FROM settlement_plan_items item
      JOIN users fu ON fu.id=item.from_user_id
      JOIN users tu ON tu.id=item.to_user_id
      WHERE item.group_id=$1 AND item.from_user_id=$2 AND item.to_user_id=$3 AND item.amount_cents=$4
      FOR UPDATE`,[req.params.id,req.userId,toUserId,amountCents]);
    if(!planItem){await client.query('ROLLBACK');return res.status(400).json({error:'這筆轉帳已完成或結算方案已更新，請重新整理'})}
    const {rows:[report]}=await client.query(`INSERT INTO settlement_payments(
      group_id,from_user_id,to_user_id,amount_cents,reported_currency,reported_amount_cents,created_by
    ) VALUES($1,$2,$3,$4,$5,$4,$2) RETURNING id`,
    [req.params.id,req.userId,toUserId,amountCents,group.currency]);
    await client.query('DELETE FROM settlement_plan_items WHERE id=$1',[planItem.id]);
    await client.query('UPDATE groups SET ledger_version=ledger_version+1 WHERE id=$1',[group.id]);
    await writeAudit(client,req,{
      action:'report_settlement',
      targetType:'settlement',
      targetId:report.id,
      metadata:{groupId:group.id,groupName:group.name,itemType:'轉帳',itemName:`${planItem.fromName} → ${planItem.toName}`,amountCents,currency:group.currency}
    });
    await pruneInactiveBankAccessGrants(client,req.params.id);
    await client.query('COMMIT');
    res.status(201).json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.use(express.static(path.join(__dirname,'dist'),{maxAge:'1h'}));
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'dist','index.html'));next()});
app.use('/api',(_req,res)=>res.status(404).json({code:'API_NOT_FOUND',error:'找不到這個 API'}));
app.use((err,req,res,_next)=>{
  const bodyTooLarge=err?.type==='entity.too.large';
  const malformedJson=err?.type==='entity.parse.failed'||(
    err instanceof SyntaxError&&Number(err?.status)===400&&Object.hasOwn(err,'body')
  );
  const declaredStatus=Number(err?.status||err?.statusCode);
  const status=bodyTooLarge?413:malformedJson?400:
    Number.isInteger(declaredStatus)&&declaredStatus>=400&&declaredStatus<500?declaredStatus:500;
  if(status>=500)console.error(err);
  res.set('Cache-Control','no-store');
  if(req.path.startsWith('/api/')){
    const code=bodyTooLarge?'REQUEST_BODY_TOO_LARGE':
      malformedJson?'INVALID_JSON':
      typeof err?.code==='string'&&status<500?err.code:
      status===422?'UNPROCESSABLE_REQUEST':'INVALID_REQUEST';
    const errorMessage=bodyTooLarge?'請求內容超過 64 KB 限制':
      malformedJson?'JSON 格式不正確':
      err instanceof LedgerIntegerSafetyError||err?.expose===true?err.message:
      status>=500?'伺服器暫時發生問題':'請求內容不正確';
    const payload={code,error:errorMessage};
    if(err instanceof LedgerIntegerSafetyError&&status<500)payload.details=err.details;
    return res.status(status).json(payload);
  }
  return res.status(status).send(status>=500?'Server error':'Bad request');
});

migrate().then(async()=>{
  await exchangeRateService.ensureSchema();
  exchangeRateScheduler.start();
  const server=app.listen(PORT,'0.0.0.0',()=>console.log(`旅帳 TripTab listening on ${PORT}`));
  const shutdown=signal=>{
    exchangeRateScheduler.stop();
    server.close(()=>pool.end().finally(()=>process.exit(0)));
    setTimeout(()=>process.exit(1),10_000).unref();
    console.log(`Received ${signal}, shutting down`);
  };
  process.once('SIGTERM',()=>shutdown('SIGTERM'));
  process.once('SIGINT',()=>shutdown('SIGINT'));
}).catch(err=>{console.error('Database migration failed',err);process.exit(1)});
