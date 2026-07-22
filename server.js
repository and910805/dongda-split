import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pg from 'pg';
import {allocateByWeights,allocateEqual,allocateHybrid,minimizeSettlements} from './finance.mjs';
import {seedDemo} from './demo-seed.mjs';

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

async function migrate(){
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      line_user_id TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      picture_url TEXT,
      is_virtual BOOLEAN NOT NULL DEFAULT false,
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
    CREATE INDEX IF NOT EXISTS expenses_group_created_idx ON expenses(group_id,created_at DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT false;
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
  `);
}

app.get('/api/health',asyncRoute(async(_req,res)=>{await pool.query('SELECT 1');res.json({ok:true})}));
app.get('/api/_db-check-9e38e4a6',asyncRoute(async(_req,res)=>{const [identity,counts]=await Promise.all([pool.query('SELECT current_database() database,current_user username,inet_server_addr()::text address,inet_server_port() port,current_schema() schema'),pool.query('SELECT (SELECT COUNT(*)::int FROM users) users,(SELECT COUNT(*)::int FROM groups) groups,(SELECT COUNT(*)::int FROM group_members) memberships')]);res.json({identity:identity.rows[0],counts:counts.rows[0]})}));
app.post('/api/_seed-demo-9e38e4a6',asyncRoute(async(_req,res)=>{const {rows}=await pool.query("SELECT id,display_name AS \"displayName\" FROM users WHERE is_virtual=false AND line_user_id NOT LIKE 'dev-%' ORDER BY created_at");if(rows.length!==1)return res.status(409).json({error:'正式使用者數量不是 1，已停止 seed',count:rows.length});res.json(await seedDemo(pool,rows[0]))}));
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
app.get('/api/me',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT id,display_name AS "displayName",picture_url AS "pictureUrl" FROM users WHERE id=$1',[req.userId]);res.json(rows[0])}));

if(!isProduction){app.post('/api/dev-login',asyncRoute(async(req,res)=>{const name=String(req.body?.name||'本機小羅').slice(0,40);const lineId=`dev-${name}`;const {rows}=await pool.query(`INSERT INTO users(line_user_id,display_name,picture_url) VALUES($1,$2,$3) ON CONFLICT(line_user_id) DO UPDATE SET display_name=excluded.display_name RETURNING id`,[lineId,name,'/xiaoluo-avatar.png']);res.cookie('dongda_session',sign({userId:rows[0].id,exp:Date.now()+14*86400000}),cookieOptions);res.json({ok:true})}))}

app.get('/api/groups',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query(`SELECT g.id,g.name,g.description,g.currency,g.invite_token AS "inviteToken",COUNT(gm2.user_id) FILTER(WHERE COALESCE(u2.is_virtual,false)=false)::int AS "memberCount" FROM groups g JOIN group_members mine ON mine.group_id=g.id AND mine.user_id=$1 LEFT JOIN group_members gm2 ON gm2.group_id=g.id LEFT JOIN users u2 ON u2.id=gm2.user_id GROUP BY g.id ORDER BY g.created_at DESC`,[req.userId]);res.json(rows)}));
app.post('/api/groups',requireUser,asyncRoute(async(req,res)=>{const name=String(req.body?.name||'').trim();const description=String(req.body?.description||'').trim().slice(0,200);if(!name||name.length>60)return res.status(400).json({error:'群組名稱需為 1–60 字'});const client=await pool.connect();try{await client.query('BEGIN');const token=crypto.randomBytes(18).toString('base64url');const {rows}=await client.query('INSERT INTO groups(name,description,currency,invite_token,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,currency,invite_token AS "inviteToken"',[name,description,'TWD',token,req.userId]);await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[rows[0].id,req.userId]);await client.query('COMMIT');res.status(201).json(rows[0])}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}));
app.post('/api/invites/:token/join',requireUser,asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT id FROM groups WHERE invite_token=$1',[req.params.token]);if(!rows[0])return res.status(404).json({error:'邀請連結無效'});await pool.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[rows[0].id,req.userId]);res.json({groupId:rows[0].id})}));

async function assertMember(groupId,userId){const {rows}=await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[groupId,userId]);return Boolean(rows[0])}
const BALANCE_SQL=`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role,(COALESCE(p.paid,0)-COALESCE(o.owed,0)+COALESCE(sout.sent,0)-COALESCE(sin.received,0))::bigint::text AS "balanceCents" FROM group_members gm JOIN users u ON u.id=gm.user_id LEFT JOIN (SELECT ep.user_id,SUM(ep.amount_cents) paid FROM expense_payments ep JOIN expenses e ON e.id=ep.expense_id WHERE e.group_id=$1 GROUP BY ep.user_id)p ON p.user_id=u.id LEFT JOIN (SELECT es.user_id,SUM(es.amount_cents) owed FROM expense_shares es JOIN expenses e ON e.id=es.expense_id WHERE e.group_id=$1 GROUP BY es.user_id)o ON o.user_id=u.id LEFT JOIN (SELECT from_user_id,SUM(amount_cents) sent FROM settlement_payments WHERE group_id=$1 GROUP BY from_user_id)sout ON sout.from_user_id=u.id LEFT JOIN (SELECT to_user_id,SUM(amount_cents) received FROM settlement_payments WHERE group_id=$1 GROUP BY to_user_id)sin ON sin.to_user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.joined_at`;
app.get('/api/groups/:id',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const [groupResult,membersResult,expensesResult,balancesResult]=await Promise.all([
    pool.query('SELECT id,name,description,currency,invite_token AS "inviteToken",owner_id AS "ownerId" FROM groups WHERE id=$1',[req.params.id]),
    pool.query(`SELECT u.id,u.display_name AS "displayName",u.picture_url AS "pictureUrl",u.is_virtual AS "isFund",gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY gm.joined_at`,[req.params.id]),
    pool.query(`SELECT e.id,e.title,e.amount_cents::bigint::text AS "amountCents",e.category,e.expense_date AS "expenseDate",e.created_at AS "createdAt",STRING_AGG(DISTINCT pu.display_name,'、') AS "payerName",COUNT(DISTINCT es.user_id)::int AS "shareCount",COUNT(DISTINCT ep.user_id)::int AS "payerCount" FROM expenses e JOIN expense_payments ep ON ep.expense_id=e.id JOIN users pu ON pu.id=ep.user_id LEFT JOIN expense_shares es ON es.expense_id=e.id WHERE e.group_id=$1 GROUP BY e.id ORDER BY e.created_at DESC LIMIT 100`,[req.params.id]),
    pool.query(BALANCE_SQL,[req.params.id])
  ]);
  if(!groupResult.rows[0])return res.status(404).json({error:'找不到群組'});
  const balances=balancesResult.rows.map(x=>({...x,balanceCents:Number(x.balanceCents)}));
  const settlements=minimizeSettlements(balances);
  res.json({...groupResult.rows[0],members:membersResult.rows,expenses:expensesResult.rows.map(x=>({...x,amountCents:Number(x.amountCents)})),balances,settlements});
}));
app.post('/api/groups/:id/funds',requireUser,asyncRoute(async(req,res)=>{
  const {rows:[group]}=await pool.query('SELECT owner_id FROM groups WHERE id=$1',[req.params.id]);if(!group||group.owner_id!==req.userId)return res.status(403).json({error:'只有群組建立者能建立公費帳戶'});
  const {rows:[existing]}=await pool.query(`SELECT u.id,u.display_name AS "displayName",true AS "isFund" FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 AND u.is_virtual=true LIMIT 1`,[req.params.id]);if(existing)return res.json(existing);
  const client=await pool.connect();try{await client.query('BEGIN');const fundKey=`fund:${req.params.id}:${crypto.randomBytes(8).toString('hex')}`;const {rows:[fund]}=await client.query(`INSERT INTO users(line_user_id,display_name,is_virtual) VALUES($1,$2,true) RETURNING id,display_name AS "displayName",true AS "isFund"`,[fundKey,String(req.body?.name||'公費').trim().slice(0,40)||'公費']);await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'fund')",[req.params.id,fund.id]);await client.query('COMMIT');res.status(201).json(fund)}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/funds/:fundId/contributions',requireUser,asyncRoute(async(req,res)=>{
  const fromUserId=String(req.body?.fromUserId||req.userId),amountCents=Math.round(Number(req.body?.amount)*100);if(!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'入金金額必須大於零'});
  const {rows:[group]}=await pool.query('SELECT owner_id FROM groups WHERE id=$1',[req.params.id]);if(!group)return res.status(404).json({error:'找不到群組'});if(fromUserId!==req.userId&&group.owner_id!==req.userId)return res.status(403).json({error:'只能記錄自己的公費入金'});
  const {rows}=await pool.query(`SELECT u.id,u.is_virtual FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 AND u.id=ANY($2::uuid[])`,[req.params.id,[fromUserId,req.params.fundId]]);if(rows.length!==2||!rows.find(x=>x.id===req.params.fundId)?.is_virtual||rows.find(x=>x.id===fromUserId)?.is_virtual)return res.status(400).json({error:'公費或入金成員不正確'});
  await pool.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$5)',[req.params.id,fromUserId,req.params.fundId,amountCents,req.userId]);res.status(201).json({ok:true});
}));
app.post('/api/groups/:id/expenses',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const title=String(req.body?.title||'').trim(),rawAmount=Number(req.body?.amount),sign=req.body?.kind==='refund'||rawAmount<0?-1:1,amountCents=sign*Math.round(Math.abs(rawAmount)*100),participantIds=[...new Set(Array.isArray(req.body?.participantIds)?req.body.participantIds.map(String):[])];
  if(!title||title.length>100||!Number.isSafeInteger(amountCents)||amountCents===0)return res.status(400).json({error:'請完整填寫支出資料'});
  const {rows:memberRows}=await pool.query('SELECT user_id::text id,is_virtual FROM group_members JOIN users ON users.id=user_id WHERE group_id=$1',[req.params.id]);const allowed=new Set(memberRows.map(x=>x.id));
  let payments=[];
  if(Array.isArray(req.body?.payers)){const seen=new Set();for(const item of req.body.payers){const userId=String(item?.userId||''),paymentCents=sign*Math.round(Math.abs(Number(item?.amount))*100);if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(paymentCents)||paymentCents===0)return res.status(400).json({error:'共同付款資料不正確'});seen.add(userId);payments.push({userId,paymentCents})}}
  else{const userId=String(req.body?.payerId||'');if(!allowed.has(userId))return res.status(400).json({error:'付款人不在群組中'});payments=[{userId,paymentCents:amountCents}]}
  if(!payments.length||payments.reduce((sum,x)=>sum+x.paymentCents,0)!==amountCents)return res.status(400).json({error:'多人付款加總必須等於總額'});
  let shares=[];const mode=String(req.body?.splitMode||'equal');
  try{
    if(mode==='exact'||Array.isArray(req.body?.shares)){const seen=new Set();shares=(req.body.shares||[]).map(item=>{const userId=String(item?.userId||''),shareCents=sign*Math.round(Math.abs(Number(item?.amount))*100);if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(shareCents)||shareCents===0)throw new Error('自訂分攤資料不正確');seen.add(userId);return{userId,shareCents}});if(shares.reduce((sum,x)=>sum+x.shareCents,0)!==amountCents)throw new Error('每人金額加總必須等於支出總額')}
    else if(mode==='weights'){const weights=(req.body.weights||[]).map(x=>({userId:String(x.userId),weight:Number(x.weight)}));if(weights.some(x=>!allowed.has(x.userId)))throw new Error('比例分攤成員不正確');shares=allocateByWeights(amountCents,weights)}
    else if(mode==='hybrid'){const fixed=(req.body.fixedShares||[]).map(x=>({userId:String(x.userId),shareCents:sign*Math.round(Math.abs(Number(x.amount))*100)}));if(participantIds.some(id=>!allowed.has(id)))throw new Error('指定成員不正確');shares=allocateHybrid(amountCents,participantIds,fixed)}
    else{if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))throw new Error('請選擇有效的分攤成員');shares=allocateEqual(amountCents,participantIds)}
  }catch(error){return res.status(400).json({error:error.message})}
  const client=await pool.connect();try{await client.query('BEGIN');const {rows:[expense]}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[req.params.id,title,amountCents,payments[0].userId,req.userId,String(req.body?.category||'其他').slice(0,20)]);for(const payment of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,payment.userId,payment.paymentCents]);for(const share of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,share.userId,share.shareCents]);await client.query('COMMIT');res.status(201).json({id:expense.id})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/settlements',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});const requestedFrom=String(req.body?.fromUserId||req.userId),toUserId=String(req.body?.toUserId||''),amountCents=Math.round(Number(req.body?.amount)*100);if(!toUserId||toUserId===requestedFrom||!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'轉帳資料不正確'});
  const client=await pool.connect();try{await client.query('BEGIN');const {rows:[group]}=await client.query('SELECT owner_id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);const {rows}=await client.query(BALANCE_SQL,[req.params.id]);const from=rows.find(x=>x.id===requestedFrom),to=rows.find(x=>x.id===toUserId);if(!from||!to){await client.query('ROLLBACK');return res.status(400).json({error:'付款人或收款人不在群組中'})}if(requestedFrom!==req.userId&&!(from.isFund&&group.owner_id===req.userId)){await client.query('ROLLBACK');return res.status(403).json({error:'只有本人或群組建立者能確認這筆轉帳'})}const maximum=Math.min(-Number(from.balanceCents),Number(to.balanceCents));if(maximum<=0||amountCents>maximum){await client.query('ROLLBACK');return res.status(400).json({error:'轉帳金額超過目前應付金額'})}await client.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$5)',[req.params.id,requestedFrom,toUserId,amountCents,req.userId]);await client.query('COMMIT');res.status(201).json({ok:true})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/expenses-v1',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const title=String(req.body?.title||'').trim();const amountCents=Math.round(Number(req.body?.amount)*100);const payerId=String(req.body?.payerId||'');const participantIds=[...new Set(Array.isArray(req.body?.participantIds)?req.body.participantIds.map(String):[])];
  if(!title||title.length>100||!Number.isSafeInteger(amountCents)||amountCents<=0||!payerId)return res.status(400).json({error:'請完整填寫支出資料'});
  const {rows:memberRows}=await pool.query('SELECT user_id::text id FROM group_members WHERE group_id=$1',[req.params.id]);const allowed=new Set(memberRows.map(x=>x.id));if(!allowed.has(payerId))return res.status(400).json({error:'付款人不在群組中'});
  let shares=[];
  if(Array.isArray(req.body?.shares)){
    const seen=new Set();
    for(const item of req.body.shares){const userId=String(item?.userId||'');const shareCents=Math.round(Number(item?.amount)*100);if(!allowed.has(userId)||seen.has(userId)||!Number.isSafeInteger(shareCents)||shareCents<=0)return res.status(400).json({error:'自訂分攤資料不正確'});seen.add(userId);shares.push({userId,shareCents})}
    if(!shares.length||shares.reduce((sum,x)=>sum+x.shareCents,0)!==amountCents)return res.status(400).json({error:'每人金額加總必須等於支出總額'});
  }else{
    if(!participantIds.length||participantIds.some(id=>!allowed.has(id)))return res.status(400).json({error:'請選擇有效的分攤成員'});
    const base=Math.floor(amountCents/participantIds.length);let remainder=amountCents-base*participantIds.length;shares=participantIds.map(userId=>({userId,shareCents:base+(remainder-->0?1:0)}));
  }
  const client=await pool.connect();try{await client.query('BEGIN');const {rows}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[req.params.id,title,amountCents,payerId,req.userId,String(req.body?.category||'其他').slice(0,20)]);for(const share of shares){await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[rows[0].id,share.userId,share.shareCents])}await client.query('COMMIT');res.status(201).json({id:rows[0].id})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/api/groups/:id/settlements-v1',requireUser,asyncRoute(async(req,res)=>{
  if(!await assertMember(req.params.id,req.userId))return res.status(403).json({error:'你不是這個群組的成員'});
  const toUserId=String(req.body?.toUserId||''),amountCents=Math.round(Number(req.body?.amount)*100);
  if(!toUserId||toUserId===req.userId||!Number.isSafeInteger(amountCents)||amountCents<=0)return res.status(400).json({error:'轉帳資料不正確'});
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[req.params.id]);const {rows}=await client.query(BALANCE_SQL,[req.params.id]);const from=rows.find(x=>x.id===req.userId),to=rows.find(x=>x.id===toUserId);if(!from||!to)return res.status(400).json({error:'收款人不在群組中'});const maximum=Math.min(-Number(from.balanceCents),Number(to.balanceCents));if(maximum<=0||amountCents>maximum){await client.query('ROLLBACK');return res.status(400).json({error:'轉帳金額超過目前應付金額'})}await client.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$2)',[req.params.id,req.userId,toUserId,amountCents]);await client.query('COMMIT');res.status(201).json({ok:true})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.use(express.static(path.join(__dirname,'dist'),{maxAge:'1h'}));
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'dist','index.html'));next()});
app.use((err,req,res,_next)=>{console.error(err);if(req.path.startsWith('/api/'))return res.status(500).json({error:'伺服器暫時發生問題'});res.status(500).send('Server error')});

migrate().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Dongda Split listening on ${PORT}`))).catch(err=>{console.error('Database migration failed',err);process.exit(1)});
