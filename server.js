import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pg from 'pg';
import {allocateByWeights,allocateEqual,allocateHybrid,minimizeSettlements} from './finance.mjs';

const {Pool}=pg;
const app=express();
const PORT=Number(process.env.PORT||8080);
const APP_URL=(process.env.APP_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const SESSION_SECRET=process.env.SESSION_SECRET||'development-only-change-me';
const isProduction=process.env.NODE_ENV==='production';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:false}:false});
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
function requireUser(req,res,next){const session=unsign(req.cookies.dongda_session);if(!session?.userId)return res.status(401).json({error:'請先使用 LINE 登入'});req.userId=session.userId;next()}
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
async function isSuperuser(userId){const {rows:[user]}=await pool.query('SELECT is_superuser FROM users WHERE id=$1',[userId]);return Boolean(user?.is_superuser)}
const requireSuperuser=asyncRoute(async(req,res,next)=>{if(!await isSuperuser(req.userId))return res.status(403).json({error:'此功能僅限超級使用者'});next()});
const toWholeTwdCents=value=>{const amount=Number(value);return Number.isSafeInteger(amount)?amount*100:NaN};
function splitMetaFromRequest(mode,body,participantIds){
  if(mode==='exact')return{shares:(body?.shares||[]).map(item=>({userId:String(item.userId),amount:Number(item.amount)}))};
  if(mode==='hybrid')return{participantIds,fixedShares:(body?.fixedShares||[]).map(item=>({userId:String(item.userId),amount:Number(item.amount)}))};
  if(mode==='weights')return{weights:(body?.weights||[]).map(item=>({userId:String(item.userId),weight:Number(item.weight)}))};
  return{participantIds};
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
    CREATE INDEX IF NOT EXISTS expenses_group_created_idx ON expenses(group_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN NOT NULL DEFAULT false;
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
app.get('/api/me',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT id,display_name AS "displayName",picture_url AS "pictureUrl",is_superuser AS "isSuperuser" FROM users WHERE id=$1',[req.userId]);res.json(rows[0])}));

if(!isProduction){app.post('/api/dev-login',asyncRoute(async(req,res)=>{const name=String(req.body?.name||'本機小羅').slice(0,40);const lineId=`dev-${name}`;const {rows}=await pool.query(`INSERT INTO users(line_user_id,display_name,picture_url) VALUES($1,$2,$3) ON CONFLICT(line_user_id) DO UPDATE SET display_name=excluded.display_name RETURNING id`,[lineId,name,'/xiaoluo-avatar.png']);res.cookie('dongda_session',sign({userId:rows[0].id,exp:Date.now()+14*86400000}),cookieOptions);res.json({ok:true})}))}

app.get('/api/admin/overview',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  const [statsResult,usersResult,groupsResult,auditResult]=await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM users WHERE is_virtual=false) AS "userCount",
      (SELECT COUNT(*)::int FROM users WHERE is_superuser=true AND is_virtual=false) AS "superuserCount",
      (SELECT COUNT(*)::int FROM groups) AS "groupCount",
      (SELECT COUNT(*)::int FROM expenses) AS "expenseCount"`),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_superuser AS "isSuperuser",u.created_at AS "createdAt",COUNT(gm.group_id)::int AS "groupCount"
      FROM users u LEFT JOIN group_members gm ON gm.user_id=u.id
      WHERE u.is_virtual=false
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
    pool.query(`SELECT log.id,log.action,log.target_type AS "targetType",log.target_id AS "targetId",log.metadata,log.created_at AS "createdAt",actor.display_name AS "actorName"
      FROM admin_audit_log log JOIN users actor ON actor.id=log.actor_id
      ORDER BY log.created_at DESC LIMIT 30`)
  ]);
  res.json({
    stats:statsResult.rows[0],
    users:usersResult.rows,
    groups:groupsResult.rows.map(group=>({...group,totalCents:Number(group.totalCents)})),
    auditLog:auditResult.rows
  });
}));

app.patch('/api/admin/users/:id/superuser',requireUser,requireSuperuser,asyncRoute(async(req,res)=>{
  const targetId=String(req.params.id||'');
  const nextValue=req.body?.isSuperuser;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)||typeof nextValue!=='boolean')return res.status(400).json({error:'權限設定格式不正確'});
  if(targetId===req.userId&&!nextValue)return res.status(400).json({error:'不能移除自己的超級使用者權限'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const {rows:[target]}=await client.query('SELECT id,display_name,is_virtual,is_superuser FROM users WHERE id=$1',[targetId]);
    if(!target){await client.query('ROLLBACK');return res.status(404).json({error:'找不到這位使用者'})}
    if(target.is_virtual){await client.query('ROLLBACK');return res.status(400).json({error:'公費帳號不能設為超級使用者'})}
    if(target.is_superuser&&!nextValue){
      const {rows:[count]}=await client.query('SELECT COUNT(*)::int AS total FROM users WHERE is_superuser=true AND is_virtual=false');
      if(count.total<=1){await client.query('ROLLBACK');return res.status(400).json({error:'系統至少需要保留一位超級使用者'})}
    }
    const {rows:[updated]}=await client.query('UPDATE users SET is_superuser=$1,updated_at=now() WHERE id=$2 RETURNING id,display_name AS "displayName",is_superuser AS "isSuperuser"',[nextValue,targetId]);
    await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata)
      VALUES($1,$2,'user',$3,$4::jsonb)`,[req.userId,nextValue?'grant_superuser':'revoke_superuser',targetId,JSON.stringify({displayName:target.display_name})]);
    await client.query('COMMIT');
    res.json(updated);
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}));

