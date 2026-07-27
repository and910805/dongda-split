import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,ArrowRight,Check,ChevronDown,ChevronLeft,ChevronRight,CircleHelp,Clipboard,DoorOpen,History,Link2,LoaderCircle,LogOut,Pencil,Plus,ReceiptText,RefreshCcw,Settings2,ShieldCheck,Trash2,Users,WalletCards,X} from 'lucide-react';
import {AdvancedExpenseModal} from './AdvancedExpenseModal.jsx';
import {AdminConsole} from './AdminConsole.jsx';
import {BrandLogo,BrandMark} from './BrandLogo.jsx';

const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});if(response.status===401)throw Object.assign(new Error('unauthorized'),{status:401});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'操作失敗');return data};
const money=cents=>`NT$ ${Math.round(Number(cents||0)/100).toLocaleString()}`;
const TABLE_PAGE_SIZE=8;
const SETTLEMENT_PAGE_SIZE=4;
const EMPTY_BANK_ACCOUNT={bankCode:'',bankName:'',branchCode:'',accountHolderName:'',accountNumber:''};
function Person({person,size=36}){
  const [imageFailed,setImageFailed]=useState(false);
  useEffect(()=>setImageFailed(false),[person?.pictureUrl]);
  if(person?.isFund)return <span className="avatar fund-avatar" style={{width:size,height:size}} aria-label={person.displayName||'公費'}><WalletCards/></span>;
  if(person?.pictureUrl&&!imageFailed)return <img className="avatar" src={person.pictureUrl} alt={person.displayName||'成員頭像'} style={{width:size,height:size}} referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>;
  const displayName=String(person?.displayName||'').trim();
  return <span className="avatar initial" style={{width:size,height:size,background:'#1f9d69'}} aria-label={displayName||'成員'}>{Array.from(displayName)[0]||'旅'}</span>;
}
function expenseShareRows(expense,members){
  const memberById=new Map((members||[]).map(member=>[String(member.id),member]));
  const memberOrder=new Map((members||[]).map((member,index)=>[String(member.id),index]));
  return (expense?.shares||[]).map(share=>{
    const userId=String(share.userId);
    return {userId,amountCents:Number(share.amountCents||0),person:memberById.get(userId)||{id:userId,displayName:'已離開的成員'}};
  }).sort((left,right)=>(memberOrder.get(left.userId)??Number.MAX_SAFE_INTEGER)-(memberOrder.get(right.userId)??Number.MAX_SAFE_INTEGER)||left.userId.localeCompare(right.userId));
}
function ExpenseShareAvatars({expense,members,onOpen}){
  const rows=expenseShareRows(expense,members),visibleRows=rows.slice(0,4),remaining=rows.length-visibleRows.length,isRefund=Number(expense.amountCents)<0,kindLabel=isRefund?'退款':'分攤';
  if(!rows.length)return <span className="expense-share-empty">沒有{kindLabel}成員</span>;
  const label=`查看「${expense.title}」的${kindLabel}成員，共 ${rows.length} 人`;
  return <button type="button" className="expense-share-trigger" onClick={()=>onOpen(expense)} aria-label={label} aria-haspopup="dialog" title={label}>
    <span className="expense-share-avatars" aria-hidden="true">
      {visibleRows.map(row=><span className="expense-share-avatar" key={row.userId}><Person person={row.person} size={24}/></span>)}
      {remaining>0&&<span className="expense-share-more">+{remaining}</span>}
    </span>
  </button>;
}
function RecordPagination({page,totalItems,pageSize,onPageChange,label,compact=false}){
  const totalPages=Math.ceil(totalItems/pageSize);
  if(totalPages<=1)return null;
  const safePage=Math.min(Math.max(page,1),totalPages),start=(safePage-1)*pageSize+1,end=Math.min(safePage*pageSize,totalItems);
  return <nav className={`record-pagination ${compact?'compact':''}`} aria-label={`${label}分頁`}>
    <span className="record-pagination-summary">第 {start}–{end} 筆，共 {totalItems} 筆</span>
    <div className="record-pagination-controls"><button type="button" disabled={safePage===1} onClick={()=>onPageChange(safePage-1)} aria-label={`${label}上一頁`}><ChevronLeft/></button><span aria-live="polite" aria-atomic="true"><b>{safePage}</b> / {totalPages}</span><button type="button" disabled={safePage===totalPages} onClick={()=>onPageChange(safePage+1)} aria-label={`${label}下一頁`}><ChevronRight/></button></div>
  </nav>;
}
function DevAccessBar({login,loading,error}){return <aside className="dev-access-bar" aria-label="本機開發工具"><div><small>LOCAL DEVELOPMENT</small><b>本機開發模式</b></div><button type="button" onClick={login} disabled={loading}>{loading?<LoaderCircle/>:<ArrowRight/>}{loading?'登入中…':'直接進入功能'}</button>{error&&<p role="alert">{error}</p>}</aside>}

