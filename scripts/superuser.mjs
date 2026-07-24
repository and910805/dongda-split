import 'dotenv/config.js';
import pg from 'pg';

const {Pool}=pg;
const args=process.argv.slice(2);
const command=args[0];
const userId=args[1];
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if(!process.env.DATABASE_URL){
  console.error('缺少 DATABASE_URL，無法連線到使用者資料庫');
  process.exit(1);
}

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:false}:false
});

async function listUsers(){
  const {rows}=await pool.query(`SELECT id::text,display_name AS "顯示名稱",is_superuser AS "超級使用者",created_at AS "建立時間"
    FROM users WHERE is_virtual=false ORDER BY is_superuser DESC,created_at DESC LIMIT 200`);
  console.table(rows);
}

async function updateRole(nextValue){
  if(!uuidPattern.test(String(userId||'')))throw new Error('請提供有效的使用者 UUID');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const {rows:[target]}=await client.query('SELECT id,display_name,is_virtual,is_superuser FROM users WHERE id=$1',[userId]);
    if(!target)throw new Error('找不到指定的使用者');
    if(target.is_virtual)throw new Error('公費帳號不能設為超級使用者');
    if(!nextValue&&target.is_superuser){
      const {rows:[count]}=await client.query('SELECT COUNT(*)::int AS total FROM users WHERE is_superuser=true AND is_virtual=false');
      if(count.total<=1)throw new Error('系統至少需要保留一位超級使用者');
    }
    await client.query('UPDATE users SET is_superuser=$1,updated_at=now() WHERE id=$2',[nextValue,userId]);
    await client.query('COMMIT');
    console.log(`已${nextValue?'授予':'移除'}「${target.display_name}」的超級使用者權限`);
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}

try{
  if(command==='--list')await listUsers();
  else if(command==='--grant')await updateRole(true);
  else if(command==='--revoke')await updateRole(false);
  else{
    console.log('使用方式：');
    console.log('  npm run superuser -- --list');
    console.log('  npm run superuser -- --grant <使用者 UUID>');
    console.log('  npm run superuser -- --revoke <使用者 UUID>');
  }
}catch(error){
  console.error(`超級使用者設定失敗：${error.message}`);
  process.exitCode=1;
}finally{
  await pool.end();
}
