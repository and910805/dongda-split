import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8080';
async function request(path,{cookie,method='GET',body}={}){const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||`${method} ${path} failed`),{status:response.status});return{data,response}}
async function login(name){const {response}=await request('/api/dev-login',{method:'POST',body:{name}});const cookie=(response.headers.getSetCookie?.()[0]||response.headers.get('set-cookie')).split(';')[0];const {data}=await request('/api/me',{cookie});return{cookie,user:data}}
const post=(cookie,path,body)=>request(path,{cookie,method:'POST',body}).then(x=>x.data);
async function expectStatus(status,promise){try{await promise;assert.fail(`expected HTTP ${status}`)}catch(error){assert.equal(error.status,status)}}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});

try{
  const actors=[];for(let i=1;i<=14;i++)actors.push(await login(`ScenarioMember${i}`));
  const owner=actors[0],group=await post(owner.cookie,'/api/groups',{name:'scenario-e2e',description:'scenario automated test'});
  for(const actor of actors.slice(1))await post(actor.cookie,`/api/invites/${group.inviteToken}/join`,{});
  const ids=actors.map(x=>x.user.id);

  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'多人共同墊付',amount:14000,payers:[{userId:ids[0],amount:10000},{userId:ids[1],amount:4000}],participantIds:ids,splitMode:'equal'});
  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'只有十人喝酒',amount:1200,payerId:ids[0],participantIds:ids.slice(0,10),splitMode:'equal'});
  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'熱炒指定後均分',amount:4500,payerId:ids[2],participantIds:ids,splitMode:'hybrid',fixedShares:[{userId:ids[0],amount:800},{userId:ids[1],amount:200}]});
  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'按住宿天數',amount:26000,payerId:ids[3],splitMode:'weights',weights:ids.map((userId,index)=>({userId,weight:index<2?1:2}))});
  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'代購',amount:125,payerId:ids[0],participantIds:[ids[1]],splitMode:'equal'});
  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'兩人不等額',amount:1000,payerId:ids[4],splitMode:'exact',shares:[{userId:ids[4],amount:600},{userId:ids[5],amount:400}]});
  await post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'退押金',kind:'refund',amount:2000,payerId:ids[0],participantIds:ids,splitMode:'equal'});
  await expectStatus(400,post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'錯誤付款加總',amount:1000,payers:[{userId:ids[0],amount:900}],participantIds:ids,splitMode:'equal'}));
  await expectStatus(400,post(owner.cookie,`/api/groups/${group.id}/expenses`,{title:'錯誤分攤加總',amount:1000,payerId:ids[0],splitMode:'exact',shares:[{userId:ids[0],amount:999}]}));
  const {data:detail}=await request(`/api/groups/${group.id}`,{cookie:actors[13].cookie});
  assert.equal(detail.members.filter(x=>!x.isFund).length,14);assert.equal(detail.expenses.length,7);assert.equal(detail.expenses.find(x=>x.title==='多人共同墊付').payerCount,2);assert.equal(detail.expenses.find(x=>x.title==='只有十人喝酒').shareCount,10);assert.ok(detail.expenses.find(x=>x.title==='退押金').amountCents<0);assert.equal(detail.balances.reduce((sum,x)=>sum+x.balanceCents,0),0);
  const purchase=detail.expenses.find(x=>x.title==='代購');assert.equal(purchase.payments.length,1);assert.equal(purchase.shares.length,1);
  await expectStatus(403,request(`/api/groups/${group.id}/expenses/${purchase.id}`,{cookie:actors[1].cookie,method:'PATCH',body:{title:'不能亂改',amount:130,payerId:ids[0],participantIds:[ids[1]],splitMode:'equal'}}));
  await request(`/api/groups/${group.id}/expenses/${purchase.id}`,{cookie:owner.cookie,method:'PATCH',body:{title:'代購（已修正）',amount:130,payerId:ids[0],participantIds:[ids[1]],splitMode:'equal'}});
  const {data:edited}=await request(`/api/groups/${group.id}`,{cookie:owner.cookie});const editedPurchase=edited.expenses.find(x=>x.id===purchase.id);assert.equal(editedPurchase.title,'代購（已修正）');assert.equal(editedPurchase.amountCents,13000);assert.equal(editedPurchase.payments[0].amountCents,13000);assert.equal(editedPurchase.shares[0].amountCents,13000);assert.equal(edited.balances.reduce((sum,x)=>sum+x.balanceCents,0),0);

  await expectStatus(410,post(owner.cookie,`/api/groups/${group.id}/funds`,{name:'公費'}));

  const settleGroup=await post(owner.cookie,'/api/groups',{name:'settle-e2e',description:'scenario automated test'});await post(actors[1].cookie,`/api/invites/${settleGroup.inviteToken}/join`,{});await post(owner.cookie,`/api/groups/${settleGroup.id}/expenses`,{title:'兩人晚餐',amount:1000,payerId:ids[0],participantIds:[ids[0],ids[1]],splitMode:'equal'});const {data:before}=await request(`/api/groups/${settleGroup.id}`,{cookie:actors[1].cookie});const transfer=before.settlements[0];await post(actors[1].cookie,`/api/groups/${settleGroup.id}/settlements`,{toUserId:ids[0],amount:transfer.amountCents/100});const {data:after}=await request(`/api/groups/${settleGroup.id}`,{cookie:owner.cookie});assert.equal(after.settlements.length,0);assert.ok(after.balances.every(x=>x.balanceCents===0));
  console.log('ALL_DATABASE_SCENARIOS_OK');
}finally{
  await pool.query("DELETE FROM groups WHERE description='scenario automated test'");
  await pool.query("DELETE FROM users WHERE line_user_id LIKE 'dev-ScenarioMember%' AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=users.id)");
  await pool.query("DELETE FROM users WHERE is_virtual=true AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=users.id)");
  await pool.end();
}
