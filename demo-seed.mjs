import crypto from 'node:crypto';
import {allocateByWeights,allocateEqual,allocateHybrid} from './finance.mjs';

export async function seedDemo(pool,owner){
  const existing=await pool.query('SELECT id,invite_token AS "inviteToken" FROM groups WHERE owner_id=$1 AND name=$2',[owner.id,'東大小羅｜16人包棟測試']);
  if(existing.rows[0])return{...existing.rows[0],created:false};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const token=crypto.randomBytes(18).toString('base64url');
    const {rows:[group]}=await client.query(`INSERT INTO groups(name,description,currency,invite_token,owner_id) VALUES($1,$2,'TWD',$3,$4) RETURNING id,invite_token AS "inviteToken"`,['東大小羅｜16人包棟測試','莊冠霖＋15 位測試旅伴的完整分帳情境',token,owner.id]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[group.id,owner.id]);
    const names=['林子晴','陳柏翰','王語彤','李承恩','張雅雯','黃冠宇','吳品妤','劉俊傑','蔡宜庭','楊子豪','許家瑋','鄭心怡','謝孟軒','郭雨潔','周柏廷'];
    const members=[owner];
    for(let i=0;i<names.length;i++){const {rows:[user]}=await client.query(`INSERT INTO users(line_user_id,display_name,is_virtual) VALUES($1,$2,false) RETURNING id,display_name AS "displayName"`,[`demo:${group.id}:${i}`,names[i]]);members.push(user);await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",[group.id,user.id])}
    const {rows:[fund]}=await client.query(`INSERT INTO users(line_user_id,display_name,is_virtual) VALUES($1,'旅費公費',true) RETURNING id,display_name AS "displayName"`,[`fund:${group.id}`]);await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'fund')",[group.id,fund.id]);
    const ids=members.map(x=>x.id);
    const addExpense=async({title,total,payments,shares,category='其他',daysAgo=0})=>{const {rows:[expense]}=await client.query(`INSERT INTO expenses(group_id,title,amount_cents,payer_id,created_by,category,expense_date,created_at) VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE-$7::int,now()-($7::text||' days')::interval) RETURNING id`,[group.id,title,total,payments[0].userId,owner.id,category,daysAgo]);for(const p of payments)await client.query('INSERT INTO expense_payments(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,p.userId,p.paymentCents]);for(const s of shares)await client.query('INSERT INTO expense_shares(expense_id,user_id,amount_cents) VALUES($1,$2,$3)',[expense.id,s.userId,s.shareCents])};
    await addExpense({title:'包棟民宿尾款（兩人合付）',total:1_400_000,payments:[{userId:ids[0],paymentCents:1_000_000},{userId:ids[1],paymentCents:400_000}],shares:allocateEqual(1_400_000,ids),category:'住宿',daysAgo:6});
    await addExpense({title:'烤肉食材',total:280_000,payments:[{userId:ids[2],paymentCents:280_000}],shares:allocateEqual(280_000,ids),category:'餐飲',daysAgo:5});
    await addExpense({title:'酒水（只有 10 人喝）',total:120_000,payments:[{userId:ids[3],paymentCents:120_000}],shares:allocateEqual(120_000,ids.slice(0,10)),category:'餐飲',daysAgo:5});
    await addExpense({title:'熱炒（指定後剩餘均分）',total:450_000,payments:[{userId:ids[0],paymentCents:450_000}],shares:allocateHybrid(450_000,ids,[{userId:ids[0],shareCents:80_000},{userId:ids[1],shareCents:20_000}]),category:'餐飲',daysAgo:4});
    await addExpense({title:'住宿天數比例',total:300_000,payments:[{userId:ids[4],paymentCents:300_000}],shares:allocateByWeights(300_000,ids.map((userId,index)=>({userId,weight:index<2?1:2}))),category:'住宿',daysAgo:4});
    await addExpense({title:'幫子晴代購飲料',total:12_500,payments:[{userId:ids[0],paymentCents:12_500}],shares:[{userId:ids[1],shareCents:12_500}],category:'購物',daysAgo:3});
    await addExpense({title:'宵夜（三人均分尾數）',total:100_000,payments:[{userId:ids[5],paymentCents:100_000}],shares:allocateEqual(100_000,ids.slice(5,8)),category:'餐飲',daysAgo:2});
    await addExpense({title:'民宿退還押金',total:-200_000,payments:[{userId:ids[0],paymentCents:-200_000}],shares:allocateEqual(-200_000,ids),category:'住宿',daysAgo:1});
    for(const userId of ids)await client.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by,created_at) VALUES($1,$2,$3,100000,$4,now()-interval \'7 days\')',[group.id,userId,fund.id,owner.id]);
    await addExpense({title:'公費購買團體門票',total:320_000,payments:[{userId:fund.id,paymentCents:320_000}],shares:allocateEqual(320_000,ids),category:'其他',daysAgo:1});
    const balances=await client.query(`SELECT u.id,(COALESCE(p.paid,0)-COALESCE(o.owed,0)+COALESCE(so.sent,0)-COALESCE(si.received,0))::bigint balance FROM group_members gm JOIN users u ON u.id=gm.user_id LEFT JOIN(SELECT ep.user_id,SUM(ep.amount_cents) paid FROM expense_payments ep JOIN expenses e ON e.id=ep.expense_id WHERE e.group_id=$1 GROUP BY ep.user_id)p ON p.user_id=u.id LEFT JOIN(SELECT es.user_id,SUM(es.amount_cents) owed FROM expense_shares es JOIN expenses e ON e.id=es.expense_id WHERE e.group_id=$1 GROUP BY es.user_id)o ON o.user_id=u.id LEFT JOIN(SELECT from_user_id,SUM(amount_cents) sent FROM settlement_payments WHERE group_id=$1 GROUP BY from_user_id)so ON so.from_user_id=u.id LEFT JOIN(SELECT to_user_id,SUM(amount_cents) received FROM settlement_payments WHERE group_id=$1 GROUP BY to_user_id)si ON si.to_user_id=u.id WHERE gm.group_id=$1`,[group.id]);
    const debtor=balances.rows.filter(x=>Number(x.balance)<0&&x.id!==fund.id).sort((a,b)=>Number(a.balance)-Number(b.balance))[0]||balances.rows.filter(x=>Number(x.balance)<0).sort((a,b)=>Number(a.balance)-Number(b.balance))[0],creditor=balances.rows.filter(x=>Number(x.balance)>0).sort((a,b)=>Number(b.balance)-Number(a.balance))[0];if(debtor&&creditor){const amount=Math.min(50_000,-Number(debtor.balance),Number(creditor.balance));await client.query('INSERT INTO settlement_payments(group_id,from_user_id,to_user_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$5)',[group.id,debtor.id,creditor.id,amount,owner.id])}
    await client.query('COMMIT');return{...group,created:true,members:16,expenses:9};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