app.get('/api/groups',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query(`SELECT g.id,g.name,g.description,g.currency,g.invite_token AS "inviteToken",COUNT(gm2.user_id) FILTER(WHERE COALESCE(u2.is_virtual,false)=false)::int AS "memberCount" FROM groups g JOIN group_members mine ON mine.group_id=g.id AND mine.user_id=$1 LEFT JOIN group_members gm2 ON gm2.group_id=g.id LEFT JOIN users u2 ON u2.id=gm2.user_id GROUP BY g.id ORDER BY g.created_at DESC`,[req.userId]);res.json(rows)}));
app.post('/api/groups',requireUser,asyncRoute(async(req,res)=>{const name=String(req.body?.name||'').trim();const description=String(req.body?.description||'').trim().slice(0,200);if(!name||name.length>60)return res.status(400).json({error:'群組名稱需為 1–60 字'});const client=await pool.connect();try{await client.query('BEGIN');const token=crypto.randomBytes(18).toString('base64url');const {rows}=await client.query('INSERT INTO groups(name,description,currency,invite_token,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,currency,invite_token AS "inviteToken"',[name,description,'TWD',token,req.userId]);await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[rows[0].id,req.userId]);await client.query('COMMIT');res.status(201).json(rows[0])}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}));
app.post('/api/invites/:token/join',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT id FROM groups WHERE invite_token=$1',[req.params.token]);if(!rows[0])return res.status(404).json({error:'邀請連結無效'});await pool.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[rows[0].id,req.userId]);res.json({groupId:rows[0].id})}));

async function assertMember(groupId,userId){const {rows}=await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[groupId,userId]);return Boolean(rows[0])}
async function canReadGroup(groupId,userId){return await assertMember(groupId,userId)||await isSuperuser(userId)}
const BALANCE_SQL=`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role,(COALESCE(p.paid,0)-COALESCE(o.owed,0)+COALESCE(sout.sent,0)-COALESCE(sin.received,0))::bigint::text AS "balanceCents" FROM group_members gm JOIN users u ON u.id=gm.user_id LEFT JOIN (SELECT ep.user_id,SUM(ep.amount_cents) paid FROM expense_payments ep JOIN expenses e ON e.id=ep.expense_id WHERE e.group_id=$1 GROUP BY ep.user_id)p ON p.user_id=u.id LEFT JOIN (SELECT es.user_id,SUM(es.amount_cents) owed FROM expense_shares es JOIN expenses e ON e.id=es.expense_id WHERE e.group_id=$1 GROUP BY es.user_id)o ON o.user_id=u.id LEFT JOIN (SELECT from_user_id,SUM(amount_cents) sent FROM settlement_payments WHERE group_id=$1 GROUP BY from_user_id)sout ON sout.from_user_id=u.id LEFT JOIN (SELECT to_user_id,SUM(amount_cents) received FROM settlement_payments WHERE group_id=$1 GROUP BY to_user_id)sin ON sin.to_user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.joined_at`;
app.get('/api/groups/:id',requireUser,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const [groupResult,membersResult,expensesResult,balancesResult,settlementHistoryResult]=await Promise.all([
    pool.query('SELECT id,name,description,currency,invite_token AS "inviteToken",owner_id AS "ownerId" FROM groups WHERE id=$1',[req.params.id]),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY gm.joined_at`,[req.params.id]),
    pool.query(`SELECT e.id,e.title,e.amount_cents::bigint::text AS "amountCents",e.category,e.split_mode AS "splitMode",e.split_meta AS "splitMeta",e.expense_date AS "expenseDate",e.created_at AS "createdAt",e.created_by AS "createdBy",STRING_AGG(DISTINCT pu.display_name,'、') AS "payerName",COUNT(DISTINCT es.user_id)::int AS "shareCount",COUNT(DISTINCT ep.user_id)::int AS "payerCount",JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('userId',ep.user_id,'amountCents',ep.amount_cents)) AS payments,JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('userId',es.user_id,'amountCents',es.amount_cents)) FILTER (WHERE es.user_id IS NOT NULL) AS shares FROM expenses e JOIN expense_payments ep ON ep.expense_id=e.id JOIN users pu ON pu.id=ep.user_id LEFT JOIN expense_shares es ON es.expense_id=e.id WHERE e.group_id=$1 GROUP BY e.id ORDER BY e.created_at DESC LIMIT 100`,[req.params.id]),
    pool.query(BALANCE_SQL,[req.params.id]),
    pool.query(`SELECT sp.id,sp.amount_cents::bigint::text AS "amountCents",sp.created_at AS "createdAt",JSONB_BUILD_OBJECT('id',fu.id,'displayName',fu.display_name,'pictureUrl',fu.picture_url,'isFund',fu.is_virtual) AS "from",JSONB_BUILD_OBJECT('id',tu.id,'displayName',tu.display_name,'pictureUrl',tu.picture_url,'isFund',tu.is_virtual) AS "to",JSONB_BUILD_OBJECT('id',cu.id,'displayName',cu.display_name) AS "confirmedBy" FROM settlement_payments sp JOIN users fu ON fu.id=sp.from_user_id JOIN users tu ON tu.id=sp.to_user_id JOIN users cu ON cu.id=sp.created_by WHERE sp.group_id=$1 ORDER BY sp.created_at DESC LIMIT 100`,[req.params.id])
  ]);
  if(!groupResult.rows[0])return res.status(404).json({error:'找不到群組'});
  const balances=balancesResult.rows.map(x=>({...x,balanceCents:Number(x.balanceCents)}));
  const settlements=minimizeSettlements(balances);
  const settlementHistory=settlementHistoryResult.rows.map(x=>({...x,amountCents:Number(x.amountCents)}));
  res.json({...groupResult.rows[0],members:membersResult.rows,expenses:expensesResult.rows.map(x=>({...x,amountCents:Number(x.amountCents),payments:(x.payments||[]).map(p=>({...p,amountCents:Number(p.amountCents)})),shares:(x.shares||[]).map(s=>({...s,amountCents:Number(s.amountCents)}))})),balances,settlements,settlementHistory});
}));
app.delete('/api/groups/:id',requireUser,asyncRoute(async(req,res)=>{
  const {rows:[group]}=await pool.query('SELECT id,owner_id FROM groups WHERE id=$1',[req.params.id]);
  if(!group)return res.status(404).json({error:'找不到群組'});
  const elevated=await isSuperuser(req.userId);
  if(group.owner_id!==req.userId&&!elevated)return res.status(403).json({error:'只有群組建立者或超級使用者能刪除群組'});
  await pool.query('DELETE FROM groups WHERE id=$1',[req.params.id]);
  if(elevated&&group.owner_id!==req.userId)await pool.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata) VALUES($1,'delete_group','group',$2,'{}'::jsonb)`,[req.userId,req.params.id]);
  res.json({ok:true});
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
  const client=await pool.connect();try{await client.query('BEGIN');const {rows:[expense]}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category,split_mode,split_meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,[req.params.id,title,amountCents,payments[0].userId,req.userId,String(req.body?.category||'其他').slice(0,20),mode,JSON.stringify(splitMeta)]);for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,payment.userId,payment.paymentCents]);for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,share.userId,share.shareCents]);await client.query('COMMIT');res.status(201).json({id:expense.id})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.patch('/api/groups/:id/expenses/:expenseId',requireUser,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const {rows:[existing]}=await pool.query(`SELECT e.created_by,g.owner_id FROM expenses e JOIN groups g ON g.id=e.group_id WHERE e.id=$1 AND e.group_id=$2`,[req.params.expenseId,req.params.id]);
  if(!existing)return res.status(404).json({error:'找不到這筆支出'});
  const elevated=await isSuperuser(req.userId);
  if(existing.created_by!==req.userId&&existing.owner_id!==req.userId&&!elevated)return res.status(403).json({error:'只有記帳人、群組建立者或超級使用者能修改'});
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
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM expenses WHERE id=$1 FOR UPDATE',[req.params.expenseId]);await client.query(`UPDATE expenses SET title=$1,amount_cents=$2,payer_id=$3,category=$4,split_mode=$5,split_meta=$6::jsonb WHERE id=$7`,[title,amountCents,payments[0].userId,String(req.body?.category||'其他').slice(0,20),mode,JSON.stringify(splitMeta),req.params.expenseId]);await client.query('DELETE FROM expense_payments WHERE expense_id=$1',[req.params.expenseId]);await client.query('DELETE FROM expense_shares WHERE expense_id=$1',[req.params.expenseId]);for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[req.params.expenseId,payment.userId,payment.paymentCents]);for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[req.params.expenseId,share.userId,share.shareCents]);if(elevated&&existing.created_by!==req.userId&&existing.owner_id!==req.userId)await client.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata) VALUES($1,'update_expense','expense',$2,$3::jsonb)`,[req.userId,req.params.expenseId,JSON.stringify({groupId:req.params.id,title})]);await client.query('COMMIT');res.json({id:req.params.expenseId})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.delete('/api/groups/:id/expenses/:expenseId',requireUser,asyncRoute(async(req,res)=>{
  if(!await canReadGroup(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const {rows:[expense]}=await pool.query(`SELECT e.id,e.created_by,g.owner_id FROM expenses e JOIN groups g ON g.id=e.group_id WHERE e.id=$1 AND e.group_id=$2`,[req.params.expenseId,req.params.id]);
  if(!expense)return res.status(404).json({error:'找不到這筆支出'});
  const elevated=await isSuperuser(req.userId);
  if(expense.created_by!==req.userId&&expense.owner_id!==req.userId&&!elevated)return res.status(403).json({error:'只有記帳人、群組建立者或超級使用者能刪除'});
  await pool.query('DELETE FROM expenses WHERE id=$1',[req.params.expenseId]);
  if(elevated&&expense.created_by!==req.userId&&expense.owner_id!==req.userId)await pool.query(`INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,metadata) VALUES($1,'delete_expense','expense',$2,$3::jsonb)`,[req.userId,req.params.expenseId,JSON.stringify({groupId:req.params.id})]);
  res.json({ok:true});
}));
app.post('/api/groups/:id/settlements',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});const requestedFrom=String(req.body?.fromUserId||req.userId),toUserId=String(req.body?.toUserId||''),amountCents=toWholeTwdCents(req.body?.amount);if(!toUserId||toUserId===requestedFrom||!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'轉帳金額必須是整數元'});
  const client=await pool.connect();try{await client.query('BEGIN');const {rows:[group]}=await client.query('SELECT owner_id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);const {rows}=await client.query(BALANCE_SQL,[req.params.id]);const from=rows.find(x=>x.id===requestedFrom),to=rows.find(x=>x.id===toUserId);if(!from||!to){await client.query('ROLLBACK');return res.status(400).json({error:'付款人或收款人不在群組中'})}if(requestedFrom!==req.userId&&!(from.isFund&&group.owner_id===req.userId)){await client.query('ROLLBACK');return res.status(403).json({error:'只有本人或群組建立者能確認這筆轉帳'})}const maximum=Math.min(-Number(from.balanceCents),Number(to.balanceCents));if(maximum<=0||amountCents>maximum){await client.query('ROLLBACK');return res.status(400).json({error:'轉帳金額超過目前應付金額'})}await client.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$5)',[req.params.id,requestedFrom,toUserId,amountCents,req.userId]);await client.query('COMMIT');res.status(201).json({ok:true})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
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
  const client=await pool.connect();try{await client.query('BEGIN');const {rows}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[req.params.id,title,amountCents,payerId,req.userId,String(req.body?.category||'其他').slice(0,20)]);for(const share of shares){await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[rows[0].id,share.userId,share.shareCents])}await client.query('COMMIT');res.status(201).json({id:rows[0].id})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/settlements-v1',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const toUserId=String(req.body?.toUserId||''),amountCents=toWholeTwdCents(req.body?.amount);
  if(!toUserId||toUserId===req.userId||!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'轉帳資料不正確'});
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);const {rows}=await client.query(BALANCE_SQL,[req.params.id]);const from=rows.find(x=>x.id===req.userId),to=rows.find(x=>x.id===toUserId);if(!from||!to)return res.status(400).json({error:'收款人不在群組中'});const maximum=Math.min(-Number(from.balanceCents),Number(to.balanceCents));if(maximum<=0||amountCents>maximum){await client.query('ROLLBACK');return res.status(400).json({error:'轉帳金額超過目前應付金額'})}await client.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$2)',[req.params.id,req.userId,toUserId,amountCents]);await client.query('COMMIT');res.status(201).json({ok:true})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.use(express.static(path.join(__dirname,'dist'),{maxAge:'1h'}));
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'dist','index.html'));next()});
app.use((err,req,res,_next)=>{console.error(err);if(req.path.startsWith('/api/'))return res.status(500).json({error:'伺服器暫時發生問題'});res.status(500).send('Server error')});

migrate().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`旅帳 TripTab listening on ${PORT}`))).catch(err=>{console.error('Database migration failed',err);process.exit(1)});
