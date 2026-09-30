import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {canRememberLedger,chooseMemberLedger} from '../src/ledger-preference.mjs';

const source=(await readFile(new URL('../src/ProductApp.jsx',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const section=(start,end)=>{
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`找不到帳本狀態測試所需程式區段 ${start}`);
  return source.slice(from,to);
};
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
  return{promise,resolve,reject};
};

// 保留每次 render 的閉包與正式非同步流程，只替換 React setter 及網路回應
function createHarness(api){
  const state={me:{id:'andy'},activeId:'A',groups:[{id:'A',name:'東京'},{id:'B',name:'大阪'},{id:'C',name:'京都'}],group:{id:'A'},groupLoading:false,groupError:'',notices:[],remembered:[]};
  const ref=current=>({current});
  const context={
    api,useCallback:fn=>fn,me:state.me,activeId:state.activeId,groups:state.groups,
    groupRequestRef:ref(0),groupsRequestRef:ref(0),selectionVersionRef:ref(0),loadedGroupIdRef:ref('A'),userRef:ref(state.me),activeIdRef:ref('A'),adminViewingRef:ref(null),
    canRememberLedger,chooseMemberLedger,readLedgerPreference:()=> 'C',writeLedgerPreference:(...args)=>state.remembered.push(args),
    notify:(message,type='success')=>state.notices.push({message,type}),history:{replaceState(){}},
  };
  for(const key of ['me','activeId','groups','group','groupLoading','groupError','adminMode','adminViewingId','notice']){
    context[`set${key[0].toUpperCase()}${key.slice(1)}`]=value=>{state[key]=typeof value==='function'?value(state[key]):value};
  }
  const runtime=vm.createContext(context);
  vm.runInContext([
    section('  const refreshGroups=useCallback(','  useEffect(()=>{\n    authCheckRef.current='),
    section('  const refreshGroup=useCallback(','  useEffect(()=>{if(me&&activeId)'),
    section('  const logout=async()=>','  const endSimulation='),
    section('  const groupDeleted=async target=>','  const openNewExpense='),
    section('  const openAdminGroup=item=>','  if(loading&&'),
    'globalThis.actions={refreshGroups,refreshGroup,selectGroup,logout,groupDeleted,openAdminGroup};'
  ].join('\n'),runtime);
  return{state,refs:context,...runtime.actions};
}

test('帳本 A 的舊操作在切到 B 後才要求重新整理，不得送出 A 查詢或覆寫選擇',async()=>{
  const requests=[];
  const app=createHarness(async url=>{requests.push(url);return{id:'A',members:[{id:'andy'}]}});
  app.selectGroup('B');
  const requestVersion=app.refs.groupRequestRef.current;
  await app.refreshGroup();
  assert.deepEqual(requests,[]);
  assert.equal(app.refs.groupRequestRef.current,requestVersion);
  assert.equal(app.state.activeId,'B');
  assert.equal(app.state.group,null);
});

test('切換帳本後抵達的舊明細回應不得回寫畫面或記憶偏好',async()=>{
  const response=deferred();
  const app=createHarness(()=>response.promise);
  const refreshing=app.refreshGroup();
  app.selectGroup('B');
  app.state.group={id:'B'};
  response.resolve({id:'A',members:[{id:'andy'}]});
  await refreshing;
  assert.equal(app.state.group.id,'B');
  assert.equal(app.state.activeId,'B');
  assert.deepEqual(app.state.remembered,[]);
});

test('失去帳本存取權時的復原清單不得覆蓋較新的手動選擇',async()=>{
  const response=deferred();
  const app=createHarness(()=>response.promise);
  const recovering=app.refreshGroups({retainCurrent:false,forceMember:true,excludeId:'A'});
  app.selectGroup('B');
  response.resolve([{id:'C'},{id:'B'}]);
  assert.equal(await recovering,null);
  assert.equal(app.state.activeId,'B');
  assert.equal(app.refs.activeIdRef.current,'B');
});

test('管理者臨時帳本會保留在清單，非成員檢視不會寫入偏好',async()=>{
  const app=createHarness(async()=>[{id:'B'},{id:'C'}]);
  app.openAdminGroup({id:'outside',name:'管理者檢視',currency:'TWD',memberCount:2});
  await app.refreshGroups();
  assert.equal(app.state.activeId,'outside');
  assert.equal(app.state.groups[0].id,'outside');
  assert.equal(app.state.groups[0].adminOnly,true);
  assert.deepEqual(app.state.remembered,[]);
});

test('較早發出的帳本清單即使較晚抵達，也不能恢復過期選擇',async()=>{
  const first=deferred(),second=deferred();
  let count=0;
  const app=createHarness(()=>++count===1?first.promise:second.promise);
  const older=app.refreshGroups(),newer=app.refreshGroups();
  second.resolve([{id:'B'}]);
  await newer;
  first.resolve([{id:'A'},{id:'C'}]);
  assert.equal(await older,null);
  assert.equal(app.state.activeId,'B');
  assert.equal(app.state.groups.length,1);
  assert.equal(app.state.groups[0].id,'B');
});

test('登出後抵達的帳本與清單回應不可恢復舊使用者資料',async()=>{
  const detail=deferred(),list=deferred();
  const app=createHarness(url=>url==='/api/auth/logout'?Promise.resolve({ok:true}):url==='/api/groups'?list.promise:detail.promise);
  const refreshing=app.refreshGroup(),listing=app.refreshGroups();
  await app.logout();
  detail.resolve({id:'A',members:[{id:'andy'}]});
  list.resolve([{id:'A'}]);
  await Promise.all([refreshing,listing]);
  assert.equal(app.state.me,null);
  assert.equal(app.state.activeId,null);
  assert.equal(app.state.group,null);
  assert.equal(app.state.groups.length,0);
  assert.deepEqual(app.state.remembered,[]);
});

test('刪除帳本已成功但更新清單失敗，保留真實結果並提供可重試的錯誤狀態',async()=>{
  const app=createHarness(async(url,options)=>{
    if(options?.method==='DELETE')return{ok:true};
    throw new Error('網路中斷');
  });
  await app.groupDeleted({id:'A',name:'東京'});
  assert.equal(app.state.activeId,null);
  assert.equal(app.state.group,null);
  assert.equal(app.state.groupLoading,false);
  assert.match(app.state.groupError,/已刪除.*列表暫時無法更新/);
  assert.equal(app.state.groups.some(item=>item.id==='A'),false);
  assert.equal(app.state.notices.at(-1).type,'info');
});
