import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pg from 'pg';
import {allocateByWeights,allocateEqual,allocateHybrid,minimizeSettlements} from './finance.mjs';
// bank-account.mjs is required at runtime and must be copied into the production image.
import {createBankAccountCipher,normalizeBankAccount} from './bank-account.mjs';
import {normalizeSimulatedAccountInput} from './account-simulation.mjs';

const {Pool}=pg;
const app=express();
const PORT=Number(process.env.PORT||8080);
const APP_URL=(process.env.APP_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const isProduction=process.env.NODE_ENV==='production';
if(isProduction&&!process.env.SESSION_SECRET)throw new Error('SESSION_SECRET is required in production');
const SESSION_SECRET=process.env.SESSION_SECRET||'development-only-change-me';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:false}:false});
const bankAccountCipher=createBankAccountCipher({
  keyBase64:process.env.BANK_ACCOUNT_ENCRYPTION_KEY,
  fallbackSecret:process.env.SESSION_SECRET||(isProduction?undefined:'development-only-bank-account')
});
const __dirname=path.dirname(fileURLToPath(import.meta.url));

app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(express.json({limit:'64kb'}));
app.use(cookieParser());

const cookieOptions={httpOnly:true,secure:isProduction,sameSite:'lax',path:'/',maxAge:1000*60*60*24*14};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(value){const body=encode(value);const sig=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest('base64url');return `${body}.${sig}`}
function unsign(token){try{const [body,sig]=String(token||'').split('.');if(!body||!sig)return null;const expected=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest();const actual=Buffer.from(sig,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;const data=JSON.parse(Buffer.from(body,'base64url').toString());if(data.exp&&Date.now()>data.exp)return null;return data}catch{return null}}
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
const toWholeTwdCents=value=>{const amount=Number(value);return Number.isSafeInteger(amount)?amount*100:NaN};
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function splitMetaFromRequest(mode,body,participantIds){
  if(mode==='exact')return{shares:(body?.shares||[]).map(item=>({userId:String(item.userId),amount:Number(item.amount)}))};
  if(mode==='hybrid')return{participantIds,fixedShares:(body?.fixedShares||[]).map(item=>({userId:String(item.userId),amount:Number(item.amount)}))};
  if(mode==='weights')return{weights:(body?.weights||[]).map(item=>({userId:String(item.userId),weight:Number(item.weight)}))};
  return{participantIds};
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
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS settlement_plan_ready BOOLEAN NOT NULL DEFAULT false;
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
    CREATE TABLE IF NOT EXISTS settlement_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user_id UUID NOT NULL REFERENCES users(id),
      to_user_id UUID NOT NULL REFERENCES users(id),
      amount_cents BIGINT NOT NULL CHECK (amount_cents>0),
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
      amount_cents BIGINT NOT NULL CHECK (amount_cents>0 AND amount_cents%100=0),
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
    CREATE INDEX IF NOT EXISTS expenses_group_created_idx ON expenses(group_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS expenses_group_created_id_idx ON expenses(group_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS settlement_payments_group_created_id_idx ON settlement_payments(group_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS settlement_plan_items_group_order_idx ON settlement_plan_items(group_id,sort_order,id);
    CREATE INDEX IF NOT EXISTS bank_account_access_grants_to_idx ON bank_account_access_grants(to_user_id);
    CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
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
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM pg_constraint WHERE conname='expenses_amount_cents_check' AND pg_get_constraintdef(oid) NOT LIKE '%<> 0%') THEN
        ALTER TABLE expenses DROP CONSTRAINT expenses_amount_cents_check;
        ALTER TABLE expenses ADD CONSTRAINT expenses_amount_cents_check CHECK (amount_cents<>0);
      END IF;
      IF EXISTS(SELECT 1 FROM pg_constraint WHERE conname='expense_shares_amount_cents_check' AND pg_get_constraintdef(oid) NOT LIKE '%<> 0%') THEN
        ALTER TABLE expense_shares DROP CONSTRAINT expense_shares_amount_cents_check;
        ALTER TABLE expense_shares ADD CONSTRAINT expense_shares_amount_cents_check CHECK (amount_cents<>0);
      END IF;
    END $$;
    INSERT INTO expense_payments(expense_id,user_id,amount_cents)
      SELECT id,payer_id,amount_cents FROM expenses ON CONFLICT DO NOTHING;
    WITH ranked_shares AS (
      SELECT es.expense_id,es.user_id,SIGN(es.amount_cents)::bigint AS direction,
             (ABS(es.amount_cents)/100)::bigint AS base_units,
             ROW_NUMBER() OVER(PARTITION BY es.expense_id ORDER BY ABS(es.amount_cents)%100 DESC,es.user_id) AS unit_rank,
             ((ABS(e.amount_cents)/100)-SUM(ABS(es.amount_cents)/100) OVER(PARTITION BY es.expense_id))::bigint AS extra_units
      FROM expense_shares es JOIN expenses e ON e.id=es.expense_id
      WHERE e.amount_cents%100=0
        AND EXISTS(SELECT 1 FROM expense_shares fractional WHERE fractional.expense_id=es.expense_id AND fractional.amount_cents%100<>0)
    )
    UPDATE expense_shares es
      SET amount_cents=ranked.direction*(ranked.base_units+CASE WHEN ranked.unit_rank<=ranked.extra_units THEN 1 ELSE 0 END)*100
      FROM ranked_shares ranked
      WHERE es.expense_id=ranked.expense_id AND es.user_id=ranked.user_id;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='expenses_whole_twd_check') THEN
        ALTER TABLE expenses ADD CONSTRAINT expenses_whole_twd_check CHECK (amount_cents%100=0);
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='expense_payments_whole_twd_check') THEN
        ALTER TABLE expense_payments ADD CONSTRAINT expense_payments_whole_twd_check CHECK (amount_cents%100=0);
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='expense_shares_whole_twd_check') THEN
        ALTER TABLE expense_shares ADD CONSTRAINT expense_shares_whole_twd_check CHECK (amount_cents%100=0);
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='settlement_payments_whole_twd_check') THEN
        ALTER TABLE settlement_payments ADD CONSTRAINT settlement_payments_whole_twd_check CHECK (amount_cents%100=0);
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='settlement_payments_void_consistency_check') THEN
        ALTER TABLE settlement_payments ADD CONSTRAINT settlement_payments_void_consistency_check CHECK (
          (voided_at IS NULL AND voided_by IS NULL)
          OR
          (voided_at IS NOT NULL AND voided_by IS NOT NULL)
        );
      END IF;
    END $$;
  `);
}

app.get('/api/health',asyncRoute(async(_req,res)=>{await pool.query('SELECT 1');res.json({ok:true})}));
app.get('/api/auth/line',(req,res)=>{
  if(!process.env.LINE_CHANNEL_ID||!process.env.LINE_CHANNEL_SECRET)return res.status(503).send('LINE Login 尚未設定');
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
    pool.query(`SELECT g.id,g.name,g.description,g.created_at AS "createdAt",owner.display_name AS "ownerName",
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
    groups:groupsResult.rows.map(group=>({...group,totalCents:Number(group.totalCents)})),
    auditLog:auditResult.rows,
    simulatedAccounts:simulatedResult.rows
  });
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
  const name=String(req.body?.name||'').trim();
  const description=String(req.body?.description||'').trim().slice(0,200);
  if(!name||name.length>60)return res.status(400).json({error:'群組名稱需為 1–60 字'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const token=crypto.randomBytes(18).toString('base64url');
    const {rows}=await client.query('INSERT INTO groups(name,description,currency,invite_token,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,currency,invite_token AS "inviteToken"',[name,description,'TWD',token,req.userId]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[rows[0].id,req.userId]);
    await writeAudit(client,req,{
      action:'create_group',
      targetType:'group',
      targetId:rows[0].id,
      metadata:{groupId:rows[0].id,groupName:name,itemType:'群組',itemName:name}
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
  await client.query('UPDATE groups SET settlement_plan_ready=false WHERE id=$1',[groupId]);
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
  const {rows:[group]}=await client.query('SELECT id,name,owner_id,settlement_plan_ready AS "settlementPlanReady" FROM groups WHERE id=$1 FOR UPDATE',[groupId]);
  if(!group||group.settlementPlanReady)return group||null;
  const {rows}=await client.query(BALANCE_SQL,[groupId]);
  const balances=rows.map(row=>({...row,balanceCents:Number(row.balanceCents)}));
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
app.get('/api/groups/:id',requireUser,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  if(!await ensureSettlementPlanForGroup(req.params.id))return res.status(404).json({error:'找不到群組'});
  const elevated=await isSuperuser(req.userId);
  const [groupResult,membersResult,expensesResult,balancesResult,settlementHistoryResult,bankAccessResult,settlementPlanResult]=await Promise.all([
    pool.query('SELECT id,name,description,currency,invite_token AS "inviteToken",owner_id AS "ownerId" FROM groups WHERE id=$1',[req.params.id]),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY gm.joined_at`,[req.params.id]),
    pool.query(`SELECT e.id,e.title,e.amount_cents::bigint::text AS "amountCents",e.category,e.split_mode AS "splitMode",e.split_meta AS "splitMeta",e.expense_date AS "expenseDate",e.created_at AS "createdAt",e.created_by AS "createdBy",EXISTS(SELECT 1 FROM settlement_payments sp WHERE sp.group_id=e.group_id AND sp.voided_at IS NULL AND sp.created_at>=e.created_at) AS "isLocked",STRING_AGG(DISTINCT pu.display_name,'、') AS "payerName",COUNT(DISTINCT es.user_id)::int AS "shareCount",COUNT(DISTINCT ep.user_id)::int AS "payerCount",JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('userId',ep.user_id,'amountCents',ep.amount_cents)) AS payments,JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('userId',es.user_id,'amountCents',es.amount_cents)) FILTER (WHERE es.user_id IS NOT NULL) AS shares FROM expenses e JOIN expense_payments ep ON ep.expense_id=e.id JOIN users pu ON pu.id=ep.user_id LEFT JOIN expense_shares es ON es.expense_id=e.id WHERE e.group_id=$1 GROUP BY e.id ORDER BY e.created_at DESC,e.id DESC`,[req.params.id]),
    pool.query(BALANCE_SQL,[req.params.id]),
    pool.query(`SELECT sp.id,sp.amount_cents::bigint::text AS "amountCents",sp.created_at AS "createdAt",sp.voided_at AS "voidedAt",
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
  const balances=balancesResult.rows.map(x=>({...x,balanceCents:Number(x.balanceCents)}));
  const activeBankAccess=new Set(bankAccessResult.rows.map(row=>`${row.fromUserId}:${row.toUserId}`));
  const settlements=settlementPlanResult.rows.map(row=>({...row,amountCents:Number(row.amountCents)})).map(settlement=>{
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
    amountCents:Number(x.amountCents),
    canVoid:!x.voidedAt&&(
      String(x.confirmedBy.id)===String(req.userId)
      ||String(x.from.id)===String(req.userId)
      ||String(groupResult.rows[0].ownerId)===String(req.userId)
      ||elevated
    )
  }));
  res.json({...groupResult.rows[0],members:membersResult.rows,expenses:expensesResult.rows.map(x=>({...x,amountCents:Number(x.amountCents),payments:(x.payments||[]).map(p=>({...p,amountCents:Number(p.amountCents)})),shares:(x.shares||[]).map(s=>({...s,amountCents:Number(s.amountCents)}))})),balances,settlements,settlementHistory});
}));
app.delete('/api/groups/:id',requireUser,asyncRoute(async(req,res)=>{
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
app.post('/api/groups/:id/funds',requireUser,(_req,res)=>res.status(410).json({error:'公費功能已移除'}));
app.post('/api/groups/:id/funds/:fundId/contributions',requireUser,(_req,res)=>res.status(410).json({error:'公費功能已移除'}));
app.post('/api/groups/:id/expenses',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const title=String(req.body?.title||'').trim(),rawAmount=Number(req.body?.amount),sign=req.body?.kind==='refund'||rawAmount<0?-1:1,amountCents=sign*toWholeTwdCents(Math.abs(rawAmount)),participantIds=[...new Set(Array.isArray(req.body?.participantIds)?req.body.participantIds.map(String):[])];
  if(!title||title.length>100||!Number.isSafeInteger(amountCents)||amountCents===0)return res.status(400).json({error:'請完整填寫支出資料'});
  const {rows:memberRows}=await pool.query('SELECT user_id::text id,is_virtual FROM group_members JOIN users ON users.id=user_id WHERE group_id=$1',[req.params.id]);const allowed=new Set(memberRows.filter(x=>!x.is_virtual).map(x=>x.id));
  let payments=[];
  if(Array.isArray(req.body?.payers)){const seen=new Set();for(const item of req.body.payers){const userId=String(item?.userId||''),paymentCents=sign*toWholeTwdCents(Math.abs(Number(item?.amount)));if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(paymentCents)||paymentCents===0)return res.status(400).json({error:'共同付款金額必須是整數元'});seen.add(userId);payments.push({userId,paymentCents})}}
  else{const userId=String(req.body?.payerId||'');if(!allowed.has(userId))return res.status(400).json({error:'付款人不在群組中'});payments=[{userId,paymentCents:amountCents}]}
  if(!payments.length||payments.reduce((sum,x)=>sum+x.paymentCents,0)!==amountCents)return res.status(400).json({error:'多人付款加總必須等於總額'});
  let shares=[];const mode=String(req.body?.splitMode||'equal');
  try{
    if(mode==='exact'||Array.isArray(req.body?.shares)){const seen=new Set();shares=(req.body.shares||[]).map(item=>{const userId=String(item?.userId||''),shareCents=sign*toWholeTwdCents(Math.abs(Number(item?.amount)));if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(shareCents)||shareCents===0)throw new Error('自訂分攤金額必須是整數元');seen.add(userId);return{userId,shareCents}});if(shares.reduce((sum,x)=>sum+x.shareCents,0)!==amountCents)throw new Error('每人金額加總必須等於支出總額')}
    else if(mode==='weights'){const weights=(req.body.weights||[]).map(x=>({userId:String(x.userId),weight:Number(x.weight)}));if(weights.some(x=>!allowed.has(x.userId)))throw new Error('比例分攤成員不正確');shares=allocateByWeights(amountCents,weights)}
    else if(mode==='hybrid'){const fixed=(req.body.fixedShares||[]).map(x=>({userId:String(x.userId),shareCents:sign*toWholeTwdCents(Math.abs(Number(x.amount)))}));if(participantIds.some(id=>!allowed.has(id)))throw new Error('指定成員不正確');shares=allocateHybrid(amountCents,participantIds,fixed)}
    else{if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))throw new Error('請選擇有效的分攤成員');shares=allocateEqual(amountCents,participantIds)}
  }catch(error){return res.status(400).json({error:error.message})}
  const splitMeta=splitMetaFromRequest(mode,req.body,participantIds);
  const category=String(req.body?.category||'其他').slice(0,20);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    const {rows:[expense]}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category,split_mode,split_meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,[req.params.id,title,amountCents,payments[0].userId,req.userId,category,mode,JSON.stringify(splitMeta)]);
    for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,payment.userId,payment.paymentCents]);
    for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,share.userId,share.shareCents]);
    await writeAudit(client,req,{
      action:'create_expense',
      targetType:'expense',
      targetId:expense.id,
      metadata:{groupId:group.id,groupName:group.name,itemType:'支出',itemName:title,amountCents,category}
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    res.status(201).json({id:expense.id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.patch('/api/groups/:id/expenses/:expenseId',requireUser,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const {rows:[existing]}=await pool.query(`SELECT e.created_by,e.title,e.amount_cents,e.category,e.split_mode,g.owner_id,g.name AS group_name
    FROM expenses e JOIN groups g ON g.id=e.group_id WHERE e.id=$1 AND e.group_id=$2`,[req.params.expenseId,req.params.id]);
  if(!existing)return res.status(404).json({error:'找不到這筆支出'});
  const elevated=await isSuperuser(req.userId);
  if(existing.created_by!==req.userId&&existing.owner_id!==req.userId&&!elevated)return res.status(403).json({error:'只有記帳人、群組建立者或管理者能修改'});
  const title=String(req.body?.title||'').trim(),rawAmount=Number(req.body?.amount),sign=req.body?.kind==='refund'||rawAmount<0?-1:1,amountCents=sign*toWholeTwdCents(Math.abs(rawAmount)),participantIds=[...new Set(Array.isArray(req.body?.participantIds)?req.body.participantIds.map(String):[])];
  if(!title||title.length>100||!Number.isSafeInteger(amountCents)||amountCents===0)return res.status(400).json({error:'請完整填寫支出資料'});
  const {rows:memberRows}=await pool.query('SELECT user_id::text id,is_virtual FROM group_members JOIN users ON users.id=user_id WHERE group_id=$1',[req.params.id]);const allowed=new Set(memberRows.filter(x=>!x.is_virtual).map(x=>x.id));
  let payments=[];
  if(Array.isArray(req.body?.payers)){const seen=new Set();for(const item of req.body.payers){const userId=String(item?.userId||''),paymentCents=sign*toWholeTwdCents(Math.abs(Number(item?.amount)));if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(paymentCents)||paymentCents===0)return res.status(400).json({error:'共同付款金額必須是整數元'});seen.add(userId);payments.push({userId,paymentCents})}}
  else{const userId=String(req.body?.payerId||'');if(!allowed.has(userId))return res.status(400).json({error:'付款人不在群組中'});payments=[{userId,paymentCents:amountCents}]}
  if(!payments.length||payments.reduce((sum,x)=>sum+x.paymentCents,0)!==amountCents)return res.status(400).json({error:'多人付款加總必須等於總額'});
  let shares=[];const mode=String(req.body?.splitMode||'equal');
  try{
    if(mode==='exact'||Array.isArray(req.body?.shares)){const seen=new Set();shares=(req.body.shares||[]).map(item=>{const userId=String(item?.userId||''),shareCents=sign*toWholeTwdCents(Math.abs(Number(item?.amount)));if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(shareCents)||shareCents===0)throw new Error('自訂分攤金額必須是整數元');seen.add(userId);return{userId,shareCents}});if(shares.reduce((sum,x)=>sum+x.shareCents,0)!==amountCents)throw new Error('每人金額加總必須等於支出總額')}
    else if(mode==='weights'){const weights=(req.body.weights||[]).map(x=>({userId:String(x.userId),weight:Number(x.weight)}));if(weights.some(x=>!allowed.has(x.userId)))throw new Error('比例分攤成員不正確');shares=allocateByWeights(amountCents,weights)}
    else if(mode==='hybrid'){const fixed=(req.body.fixedShares||[]).map(x=>({userId:String(x.userId),shareCents:sign*toWholeTwdCents(Math.abs(Number(x.amount)))}));if(participantIds.some(id=>!allowed.has(id)))throw new Error('指定成員不正確');shares=allocateHybrid(amountCents,participantIds,fixed)}
    else{if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))throw new Error('請選擇有效的分攤成員');shares=allocateEqual(amountCents,participantIds)}
  }catch(error){return res.status(400).json({error:error.message})}
  const splitMeta=splitMetaFromRequest(mode,req.body,participantIds);
  const category=String(req.body?.category||'其他').slice(0,20);
  const changedFields=[
    existing.title!==title&&'名稱',
    Number(existing.amount_cents)!==amountCents&&'金額',
    existing.category!==category&&'分類',
    existing.split_mode!==mode&&'分攤方式',
    '付款與分攤'
  ].filter(Boolean);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    const {rows:[lockedExpense]}=await client.query('SELECT id FROM expenses WHERE id=$1 AND group_id=$2 FOR UPDATE',[req.params.expenseId,req.params.id]);
    if(!lockedExpense){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這筆支出'})}
    if(await isExpenseSettlementLocked(client,req.params.id,req.params.expenseId)){await client.query('ROLLBACK');return res.status(409).json({code:'EXPENSE_SETTLEMENT_LOCKED',error:'這筆支出已有轉帳回報，不能改寫帳務歷史；請新增一筆調整或退款。只有回報本身錯誤時，才到還款紀錄撤銷回報'})}
    await client.query(`UPDATE expenses SET title=$1,amount_cents=$2,payer_id=$3,category=$4,split_mode=$5,split_meta=$6::jsonb WHERE id=$7`,[title,amountCents,payments[0].userId,category,mode,JSON.stringify(splitMeta),req.params.expenseId]);
    await client.query('DELETE FROM expense_payments WHERE expense_id=$1',[req.params.expenseId]);
    await client.query('DELETE FROM expense_shares WHERE expense_id=$1',[req.params.expenseId]);
    for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[req.params.expenseId,payment.userId,payment.paymentCents]);
    for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[req.params.expenseId,share.userId,share.shareCents]);
    await writeAudit(client,req,{
      action:'update_expense',
      targetType:'expense',
      targetId:req.params.expenseId,
      metadata:{
        groupId:req.params.id,
        groupName:existing.group_name,
        itemType:'支出',
        itemName:title,
        amountCents,
        category,
        previousItemName:existing.title,
        previousAmountCents:Number(existing.amount_cents),
        changedFields
      }
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    res.json({id:req.params.expenseId});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.delete('/api/groups/:id/expenses/:expenseId',requireUser,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const {rows:[expense]}=await pool.query(`SELECT e.id,e.created_by,e.title,e.amount_cents,e.category,g.owner_id,g.name AS group_name
    FROM expenses e JOIN groups g ON g.id=e.group_id WHERE e.id=$1 AND e.group_id=$2`,[req.params.expenseId,req.params.id]);
  if(!expense)return res.status(404).json({error:'找不到這筆支出'});
  const elevated=await isSuperuser(req.userId);
  if(expense.created_by!==req.userId&&expense.owner_id!==req.userId&&!elevated)return res.status(403).json({error:'只有記帳人、群組建立者或管理者能刪除'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    const {rows:[lockedExpense]}=await client.query('SELECT id FROM expenses WHERE id=$1 AND group_id=$2 FOR UPDATE',[req.params.expenseId,req.params.id]);
    if(!lockedExpense){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這筆支出'})}
    if(await isExpenseSettlementLocked(client,req.params.id,req.params.expenseId)){await client.query('ROLLBACK');return res.status(409).json({code:'EXPENSE_SETTLEMENT_LOCKED',error:'這筆支出已有轉帳回報，不能刪除帳務歷史；請新增一筆調整或退款。只有回報本身錯誤時，才到還款紀錄撤銷回報'})}
    await client.query('DELETE FROM expenses WHERE id=$1',[req.params.expenseId]);
    await writeAudit(client,req,{
      action:'delete_expense',
      targetType:'expense',
      targetId:req.params.expenseId,
      metadata:{
        groupId:req.params.id,
        groupName:expense.group_name,
        itemType:'支出',
        itemName:expense.title,
        amountCents:Number(expense.amount_cents),
        category:expense.category
      }
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.post('/api/groups/:id/settlements/:fromUserId/bank-account-access',requireUser,asyncRoute(async(req,res)=>{
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
app.delete('/api/groups/:id/settlements/:fromUserId/bank-account-access',requireUser,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'目前無法調整這筆轉帳資訊'});
  await pool.query('DELETE FROM bank_account_access_grants WHERE group_id=$1 AND from_user_id=$2 AND to_user_id=$3',[req.params.id,req.params.fromUserId,req.userId]);
  res.json({ok:true});
}));
app.get('/api/groups/:id/settlements/:toUserId/bank-account',requireUser,asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'目前無法查看這筆轉帳資訊'});
  await ensureSettlementPlanForGroup(req.params.id);
  const [{rows:[group]},{rows:planRows}]=await Promise.all([
    pool.query('SELECT owner_id FROM groups WHERE id=$1',[req.params.id]),
    pool.query(SETTLEMENT_PLAN_SQL,[req.params.id])
  ]);
  if(!group)return res.status(403).json({error:'目前無法查看這筆轉帳資訊'});
  const actionable=planRows.map(row=>({...row,amountCents:Number(row.amountCents)})).filter(settlement=>
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
app.patch('/api/groups/:id/settlements/:settlementId/void',requireUser,asyncRoute(async(req,res)=>{
  if(!UUID_PATTERN.test(req.params.id)||!UUID_PATTERN.test(req.params.settlementId))return res.status(400).json({error:'轉帳回報格式不正確'});
  const elevated=await isSuperuser(req.userId);
  if(!elevated&&!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name,owner_id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
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
    const canVoid=elevated||String(group.owner_id)===String(req.userId)||String(settlement.createdBy)===String(req.userId)||String(settlement.fromUserId)===String(req.userId);
    if(!canVoid){await client.query('ROLLBACK');return res.status(403).json({error:'只有付款人、原回報人、群組建立者或管理者能撤銷回報'})}
    const {rows:[voided]}=await client.query(`UPDATE settlement_payments
      SET voided_at=now(),voided_by=$1
      WHERE id=$2 RETURNING voided_at AS "voidedAt"`,[req.userId,settlement.id]);
    await writeAudit(client,req,{
      action:'void_settlement',
      targetType:'settlement',
      targetId:settlement.id,
      metadata:{
        groupId:group.id,
        groupName:group.name,
        itemType:'轉帳',
        itemName:`${settlement.fromName} → ${settlement.toName}`,
        amountCents:Number(settlement.amountCents)
      }
    });
    await invalidateSettlementPlan(client,group.id);
    await client.query('COMMIT');
    res.json({ok:true,reportStatus:'voided',voidedAt:voided.voidedAt});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));
app.post('/api/groups/:id/settlements',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const requestedFrom=String(req.body?.fromUserId||req.userId);
  const toUserId=String(req.body?.toUserId||'');
  const amountCents=toWholeTwdCents(req.body?.amount);
  if(!toUserId||toUserId===requestedFrom||!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'轉帳金額必須是整數元'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const group=await ensureSettlementPlan(client,req.params.id);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
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
    const {rows:[report]}=await client.query(`INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING id,created_at AS "reportedAt"`,[req.params.id,requestedFrom,toUserId,amountCents,req.userId]);
    await client.query('DELETE FROM settlement_plan_items WHERE id=$1',[planItem.id]);
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
        payerId:requestedFrom,
        assisted:isAssisted
      }
    });
    await pruneInactiveBankAccessGrants(client,req.params.id);
    await client.query('COMMIT');
    res.status(201).json({ok:true,reportStatus:'reported',verificationStatus:'unverified',reportedAt:report.reportedAt,assisted:isAssisted});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/expenses-v1',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const title=String(req.body?.title||'').trim();const amountCents=toWholeTwdCents(req.body?.amount);const payerId=String(req.body?.payerId||'');const participantIds=[...new Set(Array.isArray(req.body?.participantIds)?req.body.participantIds.map(String):[])];
  if(!title||title.length>100||!Number.isSafeInteger(amountCents)||amountCents<=0||!payerId)return res.status(400).json({error:'請完整填寫支出資料'});
  const {rows:memberRows}=await pool.query('SELECT user_id::text id FROM group_members WHERE group_id=$1',[req.params.id]);const allowed=new Set(memberRows.map(x=>x.id));if(!allowed.has(payerId))return res.status(400).json({error:'付款人不在群組中'});
  let shares=[];
  if(Array.isArray(req.body?.shares)){
    const seen=new Set();
    for(const item of req.body.shares){const userId=String(item?.userId||'');const shareCents=toWholeTwdCents(item?.amount);if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(shareCents)||shareCents<=0)return res.status(400).json({error:'自訂分攤金額必須是整數元'});seen.add(userId);shares.push({userId,shareCents})}
    if(!shares.length||shares.reduce((sum,x)=>sum+x.shareCents,0)!==amountCents)return res.status(400).json({error:'每人金額加總必須等於支出總額'});
  }else{
    if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))return res.status(400).json({error:'請選擇有效的分攤成員'});
    shares=allocateEqual(amountCents,participantIds);
  }
  const category=String(req.body?.category||'其他').slice(0,20);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[group]}=await client.query('SELECT id,name FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);
    const {rows}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[req.params.id,title,amountCents,payerId,req.userId,category]);
    await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[rows[0].id,payerId,amountCents]);
    for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[rows[0].id,share.userId,share.shareCents]);
    await writeAudit(client,req,{
      action:'create_expense',
      targetType:'expense',
      targetId:rows[0].id,
      metadata:{groupId:group.id,groupName:group.name,itemType:'支出',itemName:title,amountCents,category}
    });
    await invalidateSettlementPlan(client,req.params.id);
    await client.query('COMMIT');
    res.status(201).json({id:rows[0].id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/settlements-v1',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const toUserId=String(req.body?.toUserId||''),amountCents=toWholeTwdCents(req.body?.amount);
  if(!toUserId||toUserId===req.userId||!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'轉帳資料不正確'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const group=await ensureSettlementPlan(client,req.params.id);
    if(!group){await client.query('ROLLBACK');return res.status(404).json({error:'找不到群組'})}
    const {rows:[planItem]}=await client.query(`SELECT item.id,fu.display_name AS "fromName",tu.display_name AS "toName"
      FROM settlement_plan_items item
      JOIN users fu ON fu.id=item.from_user_id
      JOIN users tu ON tu.id=item.to_user_id
      WHERE item.group_id=$1 AND item.from_user_id=$2 AND item.to_user_id=$3 AND item.amount_cents=$4
      FOR UPDATE`,[req.params.id,req.userId,toUserId,amountCents]);
    if(!planItem){await client.query('ROLLBACK');return res.status(400).json({error:'這筆轉帳已完成或結算方案已更新，請重新整理'})}
    const {rows:[report]}=await client.query(`INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by)
      VALUES($1,$2,$3,$4,$2) RETURNING id`,[req.params.id,req.userId,toUserId,amountCents]);
    await client.query('DELETE FROM settlement_plan_items WHERE id=$1',[planItem.id]);
    await writeAudit(client,req,{
      action:'report_settlement',
      targetType:'settlement',
      targetId:report.id,
      metadata:{groupId:group.id,groupName:group.name,itemType:'轉帳',itemName:`${planItem.fromName} → ${planItem.toName}`,amountCents}
    });
    await pruneInactiveBankAccessGrants(client,req.params.id);
    await client.query('COMMIT');
    res.status(201).json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.use(express.static(path.join(__dirname,'dist'),{maxAge:'1h'}));
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'dist','index.html'));next()});
app.use((err,req,res,_next)=>{console.error(err);if(req.path.startsWith('/api/'))return res.status(500).json({error:'伺服器暫時發生問題'});res.status(500).send('Server error')});

migrate().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`旅帳 TripTab listening on ${PORT}`))).catch(err=>{console.error('Database migration failed',err);process.exit(1)});