export default function ProductApp({Home}){
  const [me,setMe]=useState(null),[groups,setGroups]=useState([]),[activeId,setActiveId]=useState(null),[group,setGroup]=useState(null),[loading,setLoading]=useState(true),[groupLoading,setGroupLoading]=useState(false),[groupError,setGroupError]=useState(''),[notice,setNotice]=useState(''),[showCreate,setShowCreate]=useState(false),[showExpense,setShowExpense]=useState(false),[editingExpense,setEditingExpense]=useState(null),[showInvite,setShowInvite]=useState(false),[showProfile,setShowProfile]=useState(false);
  const [devLoginLoading,setDevLoginLoading]=useState(false),[devLoginError,setDevLoginError]=useState(''),[adminMode,setAdminMode]=useState(false),[adminViewingId,setAdminViewingId]=useState(null);
  const groupRequestRef=useRef(0),loadedGroupIdRef=useRef(null);
  const inviteToken=location.pathname.startsWith('/invite/')?location.pathname.split('/')[2]:null;
  const isLocalDevelopment=['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
  const refreshGroups=useCallback(async()=>{const list=await api('/api/groups');setGroups(list);setActiveId(current=>current||list[0]?.id||null);return list},[]);
  useEffect(()=>{api('/api/me').then(async user=>{setMe(user);const list=await refreshGroups();if(inviteToken){const joined=await api(`/api/invites/${encodeURIComponent(inviteToken)}/join`,{method:'POST'});setActiveId(joined.groupId);await refreshGroups();history.replaceState({},'', '/app');setNotice('已成功加入群組！')}}).catch(error=>{if(error.status===401&&inviteToken){const returnTo=location.pathname;location.replace(`/api/auth/line?returnTo=${encodeURIComponent(returnTo)}`);return}if(error.status!==401)setNotice(error.message)}).finally(()=>setLoading(false))},[]);
  const refreshGroup=useCallback(async()=>{const requestedId=activeId,requestId=++groupRequestRef.current;if(!requestedId){loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(false);return}if(loadedGroupIdRef.current!==requestedId)setGroup(null);setGroupLoading(true);setGroupError('');try{const nextGroup=await api(`/api/groups/${requestedId}`);if(requestId!==groupRequestRef.current)return;loadedGroupIdRef.current=requestedId;setGroup(nextGroup)}catch(error){if(requestId!==groupRequestRef.current)return;loadedGroupIdRef.current=null;setGroup(null);setGroupError(error.message);throw error}finally{if(requestId===groupRequestRef.current)setGroupLoading(false)}},[activeId]);
  const selectGroup=useCallback(id=>{if(!id||id===activeId)return;setAdminViewingId(current=>current===id?current:null);groupRequestRef.current+=1;loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(true);setActiveId(id)},[activeId]);
  useEffect(()=>{if(me&&activeId)refreshGroup().catch(()=>{})},[me,activeId,refreshGroup]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer)},[notice]);
  const login=()=>{const returnTo=inviteToken?location.pathname:'/app';location.href=`/api/auth/line?returnTo=${encodeURIComponent(returnTo)}`};
  const devLogin=async()=>{setDevLoginLoading(true);setDevLoginError('');try{await api('/api/dev-login',{method:'POST'});const [user,list]=await Promise.all([api('/api/me'),api('/api/groups')]);setGroups(list);setActiveId(list[0]?.id||null);setMe(user);history.replaceState({},'','/app')}catch(error){setDevLoginError(`本機登入失敗：${error.message}`)}finally{setDevLoginLoading(false)}};
  const logout=async()=>{await api('/api/auth/logout',{method:'POST'});setAdminMode(false);setAdminViewingId(null);setMe(null);setGroups([]);setGroup(null);history.replaceState({},'','/')};
  const created=async data=>{setShowCreate(false);await refreshGroups();selectGroup(data.id);history.replaceState({},'','/app')};
  const expenseAdded=async()=>{setShowExpense(false);setEditingExpense(null);await refreshGroup()};
  const groupDeleted=async target=>{await api(`/api/groups/${target.id}`,{method:'DELETE'});const list=await api('/api/groups');setGroups(list);setGroup(null);setActiveId(list[0]?.id||null);setNotice(`已刪除群組「${target.name}」`)};
  const openNewExpense=()=>{setEditingExpense(null);setShowExpense(true)};
  const openAdminGroup=item=>{setGroups(current=>current.some(groupItem=>groupItem.id===item.id)?current:[{id:item.id,name:item.name,description:item.description,currency:'TWD',memberCount:item.memberCount},...current]);setAdminViewingId(item.id);groupRequestRef.current+=1;loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(true);setActiveId(item.id);setAdminMode(false);history.replaceState({},'','/app')};
  if(loading)return <div className="page-loading"><LoaderCircle/><p>正在整理帳本…</p></div>;
  if(!me&&inviteToken)return <div className="page-loading"><LoaderCircle/><p>正在前往 LINE 登入並加入群組…</p></div>;
  if(!me)return <><Home enter={login}/>{isLocalDevelopment&&<DevAccessBar login={devLogin} loading={devLoginLoading} error={devLoginError}/>}</>;
  if(adminMode&&me.isSuperuser)return <AdminConsole me={me} onExit={()=>setAdminMode(false)} onLogout={logout} onOpenGroup={openAdminGroup}/>;
  const adminViewing=Boolean(me.isSuperuser&&group&&adminViewingId===group.id);
  return <div className="real-app">
    <aside className="real-side" aria-label="主要導覽">
      <BrandLogo/>
      <button type="button" className="login-user" onClick={()=>setShowProfile(true)} aria-label="開啟個人資料與收款帳戶設定"><Person person={me} size={46}/><div><b>{me.displayName}</b><small>{me.bankAccount?.configured?`收款帳戶 •••• ${me.bankAccount.last4}`:'設定常用收款帳戶'}</small></div><ChevronRight className="login-user-chevron"/></button>
      <div className="side-label">我的群組</div>
      <div className="group-switcher">{groups.map(item=><button className={activeId===item.id?'active':''} aria-current={activeId===item.id?'page':undefined} key={item.id} onClick={()=>selectGroup(item.id)}><span className="group-icon"><WalletCards/></span><div><b>{item.name}</b><small>{item.memberCount} 位成員</small></div></button>)}</div>
      <button className="new-group" onClick={()=>setShowCreate(true)}><Plus/> 建立新群組</button>
      <div className="side-footer">
        {me.isSuperuser&&<button className="superuser-entry" onClick={()=>setAdminMode(true)}><ShieldCheck/> 超級使用者模式</button>}
        <button className="logout" onClick={logout}><LogOut/> 登出</button>
        <span><b>旅帳 TripTab</b><small>v1.0.0</small></span>
      </div>
    </aside>
    <section className="real-workspace">
      <header>
        <BrandMark className="mobile-header-mark"/>
        <div className="desktop-group-title"><small>{adminViewing?'超級使用者　/　帳本檢視':'我的群組　/　共同帳本'}</small><h2>{group?.name||'旅帳'}</h2></div>
        <label className="mobile-group-picker"><small>目前群組</small><select value={activeId||''} onChange={e=>selectGroup(e.target.value)} disabled={groupLoading}>{groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button type="button" className="mobile-new-group" onClick={()=>setShowCreate(true)} aria-label="建立新群組" title="建立新群組"><Plus/></button>
        <div className="real-header-actions">
          <button type="button" className="header-user-avatar" onClick={()=>setShowProfile(true)} aria-label="開啟個人資料"><Person person={me} size={36}/></button>
          <button className="header-secondary" disabled={!group||adminViewing} onClick={()=>setShowInvite(true)}><Users/> 邀請成員</button>
          {adminViewing?<span className="admin-view-badge"><ShieldCheck/>管理檢視</span>:<button className="primary header-primary" disabled={!group||groupLoading} onClick={openNewExpense}><Plus/> 新增支出</button>}
          <button type="button" className="mobile-header-avatar" aria-label="開啟個人資料與收款帳戶設定" onClick={()=>setShowProfile(true)}><Person person={me} size={38}/></button>
          <button className="mobile-logout" aria-label="登出" onClick={logout}><LogOut/></button>
        </div>
      </header>
      {!groups.length?<EmptyGroups create={()=>setShowCreate(true)}/>:groupError&&!group?<WorkspaceError message={groupError} retry={refreshGroup}/>:!group?<DashboardSkeleton/>:<GroupDashboard key={group.id} group={group} me={me} addExpense={adminViewing?null:openNewExpense} editExpense={expense=>{setEditingExpense(expense);setShowExpense(true)}} invite={()=>setShowInvite(true)} removeGroup={()=>groupDeleted(group)} refresh={refreshGroup} refreshing={groupLoading} openAdmin={me.isSuperuser?()=>setAdminMode(true):null} openProfile={()=>setShowProfile(true)} adminViewing={adminViewing}/>}
    </section>
    {group&&!adminViewing&&<button className="mobile-expense-fab" onClick={openNewExpense} aria-label="新增支出"><Plus/><span>新增</span></button>}
    {notice&&<button type="button" className="toast" onClick={()=>setNotice('')} aria-live="polite" aria-label={`${notice}，點擊關閉`}><Check/>{notice}</button>}
    {showCreate&&<CreateGroup close={()=>setShowCreate(false)} done={created}/>} {showExpense&&group&&<AdvancedExpenseModal group={group} expense={editingExpense} currentUserId={me.id} close={()=>{setShowExpense(false);setEditingExpense(null)}} done={expenseAdded}/>} {showInvite&&group&&<InviteModal group={group} close={()=>setShowInvite(false)}/>} {showProfile&&<ProfileModal me={me} close={()=>setShowProfile(false)} saved={bankAccount=>{setMe(current=>({...current,bankAccount}));setShowProfile(false);setNotice(bankAccount.configured?'已更新常用收款帳戶':'已移除常用收款帳戶')}}/>}
  </div>
}

