import 'dotenv/config.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8080';
async function request(path,{cookie,method='GET',body}={}){const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||`${method} ${path} failed`),{status:response.status});return{data,response}}
const sessionCookie=response=>(response.headers.getSetCookie?.()[0]||response.headers.get('set-cookie')).split(';')[0];
async function login(name){const {response}=await request('/api/dev-login',{method:'POST',body:{name}});const cookie=sessionCookie(response);const {data}=await request('/api/me',{cookie});return{cookie,user:data}}
const post=(cookie,path,body)=>request(path,{cookie,method:'POST',body}).then(x=>x.data);
async function expectStatus(status,promise){try{await promise;assert.fail(`expected HTTP ${status}`)}catch(error){assert.equal(error.status,status)}}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
let adminUserId=null,adminRoleBefore=null;
const simulatedUserIds=[];
const simulationRunId=crypto.randomUUID().slice(0,8);
const simulationNote=`scenario automated test ${simulationRunId}`;

try{
  const actors=[];for(let i=1;i<=14;i++)actors.push(await login(`ScenarioMember${i}`));
  const admin=await login('本機小羅');
  adminUserId=admin.user.id;
  const {rows:[existingAdmin]}=await pool.query('SELECT is_superuser FROM users WHERE id=$1',[adminUserId]);
  adminRoleBefore=existingAdmin;
  await pool.query('UPDATE users SET is_superuser=true WHERE id=$1',[adminUserId]);
  const {data:adminMe}=await request('/api/me',{cookie:admin.cookie});
  admin.user=adminMe;
  const owner=actors[0],group=await post(owner.cookie,'/api/groups',{name:'scenario-e2e',description:'scenario automated test'});
  for(const actor of actors.slice(1))await post(actor.cookie,`/api/invites/${group.inviteToken}/join`,{});
  const ids=actors.map(x=>x.user.id);

  await expectStatus(403,request('/api/admin/overview',{cookie:owner.cookie}));
  const {data:adminOverview}=await request('/api/admin/overview',{cookie:admin.cookie});
  assert.equal(admin.user.isSuperuser,true);
  assert.ok(adminOverview.users.some(user=>user.id===owner.user.id));
  assert.ok(adminOverview.groups.some(item=>item.id===group.id));
  await expectStatus(403,request('/api/admin/simulated-accounts',{cookie:owner.cookie,method:'POST',body:{displayName:'無權建立'}}));
  await expectStatus(400,request('/api/admin/simulated-accounts',{cookie:admin.cookie,method:'POST',body:{displayName:'  '}}));
  const simulatedName=`Scenario模擬旅伴A-${simulationRunId}`;
  const {data:simulatedAccount,response:simulatedCreateResponse}=await request('/api/admin/simulated-accounts',{cookie:admin.cookie,method:'POST',body:{displayName:simulatedName,note:simulationNote}});
  simulatedUserIds.push(simulatedAccount.id);
  assert.equal(simulatedCreateResponse.status,201);
  assert.equal(simulatedAccount.displayName,simulatedName);
  assert.equal(simulatedAccount.isSimulated,true);
  await expectStatus(409,request('/api/admin/simulated-accounts',{cookie:admin.cookie,method:'POST',body:{displayName:simulatedName,note:'duplicate'}}));
  const {data:overviewWithSimulation}=await request('/api/admin/overview',{cookie:admin.cookie});
  assert.equal(overviewWithSimulation.stats.simulatedAccountCount>=1,true);
  assert.ok(overviewWithSimulation.simulatedAccounts.some(account=>account.id===simulatedAccount.id&&account.isSimulated===true));
  assert.ok(!overviewWithSimulation.users.some(user=>user.id===simulatedAccount.id));
  await expectStatus(403,request(`/api/admin/simulated-accounts/${simulatedAccount.id}/session`,{cookie:owner.cookie,method:'POST'}));
  await expectStatus(400,request('/api/admin/simulated-accounts/not-a-uuid/session',{cookie:admin.cookie,method:'POST'}));
  await expectStatus(400,request(`/api/admin/users/${simulatedAccount.id}/superuser`,{cookie:admin.cookie,method:'PATCH',body:{isSuperuser:true}}));
  const {response:simulationResponse}=await request(`/api/admin/simulated-accounts/${simulatedAccount.id}/session`,{cookie:admin.cookie,method:'POST'});
  const simulatedCookie=sessionCookie(simulationResponse);
  const {data:simulatedMe}=await request('/api/me',{cookie:simulatedCookie});
  assert.equal(simulatedMe.id,simulatedAccount.id);
  assert.equal(simulatedMe.isSimulated,true);
  assert.equal(simulatedMe.isSuperuser,false);
  assert.equal(simulatedMe.simulation.active,true);
  assert.equal(simulatedMe.simulation.actor.id,admin.user.id);
  await expectStatus(403,request('/api/admin/overview',{cookie:simulatedCookie}));
  const simulatedGroup=await post(simulatedCookie,'/api/groups',{name:'simulation-e2e',description:'scenario automated test'});
  const secondSimulatedName=`Scenario模擬旅伴B-${simulationRunId}`;
  const secondSimulated=await post(admin.cookie,'/api/admin/simulated-accounts',{displayName:secondSimulatedName,note:simulationNote});
  simulatedUserIds.push(secondSimulated.id);
  const {response:simulationExitResponse}=await request('/api/admin/simulation/exit',{cookie:simulatedCookie,method:'POST'});
  const restoredAdminCookie=sessionCookie(simulationExitResponse);
  const {data:restoredAdmin}=await request('/api/me',{cookie:restoredAdminCookie});
  assert.equal(restoredAdmin.id,admin.user.id);
  assert.equal(restoredAdmin.isSuperuser,true);
  assert.equal(restoredAdmin.simulation,null);
  await expectStatus(401,request('/api/groups',{cookie:simulatedCookie}));
  const {response:secondSimulationResponse}=await request(`/api/admin/simulated-accounts/${secondSimulated.id}/session`,{cookie:admin.cookie,method:'POST'});
  const secondSimulatedCookie=sessionCookie(secondSimulationResponse);
  await post(secondSimulatedCookie,`/api/invites/${simulatedGroup.inviteToken}/join`,{});
  await expectStatus(403,post(owner.cookie,`/api/invites/${simulatedGroup.inviteToken}/join`,{}));
  await expectStatus(403,post(secondSimulatedCookie,`/api/invites/${group.inviteToken}/join`,{}));
  const {data:simulatedGroupDetail}=await request(`/api/groups/${simulatedGroup.id}`,{cookie:secondSimulatedCookie});
  assert.equal(simulatedGroupDetail.members.filter(member=>!member.isFund).length,2);
  await request('/api/admin/simulation/exit',{cookie:secondSimulatedCookie,method:'POST'});
  await expectStatus(401,request('/api/groups',{cookie:secondSimulatedCookie}));
  const {response:expenseSimulationResponse}=await request(`/api/admin/simulated-accounts/${simulatedAccount.id}/session`,{cookie:admin.cookie,method:'POST'});
  const expenseSimulatedCookie=sessionCookie(expenseSimulationResponse);
  await post(expenseSimulatedCookie,`/api/groups/${simulatedGroup.id}/expenses`,{
    title:'模擬住宿費',
    amount:1200,
    payerId:simulatedAccount.id,
    participantIds:[simulatedAccount.id,secondSimulated.id],
    splitMode:'equal'
  });
  const {data:simulatedLedger}=await request(`/api/groups/${simulatedGroup.id}`,{cookie:expenseSimulatedCookie});
  assert.equal(simulatedLedger.expenses.some(expense=>expense.title==='模擬住宿費'),true);
  const simulatedTransfer=simulatedLedger.settlements.find(item=>item.from.id===secondSimulated.id&&item.to.id===simulatedAccount.id);
  assert.equal(simulatedTransfer.amountCents,60000);
  await request('/api/admin/simulation/exit',{cookie:expenseSimulatedCookie,method:'POST'});
  const {response:settlementSimulationResponse}=await request(`/api/admin/simulated-accounts/${secondSimulated.id}/session`,{cookie:admin.cookie,method:'POST'});
  const settlementSimulatedCookie=sessionCookie(settlementSimulationResponse);
  await post(settlementSimulatedCookie,`/api/groups/${simulatedGroup.id}/settlements`,{
    fromUserId:secondSimulated.id,
    toUserId:simulatedAccount.id,
    amount:simulatedTransfer.amountCents/100
  });
  const {data:simulatedSettled}=await request(`/api/groups/${simulatedGroup.id}`,{cookie:settlementSimulatedCookie});
  assert.equal(simulatedSettled.settlements.length,0);
  assert.equal(simulatedSettled.settlementHistory.length,1);
  await request('/api/admin/simulation/exit',{cookie:settlementSimulatedCookie,method:'POST'});
  await expectStatus(400,request('/api/admin/simulation/exit',{cookie:admin.cookie,method:'POST'}));
  const {data:overviewAfterSimulation}=await request('/api/admin/overview',{cookie:admin.cookie});
  assert.ok(overviewAfterSimulation.auditLog.some(item=>item.action==='create_simulated_account'&&item.targetId===simulatedAccount.id));
  assert.ok(overviewAfterSimulation.auditLog.some(item=>item.action==='start_account_simulation'&&item.targetId===simulatedAccount.id));
  assert.ok(overviewAfterSimulation.auditLog.some(item=>item.action==='end_account_simulation'&&item.targetId===simulatedAccount.id));
  const promoted=actors[13];
  const {data:promotedRole}=await request(`/api/admin/users/${promoted.user.id}/superuser`,{cookie:admin.cookie,method:'PATCH',body:{isSuperuser:true}});
  assert.equal(promotedRole.isSuperuser,true);
  const {data:promotedMe}=await request('/api/me',{cookie:promoted.cookie});
  assert.equal(promotedMe.isSuperuser,true);
  await expectStatus(400,request(`/api/admin/users/${admin.user.id}/superuser`,{cookie:admin.cookie,method:'PATCH',body:{isSuperuser:false}}));
  const foreignSimulated=await post(promoted.cookie,'/api/admin/simulated-accounts',{
    displayName:`Scenario模擬旅伴C-${simulationRunId}`,
    note:simulationNote
  });
  simulatedUserIds.push(foreignSimulated.id);
  const {response:foreignSimulationResponse}=await request(`/api/admin/simulated-accounts/${foreignSimulated.id}/session`,{cookie:promoted.cookie,method:'POST'});
  const foreignSimulatedCookie=sessionCookie(foreignSimulationResponse);
  await expectStatus(403,post(foreignSimulatedCookie,`/api/invites/${simulatedGroup.inviteToken}/join`,{}));
  const {data:revokedRole}=await request(`/api/admin/users/${promoted.user.id}/superuser`,{cookie:admin.cookie,method:'PATCH',body:{isSuperuser:false}});
  assert.equal(revokedRole.isSuperuser,false);
  await expectStatus(401,request('/api/groups',{cookie:foreignSimulatedCookie}));
  const {response:foreignSimulationExitResponse}=await request('/api/admin/simulation/exit',{cookie:foreignSimulatedCookie,method:'POST'});
  const restoredPromotedCookie=sessionCookie(foreignSimulationExitResponse);
  const {data:restoredPromoted}=await request('/api/me',{cookie:restoredPromotedCookie});
  assert.equal(restoredPromoted.id,promoted.user.id);
  assert.equal(restoredPromoted.isSuperuser,false);
  const {data:adminGroupView}=await request(`/api/groups/${group.id}`,{cookie:admin.cookie});
  assert.equal(adminGroupView.id,group.id);

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
  assert.equal(detail.members.filter(x=>!x.isFund).length,14);assert.equal(detail.expenses.length,7);assert.equal(detail.expenses.find(x=>x.title==='多人共同墊付').payerCount,2);assert.equal(detail.expenses.find(x=>x.title==='只有十人喝酒').shareCount,10);assert.equal(detail.expenses.find(x=>x.title==='熱炒指定後均分').splitMode,'hybrid');assert.equal(detail.expenses.find(x=>x.title==='按住宿天數').splitMode,'weights');assert.equal(detail.expenses.find(x=>x.title==='兩人不等額').splitMode,'exact');assert.ok(detail.expenses.find(x=>x.title==='退押金').amountCents<0);assert.equal(detail.balances.reduce((sum,x)=>sum+x.balanceCents,0),0);
  const hybridExpense=detail.expenses.find(x=>x.title==='熱炒指定後均分'),weightedExpense=detail.expenses.find(x=>x.title==='按住宿天數'),exactExpense=detail.expenses.find(x=>x.title==='兩人不等額');
  assert.deepEqual(hybridExpense.splitMeta.participantIds,ids);assert.deepEqual(hybridExpense.splitMeta.fixedShares,[{userId:ids[0],amount:800},{userId:ids[1],amount:200}]);assert.deepEqual(weightedExpense.splitMeta.weights,ids.map((userId,index)=>({userId,weight:index<2?1:2})));assert.deepEqual(exactExpense.splitMeta.shares,[{userId:ids[4],amount:600},{userId:ids[5],amount:400}]);
  const purchase=detail.expenses.find(x=>x.title==='代購');assert.equal(purchase.payments.length,1);assert.equal(purchase.shares.length,1);
  await expectStatus(403,request(`/api/groups/${group.id}/expenses/${purchase.id}`,{cookie:actors[1].cookie,method:'PATCH',body:{title:'不能亂改',amount:130,payerId:ids[0],participantIds:[ids[1]],splitMode:'equal'}}));
  await request(`/api/groups/${group.id}/expenses/${purchase.id}`,{cookie:admin.cookie,method:'PATCH',body:{title:'代購（管理者修正）',amount:125,payerId:ids[0],participantIds:[ids[1]],splitMode:'equal'}});
  const {data:adminEdited}=await request(`/api/groups/${group.id}`,{cookie:owner.cookie});
  assert.equal(adminEdited.expenses.find(x=>x.id===purchase.id).title,'代購（管理者修正）');
  const {data:overviewAfterAdminEdit}=await request('/api/admin/overview',{cookie:admin.cookie});
  assert.ok(overviewAfterAdminEdit.auditLog.some(item=>item.action==='update_expense'&&item.targetId===purchase.id));
  await request(`/api/groups/${group.id}/expenses/${purchase.id}`,{cookie:owner.cookie,method:'PATCH',body:{title:'代購（已修正）',amount:130,payerId:ids[0],participantIds:[ids[1]],splitMode:'equal'}});
  const {data:edited}=await request(`/api/groups/${group.id}`,{cookie:owner.cookie});const editedPurchase=edited.expenses.find(x=>x.id===purchase.id);assert.equal(editedPurchase.title,'代購（已修正）');assert.equal(editedPurchase.amountCents,13000);assert.equal(editedPurchase.payments[0].amountCents,13000);assert.equal(editedPurchase.shares[0].amountCents,13000);assert.equal(edited.balances.reduce((sum,x)=>sum+x.balanceCents,0),0);

  await expectStatus(410,post(owner.cookie,`/api/groups/${group.id}/funds`,{name:'公費'}));

  const legacyGroup=await post(owner.cookie,'/api/groups',{name:'legacy-ledger-e2e',description:'scenario automated test'});
  await post(actors[1].cookie,`/api/invites/${legacyGroup.inviteToken}/join`,{});
  await post(owner.cookie,`/api/groups/${legacyGroup.id}/expenses-v1`,{title:'舊版端點零和驗證',amount:100,payerId:ids[0],participantIds:[ids[0],ids[1]]});
  const {data:legacyBefore}=await request(`/api/groups/${legacyGroup.id}`,{cookie:actors[1].cookie});
  assert.equal(legacyBefore.balances.reduce((sum,item)=>sum+item.balanceCents,0),0);
  assert.equal(legacyBefore.expenses[0].payments.reduce((sum,item)=>sum+item.amountCents,0),10000);
  const legacyTransfer=legacyBefore.settlements.find(item=>item.from.id===ids[1]&&item.to.id===ids[0]);
  assert.equal(legacyTransfer.amountCents,5000);
  await post(actors[1].cookie,`/api/groups/${legacyGroup.id}/settlements-v1`,{toUserId:ids[0],amount:legacyTransfer.amountCents/100});
  const {data:legacyAfter}=await request(`/api/groups/${legacyGroup.id}`,{cookie:owner.cookie});
  assert.ok(legacyAfter.balances.every(item=>item.balanceCents===0));
  assert.equal(legacyAfter.settlements.length,0);

  const settleGroup=await post(owner.cookie,'/api/groups',{name:'settle-e2e',description:'scenario automated test'});
  await post(actors[1].cookie,`/api/invites/${settleGroup.inviteToken}/join`,{});
  await post(actors[2].cookie,`/api/invites/${settleGroup.inviteToken}/join`,{});
  await post(owner.cookie,`/api/groups/${settleGroup.id}/expenses`,{title:'兩人晚餐',amount:1000,payerId:ids[0],participantIds:[ids[0],ids[1]],splitMode:'equal'});
  const {data:before}=await request(`/api/groups/${settleGroup.id}`,{cookie:actors[1].cookie});
  const transfer=before.settlements[0];
  const reportPayload={fromUserId:ids[1],toUserId:ids[0],amount:transfer.amountCents/100};
  await expectStatus(403,post(actors[2].cookie,`/api/groups/${settleGroup.id}/settlements`,reportPayload));
  await expectStatus(403,post(owner.cookie,`/api/groups/${settleGroup.id}/settlements`,reportPayload));
  const {data:reportResult,response:reportResponse}=await request(`/api/groups/${settleGroup.id}/settlements`,{cookie:actors[1].cookie,method:'POST',body:reportPayload});
  assert.equal(reportResponse.status,201);
  assert.equal(reportResult.ok,true);
  assert.equal(reportResult.reportStatus,'reported');
  assert.equal(reportResult.verificationStatus,'unverified');
  assert.ok(Number.isFinite(new Date(reportResult.reportedAt).getTime()));
  await expectStatus(400,post(actors[1].cookie,`/api/groups/${settleGroup.id}/settlements`,reportPayload));
  const {data:after}=await request(`/api/groups/${settleGroup.id}`,{cookie:owner.cookie});
  assert.equal(after.settlements.length,0);
  assert.ok(after.balances.every(x=>x.balanceCents===0));
  assert.equal(after.settlementHistory.length,1);
  assert.equal(after.settlementHistory[0].from.id,ids[1]);
  assert.equal(after.settlementHistory[0].to.id,ids[0]);
  assert.equal(after.settlementHistory[0].amountCents,transfer.amountCents);
  assert.equal(after.settlementHistory[0].confirmedBy.id,ids[1]);
  assert.equal(after.settlementHistory[0].reportedBy.id,ids[1]);
  assert.equal(after.settlementHistory[0].reportStatus,'reported');
  assert.equal(after.settlementHistory[0].verificationStatus,'unverified');
  assert.equal(new Date(after.settlementHistory[0].createdAt).getTime(),new Date(reportResult.reportedAt).getTime());

  const bankOwner=actors[0],bankDebtor=actors[1],bankObserver=actors[2];
  await request('/api/me/bank-account',{cookie:bankOwner.cookie,method:'DELETE'});
  const bankGroup=await post(bankOwner.cookie,'/api/groups',{name:'bank-account-e2e',description:'scenario automated test'});
  await post(bankDebtor.cookie,`/api/invites/${bankGroup.inviteToken}/join`,{});
  await post(bankObserver.cookie,`/api/invites/${bankGroup.inviteToken}/join`,{});
  await post(bankOwner.cookie,`/api/groups/${bankGroup.id}/expenses`,{title:'銀行帳戶授權測試',amount:1000,payerId:bankOwner.user.id,participantIds:[bankOwner.user.id,bankDebtor.user.id],splitMode:'equal'});
  const {data:bankBefore}=await request(`/api/groups/${bankGroup.id}`,{cookie:bankDebtor.cookie});
  const bankTransfer=bankBefore.settlements.find(item=>item.from.id===bankDebtor.user.id&&item.to.id===bankOwner.user.id);
  assert.ok(bankTransfer);
  assert.equal(bankTransfer.amountCents,50000);
  assert.deepEqual(bankTransfer.bankAccountAccess,{shared:false,canView:true,canShare:false});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie}));
  await expectStatus(400,post(bankOwner.cookie,`/api/groups/${bankGroup.id}/settlements/${bankDebtor.user.id}/bank-account-access`,{}));
  const bankAccount={bankCode:'012',bankName:'測試銀行',branchCode:'0001',accountHolderName:'ScenarioMember1',accountNumber:'001234567890'};
  await request('/api/me/bank-account',{cookie:bankOwner.cookie,method:'PUT',body:bankAccount});
  const {data:ownBank}=await request('/api/me/bank-account',{cookie:bankOwner.cookie});
  for(const [field,value] of Object.entries(bankAccount))assert.equal(ownBank.bankAccount[field],value);
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie}));
  await post(bankOwner.cookie,`/api/groups/${bankGroup.id}/settlements/${bankDebtor.user.id}/bank-account-access`,{});
  const {data:ownerSharedView}=await request(`/api/groups/${bankGroup.id}`,{cookie:bankOwner.cookie});
  const ownerSharedTransfer=ownerSharedView.settlements.find(item=>item.from.id===bankDebtor.user.id&&item.to.id===bankOwner.user.id);
  assert.deepEqual(ownerSharedTransfer.bankAccountAccess,{shared:true,canView:false,canShare:true});
  const {data:bankReveal}=await request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie});
  assert.equal(bankReveal.recipient.id,bankOwner.user.id);
  assert.equal(bankReveal.amountCents,bankTransfer.amountCents);
  for(const [field,value] of Object.entries(bankAccount))assert.equal(bankReveal.bankAccount[field],value);
  assert.equal(bankReveal.bankAccount.accountNumber.startsWith('00'),true);
  const fakeExpense=await post(bankObserver.cookie,`/api/groups/${bankGroup.id}/expenses`,{title:'偽造欠款不能取得帳戶',amount:200,payerId:bankOwner.user.id,participantIds:[bankObserver.user.id],splitMode:'equal'});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankObserver.cookie}));
  await request(`/api/groups/${bankGroup.id}/expenses/${fakeExpense.id}`,{cookie:bankObserver.cookie,method:'DELETE'});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankOwner.cookie}));
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankObserver.cookie}));
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:admin.cookie}));
  const updatedBankAccount={...bankAccount,accountNumber:'009876543210'};
  await request('/api/me/bank-account',{cookie:bankOwner.cookie,method:'PUT',body:updatedBankAccount});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie}));
  await post(bankOwner.cookie,`/api/groups/${bankGroup.id}/settlements/${bankDebtor.user.id}/bank-account-access`,{});
  const {data:updatedBankReveal}=await request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie});
  assert.equal(updatedBankReveal.bankAccount.accountNumber,updatedBankAccount.accountNumber);
  await request(`/api/groups/${bankGroup.id}/settlements/${bankDebtor.user.id}/bank-account-access`,{cookie:bankOwner.cookie,method:'DELETE'});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie}));
  await post(bankOwner.cookie,`/api/groups/${bankGroup.id}/settlements/${bankDebtor.user.id}/bank-account-access`,{});
  const {data:ordinaryGroupPayload}=await request(`/api/groups/${bankGroup.id}`,{cookie:bankDebtor.cookie});
  const {data:ordinaryMePayload}=await request('/api/me',{cookie:bankOwner.cookie});
  assert.equal(JSON.stringify(ordinaryGroupPayload).includes(updatedBankAccount.accountNumber),false);
  assert.equal(JSON.stringify(ordinaryMePayload).includes(updatedBankAccount.accountNumber),false);
  for(const sensitiveKey of ['bankCode','bankName','branchCode','accountHolderName','accountNumber','ciphertext','iv','authTag']){
    assert.equal(JSON.stringify(ordinaryGroupPayload).includes(`"${sensitiveKey}"`),false);
    assert.equal(JSON.stringify(ordinaryMePayload).includes(`"${sensitiveKey}"`),false);
  }
  await post(bankDebtor.cookie,`/api/groups/${bankGroup.id}/settlements`,{toUserId:bankOwner.user.id,amount:bankTransfer.amountCents/100});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie}));
  const laterDebt=await post(bankOwner.cookie,`/api/groups/${bankGroup.id}/expenses`,{title:'結清後的新欠款需重新授權',amount:300,payerId:bankOwner.user.id,participantIds:[bankOwner.user.id,bankDebtor.user.id],splitMode:'equal'});
  const {data:laterDebtView}=await request(`/api/groups/${bankGroup.id}`,{cookie:bankDebtor.cookie});
  const laterTransfer=laterDebtView.settlements.find(item=>item.from.id===bankDebtor.user.id&&item.to.id===bankOwner.user.id);
  assert.ok(laterTransfer);
  assert.deepEqual(laterTransfer.bankAccountAccess,{shared:false,canView:true,canShare:false});
  await expectStatus(403,request(`/api/groups/${bankGroup.id}/settlements/${bankOwner.user.id}/bank-account`,{cookie:bankDebtor.cookie}));
  await request(`/api/groups/${bankGroup.id}/expenses/${laterDebt.id}`,{cookie:bankOwner.cookie,method:'DELETE'});
  await request('/api/me/bank-account',{cookie:bankOwner.cookie,method:'DELETE'});
  const {data:deletedOwnBank}=await request('/api/me/bank-account',{cookie:bankOwner.cookie});
  assert.equal(deletedOwnBank.bankAccount,null);

  const carryOwner=actors[3],carryPeer=actors[4];
  const carryGroup=await post(carryOwner.cookie,'/api/groups',{name:'settlement-carryover-e2e',description:'scenario automated test'});
  await post(carryPeer.cookie,`/api/invites/${carryGroup.inviteToken}/join`,{});
  await post(carryOwner.cookie,`/api/groups/${carryGroup.id}/expenses`,{title:'已結清舊款',amount:1000,payerId:carryOwner.user.id,participantIds:[carryOwner.user.id,carryPeer.user.id],splitMode:'equal'});
  const {data:oldPending}=await request(`/api/groups/${carryGroup.id}`,{cookie:carryPeer.cookie});
  const oldTransfer=oldPending.settlements.find(item=>item.from.id===carryPeer.user.id&&item.to.id===carryOwner.user.id);
  assert.ok(oldTransfer);
  assert.equal(oldTransfer.amountCents,50000);
  await post(carryPeer.cookie,`/api/groups/${carryGroup.id}/settlements`,{toUserId:carryOwner.user.id,amount:oldTransfer.amountCents/100});
  const {data:oldSettled}=await request(`/api/groups/${carryGroup.id}`,{cookie:carryOwner.cookie});
  assert.equal(oldSettled.settlements.length,0);
  assert.ok(oldSettled.balances.every(item=>item.balanceCents===0));
  assert.equal(oldSettled.settlementHistory.length,1);
  const oldHistorySnapshot=JSON.parse(JSON.stringify(oldSettled.settlementHistory));
  await post(carryOwner.cookie,`/api/groups/${carryGroup.id}/expenses`,{title:'結清後同向新款',amount:600,payerId:carryOwner.user.id,participantIds:[carryPeer.user.id],splitMode:'equal'});
  const {data:sameDirection}=await request(`/api/groups/${carryGroup.id}`,{cookie:carryOwner.cookie});
  assert.equal(sameDirection.balances.find(item=>item.id===carryOwner.user.id).balanceCents,60000);
  assert.equal(sameDirection.balances.find(item=>item.id===carryPeer.user.id).balanceCents,-60000);
  assert.equal(sameDirection.settlements.length,1);
  assert.equal(sameDirection.settlements[0].from.id,carryPeer.user.id);
  assert.equal(sameDirection.settlements[0].to.id,carryOwner.user.id);
  assert.equal(sameDirection.settlements[0].amountCents,60000);
  assert.deepEqual(sameDirection.settlementHistory,oldHistorySnapshot);
  await post(carryPeer.cookie,`/api/groups/${carryGroup.id}/expenses`,{title:'結清後反向新款',amount:900,payerId:carryPeer.user.id,participantIds:[carryOwner.user.id],splitMode:'equal'});
  const {data:reversedDirection}=await request(`/api/groups/${carryGroup.id}`,{cookie:carryPeer.cookie});
  assert.equal(reversedDirection.balances.find(item=>item.id===carryOwner.user.id).balanceCents,-30000);
  assert.equal(reversedDirection.balances.find(item=>item.id===carryPeer.user.id).balanceCents,30000);
  assert.equal(reversedDirection.balances.reduce((sum,item)=>sum+item.balanceCents,0),0);
  assert.equal(reversedDirection.settlements.length,1);
  assert.equal(reversedDirection.settlements[0].from.id,carryOwner.user.id);
  assert.equal(reversedDirection.settlements[0].to.id,carryPeer.user.id);
  assert.equal(reversedDirection.settlements[0].amountCents,30000);
  assert.deepEqual(reversedDirection.settlementHistory,oldHistorySnapshot);
  console.log('ALL_DATABASE_SCENARIOS_OK');
}finally{
  await pool.query("DELETE FROM groups WHERE description='scenario automated test'");
  if(simulatedUserIds.length){
    await pool.query(`DELETE FROM admin_audit_log
      WHERE (target_type='simulated_account' AND target_id=ANY($1::text[]))
         OR (target_type='simulation_session' AND metadata->>'subjectId'=ANY($1::text[]))`,[simulatedUserIds]);
    await pool.query('DELETE FROM account_simulation_sessions WHERE subject_id=ANY($1::uuid[])',[simulatedUserIds]);
    await pool.query(`DELETE FROM users
      WHERE id=ANY($1::uuid[]) AND is_simulated=true
        AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=users.id)`,[simulatedUserIds]);
  }
  await pool.query("DELETE FROM users WHERE line_user_id LIKE 'dev-ScenarioMember%' AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=users.id)");
  await pool.query("DELETE FROM users WHERE is_virtual=true AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=users.id)");
  if(adminUserId&&adminRoleBefore&&!adminRoleBefore.is_superuser)await pool.query('UPDATE users SET is_superuser=false WHERE id=$1',[adminUserId]);
  await pool.end();
}