function EmptyGroups({create}){return <main className="empty-groups"><img src="/xiaoluo-avatar.png" alt="旅行成員頭像"/><span className="eyebrow">歡迎加入旅帳 TripTab</span><h1>先建立第一個分帳群組</h1><p>為這次活動取一個名字，再把邀請連結傳給同行的朋友</p><button className="primary" onClick={create}><Plus/> 建立群組</button></main>}
function DashboardSkeleton(){return <main className="dashboard-skeleton" aria-label="正在載入群組資料" aria-busy="true"><div className="skeleton skeleton-hero"></div><div className="skeleton-stats">{[0,1,2].map(item=><div className="skeleton" key={item}></div>)}</div><div className="skeleton-grid"><div className="skeleton"></div><div className="skeleton"></div></div><span className="sr-only">正在載入群組資料</span></main>}
function WorkspaceError({message,retry}){const [retrying,setRetrying]=useState(false);const handleRetry=async()=>{setRetrying(true);try{await retry()}catch{}finally{setRetrying(false)}};return <main className="workspace-error" role="alert"><span><AlertCircle/></span><h1>群組資料暫時無法載入</h1><p>{message||'請檢查網路連線後再試一次'}</p><button className="primary" disabled={retrying} onClick={handleRetry}>{retrying?<LoaderCircle/>:<RefreshCcw/>}{retrying?'重新載入中…':'重新載入'}</button></main>}
function SettlementBankDetails({groupId,settlement}){
  const [details,setDetails]=useState(null),[expanded,setExpanded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const panelId=`settlement-bank-${settlement.from.id}-${settlement.to.id}`;
  const toggle=async()=>{
    if(details){setExpanded(value=>!value);return}
    setLoading(true);setError('');
    try{setDetails(await api(`/api/groups/${groupId}/settlements/${settlement.to.id}/bank-account`));setExpanded(true)}
    catch(loadError){setError(loadError.message)}
    finally{setLoading(false)}
  };
  const copyAccount=async()=>{
    setError('');
    try{await navigator.clipboard.writeText(details.bankAccount.accountNumber);setCopied(true)}
    catch{setError('無法自動複製，請手動選取帳號')}
  };
  return <div className="settlement-bank">
    <button type="button" className="settlement-bank-toggle" onClick={toggle} disabled={loading} aria-expanded={expanded} aria-controls={panelId}>
      {loading?<LoaderCircle/>:<WalletCards/>}{loading?'讀取中…':expanded?'收起轉帳資訊':'檢視轉帳資訊'}<ChevronDown/>
    </button>
    {error&&<p className="settlement-bank-error" role="alert"><AlertCircle/>{error}</p>}
    {expanded&&details&&<div className={`settlement-bank-panel ${details.bankAccount?'':'is-empty'}`} id={panelId}>
      {!details.bankAccount?<><AlertCircle/><div><b>{details.recipient.displayName} 尚未設定收款帳戶</b><p>可先用現金或其他方式還款，仍可在下方確認完成。</p></div></>:<>
        <div className="settlement-bank-recipient"><Person person={details.recipient} size={34}/><span><small>轉帳給</small><b>{details.recipient.displayName}</b></span><ShieldCheck aria-label="僅付款人可見"/></div>
        <dl>
          <div><dt>銀行</dt><dd>{details.bankAccount.bankName}（{details.bankAccount.bankCode}）</dd></div>
          {details.bankAccount.branchCode&&<div><dt>分行代碼</dt><dd>{details.bankAccount.branchCode}</dd></div>}
          <div><dt>戶名</dt><dd>{details.bankAccount.accountHolderName}</dd></div>
          <div className="bank-account-number"><dt>帳號</dt><dd>{details.bankAccount.accountNumber}</dd></div>
        </dl>
        <button type="button" className="settlement-bank-copy" onClick={copyAccount} aria-live="polite">{copied?<Check/>:<Clipboard/>}{copied?'已複製帳號':'複製帳號'}</button>
        <small className="settlement-bank-manual">僅供檢視與複製，請自行使用手機銀行轉帳；系統不會發起扣款或匯款。</small>
      </>}
    </div>}
  </div>;
}
function SettlementBankUnavailable(){
  return <div className="settlement-bank-unavailable"><WalletCards/><div><b>收款人尚未提供轉帳資訊</b><p>可先聯絡對方或使用其他方式還款，仍可在下方確認完成。</p></div></div>;
}
function SettlementBankShare({groupId,settlement,shared,configured,refresh,openProfile}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const updateAccess=async()=>{
    if(!configured){openProfile();return}
    setBusy(true);setError('');
    try{
      await api(`/api/groups/${groupId}/settlements/${settlement.from.id}/bank-account-access`,{method:shared?'DELETE':'POST'});
      await refresh();
    }catch(updateError){setError(updateError.message)}finally{setBusy(false)}
  };
  return <div className={`settlement-bank-share ${shared?'is-shared':''}`}>
    <div><ShieldCheck/><span><b>{shared?'已提供轉帳資訊':'安全提供收款帳戶'}</b><p>{shared?'只有這位付款人能在目前欠款有效時查看。':'由你主動提供後，付款人才看得到完整帳號。'}</p></span></div>
    <button type="button" onClick={updateAccess} disabled={busy}>{busy?<LoaderCircle/>:configured?shared?<X/>:<WalletCards/>:<Plus/>}{busy?'處理中…':configured?shared?'撤回資訊':'提供給付款人':'設定收款帳戶'}</button>
    {error&&<p className="settlement-bank-error" role="alert"><AlertCircle/>{error}</p>}
  </div>;
}
function GroupDashboard({group,me,addExpense,editExpense,invite,removeGroup,refresh,refreshing=false,openAdmin,openProfile,adminViewing=false}){
  const [paying,setPaying]=useState(''),[deleting,setDeleting]=useState(''),[deletingGroup,setDeletingGroup]=useState(false),[showSettlementHelp,setShowSettlementHelp]=useState(false),[showBalances,setShowBalances]=useState(false),[selectedExpenseShares,setSelectedExpenseShares]=useState(null),[actionError,setActionError]=useState('');
  const [activityTab,setActivityTab]=useState('expenses'),[expensePage,setExpensePage]=useState(1),[settlementPage,setSettlementPage]=useState(1);
  const expenseMembers=useMemo(()=>group.members.filter(member=>!member.isFund),[group.members]);
  const [expenseMemberId,setExpenseMemberId]=useState(()=>expenseMembers.some(member=>String(member.id)===String(me.id))?String(me.id):'all');
  const visibleExpenses=useMemo(()=>expenseMemberId==='all'?group.expenses:group.expenses.filter(expense=>
    [...(expense.payments||[]),...(expense.shares||[])].some(entry=>String(entry.userId)===expenseMemberId)
  ),[expenseMemberId,group.expenses]);
  const prioritizedExpenses=useMemo(()=>{
    const paidByMe=[],others=[];
    for(const expense of visibleExpenses){
      const isPaidByMe=(expense.payments||[]).some(payment=>String(payment.userId)===String(me.id));
      (isPaidByMe?paidByMe:others).push(expense);
    }
    return [...paidByMe,...others];
  },[me.id,visibleExpenses]);
  const expensePageCount=Math.max(1,Math.ceil(prioritizedExpenses.length/TABLE_PAGE_SIZE)),currentExpensePage=Math.min(expensePage,expensePageCount);
  const pagedExpenses=prioritizedExpenses.slice((currentExpensePage-1)*TABLE_PAGE_SIZE,currentExpensePage*TABLE_PAGE_SIZE);
  const settlementPageCount=Math.max(1,Math.ceil(group.settlements.length/SETTLEMENT_PAGE_SIZE)),currentSettlementPage=Math.min(settlementPage,settlementPageCount);
  const pagedSettlements=group.settlements.slice((currentSettlementPage-1)*SETTLEMENT_PAGE_SIZE,currentSettlementPage*SETTLEMENT_PAGE_SIZE);
  useEffect(()=>setExpensePage(page=>Math.min(page,expensePageCount)),[expensePageCount]);
  useEffect(()=>setSettlementPage(page=>Math.min(page,settlementPageCount)),[settlementPageCount]);
  const selectedExpenseMember=expenseMembers.find(member=>String(member.id)===expenseMemberId);
  const total=group.expenses.reduce((sum,e)=>sum+e.amountCents,0);
  const mine=group.balances.find(x=>x.id===me.id)?.balanceCents||0;
  const memberCount=group.members.filter(x=>!x.isFund).length;
  const latestActivity=[...group.expenses,...(group.settlementHistory||[])].map(item=>new Date(item.createdAt).getTime()).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  const lastUpdated=latestActivity?new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(latestActivity)):'尚未有紀錄';
  const canPay=settlement=>settlement.from.id===me.id;
  const canManageFundPayment=settlement=>settlement.from.isFund&&group.ownerId===me.id&&settlement.to.id!==me.id;
  const canConfirm=settlement=>canPay(settlement)||canManageFundPayment(settlement);
  const settlementKey=settlement=>`${settlement.from.id}:${settlement.to.id}:${settlement.amountCents}`;
  const markPaid=async settlement=>{setPaying(settlementKey(settlement));setActionError('');try{await api(`/api/groups/${group.id}/settlements`,{method:'POST',body:JSON.stringify({fromUserId:settlement.from.id,toUserId:settlement.to.id,amount:settlement.amountCents/100})});await refresh()}catch(error){setActionError(error.message)}finally{setPaying('')}};
  const removeExpense=async expense=>{if(!confirm(`確定要刪除「${expense.title}」嗎？刪除後無法復原`))return;setDeleting(expense.id);setActionError('');try{await api(`/api/groups/${group.id}/expenses/${expense.id}`,{method:'DELETE'});await refresh()}catch(error){setActionError(error.message)}finally{setDeleting('')}};
  const deleteCurrentGroup=async()=>{if(!confirm(`確定要刪除群組「${group.name}」嗎？所有支出與結算都會一併刪除，且無法復原`))return;setDeletingGroup(true);setActionError('');try{await removeGroup()}catch(error){setActionError(error.message);setDeletingGroup(false)}};
  const focusActivityTab=nextTab=>{setActivityTab(nextTab);requestAnimationFrame(()=>document.getElementById(`activity-tab-${nextTab}-${group.id}`)?.focus())};
  const handleActivityTabKeyDown=event=>{let nextTab;if(event.key==='ArrowLeft'||event.key==='Home')nextTab='expenses';if(event.key==='ArrowRight'||event.key==='End')nextTab='repayments';if(!nextTab)return;event.preventDefault();focusActivityTab(nextTab)};
  return <main className={`real-dashboard ${refreshing?'is-refreshing':''}`} aria-busy={refreshing}>
    {refreshing&&<div className="workspace-progress" role="status"><span></span><span className="sr-only">正在更新群組資料</span></div>}
    {actionError&&<div className="inline-alert" role="alert"><AlertCircle/><span>{actionError}</span><button onClick={()=>setActionError('')} aria-label="關閉錯誤訊息"><X/></button></div>}
    <section className="group-hero" aria-labelledby="group-title">
      <span className="group-summary-icon" aria-hidden="true"><WalletCards/></span>
      <div className="group-overview-copy">
        <div className="group-title-row"><h1 id="group-title">{group.name}</h1><span className="currency-badge">TWD</span></div>
        <p>{group.description||'一起記下每筆共同花費，最後輕鬆結清'}</p>
        <div className="group-meta">
          <span className="member-count-meta"><Users/>{memberCount} 位成員</span>
          <span><CircleHelp/>TWD 台幣</span>
          <span><History/>上次更新：{lastUpdated}</span>
        </div>
        <div className="group-member-wall" aria-label={`同行成員，共 ${memberCount} 位`}>
          <div className="group-member-wall-head"><span>同行成員</span><strong>{memberCount} 位</strong></div>
          <div className="group-member-avatars" role="list">
            {group.members.filter(member=>!member.isFund).map(member=><span className="group-member-avatar" role="listitem" title={member.displayName||'成員'} key={member.id}><Person person={member} size={32}/></span>)}
          </div>
        </div>
      </div>
      <div className="group-overview-side">
        {(group.ownerId===me.id||adminViewing)&&<details className="group-admin-menu"><summary><Settings2/> 群組管理</summary><div><p>{adminViewing?'你正以超級使用者身分管理這個帳本':'刪除後，所有支出與結算都無法復原'}</p><button className="danger-action" disabled={deletingGroup} onClick={deleteCurrentGroup}>{deletingGroup?<LoaderCircle/>:<Trash2/>}{deletingGroup?'刪除中…':'刪除群組'}</button></div></details>}
      </div>
    </section>
    <nav className={`mobile-shortcuts ${openAdmin?'has-admin':''}`} aria-label="群組快捷功能">
      <button className="shortcut-card shortcut-expenses" onClick={()=>{setActivityTab('expenses');requestAnimationFrame(()=>document.querySelector('.activity-column')?.scrollIntoView({behavior:'smooth'}))}}><span className="shortcut-icon" aria-hidden="true"><ReceiptText/></span><span className="shortcut-label">支出</span></button>
      <button className="shortcut-card shortcut-balances" onClick={()=>setShowBalances(true)}><span className="shortcut-icon" aria-hidden="true"><WalletCards/></span><span className="shortcut-label">結餘</span></button>
      <button className="shortcut-card shortcut-settlements" onClick={()=>document.querySelector('.settlements')?.scrollIntoView({behavior:'smooth'})}><span className="shortcut-icon" aria-hidden="true"><Check/></span><span className="shortcut-label">結算</span></button>
      <button className="shortcut-card shortcut-invite" onClick={invite} disabled={adminViewing}><span className="shortcut-icon" aria-hidden="true"><Users/></span><span className="shortcut-label">邀請</span></button>
      {openAdmin&&<button className="shortcut-card mobile-admin-shortcut" onClick={openAdmin}><span className="shortcut-icon" aria-hidden="true"><ShieldCheck/></span><span className="shortcut-label">管理</span></button>}
    </nav>
    <div className="real-stats">
      <article className="stat-card"><span className="stat-icon"><WalletCards/></span><div><small>我的餘額</small><h3 className={mine>=0?'positive':'negative'}>{mine>=0?'應收 ':'應付 '}{money(Math.abs(mine))}</h3><p>{mine===0?'目前沒有待結算款項':mine>0?'其他成員需要付給你':'你需要付給其他成員'}</p></div></article>
      <article className="stat-card"><span className="stat-icon"><ReceiptText/></span><div><small>群組總支出</small><h3>{money(total)}</h3><p>共 {group.expenses.length} 筆共同花費</p></div></article>
      <article className="stat-card settlement-stat"><span className="stat-icon"><Check/></span><div><small>待處理轉帳</small><h3>{group.settlements.length} 筆</h3><p>已自動簡化轉帳路徑</p></div></article>
    </div>
    <div className="real-grid">
      <div className="activity-column">
        <nav className="activity-tabs" role="tablist" aria-label="帳目紀錄">
          <button id={`activity-tab-expenses-${group.id}`} type="button" role="tab" aria-selected={activityTab==='expenses'} aria-controls={`activity-panel-expenses-${group.id}`} tabIndex={activityTab==='expenses'?0:-1} className={activityTab==='expenses'?'active':''} onClick={()=>setActivityTab('expenses')} onKeyDown={handleActivityTabKeyDown}><ReceiptText/><span>最近支出</span><b>{group.expenses.length}</b></button>
          <button id={`activity-tab-repayments-${group.id}`} type="button" role="tab" aria-selected={activityTab==='repayments'} aria-controls={`activity-panel-repayments-${group.id}`} tabIndex={activityTab==='repayments'?0:-1} className={activityTab==='repayments'?'active':''} onClick={()=>setActivityTab('repayments')} onKeyDown={handleActivityTabKeyDown}><History/><span>還款紀錄</span><b>{(group.settlementHistory||[]).length}</b></button>
        </nav>
        <section className="expense-panel" id={`activity-panel-expenses-${group.id}`} role="tabpanel" aria-labelledby={`activity-tab-expenses-${group.id}`} tabIndex={0} hidden={activityTab!=='expenses'}>
          <div className="section-head"><div><h2 id="expense-title">最近支出</h2><p>你付款的支出優先，各組內依新增時間排序</p></div><div className="expense-head-actions"><label className="expense-member-filter" title={selectedExpenseMember?.displayName||'全部成員'}><span className="expense-member-filter-avatar" aria-hidden="true">{selectedExpenseMember?<Person person={selectedExpenseMember} size={26}/>:<Users/>}</span><span className="expense-member-filter-copy" aria-hidden="true"><small>支出成員</small><b>{selectedExpenseMember?.displayName||'全部成員'}</b></span><ChevronDown aria-hidden="true"/><select id={`expense-member-filter-${group.id}`} value={expenseMemberId} onChange={event=>{setExpenseMemberId(event.target.value);setExpensePage(1)}} aria-label="依成員篩選最近支出"><option value="all">全部成員</option>{expenseMembers.map(member=><option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><output className={`count-badge expense-count ${expenseMemberId==='all'?'':'is-filtered'}`} htmlFor={`expense-member-filter-${group.id}`} aria-live="polite" aria-atomic="true"><strong>{visibleExpenses.length}</strong><span>{expenseMemberId==='all'?'筆支出':`／${group.expenses.length} 筆`}</span></output></div></div>
          {!group.expenses.length?<div className="empty-list"><ReceiptText/><b>還沒有任何支出</b><p>{adminViewing?'此帳本目前不需要管理協助':'從第一筆共同花費開始建立清楚帳目'}</p>{addExpense&&<button className="empty-primary" onClick={addExpense}><Plus/> 新增第一筆支出</button>}</div>:<>
            {!visibleExpenses.length?<div className="empty-list"><ReceiptText/><b>沒有符合的支出</b><p>{selectedExpenseMember?`${selectedExpenseMember.displayName} 尚未參與任何支出`:'目前沒有符合篩選條件的支出'}</p></div>:<>
            <div className="record-table-head" aria-hidden="true"><span>日期</span><span>項目</span><span>支付者</span><span>參與金額</span><span>金額 (TWD)</span><span className="record-category-heading">分類</span><span>狀態</span><span>操作</span></div>
            <div className="record-list">{pagedExpenses.map(e=>{const ownShare=(e.shares||[]).find(share=>String(share.userId)===String(me.id));return <article key={e.id}>
              <time className="record-date" dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleDateString('zh-TW')}</time>
              <div className="record-name"><div><b title={e.title}>{e.title}</b><small className="record-meta"><ExpenseShareAvatars expense={e} members={group.members} onOpen={setSelectedExpenseShares}/><span className="record-payer-mobile">{e.payerName} 付款</span></small></div></div>
              <span className="record-payer">{e.payerName}</span>
              <div className={`record-share-amount ${ownShare?'':'is-empty'}`}><small>我的參與金額</small><b>{ownShare?money(ownShare.amountCents):'未參與'}</b></div>
              <div className="record-price"><b className={e.amountCents<0?'positive':''}>{money(e.amountCents)}</b><small>{e.payerCount>1?`${e.payerCount} 人付款`:e.splitMode==='equal'?`平均 ${money(Math.round(e.amountCents/e.shareCount))}`:{exact:'指定金額',hybrid:'指定＋均分',weights:'比例／份數'}[e.splitMode]||'自訂分攤'}</small></div>
              <span className="record-category">{e.amountCents<0?'退款':e.category||'其他'}</span>
              <span className="record-status"><Check/>已記錄</span>
              <div className="expense-row-actions">{(e.createdBy===me.id||group.ownerId===me.id||me.isSuperuser)&&<><button className="expense-edit" title="修改支出" aria-label={`修改 ${e.title}`} onClick={()=>editExpense(e)}><Pencil/></button><button className="expense-delete" title="刪除支出" aria-label={`刪除 ${e.title}`} disabled={deleting===e.id} onClick={()=>removeExpense(e)}>{deleting===e.id?<LoaderCircle/>:<Trash2/>}</button></>}</div>
            </article>})}</div>
            <RecordPagination page={currentExpensePage} totalItems={visibleExpenses.length} pageSize={TABLE_PAGE_SIZE} onPageChange={setExpensePage} label="最近支出"/>
            </>}
          </>}
        </section>
        <SettlementHistory group={group} refresh={refresh} refreshing={refreshing} hidden={activityTab!=='repayments'} id={`activity-panel-repayments-${group.id}`} labelledBy={`activity-tab-repayments-${group.id}`}/>
      </div>
      <aside className="settlements" aria-labelledby="settlement-title">
        <div className="settlement-heading"><div><span className="section-kicker">待辦事項</span><h2 id="settlement-title">結算</h2><p>簡化後轉帳，共 {group.settlements.length} 筆</p></div><button className="settlement-help-button" onClick={()=>setShowSettlementHelp(true)} aria-label="了解結算演算法"><CircleHelp/></button></div>
        {!group.settlements.length?<div className="all-clear"><Check/><b>目前都結清了</b><p>新增支出後，旅帳會在這裡整理最少轉帳路徑</p></div>:<>
          <div className="settlement-list">{pagedSettlements.map(s=>{
            const actionable=canConfirm(s),fundPayment=canManageFundPayment(s),bankAccess=s.bankAccountAccess||{},canShareBank=Boolean(bankAccess.canShare&&String(s.to.id)===String(me.id));
            return <article className={`settlement-row ${actionable?'payable':''}`} key={settlementKey(s)}>
              <span className={`settlement-status ${actionable?'needs-action':''}`}>{actionable?'待你處理':'等待對方'}</span>
              <div className="settlement-person"><Person person={s.from} size={44}/><span className="settlement-person-copy"><small>付款人</small><b>{s.from.displayName}</b></span></div>
              <div className="settlement-flow"><ArrowRight/><small>應付金額</small><strong>{money(s.amountCents)}</strong></div>
              <div className="settlement-person receiver"><Person person={s.to} size={44}/><span className="settlement-person-copy"><small>收款人</small><b>{s.to.displayName}</b></span></div>
              {canShareBank&&<SettlementBankShare groupId={group.id} settlement={s} shared={bankAccess.shared} configured={Boolean(me.bankAccount?.configured)} refresh={refresh} openProfile={openProfile}/>}
              {actionable&&(bankAccess.shared?<SettlementBankDetails groupId={group.id} settlement={s}/>:<SettlementBankUnavailable/>)}
              {actionable?<button className="settlement-confirm" disabled={Boolean(paying)} onClick={()=>markPaid(s)}>{paying===settlementKey(s)?<><LoaderCircle/>處理中…</>:fundPayment?'從公費付款':'我已轉帳'}</button>:<div className="settlement-waiting">等待付款人轉帳</div>}
            </article>;
          })}</div>
          <RecordPagination page={currentSettlementPage} totalItems={group.settlements.length} pageSize={SETTLEMENT_PAGE_SIZE} onPageChange={setSettlementPage} label="待辦結算" compact/>
        </>}
      </aside>
      <footer className="workspace-footer"><span>服務條款 · 隱私權政策</span><b>© 2026 TripTab</b></footer>
    </div>
    {showSettlementHelp&&<SettlementHelp close={()=>setShowSettlementHelp(false)}/>} {showBalances&&<BalanceChart group={group} close={()=>setShowBalances(false)}/>} {selectedExpenseShares&&<ExpenseSharesModal expense={selectedExpenseShares} members={group.members} close={()=>setSelectedExpenseShares(null)}/>}
  </main>
}
function ExpenseSharesModal({expense,members,close}){
 const rows=expenseShareRows(expense,members),isRefund=Number(expense.amountCents)<0,kindLabel=isRefund?'退款':'分攤';
 return <Modal close={close} label={`「${expense.title}」的${kindLabel}成員`}>
  <div className="expense-shares-modal-content">
   <span className="eyebrow"><Users/> {isRefund?'退款分配':'支出分攤'}</span>
   <h2>{expense.title}</h2>
   <p className="modal-copy">{isRefund?`這筆退款將依下列金額退回給 ${rows.length} 位成員。`:`這筆支出由以下 ${rows.length} 位成員共同分攤。`}</p>
   <ul className="expense-share-list" aria-label={`${kindLabel}成員與金額`}>
    {rows.map(row=><li key={row.userId}><Person person={row.person} size={42}/><span><b>{row.person.displayName}</b><small>{isRefund?'退回金額':'應分攤金額'}</small></span><strong>{money(Math.abs(row.amountCents))}</strong></li>)}
   </ul>
   <div className={`expense-share-total ${isRefund?'is-refund':''}`}><span>{isRefund?'退款總額':'分攤總額'}</span><strong>{money(Math.abs(expense.amountCents))}</strong></div>
   <button type="button" className="primary wide" onClick={close}>完成</button>
  </div>
 </Modal>;
}
function SettlementHistory({group,refresh,refreshing=false,hidden=false,id,labelledBy}){
 const rows=group.settlementHistory||[];
 const [page,setPage]=useState(1),pageCount=Math.max(1,Math.ceil(rows.length/TABLE_PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const pagedRows=rows.slice((currentPage-1)*TABLE_PAGE_SIZE,currentPage*TABLE_PAGE_SIZE);
 useEffect(()=>setPage(value=>Math.min(value,pageCount)),[pageCount]);
 const formatTime=value=>new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 return <section className="repayment-panel" id={id} role="tabpanel" aria-labelledby={labelledBy} tabIndex={0} hidden={hidden}>
  <div className="section-head"><div><h2 id="repayment-title">還款紀錄</h2><p>已完成的實際轉帳，共 {rows.length} 筆</p></div><button type="button" className="history-refresh" disabled={refreshing} onClick={()=>refresh().catch(()=>{})} aria-label={refreshing?'正在重新整理還款紀錄':'重新整理還款紀錄'}>{refreshing?<LoaderCircle/>:<RefreshCcw/>}</button></div>
  {!rows.length?<div className="repayment-empty"><History/><span>還沒有還款紀錄</span></div>:<>
   <div className="repayment-table-head" aria-hidden="true"><span>日期</span><span>付款人</span><span>收款人</span><span>金額 (TWD)</span><span>備註</span><span>狀態</span></div>
   <div className="repayment-log">{pagedRows.map(item=><article key={item.id}><time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time><span>{item.from.displayName}</span><span>{item.to.displayName}</span><strong>{money(item.amountCents)}</strong><small>由 {item.confirmedBy.displayName} 確認</small><span className="record-status"><Check/>已完成</span></article>)}</div>
   <RecordPagination page={currentPage} totalItems={rows.length} pageSize={TABLE_PAGE_SIZE} onPageChange={setPage} label="還款紀錄"/>
  </>}
 </section>
}
function BalanceChart({group,close}){
 const rows=[...group.balances].sort((a,b)=>a.balanceCents-b.balanceCents);
 const maximum=Math.max(1,...rows.map(x=>Math.abs(x.balanceCents)));
 return <Modal close={close} label="群組結餘"><span className="eyebrow"><WalletCards/> Balance</span><h2>群組結餘</h2><p className="modal-copy">每個人的最終淨額：紅色代表需要付出，綠色代表可以收回，長度越長，金額越大</p><div className="diverging-legend"><span>← 應付</span><i></i><span>應收 →</span></div><div className="diverging-chart">{rows.map(person=>{const value=person.balanceCents,width=value===0?0:Math.max(10,Math.round(Math.abs(value)/maximum*100)),member=<div className="diverging-member"><b>{person.displayName}</b><Person person={person} size={38}/></div>;return <div className={`diverging-row ${value<0?'is-debt':value>0?'is-credit':'is-zero'}`} key={person.id}><div className="diverging-left">{value<0?<span className="diverging-bar debt" style={{width:`${width}%`}}><strong>-{money(Math.abs(value))}</strong></span>:member}</div><div className="diverging-right">{value>0?<span className="diverging-bar credit" style={{width:`${width}%`}}><strong>+{money(value)}</strong></span>:value<0?member:<strong className="zero-amount">{money(0)}</strong>}</div></div>})}</div><div className="balance-check"><Check/> 所有人的結餘加總為 NT$ 0</div><button className="primary wide" onClick={close}>了解</button></Modal>
}
function SettlementHelp({close}){return <Modal close={close} label="結算說明"><span className="eyebrow"><CircleHelp/> 結算說明</span><h2>我們如何簡化轉帳？</h2><p className="modal-copy">系統會先把所有支出換算成每個人的最終淨額，再重新安排付款對象，原始帳目不會被修改，每個人最後付出或收到的總額也完全相同</p><div className="settlement-example"><div className="example-title"><b>舉個例子</b><small>A、B、C 三人結算</small></div><div className="example-columns"><section><b>原始 · 3 筆</b><p>A → C　NT$ 100</p><p>B → C　NT$ 300</p><p>A → B　NT$ 50</p></section><ArrowRight/><section className="simplified"><b>簡化後 · 2 筆</b><p>A → C　NT$ 150</p><p>B → C　NT$ 250</p></section></div><div className="example-net"><span>A 應付 150</span><span>B 應付 250</span><span>C 應收 400</span></div></div><div className="algorithm-note"><b>目前採用的方式</b><p>先配對金額完全相同的人，再讓小額欠款者優先一次付清，目標是讓更多付款人只轉一次；較大的欠款者必要時可能拆成多筆，因此不保證全群總筆數是數學上的絕對最少</p></div><button className="primary wide" onClick={close}>了解</button></Modal>}
function Modal({children,close,label='對話視窗'}){const overlayRef=useRef(null),dialogRef=useRef(null),closeRef=useRef(close),returnFocus=useRef(document.activeElement);closeRef.current=close;useEffect(()=>{const overlay=overlayRef.current,dialog=dialogRef.current,focusable='button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',blocked=[...(overlay?.parentElement?.children||[])].filter(item=>item!==overlay).map(item=>({item,inert:item.inert,hidden:item.getAttribute('aria-hidden')}));blocked.forEach(({item})=>{item.inert=true;item.setAttribute('aria-hidden','true')});const initialTimer=setTimeout(()=>{if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector(focusable)?.focus()},0);const onKeyDown=event=>{if(event.key==='Escape'){event.preventDefault();closeRef.current();return}if(event.key!=='Tab'||!dialog)return;const items=[...dialog.querySelectorAll(focusable)].filter(item=>item.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};document.addEventListener('keydown',onKeyDown);return()=>{clearTimeout(initialTimer);document.removeEventListener('keydown',onKeyDown);blocked.forEach(({item,inert,hidden})=>{item.inert=inert;if(hidden===null)item.removeAttribute('aria-hidden');else item.setAttribute('aria-hidden',hidden)});returnFocus.current?.focus?.()}},[]);return createPortal(<div ref={overlayRef} className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><div ref={dialogRef} className="modal real-modal" role="dialog" aria-modal="true" aria-label={label}><button type="button" className="modal-x" onClick={close} aria-label="關閉對話視窗"><X/></button>{children}</div></div>,document.body)}
function ProfileModal({me,close,saved}){
 const [form,setForm]=useState(EMPTY_BANK_ACCOUNT),[configured,setConfigured]=useState(Boolean(me.bankAccount?.configured)),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;api('/api/me/bank-account').then(({bankAccount})=>{if(!active)return;if(bankAccount){setForm({...EMPTY_BANK_ACCOUNT,...bankAccount,branchCode:bankAccount.branchCode||''});setConfigured(true)}}).catch(loadError=>active&&setError(loadError.message)).finally(()=>active&&setLoading(false));return()=>{active=false}},[]);
 const update=(field,value)=>setForm(current=>({...current,[field]:value}));
 const submit=async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{const result=await api('/api/me/bank-account',{method:'PUT',body:JSON.stringify(form)});saved(result.bankAccount)}catch(saveError){setError(saveError.message);setBusy(false)}};
 const remove=async()=>{if(!confirm('確定要移除常用收款帳戶嗎？目前欠你款項的人將無法查看轉帳資訊。'))return;setBusy(true);setError('');try{const result=await api('/api/me/bank-account',{method:'DELETE'});saved(result.bankAccount)}catch(removeError){setError(removeError.message);setBusy(false)}};
 return <Modal close={close} label="個人資料與收款帳戶">
  <div className="profile-heading"><Person person={me} size={52}/><div><span className="eyebrow">個人資料</span><h2>{me.displayName}</h2><p>LINE 帳號已連結</p></div></div>
  <div className="profile-privacy" id="bank-account-privacy"><ShieldCheck/><div><b>帳戶由你主動提供給付款人</b><p>資料只供檢視與複製，系統不會代為轉帳；結清後付款人會立即失去查看權限，更新帳戶也會撤銷舊授權。</p></div></div>
  {loading?<div className="profile-loading" role="status"><LoaderCircle/><span>正在讀取帳戶資料…</span></div>:<form className="profile-form" onSubmit={submit}>
    <div className="profile-form-title"><div><b>常用收款帳戶</b><small>{configured?`目前帳號末四碼 ${me.bankAccount?.last4||form.accountNumber.slice(-4)}`:'尚未設定'}</small></div><WalletCards/></div>
    <div className="form-two">
      <label>銀行代碼 <span className="required-mark" aria-hidden="true">*</span><input autoFocus inputMode="numeric" maxLength="3" pattern="[0-9]{3}" value={form.bankCode} onChange={event=>update('bankCode',event.target.value)} placeholder="例如：822" required aria-describedby="bank-account-privacy"/></label>
      <label>銀行名稱 <span className="required-mark" aria-hidden="true">*</span><input maxLength="60" value={form.bankName} onChange={event=>update('bankName',event.target.value)} placeholder="例如：中國信託" required/></label>
    </div>
    <label>分行代碼<input inputMode="numeric" maxLength="7" pattern="[0-9]{3,7}" value={form.branchCode} onChange={event=>update('branchCode',event.target.value)} placeholder="選填，3–7 位數"/><small className="field-help">若不確定可先留白</small></label>
    <label>戶名 <span className="required-mark" aria-hidden="true">*</span><input maxLength="80" autoComplete="name" value={form.accountHolderName} onChange={event=>update('accountHolderName',event.target.value)} placeholder="銀行帳戶戶名" required/></label>
    <label>帳號 <span className="required-mark" aria-hidden="true">*</span><input inputMode="numeric" autoComplete="off" maxLength="24" pattern="[0-9 -]{6,24}" value={form.accountNumber} onChange={event=>update('accountNumber',event.target.value)} placeholder="請輸入 6–20 位數帳號" required aria-describedby="bank-account-number-help"/><small className="field-help" id="bank-account-number-help">帳號會加密保存，可輸入空格或連字號，儲存時會自動整理。</small></label>
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions profile-actions">{configured&&<button type="button" className="profile-remove" onClick={remove} disabled={busy}><Trash2/>移除帳戶</button>}<button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy}>{busy?<LoaderCircle/>:<Check/>}{busy?'儲存中…':'儲存帳戶'}</button></div>
  </form>}
 </Modal>;
}
function CreateGroup({close,done}){const [name,setName]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const submit=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{done(await api('/api/groups',{method:'POST',body:JSON.stringify({name,description})}))}catch(err){setError(err.message);setBusy(false)}};return <Modal close={close} label="建立分帳群組"><span className="eyebrow">新的共同帳本</span><h2>建立分帳群組</h2><p className="modal-copy">先為這次旅行取一個容易辨識的名稱，建立後即可邀請旅伴</p><form onSubmit={submit}><label>群組名稱 <span className="required-mark" aria-hidden="true">*</span><input autoFocus maxLength="60" value={name} onChange={e=>setName(e.target.value)} placeholder="例如：花蓮三天兩夜" required aria-invalid={Boolean(error&&!name.trim())}/><small className="field-help">最多 60 個字，建議包含地點或日期</small></label><label>簡短說明<input maxLength="200" value={description} onChange={e=>setDescription(e.target.value)} placeholder="例如：14 人畢旅共同花費"/><small className="field-help">選填，讓旅伴快速確認群組用途</small></label>{error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}<div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy||!name.trim()}>{busy?<LoaderCircle/>:<Plus/>}{busy?'建立中…':'建立群組'}</button></div></form></Modal>}
function ExpenseModal({group,close,done}){
 const [title,setTitle]=useState(''),[amount,setAmount]=useState(''),[payerId,setPayerId]=useState(group.members[0]?.id),[category,setCategory]=useState('餐飲'),[selected,setSelected]=useState(group.members.map(x=>x.id)),[mode,setMode]=useState('equal'),[custom,setCustom]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const toggle=id=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
 const customTotal=selected.reduce((sum,id)=>sum+Number(custom[id]||0),0),difference=Number(amount||0)-customTotal;
 const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{const payload={title,amount,payerId,category};if(mode==='equal')payload.participantIds=selected;else payload.shares=selected.map(userId=>({userId,amount:Number(custom[userId]||0)}));await api(`/api/groups/${group.id}/expenses`,{method:'POST',body:JSON.stringify(payload)});done()}catch(err){setError(err.message);setBusy(false)}};
 return <Modal close={close}><span className="eyebrow">共同花費</span><h2>新增一筆支出</h2><form onSubmit={submit}><label>項目名稱<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：晚餐" required/></label><div className="form-two"><label>金額<input type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="NT$ 0" required/></label><label>分類<select value={category} onChange={e=>setCategory(e.target.value)}><option>餐飲</option><option>住宿</option><option>交通</option><option>購物</option><option>其他</option></select></label></div><label>誰先付款？<select value={payerId} onChange={e=>setPayerId(e.target.value)}>{group.members.map(p=><option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label><div className="split-mode"><button type="button" className={mode==='equal'?'active':''} onClick={()=>setMode('equal')}>平均分攤</button><button type="button" className={mode==='custom'?'active':''} onClick={()=>setMode('custom')}>自訂金額</button></div><label>哪些人一起分？ <small>已選 {selected.length}／{group.members.length} 人</small></label><div className={'participant-grid '+(mode==='custom'?'custom':'')}>{group.members.map(p=><div className={'participant-item '+(selected.includes(p.id)?'selected':'')} key={p.id}><button type="button" onClick={()=>toggle(p.id)}><Person person={p} size={31}/><span>{p.displayName}</span>{selected.includes(p.id)&&<Check/>}</button>{mode==='custom'&&selected.includes(p.id)&&<div className="share-input"><span>NT$</span><input type="number" min="1" step="1" value={custom[p.id]||''} onChange={e=>setCustom(old=>({...old,[p.id]:e.target.value}))} placeholder="0"/></div>}</div>)}</div>{mode==='custom'&&<div className={'share-summary '+(difference===0?'balanced':'')}><span>已分配 NT$ {customTotal.toLocaleString()}</span><b>{difference===0?'金額吻合 ✓':`還差 NT$ ${difference.toLocaleString()}`}</b></div>}{error&&<p className="form-error">{error}</p>}<button className="primary wide" disabled={busy||!selected.length||(mode==='custom'&&difference!==0)}>{busy?<LoaderCircle/>:<ReceiptText/>}{mode==='equal'?`由 ${selected.length} 人平均分攤`:'依自訂金額儲存'}</button></form></Modal>}
function InviteModal({group,close}){const link=`${location.origin}/invite/${group.inviteToken}`;const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');const copy=async()=>{setCopyError('');try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setCopyError('無法自動複製，請手動選取上方連結')}};return <Modal close={close} label="邀請成員"><span className="eyebrow">邀請成員</span><h2>把連結傳到 LINE 群組</h2><p className="modal-copy">朋友點開後使用 LINE 登入，就會自動加入「{group.name}」</p><div className="invite-link"><Link2/><span>{link}</span></div>{copyError&&<p className="form-error" role="alert"><AlertCircle/>{copyError}</p>}<button className="line-share" onClick={()=>location.href=`https://line.me/R/share?text=${encodeURIComponent(`加入「${group.name}」一起分帳：${link}`)}`}><DoorOpen/> 用 LINE 分享</button><button className="copy-link" onClick={copy} aria-live="polite">{copied?<Check/>:<Clipboard/>}{copied?'已複製邀請連結':'複製邀請連結'}</button></Modal>}
