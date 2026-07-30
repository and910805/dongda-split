import React,{useCallback,useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,ArrowDown,ArrowRight,ArrowUp,ArrowUpDown,Check,ChevronDown,ChevronLeft,ChevronRight,CircleHelp,Clipboard,Clock3,DoorOpen,FlaskConical,History,Home,Info,Link2,LoaderCircle,LogOut,MessageCircle,Pencil,Plus,ReceiptText,RefreshCcw,Search,Settings2,ShieldCheck,Trash2,UserRound,Users,WalletCards,X} from './ui-icons.jsx';
import {AdvancedExpenseModal} from './AdvancedExpenseModal.jsx';
import {AdminConsole} from './AdminConsole.jsx';
import {BrandLogo,BrandMark} from './BrandLogo.jsx';
import {ConfirmModal} from './ConfirmModal.jsx';
import {bankAccountRemovalConfirmation,expenseDeletionConfirmation,groupDeletionConfirmation,settlementVoidConfirmation} from './confirmation-actions.mjs';
import {DEFAULT_EXPENSE_SORT,filterExpenses,nextExpenseSort,sortExpenses} from './expense-sort.mjs';
import {acquireModalEnvironment} from './modal-environment.mjs';
import {buildSettlementNotice,settlementLineShareUrl} from './settlement-notice.mjs';
import {prioritizeSettlementsForMember} from './settlement-order.mjs';
import {SUPPORTED_CURRENCIES,amountCentsToInputValue,formatCurrencyAmount,getCurrency} from '../currency.mjs';

const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});if(response.status===401)throw Object.assign(new Error('unauthorized'),{status:401});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||'操作失敗'),{status:response.status,data});return data};
const money=(cents,currency='TWD',options)=>formatCurrencyAmount(Number(cents||0),currency,options);
const conversionDeltaLabel=(cents,currency='TWD')=>{
  const definition=getCurrency(currency),numeric=Number(cents||0),absolute=BigInt(Math.abs(numeric));
  if(!Number.isSafeInteger(numeric))return '—';
  if(numeric%definition.quantum===0)return money(Math.abs(numeric),currency);
  const whole=absolute/100n,fraction=(absolute%100n).toString().padStart(2,'0').replace(/0+$/,'');
  return `${definition.symbol} ${whole.toLocaleString('zh-TW')}${fraction?`.${fraction}`:''}`;
};
const DEFAULT_CURRENCIES=SUPPORTED_CURRENCIES.map(code=>getCurrency(code));
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
    <span className="compact-avatar-stack expense-share-avatars" aria-hidden="true">
      {visibleRows.map(row=><span className="compact-avatar-item expense-share-avatar" key={row.userId}><Person person={row.person} size={24}/></span>)}
      {remaining>0&&<span className="compact-avatar-more expense-share-more">+{remaining}</span>}
    </span>
  </button>;
}
function ExpensePayerAvatars({expense,members}){
  const memberById=new Map((members||[]).map(member=>[String(member.id),member]));
  const payers=(expense?.payments||[]).map(payment=>({id:String(payment.userId),person:memberById.get(String(payment.userId))||{id:payment.userId,displayName:'已離開的成員'}}));
  const visiblePayers=payers.slice(0,3),remaining=payers.length-visiblePayers.length;
  return <span className="compact-avatar-stack record-payer-avatars" aria-hidden="true">
    {visiblePayers.map(payer=><span className="compact-avatar-item" key={payer.id}><Person person={payer.person} size={26}/></span>)}
    {remaining>0&&<span className="compact-avatar-more">+{remaining}</span>}
  </span>;
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
const EXPENSE_SORT_LABELS={date:'日期',participantAmount:'參與金額',amount:'金額'};
const expenseSortDirectionLabel=(key,direction)=>{
  if(key==='date')return direction==='asc'?'由舊到新':'由新到舊';
  return direction==='asc'?'由低到高':'由高到低';
};
function ExpenseSortButton({field,sort,onSort,className=''}) {
  const active=sort.key===field,direction=active?sort.direction:'desc';
  const Icon=active?(direction==='asc'?ArrowUp:ArrowDown):ArrowUpDown;
  const label=EXPENSE_SORT_LABELS[field];
  const currentLabel=active?`目前${expenseSortDirectionLabel(field,direction)}`:'尚未選取';
  const nextDirection=active&&direction==='desc'?'asc':'desc';
  return <button type="button" className={`expense-sort-button ${active?'is-active':''} ${className}`.trim()} aria-pressed={active} aria-label={`${label}排序，${currentLabel}，點擊改為${expenseSortDirectionLabel(field,nextDirection)}`} title={`${label}排序：${currentLabel}`} onClick={()=>onSort(field)}><span>{label}</span><Icon aria-hidden="true"/></button>;
}
function DevAccessBar({login,loading,error}){return <aside className="dev-access-bar" aria-label="本機開發工具"><div><small>LOCAL DEVELOPMENT</small><b>本機開發模式</b></div><button type="button" onClick={login} disabled={loading}>{loading?<LoaderCircle/>:<ArrowRight/>}{loading?'登入中…':'直接進入功能'}</button>{error&&<p role="alert">{error}</p>}</aside>}

export default function ProductApp({Home}){
  const [me,setMe]=useState(null),[groups,setGroups]=useState([]),[activeId,setActiveId]=useState(null),[group,setGroup]=useState(null),[loading,setLoading]=useState(true),[groupLoading,setGroupLoading]=useState(false),[groupError,setGroupError]=useState(''),[notice,setNotice]=useState(''),[showCreate,setShowCreate]=useState(false),[showExpense,setShowExpense]=useState(false),[editingExpense,setEditingExpense]=useState(null),[showInvite,setShowInvite]=useState(false),[showProfile,setShowProfile]=useState(false),[transferReport,setTransferReport]=useState(null);
  const [currencyData,setCurrencyData]=useState({currencies:DEFAULT_CURRENCIES,exchangeRates:null});
  const [devLoginLoading,setDevLoginLoading]=useState(false),[devLoginError,setDevLoginError]=useState(''),[adminMode,setAdminMode]=useState(false),[adminViewingId,setAdminViewingId]=useState(null),[endingSimulation,setEndingSimulation]=useState(false);
  const groupRequestRef=useRef(0),loadedGroupIdRef=useRef(null);
  const inviteToken=location.pathname.startsWith('/invite/')?location.pathname.split('/')[2]:null;
  const isLocalDevelopment=['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
  useEffect(()=>{let active=true;api('/api/currencies').then(data=>{if(active&&Array.isArray(data.currencies)&&data.currencies.length)setCurrencyData(data)}).catch(()=>{});return()=>{active=false}},[]);
  const refreshGroups=useCallback(async()=>{const list=await api('/api/groups');setGroups(list);setActiveId(current=>current||list[0]?.id||null);return list},[]);
  useEffect(()=>{api('/api/me').then(async user=>{setMe(user);const list=await refreshGroups();if(inviteToken){const joined=await api(`/api/invites/${encodeURIComponent(inviteToken)}/join`,{method:'POST'});setActiveId(joined.groupId);await refreshGroups();history.replaceState({},'', '/app');setNotice('已成功加入群組！')}}).catch(error=>{if(error.status===401&&inviteToken){const returnTo=location.pathname;location.replace(`/api/auth/line?returnTo=${encodeURIComponent(returnTo)}`);return}if(error.status!==401)setNotice(error.message)}).finally(()=>setLoading(false))},[]);
  const refreshGroup=useCallback(async()=>{const requestedId=activeId,requestId=++groupRequestRef.current;if(!requestedId){loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(false);return}if(loadedGroupIdRef.current!==requestedId)setGroup(null);setGroupLoading(true);setGroupError('');try{const nextGroup=await api(`/api/groups/${requestedId}`);if(requestId!==groupRequestRef.current)return;loadedGroupIdRef.current=requestedId;setGroup(nextGroup);return nextGroup}catch(error){if(requestId!==groupRequestRef.current)return;loadedGroupIdRef.current=null;setGroup(null);setGroupError(error.message);throw error}finally{if(requestId===groupRequestRef.current)setGroupLoading(false)}},[activeId]);
  const selectGroup=useCallback(id=>{if(!id||id===activeId)return;setAdminViewingId(current=>current===id?current:null);groupRequestRef.current+=1;loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(true);setActiveId(id)},[activeId]);
  useEffect(()=>{if(me&&activeId)refreshGroup().catch(()=>{})},[me,activeId,refreshGroup]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer)},[notice]);
  const login=()=>{const returnTo=inviteToken?location.pathname:'/app';location.href=`/api/auth/line?returnTo=${encodeURIComponent(returnTo)}`};
  const devLogin=async()=>{setDevLoginLoading(true);setDevLoginError('');try{await api('/api/dev-login',{method:'POST'});const [user,list]=await Promise.all([api('/api/me'),api('/api/groups')]);setGroups(list);setActiveId(list[0]?.id||null);setMe(user);history.replaceState({},'','/app')}catch(error){setDevLoginError(`本機登入失敗：${error.message}`)}finally{setDevLoginLoading(false)}};
  const logout=async()=>{await api('/api/auth/logout',{method:'POST'});setAdminMode(false);setAdminViewingId(null);setMe(null);setGroups([]);setGroup(null);history.replaceState({},'','/')};
  const endSimulation=async()=>{if(endingSimulation)return;setEndingSimulation(true);try{await api('/api/admin/simulation/exit',{method:'POST'});location.assign('/app')}catch(error){setNotice(error.message);setEndingSimulation(false)}};
  const created=async data=>{setShowCreate(false);await refreshGroups();selectGroup(data.id);history.replaceState({},'','/app')};
  const expenseAdded=async()=>{setShowExpense(false);setEditingExpense(null);await refreshGroup()};
  const groupDeleted=async target=>{await api(`/api/groups/${target.id}`,{method:'DELETE'});const list=await api('/api/groups');setGroups(list);setGroup(null);setActiveId(list[0]?.id||null);setNotice(`已刪除群組「${target.name}」`)};
  const openNewExpense=()=>{setEditingExpense(null);setShowExpense(true)};
  const closeTransferReport=()=>{setTransferReport(null);requestAnimationFrame(()=>{const target=document.getElementById('settlement-title')||document.querySelector('.workspace-error button, .header-user-avatar');target?.focus()})};
  const openAdminGroup=item=>{setGroups(current=>current.some(groupItem=>groupItem.id===item.id)?current:[{id:item.id,name:item.name,description:item.description,currency:item.currency||'TWD',memberCount:item.memberCount},...current]);setAdminViewingId(item.id);groupRequestRef.current+=1;loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(true);setActiveId(item.id);setAdminMode(false);history.replaceState({},'','/app')};
  if(loading)return <div className="page-loading"><LoaderCircle/><p>正在整理帳本…</p></div>;
  if(!me&&inviteToken)return <div className="page-loading"><LoaderCircle/><p>正在前往 LINE 登入並加入群組…</p></div>;
  if(!me)return <><Home enter={login}/>{isLocalDevelopment&&<DevAccessBar login={devLogin} loading={devLoginLoading} error={devLoginError}/>}</>;
  if(adminMode&&me.isSuperuser)return <AdminConsole me={me} onExit={()=>setAdminMode(false)} onLogout={logout} onOpenGroup={openAdminGroup}/>;
  const adminViewing=Boolean(me.isSuperuser&&group&&adminViewingId===group.id);
  const activeGroupOption=groups.find(item=>String(item.id)===String(activeId));
  return <div className={`real-app ${me.simulation?.active?'is-simulating':''}`}>
    {me.simulation?.active&&<aside className="simulation-banner" aria-label="帳戶模擬狀態"><div><FlaskConical/><span><b>帳戶模擬中：{me.displayName}</b><small>操作會記錄在這個虛擬帳號，且只能使用隔離的測試群組</small></span></div><button type="button" onClick={endSimulation} disabled={endingSimulation} aria-label={`結束模擬，返回 ${me.simulation.actor.displayName}`} title={`返回 ${me.simulation.actor.displayName}`}>{endingSimulation?<LoaderCircle/>:<ArrowRight/>}<span className="simulation-exit-full">{endingSimulation?'正在返回…':`結束模擬，返回 ${me.simulation.actor.displayName}`}</span><span className="simulation-exit-short">{endingSimulation?'返回中…':'結束模擬'}</span></button></aside>}
    <aside className="real-side" aria-label="主要導覽">
      <BrandLogo/>
      <button type="button" className="login-user" onClick={()=>setShowProfile(true)} aria-label="開啟個人資料與收款帳戶設定"><Person person={me} size={46}/><div><b>{me.displayName}</b><small>{me.isSimulated?'虛擬測試帳號':me.bankAccount?.configured?`收款帳戶 •••• ${me.bankAccount.last4}`:'設定常用收款帳戶'}</small></div><ChevronRight className="login-user-chevron"/></button>
      <div className="side-label">我的群組</div>
      <div className="group-switcher">{groups.map(item=><button className={activeId===item.id?'active':''} aria-current={activeId===item.id?'page':undefined} key={item.id} onClick={()=>selectGroup(item.id)}><div><b>{item.name}</b><small>{item.memberCount} 位成員 · {item.currency||'TWD'}</small></div></button>)}</div>
      <button className="new-group" onClick={()=>setShowCreate(true)}><Plus/> 建立新群組</button>
      <div className="side-footer">
        {me.isSuperuser&&<button className="superuser-entry" onClick={()=>setAdminMode(true)}><ShieldCheck/> 管理者模式</button>}
        <button className="logout" onClick={logout}><LogOut/> 登出</button>
      </div>
    </aside>
    <section className="real-workspace">
      <header>
        <BrandMark className="mobile-header-mark"/>
        <div className="desktop-group-title"><small>{adminViewing?'管理者　/　帳本檢視':'我的群組　/　共同帳本'}</small><h2>{group?.name||'旅帳'}</h2></div>
        <label className={`mobile-group-picker ${groupLoading?'is-loading':''}`} aria-busy={groupLoading||undefined}>
          <span className="mobile-group-picker-copy"><small>目前群組</small><b>{activeGroupOption?.name||'選擇群組'}</b></span>
          <span className="mobile-group-picker-caret" aria-hidden="true">{groupLoading?<LoaderCircle/>:<ChevronDown/>}</span>
          <select aria-label="切換目前群組" value={activeId||''} onChange={e=>selectGroup(e.target.value)} disabled={groupLoading}>{groups.map(item=><option key={item.id} value={item.id}>{item.name}（{item.currency||'TWD'}）</option>)}</select>
        </label>
        <button type="button" className="mobile-new-group" onClick={()=>setShowCreate(true)} aria-label="建立新群組" title="建立新群組"><Plus/></button>
        <div className="real-header-actions">
          <button type="button" className="header-user-avatar" onClick={()=>setShowProfile(true)} aria-label="開啟個人資料"><Person person={me} size={36}/></button>
          <button className="header-secondary" disabled={!group||adminViewing} onClick={()=>setShowInvite(true)}><Users/> 邀請成員</button>
          {adminViewing?<span className="admin-view-badge"><ShieldCheck/>管理檢視</span>:<button className="primary header-primary" disabled={!group||groupLoading} onClick={openNewExpense}><Plus/> 新增支出</button>}
          <button type="button" className="mobile-header-avatar" aria-label="開啟個人資料與收款帳戶設定" onClick={()=>setShowProfile(true)}><Person person={me} size={38}/></button>
          <button className="mobile-logout" aria-label="登出" onClick={logout}><LogOut/></button>
        </div>
      </header>
      {!groups.length?<EmptyGroups create={()=>setShowCreate(true)}/>:groupError&&!group?<WorkspaceError message={groupError} retry={refreshGroup}/>:!group?<DashboardSkeleton/>:<GroupDashboard key={group.id} group={group} me={me} currencies={currencyData} addExpense={adminViewing?null:openNewExpense} editExpense={expense=>{setEditingExpense(expense);setShowExpense(true)}} invite={()=>setShowInvite(true)} removeGroup={()=>groupDeleted(group)} refresh={refreshGroup} currencyChanged={async result=>{await Promise.all([refreshGroups(),refreshGroup()]);setNotice(result.alreadyApplied?'這次幣別換算先前已完成':`帳本已換算為 ${result.currency}`)}} refreshing={groupLoading} openAdmin={me.isSuperuser?()=>setAdminMode(true):null} openProfile={()=>setShowProfile(true)} onTransferReported={setTransferReport} adminViewing={adminViewing}/>}
    </section>
    {notice&&<button type="button" className="toast" onClick={()=>setNotice('')} aria-live="polite" aria-label={`${notice}，點擊關閉`}><Check/>{notice}</button>}
    {showCreate&&<CreateGroup currencies={currencyData.currencies} close={()=>setShowCreate(false)} done={created}/>} {showExpense&&group&&<AdvancedExpenseModal group={group} currencies={currencyData.currencies} expense={editingExpense} currentUserId={me.id} close={()=>{setShowExpense(false);setEditingExpense(null)}} done={expenseAdded}/>} {showInvite&&group&&<InviteModal group={group} close={()=>setShowInvite(false)}/>} {showProfile&&<ProfileModal me={me} close={()=>setShowProfile(false)} saved={bankAccount=>{setMe(current=>({...current,bankAccount}));setShowProfile(false);setNotice(bankAccount.configured?'已更新常用收款帳戶':'已移除常用收款帳戶')}}/>} {transferReport&&<TransferNoticeModal report={transferReport} close={closeTransferReport}/>}
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
      {!details.bankAccount?<><AlertCircle/><div><b>{details.recipient.displayName} 尚未設定收款帳戶</b><p>可先用現金或其他方式還款，仍可在下方確認完成</p></div></>:<>
        <div className="settlement-bank-recipient"><Person person={details.recipient} size={34}/><span><small>轉帳給</small><b>{details.recipient.displayName}</b></span><ShieldCheck aria-label="僅付款人可見"/></div>
        <dl>
          <div><dt>銀行</dt><dd>{details.bankAccount.bankName}（{details.bankAccount.bankCode}）</dd></div>
          {details.bankAccount.branchCode&&<div><dt>分行代碼</dt><dd>{details.bankAccount.branchCode}</dd></div>}
          <div><dt>戶名</dt><dd>{details.bankAccount.accountHolderName}</dd></div>
          <div className="bank-account-number"><dt>帳號</dt><dd>{details.bankAccount.accountNumber}</dd></div>
        </dl>
        <button type="button" className="settlement-bank-copy" onClick={copyAccount} aria-live="polite">{copied?<Check/>:<Clipboard/>}{copied?'已複製帳號':'複製帳號'}</button>
        <small className="settlement-bank-manual">僅供檢視與複製，請自行使用手機銀行轉帳；系統不會發起扣款或匯款</small>
      </>}
    </div>}
  </div>;
}
function SettlementBankUnavailable(){
  return <div className="settlement-bank-unavailable"><WalletCards/><div><b>收款人尚未提供轉帳資訊</b><p>可先聯絡對方或使用其他方式還款，仍可在下方確認完成</p></div></div>;
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
    <div><ShieldCheck/><span><b>{shared?'已提供轉帳資訊':'安全提供收款帳戶'}</b><p>{shared?'只有這位付款人能在目前欠款有效時查看':'由你主動提供後，付款人才看得到完整帳號'}</p></span></div>
    <button type="button" onClick={updateAccess} disabled={busy}>{busy?<LoaderCircle/>:configured?shared?<X/>:<WalletCards/>:<Plus/>}{busy?'處理中…':configured?shared?'撤回資訊':'提供給付款人':'設定收款帳戶'}</button>
    {error&&<p className="settlement-bank-error" role="alert"><AlertCircle/>{error}</p>}
  </div>;
}
function GroupDashboard({group,me,currencies,addExpense,editExpense,invite,removeGroup,refresh,currencyChanged,refreshing=false,openAdmin,openProfile,onTransferReported,adminViewing=false}){
  const [paying,setPaying]=useState(''),[pendingSettlement,setPendingSettlement]=useState(null),[transferError,setTransferError]=useState(''),[deleting,setDeleting]=useState(''),[deletingGroup,setDeletingGroup]=useState(false),[showSettlementHelp,setShowSettlementHelp]=useState(false),[showBalances,setShowBalances]=useState(false),[selectedExpenseShares,setSelectedExpenseShares]=useState(null),[selectedMemberId,setSelectedMemberId]=useState(null),[actionError,setActionError]=useState('');
  const [showCurrencyChange,setShowCurrencyChange]=useState(false),[groupAdminOpen,setGroupAdminOpen]=useState(false);
  const [pendingAction,setPendingAction]=useState(null),[confirmationError,setConfirmationError]=useState('');
  const [activityTab,setActivityTab]=useState('expenses'),[expensePage,setExpensePage]=useState(1),[settlementPage,setSettlementPage]=useState(1),[expenseSort,setExpenseSort]=useState(DEFAULT_EXPENSE_SORT),[expenseQuery,setExpenseQuery]=useState('');
  const [mobileNavActive,setMobileNavActive]=useState('overview');
  const expenseMembers=useMemo(()=>group.members.filter(member=>!member.isFund),[group.members]);
  const selectedMember=expenseMembers.find(member=>String(member.id)===selectedMemberId);
  const [expenseMemberId,setExpenseMemberId]=useState(()=>expenseMembers.some(member=>String(member.id)===String(me.id))?String(me.id):'all');
  const selectedExpenseMember=expenseMembers.find(member=>String(member.id)===expenseMemberId);
  const currentUserIsMember=expenseMembers.some(member=>String(member.id)===String(me.id));
  const expenseParticipantId=selectedExpenseMember?.id||(currentUserIsMember?me.id:null);
  const expenseParticipantLabel=selectedExpenseMember?`${selectedExpenseMember.displayName} 的參與金額`:currentUserIsMember?'我的參與金額':'參與金額';
  const memberFilteredExpenses=useMemo(()=>expenseMemberId==='all'?group.expenses:group.expenses.filter(expense=>
    [...(expense.payments||[]),...(expense.shares||[])].some(entry=>String(entry.userId)===expenseMemberId)
  ),[expenseMemberId,group.expenses]);
  const deferredExpenseQuery=useDeferredValue(expenseQuery);
  const visibleExpenses=useMemo(()=>filterExpenses(memberFilteredExpenses,deferredExpenseQuery),[deferredExpenseQuery,memberFilteredExpenses]);
  const sortedExpenses=useMemo(()=>sortExpenses(visibleExpenses,expenseSort,expenseParticipantId),[expenseParticipantId,expenseSort,visibleExpenses]);
  const expensePageCount=Math.max(1,Math.ceil(sortedExpenses.length/TABLE_PAGE_SIZE)),currentExpensePage=Math.min(expensePage,expensePageCount);
  const pagedExpenses=sortedExpenses.slice((currentExpensePage-1)*TABLE_PAGE_SIZE,currentExpensePage*TABLE_PAGE_SIZE);
  const prioritizedSettlements=useMemo(()=>prioritizeSettlementsForMember(group.settlements,me.id),[group.settlements,me.id]);
  const settlementOrderKey=useMemo(()=>prioritizedSettlements.map(settlement=>`${settlement.from?.id}:${settlement.to?.id}:${settlement.amountCents}`).join('|'),[prioritizedSettlements]);
  const settlementPageCount=Math.max(1,Math.ceil(prioritizedSettlements.length/SETTLEMENT_PAGE_SIZE)),currentSettlementPage=Math.min(settlementPage,settlementPageCount);
  const pagedSettlements=prioritizedSettlements.slice((currentSettlementPage-1)*SETTLEMENT_PAGE_SIZE,currentSettlementPage*SETTLEMENT_PAGE_SIZE);
  useEffect(()=>setExpensePage(page=>Math.min(page,expensePageCount)),[expensePageCount]);
  useEffect(()=>setSettlementPage(page=>Math.min(page,settlementPageCount)),[settlementPageCount]);
  useEffect(()=>setSettlementPage(1),[group.id,me.id,settlementOrderKey]);
  const changeExpenseSort=field=>{setExpenseSort(current=>nextExpenseSort(current,field));setExpensePage(1)};
  const expenseSortSummary=`目前依${EXPENSE_SORT_LABELS[expenseSort.key]}${expenseSortDirectionLabel(expenseSort.key,expenseSort.direction)}排序`;
  const expenseSearchActive=Boolean(String(deferredExpenseQuery).normalize('NFKC').trim());
  const expenseFiltersActive=expenseMemberId!=='all'||expenseSearchActive;
  const currencyCode=group.currency||'TWD',currencyInfo=getCurrency(currencyCode);
  const groupMoney=(cents,options)=>money(cents,currencyCode,options);
  const total=group.expenses.reduce((sum,e)=>sum+e.amountCents,0);
  const mine=group.balances.find(x=>x.id===me.id)?.balanceCents||0;
  const memberCount=group.members.filter(x=>!x.isFund).length;
  const visibleMobileMembers=expenseMembers.slice(0,5),hiddenMobileMemberCount=Math.max(0,expenseMembers.length-visibleMobileMembers.length);
  const settlementHistory=group.settlementHistory||[];
  const activeRepayments=settlementHistory.filter(item=>item.reportStatus!=='voided'&&!item.voidedAt);
  const activeRepaymentTotal=activeRepayments.reduce((sum,item)=>sum+Number(item.amountCents||0),0);
  const latestActivity=[
    ...group.expenses.map(item=>item.createdAt),
    ...settlementHistory.flatMap(item=>[item.createdAt,item.voidedAt])
  ].map(value=>new Date(value).getTime()).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  const lastUpdated=latestActivity?new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(latestActivity)):'尚未有紀錄';
  const canPay=settlement=>String(settlement.from.id)===String(me.id);
  const canManageFundPayment=settlement=>settlement.from.isFund&&String(group.ownerId)===String(me.id)&&String(settlement.to.id)!==String(me.id);
  const canAssistMemberPayment=settlement=>!settlement.from.isFund&&String(group.ownerId)===String(me.id)&&String(settlement.from.id)!==String(me.id);
  const canConfirm=settlement=>canPay(settlement)||canManageFundPayment(settlement)||canAssistMemberPayment(settlement);
  const settlementKey=settlement=>`${settlement.from.id}:${settlement.to.id}:${settlement.amountCents}`;
  const beginTransferReport=settlement=>{setTransferError('');setPendingSettlement(settlement)};
  const closeTransferReport=()=>{if(paying)return;setTransferError('');setPendingSettlement(null)};
  const markPaid=async settlement=>{
    if(paying)return;
    const key=settlementKey(settlement);
    const previousHistoryIds=new Set((group.settlementHistory||[]).map(item=>String(item.id)));
    setPaying(key);
    setTransferError('');
    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),15000);
    let result,requestError,reconciledGroup;
    try{
      result=await api(`/api/groups/${group.id}/settlements`,{method:'POST',signal:controller.signal,body:JSON.stringify({fromUserId:settlement.from.id,toUserId:settlement.to.id,amount:amountCentsToInputValue(Number(settlement.amountCents),currencyCode),currency:currencyCode,ledgerVersion:group.ledgerVersion})});
    }catch(error){
      requestError=error;
    }finally{
      clearTimeout(timeoutId);
    }
    if(requestError){
      try{reconciledGroup=await refresh()}catch{}
      const recorded=(reconciledGroup?.settlementHistory||[]).find(item=>
        !previousHistoryIds.has(String(item.id))&&
        String(item.from.id)===String(settlement.from.id)&&
        String(item.to.id)===String(settlement.to.id)&&
        Number(item.amountCents)===Number(settlement.amountCents)
      );
      if(recorded){
        result={reportedAt:recorded.createdAt,reportStatus:recorded.reportStatus,verificationStatus:recorded.verificationStatus,reportedBy:recorded.reportedBy||recorded.confirmedBy};
      }else{
        const uncertain=!requestError.status;
        setTransferError(uncertain?'目前無法確認轉帳回報是否已記錄 請先重新整理帳本後確認，避免重複送出':`轉帳尚未記錄：${requestError.message}`);
        setPaying('');
        return;
      }
    }
    const report={
      groupName:group.name,
      from:settlement.from,
      to:settlement.to,
      reportedBy:result.reportedBy||{id:me.id,displayName:me.displayName,pictureUrl:me.pictureUrl},
      amountCents:settlement.amountCents,
      currency:currencyCode,
      reportedCurrency:currencyCode,
      reportedAmountCents:settlement.amountCents,
      reportedAt:result.reportedAt||new Date().toISOString(),
      reportStatus:result.reportStatus||'reported',
      verificationStatus:result.verificationStatus||'unverified'
    };
    setPendingSettlement(null);
    onTransferReported(report);
    if(!reconciledGroup){
      try{
        await refresh();
      }catch{
        onTransferReported(current=>current===report?{...report,refreshWarning:'轉帳回報已記錄，但帳本暫時無法重新整理 請關閉視窗後再試一次'}:current);
      }
    }
    setPaying('');
  };
  const requestRemoveExpense=expense=>{setActionError('');setConfirmationError('');setPendingAction({type:'expense',expense})};
  const requestDeleteCurrentGroup=()=>{setGroupAdminOpen(false);setActionError('');setConfirmationError('');setPendingAction({type:'group'})};
  const closeConfirmation=()=>{if(deleting||deletingGroup)return;setConfirmationError('');setPendingAction(null)};
  const confirmPendingAction=async()=>{
    if(!pendingAction||deleting||deletingGroup)return;
    setActionError('');
    setConfirmationError('');
    if(pendingAction.type==='expense'){
      const expense=pendingAction.expense;
      setDeleting(expense.id);
      try{
        await api(`/api/groups/${group.id}/expenses/${expense.id}`,{method:'DELETE'});
        await refresh();
        setPendingAction(null);
      }catch(error){setConfirmationError(error.message)}
      finally{setDeleting('')}
      return;
    }
    setDeletingGroup(true);
    try{
      await removeGroup();
      setPendingAction(null);
    }catch(error){setConfirmationError(error.message)}
    finally{setDeletingGroup(false)}
  };
  const confirmation=pendingAction?.type==='expense'
    ?expenseDeletionConfirmation(pendingAction.expense.title)
    :pendingAction?.type==='group'
      ?groupDeletionConfirmation(group.name)
      :null;
  const confirmationBusy=pendingAction?.type==='expense'?deleting===pendingAction.expense.id:deletingGroup;
  const focusActivityTab=nextTab=>{setActivityTab(nextTab);requestAnimationFrame(()=>document.getElementById(`activity-tab-${nextTab}-${group.id}`)?.focus())};
  const scrollToMobileSection=(selector,nextActive)=>{setMobileNavActive(nextActive);requestAnimationFrame(()=>{const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;document.querySelector(selector)?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'})})};
  const openMobileOverview=()=>scrollToMobileSection(`#group-overview-${group.id}`,'overview');
  const openMobileExpenses=()=>{setActivityTab('expenses');scrollToMobileSection(`#activity-panel-expenses-${group.id}`,'expenses')};
  const openMobileSettlements=()=>scrollToMobileSection(`#group-settlements-${group.id}`,'settlements');
  const openRepaymentHistory=()=>{setActivityTab('repayments');setMobileNavActive('expenses');requestAnimationFrame(()=>{const panel=document.getElementById(`activity-panel-repayments-${group.id}`),reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;panel?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'});document.getElementById('repayment-title')?.focus()})};
  const handleActivityTabKeyDown=event=>{let nextTab;if(event.key==='ArrowLeft'||event.key==='Home')nextTab='expenses';if(event.key==='ArrowRight'||event.key==='End')nextTab='repayments';if(!nextTab)return;event.preventDefault();focusActivityTab(nextTab)};
  return <main className={`real-dashboard ${refreshing?'is-refreshing':''}`} aria-busy={refreshing}>
    {refreshing&&<div className="workspace-progress" role="status"><span></span><span className="sr-only">正在更新群組資料</span></div>}
    {actionError&&<div className="inline-alert" role="alert"><AlertCircle/><span>{actionError}</span><button onClick={()=>setActionError('')} aria-label="關閉錯誤訊息"><X/></button></div>}
    <div className="mobile-overview-pair">
      <article className={`mobile-balance-overview ${mine<0?'is-payable':mine>0?'is-receivable':'is-settled'}`} aria-label="我的餘額摘要">
        <span>{mine<0?'你需要付款':mine>0?'你可以收款':'目前已結清'}<Info aria-hidden="true"/></span>
        <strong>{groupMoney(Math.abs(mine))}</strong>
        <button type="button" onClick={()=>setShowBalances(true)}>查看我的餘額<ChevronRight/></button>
        <span className="mobile-balance-wallet" aria-hidden="true"><i></i></span>
      </article>
      <section className="group-hero" id={`group-overview-${group.id}`} aria-labelledby="group-title">
        <div className="group-overview-side">
          <details className="group-admin-menu" open={groupAdminOpen}><summary aria-expanded={groupAdminOpen} onClick={event=>{event.preventDefault();setGroupAdminOpen(open=>!open)}}><Settings2 aria-hidden="true"/>群組設定</summary><div>
            <div className="group-admin-current"><span>帳本幣別</span><b>{currencyInfo.code} · {currencyInfo.name}</b></div>
            <button type="button" className="group-currency-action" onClick={()=>{setGroupAdminOpen(false);setShowCurrencyChange(true)}}>變更幣別</button>
            <p>所有群組成員都可以調整帳本幣別；換算前會先顯示匯率與尾差。</p>
            {(group.ownerId===me.id||adminViewing)&&<><p>{adminViewing?'你正以管理者身分管理這個帳本':'刪除後，所有支出與結算都無法復原'}</p><button className="danger-action" disabled={deletingGroup} onClick={requestDeleteCurrentGroup}>{deletingGroup?<LoaderCircle/>:<Trash2/>}{deletingGroup?'刪除中…':'刪除群組'}</button></>}
          </div></details>
        </div>
        <div className="group-overview-copy">
          <div className="group-title-row"><h1 id="group-title">{group.name}</h1><span className="currency-badge">{currencyCode}</span></div>
          <p>{group.description||'一起記下每筆共同花費，最後輕鬆結清'}</p>
          <div className="group-meta">
            <span className="member-count-meta"><Users/>{memberCount} 位成員</span>
            <span><CircleHelp/>{currencyCode} {currencyInfo.name}</span>
            <span><History/>上次更新：{lastUpdated}</span>
          </div>
          <div className="group-member-wall" aria-label={`同行成員，共 ${memberCount} 位`}>
            <div className="group-member-wall-head"><span>同行成員</span><strong>{memberCount} 位</strong></div>
            <ul className="group-member-avatars">
              {expenseMembers.map(member=><li key={member.id}><button type="button" className="group-member-avatar" onClick={()=>setSelectedMemberId(String(member.id))} aria-label={`查看 ${member.displayName||'成員'} 的個人資訊`} aria-haspopup="dialog" title={`查看 ${member.displayName||'成員'} 的個人資訊`}><Person person={member} size={32}/></button></li>)}
            </ul>
          </div>
          <div className="mobile-group-details">
            <span className="mobile-group-member-count"><Users/>{memberCount} 位成員</span>
            <ul className="mobile-group-avatars" aria-label={`同行成員，共 ${memberCount} 位`}>
              {visibleMobileMembers.map(member=><li key={member.id}><button type="button" onClick={()=>setSelectedMemberId(String(member.id))} aria-label={`查看 ${member.displayName||'成員'} 的個人資訊`} aria-haspopup="dialog" title={`查看 ${member.displayName||'成員'} 的個人資訊`}><Person person={member} size={30}/></button></li>)}
              {hiddenMobileMemberCount>0&&<li className="mobile-group-avatar-more" aria-hidden="true">+{hiddenMobileMemberCount}</li>}
            </ul>
            <span className="mobile-group-updated"><History/>上次更新：{lastUpdated}</span>
          </div>
        </div>
      </section>
    </div>
    <div className="mobile-summary-cluster">
      <section className={`real-stats ${openAdmin?'has-admin':''}`} aria-label="群組摘要">
        <article className="stat-card balance-stat"><div><small>我的餘額</small><h3 className={mine>=0?'positive':'negative'}><span className="balance-direction">{mine>=0?'應收':'應付'}</span><span className="balance-value">{groupMoney(Math.abs(mine))}</span></h3><p>{mine===0?'目前沒有待結算款項':mine>0?'其他成員需要付給你':'你需要付給其他成員'}</p></div></article>
        <article className="stat-card mobile-summary-copy-stat"><div><small>群組總支出</small><h3>{groupMoney(total)}</h3><p>共 {group.expenses.length} 筆共同花費</p></div></article>
        <article className="stat-card settlement-stat mobile-summary-copy-stat"><div><small>待處理轉帳</small><h3>{group.settlements.length} 筆</h3><p>已自動簡化轉帳路徑</p></div></article>
        <article className="stat-card mobile-summary-stat mobile-member-stat mobile-summary-copy-stat"><div><small>同行成員</small><h3>{memberCount} 位</h3><p>一起記帳更輕鬆</p></div></article>
        {openAdmin&&<button type="button" className="stat-card mobile-summary-stat mobile-admin-stat" onClick={openAdmin}><span className="mobile-stat-icon is-admin" aria-hidden="true"><ShieldCheck/></span><span><small>管理中心</small><strong>查看結餘與設定</strong></span></button>}
      </section>
      <div className={`mobile-shortcuts ${openAdmin?'has-admin':''}`} role="group" aria-label="群組快捷操作">
        <button className="shortcut-card shortcut-balances" onClick={()=>setShowBalances(true)}><span className="shortcut-icon" aria-hidden="true"><WalletCards/></span><span className="shortcut-label">查看結餘</span></button>
        <button className="shortcut-card shortcut-invite" onClick={invite} disabled={adminViewing}><span className="shortcut-icon" aria-hidden="true"><Users/></span><span className="shortcut-label">邀請成員</span></button>
        {openAdmin&&<button className="shortcut-card mobile-admin-shortcut" onClick={openAdmin}><span className="shortcut-icon" aria-hidden="true"><ShieldCheck/></span><span className="shortcut-label">管理中心</span></button>}
      </div>
    </div>
    <div className="real-grid">
      <div className="activity-column">
        <nav className="activity-tabs" role="tablist" aria-label="帳目紀錄">
          <button id={`activity-tab-expenses-${group.id}`} type="button" role="tab" aria-selected={activityTab==='expenses'} aria-controls={`activity-panel-expenses-${group.id}`} tabIndex={activityTab==='expenses'?0:-1} className={activityTab==='expenses'?'active':''} onClick={()=>{setActivityTab('expenses');setMobileNavActive('expenses')}} onKeyDown={handleActivityTabKeyDown}><ReceiptText/><span>最近支出</span><b>{group.expenses.length}</b></button>
          <button id={`activity-tab-repayments-${group.id}`} type="button" role="tab" aria-selected={activityTab==='repayments'} aria-controls={`activity-panel-repayments-${group.id}`} tabIndex={activityTab==='repayments'?0:-1} className={activityTab==='repayments'?'active':''} onClick={()=>{setActivityTab('repayments');setMobileNavActive('expenses')}} onKeyDown={handleActivityTabKeyDown}><History/><span>還款紀錄</span><b>{(group.settlementHistory||[]).length}</b></button>
        </nav>
        <section className="expense-panel" id={`activity-panel-expenses-${group.id}`} role="tabpanel" aria-labelledby={`activity-tab-expenses-${group.id}`} tabIndex={0} hidden={activityTab!=='expenses'}>
          <div className="section-head">
            <div><h2 id="expense-title">最近支出</h2><p aria-live="polite" aria-atomic="true">{expenseSortSummary}</p></div>
            <div className="expense-head-actions">
              <label className="expense-search" htmlFor={`expense-search-${group.id}`}>
                <Search aria-hidden="true"/>
                <span className="sr-only">搜尋最近支出</span>
                <input id={`expense-search-${group.id}`} type="search" value={expenseQuery} onChange={event=>{setExpenseQuery(event.target.value);setExpensePage(1)}} placeholder="搜尋項目" autoComplete="off"/>
              </label>
              <label className="expense-member-filter" title={selectedExpenseMember?.displayName||'全部成員'}><span className="expense-member-filter-avatar" aria-hidden="true">{selectedExpenseMember?<Person person={selectedExpenseMember} size={26}/>:<Users/>}</span><span className="expense-member-filter-copy" aria-hidden="true"><small>支出成員</small><b>{selectedExpenseMember?.displayName||'全部成員'}</b></span><ChevronDown aria-hidden="true"/><select id={`expense-member-filter-${group.id}`} value={expenseMemberId} onChange={event=>{setExpenseMemberId(event.target.value);setExpensePage(1)}} aria-label="依成員篩選最近支出"><option value="all">全部成員</option>{expenseMembers.map(member=><option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
              <output className={`count-badge expense-count ${expenseFiltersActive?'is-filtered':''}`} htmlFor={`expense-search-${group.id} expense-member-filter-${group.id}`} aria-live="polite" aria-atomic="true"><strong>{visibleExpenses.length}</strong><span>{expenseFiltersActive?`／${group.expenses.length} 筆`:'筆支出'}</span></output>
            </div>
          </div>
          <div className="mobile-expense-sort" role="group" aria-label="最近支出排序"><ExpenseSortButton field="date" sort={expenseSort} onSort={changeExpenseSort}/><ExpenseSortButton field="participantAmount" sort={expenseSort} onSort={changeExpenseSort}/><ExpenseSortButton field="amount" sort={expenseSort} onSort={changeExpenseSort}/></div>
          {!group.expenses.length?<div className="empty-list"><ReceiptText/><b>還沒有任何支出</b><p>{adminViewing?'此帳本目前不需要管理協助':'從第一筆共同花費開始建立清楚帳目'}</p>{addExpense&&<button className="empty-primary" onClick={addExpense}><Plus/> 新增第一筆支出</button>}</div>:<>
            {!visibleExpenses.length?<div className="empty-list"><ReceiptText/><b>沒有符合的支出</b><p>{expenseSearchActive?`找不到符合「${expenseQuery.trim()}」的支出`:selectedExpenseMember?`${selectedExpenseMember.displayName} 尚未參與任何支出`:'目前沒有符合篩選條件的支出'}</p></div>:<>
            <div className="expense-record-table" role="table" aria-labelledby="expense-title">
              <div role="rowgroup"><div className="record-table-head" role="row"><span className="record-sort-cell" role="columnheader" aria-sort={expenseSort.key==='date'?(expenseSort.direction==='asc'?'ascending':'descending'):'none'}><ExpenseSortButton field="date" sort={expenseSort} onSort={changeExpenseSort}/></span><span role="columnheader">項目</span><span role="columnheader">支付者</span><span className="record-sort-cell numeric" role="columnheader" aria-sort={expenseSort.key==='participantAmount'?(expenseSort.direction==='asc'?'ascending':'descending'):'none'}><ExpenseSortButton field="participantAmount" sort={expenseSort} onSort={changeExpenseSort}/></span><span className="record-sort-cell numeric" role="columnheader" aria-sort={expenseSort.key==='amount'?(expenseSort.direction==='asc'?'ascending':'descending'):'none'}><ExpenseSortButton field="amount" sort={expenseSort} onSort={changeExpenseSort} className="amount-sort"/><small className="record-currency" aria-hidden="true">{currencyCode}</small></span><span className="record-category-heading" role="columnheader">分類</span><span role="columnheader">狀態</span><span role="columnheader">操作</span></div></div>
              <div className="record-list" role="rowgroup">{pagedExpenses.map(e=>{const participantShare=(e.shares||[]).find(share=>String(share.userId)===String(expenseParticipantId)),inputCurrency=e.currencyMeta?.inputCurrency||currencyCode,inputAmountCents=Number(e.currencyMeta?.inputAmountCents??e.amountCents),showOriginal=inputCurrency!==currencyCode;return <article key={e.id} role="row">
                <time className="record-date" dateTime={e.createdAt} role="cell">{new Date(e.createdAt).toLocaleDateString('zh-TW')}</time>
                <div className="record-name" role="cell"><div><b title={e.title}>{e.title}</b><small className="record-meta"><ExpenseShareAvatars expense={e} members={group.members} onOpen={setSelectedExpenseShares}/></small></div></div>
                <div className="record-mobile-payer" role="cell"><ExpensePayerAvatars expense={e} members={group.members}/><span className="record-mobile-payer-copy"><b title={e.payerName}>{e.payerName}</b><small>付款</small></span></div>
                <span className="record-payer" role="cell">{e.payerName}</span>
                <div className={`record-share-amount ${participantShare?'':'is-empty'}`} role="cell"><small>{expenseParticipantLabel}</small><b>{participantShare?groupMoney(participantShare.amountCents):'未參與'}</b></div>
                <div className="record-price" role="cell"><b className={e.amountCents<0?'positive':''}>{groupMoney(e.amountCents)}</b>{showOriginal&&<small className="record-original-currency">原幣 {money(inputAmountCents,inputCurrency)}</small>}<small>{e.payerCount>1?`${e.payerCount} 人付款`:e.splitMode==='equal'?`平均 ${groupMoney(Math.round(e.amountCents/e.shareCount/currencyInfo.quantum)*currencyInfo.quantum)}`:{exact:'指定金額',hybrid:'指定＋均分',weights:'比例／份數'}[e.splitMode]||'自訂分攤'}</small></div>
                <span className="record-category" role="cell">{e.amountCents<0?'退款':e.category||'其他'}</span>
                <span className={`record-status ${e.isLocked?'is-locked':''}`} role="cell">{e.isLocked?<ShieldCheck/>:<Check/>}{e.isLocked?'已結算':'已記錄'}</span>
                <div className="record-mobile-meta" role="cell"><ExpenseShareAvatars expense={e} members={group.members} onOpen={setSelectedExpenseShares}/></div>
                <div className="expense-row-actions" role="cell">{(e.createdBy===me.id||group.ownerId===me.id||me.isSuperuser)&&(e.isLocked?<button type="button" className="expense-locked" onClick={openRepaymentHistory} aria-label={`查看與「${e.title}」相關時段的還款紀錄`}><History/><span>查看還款</span></button>:<><button className="expense-edit" title="修改支出" aria-label={`修改 ${e.title}`} onClick={()=>editExpense(e)}><Pencil/></button><button className="expense-delete" title="刪除支出" aria-label={`刪除 ${e.title}`} disabled={deleting===e.id} onClick={()=>requestRemoveExpense(e)}>{deleting===e.id?<LoaderCircle/>:<Trash2/>}</button></>)}</div>
              </article>})}</div>
            </div>
            <RecordPagination page={currentExpensePage} totalItems={visibleExpenses.length} pageSize={TABLE_PAGE_SIZE} onPageChange={setExpensePage} label="最近支出"/>
            </>}
          </>}
        </section>
        <SettlementHistory group={group} refresh={refresh} refreshing={refreshing} hidden={activityTab!=='repayments'} id={`activity-panel-repayments-${group.id}`} labelledBy={`activity-tab-repayments-${group.id}`}/>
      </div>
      <aside className="settlements" id={`group-settlements-${group.id}`} aria-labelledby="settlement-title">
        <div className="settlement-heading"><div><span className="section-kicker">待辦事項</span><h2 id="settlement-title" tabIndex={-1}>結算</h2><p>依支出與有效還款計算，共 {group.settlements.length} 筆</p></div><button className="settlement-help-button" onClick={()=>setShowSettlementHelp(true)} aria-label="了解結算演算法"><CircleHelp/></button></div>
        {activeRepayments.length>0&&<button type="button" className="settlement-repayment-note" onClick={openRepaymentHistory}><span>結餘已計入 {activeRepayments.length} 筆有效還款（共 {groupMoney(activeRepaymentTotal)}）</span><b>查看紀錄</b></button>}
        {!group.settlements.length?<div className="all-clear"><Check/><b>目前都結清了</b><p>新增支出後，旅帳會在這裡整理最少轉帳路徑</p></div>:<>
          <div className="settlement-list">{pagedSettlements.map(s=>{
            const ownPayment=canPay(s),fundPayment=canManageFundPayment(s),assistedPayment=canAssistMemberPayment(s);
            const actionable=ownPayment||fundPayment||assistedPayment,bankAccess=s.bankAccountAccess||{},canShareBank=Boolean(bankAccess.canShare&&String(s.to.id)===String(me.id));
            return <article className={`settlement-row ${actionable?'payable':''}`} key={settlementKey(s)}>
              <div className="settlement-card-head">
                <span className={`settlement-status ${actionable?'needs-action':''}`}><Clock3/>{assistedPayment?'可代為確認':actionable?'待你付款':'等待付款'}</span>
                <span className="settlement-amount"><small>{assistedPayment?'代確認金額':actionable?(fundPayment?'公費需支付':'你需支付'):'轉帳金額'}</small><strong>{groupMoney(s.amountCents)}</strong></span>
              </div>
              <div className="settlement-route" role="group" aria-label={`${s.from.displayName} 支付給 ${s.to.displayName}`}>
                <div className="settlement-person"><Person person={s.from} size={40}/><span className="settlement-person-copy"><small>付款人</small><b>{s.from.displayName}</b></span></div>
                <span className="settlement-route-arrow" aria-hidden="true"><ArrowRight/></span>
                <div className="settlement-person receiver"><Person person={s.to} size={40}/><span className="settlement-person-copy"><small>收款人</small><b>{s.to.displayName}</b></span></div>
              </div>
              {canShareBank&&<SettlementBankShare groupId={group.id} settlement={s} shared={bankAccess.shared} configured={Boolean(me.bankAccount?.configured)} refresh={refresh} openProfile={openProfile}/>}
              {(ownPayment||fundPayment)&&(bankAccess.shared?<SettlementBankDetails groupId={group.id} settlement={s}/>:<SettlementBankUnavailable/>)}
              {actionable?<button className="settlement-confirm" disabled={Boolean(paying)} onClick={()=>beginTransferReport(s)}><Check/>{assistedPayment?'代為標記已轉帳':fundPayment?'從公費付款':'我已轉帳'}</button>:<div className="settlement-waiting" role="status"><Clock3/><span><b>等待 {s.from.displayName} 轉帳</b><small>付款人回報後會更新結算狀態</small></span></div>}
            </article>;
          })}</div>
          <RecordPagination page={currentSettlementPage} totalItems={group.settlements.length} pageSize={SETTLEMENT_PAGE_SIZE} onPageChange={setSettlementPage} label="待辦結算" compact/>
        </>}
      </aside>
    </div>
    <nav className="mobile-bottom-nav" aria-label="主要導覽">
      <button type="button" aria-current={mobileNavActive==='overview'?'page':undefined} onClick={openMobileOverview}><Home/><span>總覽</span></button>
      <button type="button" aria-current={mobileNavActive==='expenses'?'page':undefined} onClick={openMobileExpenses}><ReceiptText/><span>支出</span></button>
      <button type="button" className="mobile-bottom-add" onClick={addExpense} disabled={!addExpense} aria-label="記一筆支出"><span className="mobile-bottom-add-icon" aria-hidden="true"><Plus/></span><span className="mobile-bottom-add-label">記一筆</span></button>
      <button type="button" aria-current={mobileNavActive==='settlements'?'page':undefined} onClick={openMobileSettlements}><Check/><span>結算</span></button>
      <button type="button" onClick={openProfile}><UserRound/><span>我的</span></button>
    </nav>
    {showCurrencyChange&&<CurrencyConversionModal group={group} currencies={currencies} close={()=>setShowCurrencyChange(false)} done={currencyChanged}/>} {showSettlementHelp&&<SettlementHelp group={group} close={()=>setShowSettlementHelp(false)}/>} {showBalances&&<BalanceChart group={group} close={()=>setShowBalances(false)}/>} {selectedExpenseShares&&<ExpenseSharesModal expense={selectedExpenseShares} members={group.members} currency={currencyCode} close={()=>setSelectedExpenseShares(null)}/>} {selectedMember&&<MemberInfoModal member={selectedMember} group={group} me={me} close={()=>setSelectedMemberId(null)}/>} {pendingSettlement&&<TransferConfirmationModal group={group} settlement={pendingSettlement} reportedBy={me} busy={paying===settlementKey(pendingSettlement)} error={transferError} close={closeTransferReport} confirm={()=>markPaid(pendingSettlement)}/>}
    {confirmation&&<ConfirmModal {...confirmation} busy={confirmationBusy} error={confirmationError} onCancel={closeConfirmation} onConfirm={confirmPendingAction}/>}
  </main>
}
function CurrencyConversionModal({group,currencies,close,done}){
 const options=Array.isArray(currencies?.currencies)?currencies.currencies:Array.isArray(currencies)?currencies:DEFAULT_CURRENCIES;
 const currentCode=group.currency||'TWD',available=options.filter(item=>item.code!==currentCode);
 const [targetCurrency,setTargetCurrency]=useState(available[0]?.code||''),[preview,setPreview]=useState(null),[agreed,setAgreed]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[blockedIssues,setBlockedIssues]=useState([]);
 const [exchangeRateMode,setExchangeRateMode]=useState('quoted'),[manualRate,setManualRate]=useState('');
 const current=getCurrency(currentCode),target=getCurrency(preview?.toCurrency||targetCurrency||currentCode);
 const manualRateValid=exchangeRateMode!=='manual'||(/^(\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(manualRate.trim())&&Number(manualRate)>0);
 const rateHealth=preview?.exchangeRateHealth||currencies?.exchangeRates;
 const requestPreview=async event=>{
  event?.preventDefault();
  if(!targetCurrency||targetCurrency===currentCode||loading||!manualRateValid)return;
  setLoading(true);setError('');setBlockedIssues([]);setAgreed(false);
  try{
   const result=await api(`/api/groups/${group.id}/currency/preview`,{method:'POST',body:JSON.stringify({targetCurrency,exchangeRateMode,exchangeRate:exchangeRateMode==='manual'?manualRate.trim():undefined})});
   setPreview(result);
  }catch(previewError){
   setPreview(null);
   setBlockedIssues(Array.isArray(previewError.data?.blockedIssues)?previewError.data.blockedIssues:[]);
   setError(previewError.message);
  }finally{setLoading(false)}
 };
 const confirm=async()=>{
  if(!preview?.previewToken||!agreed||saving)return;
  setSaving(true);setError('');
  try{
   const result=await api(`/api/groups/${group.id}/currency`,{method:'PATCH',body:JSON.stringify({previewToken:preview.previewToken})});
   await done(result);
   close();
  }catch(saveError){
   if(saveError.status===409){setPreview(null);setAgreed(false);setError('帳本或匯率已更新，請重新取得換算預覽後再確認')}
   else setError(saveError.message);
  }finally{setSaving(false)}
 };
 const back=()=>{if(loading||saving)return;setPreview(null);setAgreed(false);setError('');setBlockedIssues([])};
 const formatRate=value=>{const numeric=Number(value);return Number.isFinite(numeric)?new Intl.NumberFormat('zh-TW',{maximumFractionDigits:10}).format(numeric):String(value||'—')};
 const formatDate=value=>{if(!value)return '未提供';const date=new Date(`${value}T00:00:00`);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium'}).format(date)};
 const roundingDelta=Number(preview?.roundingDeltaCents||0);
 const counts=preview?.counts||{};
 const rateWarning=rateHealth?.warning||((rateHealth?.stale||rateHealth?.status==='stale')?'目前使用最後一份有效匯率，請先確認匯率日期':'');
 return <Modal close={close} closeDisabled={loading||saving} className="currency-conversion-modal" label={`變更「${group.name}」的帳本幣別`}>
  <div className="currency-conversion-content" aria-busy={loading||saving}>
   <header className="currency-conversion-heading">
    <span className="eyebrow">群組管理</span>
    <h2>變更帳本幣別</h2>
    <p>既有帳務會依預覽匯率永久換算，之後不會隨每日匯率浮動</p>
   </header>
   <ol className="currency-conversion-steps" aria-label="幣別換算進度">
    <li className={!preview?'active':'complete'}><span>1</span><b>選擇幣別</b></li>
    <li className={preview?'active':''}><span>2</span><b>檢查並確認</b></li>
   </ol>
   {!preview?<form className="currency-conversion-select" onSubmit={requestPreview}>
    <div className="currency-current-card"><span>目前帳本幣別</span><strong>{current.code}</strong><small>{current.name} · 小數點後 {current.decimals} 位</small></div>
    <label htmlFor={`currency-target-${group.id}`}>換算為
     <select id={`currency-target-${group.id}`} autoFocus value={targetCurrency} onChange={event=>{setTargetCurrency(event.target.value);setError('');setBlockedIssues([])}} disabled={loading}>
      {available.map(item=><option value={item.code} key={item.code}>{item.code} · {item.name}（小數點後 {item.decimals} 位）</option>)}
     </select>
     <small className="field-help">換算前會先顯示匯率、影響筆數與預估尾差，不會立即修改帳本</small>
    </label>
    <div className="currency-rate-choice">
     <div className="currency-rate-tabs" role="group" aria-label="群組換算匯率來源"><button type="button" aria-pressed={exchangeRateMode==='quoted'} onClick={()=>{setExchangeRateMode('quoted');setError('')}}>系統匯率</button><button type="button" aria-pressed={exchangeRateMode==='manual'} onClick={()=>{setExchangeRateMode('manual');setError('')}}>自訂匯率</button></div>
     {exchangeRateMode==='manual'&&<label>1 {currentCode} = <span><input type="number" min="0.000000001" step="any" inputMode="decimal" value={manualRate} onChange={event=>setManualRate(event.target.value)} aria-invalid={!manualRateValid}/><b>{targetCurrency}</b></span><small className="field-help">所有既有帳務都會固定使用這個匯率，請先確認方向與數值</small></label>}
    </div>
    {rateWarning&&<p className="currency-rate-warning" role="status">{rateWarning}</p>}
    {blockedIssues.length>0&&<ul className="currency-blocked-list" role="alert">{blockedIssues.map((issue,index)=><li key={`${issue?.code||'issue'}-${index}`}>{issue?.message||String(issue)}</li>)}</ul>}
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={loading}>取消</button><button type="submit" className="primary" disabled={loading||!targetCurrency||!manualRateValid}>{loading?<LoaderCircle/>:null}{loading?'正在計算…':'取得換算預覽'}</button></div>
   </form>:<div className="currency-preview">
    <div className="currency-preview-route" aria-label={`從 ${currentCode} 換算為 ${target.code}`}><div><small>目前</small><strong>{currentCode}</strong><span>{current.name}</span></div><ArrowRight aria-hidden="true"/><div><small>換算後</small><strong>{target.code}</strong><span>{target.name}</span></div></div>
    <dl className="currency-preview-facts">
     <div><dt>採用匯率</dt><dd>1 {preview.fromCurrency} = {formatRate(preview.rate)} {preview.toCurrency}</dd></div>
     <div><dt>匯率日期</dt><dd>{formatDate(preview.rateDate)}</dd></div>
     <div><dt>資料來源</dt><dd>{preview.rateMode==='manual'?'成員自訂':preview.sourceUrl?<a href={preview.sourceUrl} target="_blank" rel="noreferrer">{preview.source||'Exchange API'}</a>:preview.source||'Exchange API'}</dd></div>
     <div><dt>金額精度</dt><dd>{target.code} 保留小數點後 {preview.targetDecimals??target.decimals} 位</dd></div>
    </dl>
    <div className="currency-preview-counts" aria-label="換算資料筆數">
     <span><b>{Number(counts.expenses||0).toLocaleString()}</b>支出</span>
     <span><b>{Number(counts.payments||0).toLocaleString()}</b>付款明細</span>
     <span><b>{Number(counts.shares||0).toLocaleString()}</b>分攤明細</span>
     <span><b>{Number(counts.settlements||0).toLocaleString()}</b>還款紀錄</span>
    </div>
    <div className="currency-rounding-summary"><span>預估換算尾差</span><strong className={roundingDelta===0?'is-zero':''}>{roundingDelta===0?'無尾差':`${roundingDelta>0?'+':'−'}${conversionDeltaLabel(roundingDelta,target.code)}`}</strong><small>這是幣別精度造成的理論差額；系統會以最大餘數法分配，確保每筆付款與分攤總額一致</small></div>
    {Array.isArray(preview.examples)&&preview.examples.length>0&&<div className="currency-preview-examples"><b>換算範例</b>{preview.examples.slice(0,3).map((item,index)=><div key={item.id||`${item.title}-${index}`}><span>{item.title||`帳目 ${index+1}`}</span><small>{money(item.beforeAmountCents,preview.fromCurrency)} → {money(item.afterAmountCents,preview.toCurrency)}</small></div>)}</div>}
    {rateWarning&&<p className="currency-rate-warning" role="status">{rateWarning}</p>}
    <div className="currency-permanent-warning"><b>這是不可逆的帳務操作</b><p>所有支出、付款、分攤與還款都會永久換算。反覆切換可能因幣別精度產生小額四捨五入差異，原始快照會保留在稽核紀錄中。</p></div>
    <label className="currency-confirm-check"><input type="checkbox" checked={agreed} onChange={event=>setAgreed(event.target.checked)} disabled={saving}/><span>我了解這會永久換算既有帳務</span></label>
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={back} disabled={saving}>返回修改</button><button type="button" className="primary" onClick={confirm} disabled={saving||!agreed}>{saving?<LoaderCircle/>:null}{saving?'正在換算帳本…':`確認換算為 ${target.code}`}</button></div>
    {preview.expiresAt&&<small className="currency-preview-expiry">此預覽將於 {new Intl.DateTimeFormat('zh-TW',{hour:'2-digit',minute:'2-digit'}).format(new Date(preview.expiresAt))} 失效</small>}
   </div>}
  </div>
 </Modal>;
}
function MemberInfoModal({member,group,me,close}){
 const isOwner=member.role==='owner'||String(member.id)===String(group.ownerId),isMe=String(member.id)===String(me.id),roleLabel=isOwner?'群組建立者':'同行成員';
 return <Modal close={close} label={`${member.displayName||'成員'}的個人資訊`}>
  <div className="member-profile-content">
   <div className="member-profile-heading"><Person person={member} size={72}/><div><span className="eyebrow"><Users/> 群組成員</span><h2>{member.displayName||'未命名成員'}</h2><p>{roleLabel}{isMe?' · 這是你':''}</p></div></div>
   <dl className="member-profile-details">
    <div><dt>顯示名稱</dt><dd>{member.displayName||'未設定'}</dd></div>
    <div><dt>群組身分</dt><dd>{roleLabel}</dd></div>
    <div><dt>成員狀態</dt><dd><Check/>已加入「{group.name}」</dd></div>
   </dl>
   <div className="member-profile-privacy"><ShieldCheck/><div><b>只顯示群組公開資訊</b><p>收款帳戶與其他私人資料不會顯示在成員資訊中</p></div></div>
   <button type="button" className="primary wide" onClick={close}>完成</button>
  </div>
 </Modal>;
}
function ExpenseSharesModal({expense,members,currency='TWD',close}){
 const rows=expenseShareRows(expense,members),isRefund=Number(expense.amountCents)<0,kindLabel=isRefund?'退款':'分攤';
 return <Modal close={close} label={`「${expense.title}」的${kindLabel}成員`}>
  <div className="expense-shares-modal-content">
   <span className="eyebrow"><Users/> {isRefund?'退款分配':'支出分攤'}</span>
   <h2>{expense.title}</h2>
   <p className="modal-copy">{isRefund?`這筆退款將依下列金額退回給 ${rows.length} 位成員`:`這筆支出由以下 ${rows.length} 位成員共同分攤`}</p>
   <ul className="expense-share-list" aria-label={`${kindLabel}成員與金額`}>
    {rows.map(row=><li key={row.userId}><Person person={row.person} size={42}/><span><b>{row.person.displayName}</b><small>{isRefund?'退回金額':'應分攤金額'}</small></span><strong>{money(Math.abs(row.amountCents),currency)}</strong></li>)}
   </ul>
   <div className={`expense-share-total ${isRefund?'is-refund':''}`}><span>{isRefund?'退款總額':'分攤總額'}</span><strong>{money(Math.abs(expense.amountCents),currency)}</strong></div>
   <button type="button" className="primary wide" onClick={close}>完成</button>
  </div>
 </Modal>;
}
function TransferConfirmationModal({group,settlement,reportedBy,busy,error,close,confirm}){
 const isFund=Boolean(settlement.from.isFund);
 const isAssisted=String(settlement.from.id)!==String(reportedBy.id);
 return <Modal close={close} closeDisabled={busy} className="transfer-confirm-modal" label="確認轉帳回報">
  <div className="transfer-confirm-content" aria-busy={busy}>
   <div className="transfer-modal-heading"><span className="transfer-modal-icon"><Check/></span><div><span className="eyebrow">完成轉帳通知</span><h2>{isAssisted?'代為確認這筆轉帳已完成？':'確認已完成這筆轉帳？'}</h2><p>{isAssisted?'送出後會以群組建立者身分代為記錄，並更新帳本':'送出後會更新帳本，並為你準備可分享到 LINE 的通知文字'}</p></div></div>
   <div className="transfer-summary-card">
    <div className="transfer-report-route" role="group" aria-label={`${settlement.from.displayName} 轉帳給 ${settlement.to.displayName}`}>
     <div><Person person={settlement.from} size={42}/><span><small>付款人</small><b>{settlement.from.displayName}</b></span></div>
     <ArrowRight aria-hidden="true"/>
     <div><Person person={settlement.to} size={42}/><span><small>收款人</small><b>{settlement.to.displayName}</b></span></div>
    </div>
    <div className="transfer-summary-amount"><small>回報金額</small><strong>{money(settlement.amountCents,group.currency)}</strong></div>
    <p className="transfer-summary-group"><WalletCards/>{group.name}{isAssisted&&<span>由 {reportedBy.displayName} 代為確認</span>}{!isAssisted&&isFund&&<span>由 {reportedBy.displayName} 代管回報</span>}</p>
   </div>
   <div className="transfer-verification-note" id="transfer-confirm-note"><AlertCircle/><div><b>{isAssisted?'這是管理員代為回報，不是入帳驗證':'這是自行回報，不是入帳驗證'}</b><p>{isAssisted?'TripTab 未連線銀行，請先向付款人或收款人確認款項已完成，再代為送出。':'TripTab 未連線銀行，無法確認收款人是否實際收到款項 請確認你已在銀行或其他支付工具完成轉帳後再送出'}</p></div></div>
   {error&&<p className="transfer-report-error" role="alert"><AlertCircle/>{error}</p>}
   <div className="transfer-confirm-actions">
    <button type="button" className="secondary-button" onClick={close} disabled={busy}>先不要</button>
    <button type="button" className="primary" onClick={confirm} disabled={busy} aria-describedby="transfer-confirm-note">{busy?<LoaderCircle/>:<Check/>}{busy?'記錄中…':isAssisted?'代為確認並記錄':'確認已轉帳並記錄'}</button>
   </div>
  </div>
 </Modal>;
}
function TransferNoticeModal({report,close}){
 const {text,amountLabel,timeLabel}=buildSettlementNotice(report);
 const isAssisted=Boolean(report.reportedBy)&&String(report.reportedBy.id)!==String(report.from.id);
 const [copyState,setCopyState]=useState(''),[shareOpened,setShareOpened]=useState(false);
 const copy=async()=>{
  setCopyState('');
  try{
   await navigator.clipboard.writeText(text);
   setCopyState('copied');
  }catch{
   setCopyState('error');
  }
 };
 return <Modal close={close} className="transfer-report-modal" label="轉帳回報完成">
  <div className="transfer-report-content">
   <div className="transfer-modal-heading is-success"><span className="transfer-modal-icon"><Check/></span><div><span className="eyebrow">轉帳回報完成</span><h2>已記錄這筆轉帳</h2><p>旅帳已更新結算與還款紀錄，你現在可以通知收款人</p></div></div>
   <div className="transfer-summary-card">
    <div className="transfer-report-route" role="group" aria-label={`${report.from.displayName} 轉帳給 ${report.to.displayName}`}>
     <div><Person person={report.from} size={42}/><span><small>付款人</small><b>{report.from.displayName}</b></span></div>
     <ArrowRight aria-hidden="true"/>
     <div><Person person={report.to} size={42}/><span><small>收款人</small><b>{report.to.displayName}</b></span></div>
    </div>
    <div className="transfer-summary-amount"><small>已回報金額</small><strong>{amountLabel}</strong></div>
    <dl className="transfer-report-meta"><div><dt>旅程</dt><dd>{report.groupName}</dd></div><div><dt>記錄時間</dt><dd>{timeLabel}</dd></div>{report.reportedBy&&<div><dt>回報人</dt><dd>{report.reportedBy.displayName}</dd></div>}</dl>
   </div>
   <div className="transfer-verification-note" id="transfer-report-note"><ShieldCheck/><div><b>{isAssisted?'群組建立者代為回報':'付款人自行回報'}</b><p>TripTab 未連線銀行驗證入帳，實際收款狀態請以收款人的銀行或支付工具紀錄為準</p></div></div>
   {report.refreshWarning&&<p className="transfer-refresh-warning" role="alert"><RefreshCcw/>{report.refreshWarning}</p>}
   <details className="transfer-report-preview"><summary>預覽通知文字</summary><pre>{text}</pre></details>
   <div className="transfer-report-actions">
    <a className="line-share transfer-line-share" href={settlementLineShareUrl(report)} target="_blank" rel="noreferrer" aria-describedby="transfer-report-note" onClick={()=>{setCopyState('');setShareOpened(true)}}><MessageCircle/>分享到 LINE</a>
    <button type="button" className="copy-link transfer-copy-link" onClick={copy} aria-describedby="transfer-report-note">{copyState==='copied'?<Check/>:<Clipboard/>}{copyState==='copied'?'已複製通知文字':'複製通知文字'}</button>
    <button type="button" className="transfer-report-done" onClick={close}>完成，返回旅帳</button>
   </div>
   <div className={`transfer-share-feedback ${copyState==='error'?'is-error':''}`} aria-live="polite" role={copyState==='error'?'alert':'status'}>
    {copyState==='error'?'無法自動複製，請展開預覽後手動選取文字':copyState==='copied'?'通知文字已複製':shareOpened?'已送出 LINE 分享請求，請在 LINE 選擇聊天室後自行送出':'LINE 分享不會自動傳送訊息'}
   </div>
  </div>
 </Modal>;
}
function SettlementHistory({group,refresh,refreshing=false,hidden=false,id,labelledBy}){
 const sourceRows=group.settlementHistory||[];
 const [localVoids,setLocalVoids]=useState({});
 const rows=sourceRows.map(item=>localVoids[item.id]&&!item.voidedAt?{...item,...localVoids[item.id],canVoid:false}:item);
 const activeCount=rows.filter(item=>item.reportStatus!=='voided'&&!item.voidedAt).length,voidedCount=rows.length-activeCount;
 const [page,setPage]=useState(1),[pendingVoid,setPendingVoid]=useState(null),[voiding,setVoiding]=useState(''),[voidError,setVoidError]=useState(''),[historyError,setHistoryError]=useState(''),[statusMessage,setStatusMessage]=useState('');
 const pageCount=Math.max(1,Math.ceil(rows.length/TABLE_PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const pagedRows=rows.slice((currentPage-1)*TABLE_PAGE_SIZE,currentPage*TABLE_PAGE_SIZE);
 useEffect(()=>{setLocalVoids({});setPage(1);setPendingVoid(null);setVoiding('');setVoidError('');setHistoryError('');setStatusMessage('')},[group.id]);
 useEffect(()=>setPage(value=>Math.min(value,pageCount)),[pageCount]);
 const formatTime=value=>new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const refreshHistory=async()=>{setHistoryError('');try{await refresh()}catch(error){setHistoryError(error.message||'暫時無法重新整理還款紀錄，請稍後再試')}};
 const requestVoid=item=>{setStatusMessage('');setHistoryError('');setVoidError('');setPendingVoid(item)};
 const closeVoid=()=>{if(voiding)return;setVoidError('');setPendingVoid(null)};
 const confirmVoid=async()=>{
  if(!pendingVoid||voiding)return;
  const item=pendingVoid;
  setVoiding(item.id);
  setVoidError('');
  try{
   const result=await api(`/api/groups/${group.id}/settlements/${item.id}/void`,{method:'PATCH'});
   setLocalVoids(current=>({...current,[item.id]:{reportStatus:'voided',voidedAt:result.voidedAt||new Date().toISOString(),voidedBy:{displayName:'你'}}}));
   setPendingVoid(null);
   setStatusMessage(`已撤銷 ${item.from.displayName} 轉給 ${item.to.displayName} 的 ${money(item.amountCents,group.currency)} 回報，群組結餘已重新計算`);
   try{await refresh()}catch{setStatusMessage('回報已撤銷，但帳本暫時無法重新整理，請按右上角重新整理')}
   requestAnimationFrame(()=>document.getElementById('repayment-title')?.focus());
  }catch(error){setVoidError(error.message)}finally{setVoiding('')}
 };
 const confirmation=pendingVoid?settlementVoidConfirmation(pendingVoid):null;
 return <>
  <section className="repayment-panel" id={id} role="tabpanel" aria-labelledby={labelledBy} tabIndex={0} hidden={hidden}>
   <div className="section-head"><div><h2 id="repayment-title" tabIndex={-1}>還款紀錄</h2><p>有效 {activeCount} 筆{voidedCount?` · 已撤銷 ${voidedCount} 筆`:''}</p></div><button type="button" className="history-refresh" disabled={refreshing||Boolean(voiding)} onClick={refreshHistory} aria-label={refreshing?'正在重新整理還款紀錄':'重新整理還款紀錄'}>{refreshing?<LoaderCircle/>:<RefreshCcw/>}</button></div>
   {statusMessage&&<p className="repayment-feedback" role="status" aria-live="polite"><Check/>{statusMessage}</p>}
   {historyError&&<p className="repayment-feedback is-error" role="alert"><AlertCircle/>{historyError}</p>}
   {!rows.length?<div className="repayment-empty"><History/><span>還沒有轉帳回報紀錄</span></div>:<>
    <div className="repayment-table-head" aria-hidden="true"><span>日期</span><span>付款人</span><span>收款人</span><span>金額 ({group.currency||'TWD'})</span><span>回報資訊</span><span>狀態與操作</span></div>
    <div className="repayment-log">{pagedRows.map(item=>{const reportedBy=item.reportedBy||item.confirmedBy||{displayName:'成員'},isVoided=item.reportStatus==='voided'||Boolean(item.voidedAt),voidedBy=item.voidedBy?.displayName||'管理者',reportedCurrency=item.reportedCurrency||group.currency||'TWD',reportedAmountCents=Number(item.reportedAmountCents??item.amountCents),showOriginal=reportedCurrency!==(group.currency||'TWD')||reportedAmountCents!==Number(item.amountCents);return <article className={isVoided?'is-voided':''} key={item.id}>
     <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
     <span className="repayment-payer">{item.from.displayName}</span>
     <span className="repayment-receiver">{item.to.displayName}</span>
     <strong className="repayment-amount"><span>{money(item.amountCents,group.currency)}</span>{showOriginal&&<small>原回報 {money(reportedAmountCents,reportedCurrency)}</small>}</strong>
     <small className="repayment-meta">{isVoided?`由 ${voidedBy} 撤銷 · 原由 ${reportedBy.displayName} 回報`:`由 ${reportedBy.displayName} 回報`}</small>
     <div className="repayment-status-actions"><span className={`record-status ${isVoided?'is-voided':''}`}>{isVoided?<History/>:<Check/>}{isVoided?'已撤銷':'已回報'}</span>{item.canVoid&&<button type="button" className="repayment-void-button" disabled={Boolean(voiding)} onClick={()=>requestVoid(item)} aria-label={`撤銷 ${item.from.displayName} 轉給 ${item.to.displayName} ${money(item.amountCents,group.currency)} 的回報`}>{voiding===item.id?<LoaderCircle/>:<X/>}<span>{voiding===item.id?'處理中…':'撤銷回報'}</span></button>}</div>
    </article>})}</div>
    <RecordPagination page={currentPage} totalItems={rows.length} pageSize={TABLE_PAGE_SIZE} onPageChange={setPage} label="還款紀錄"/>
   </>}
  </section>
  {confirmation&&<ConfirmModal {...confirmation} busy={voiding===pendingVoid.id} error={voidError} onCancel={closeVoid} onConfirm={confirmVoid}/>}
 </>;
}
function BalanceChart({group,close}){
 const rows=[...group.balances].sort((a,b)=>a.balanceCents-b.balanceCents);
 const maximum=Math.max(1,...rows.map(x=>Math.abs(x.balanceCents)));
 const currency=group.currency||'TWD';
 return <Modal close={close} label="群組結餘"><span className="eyebrow"><WalletCards/> Balance</span><h2>群組結餘</h2><p className="modal-copy">每個人的最終淨額：紅色代表需要付出，綠色代表可以收回，長度越長，金額越大</p><div className="diverging-legend"><span>← 應付</span><i></i><span>應收 →</span></div><div className="diverging-chart">{rows.map(person=>{const value=person.balanceCents,width=value===0?0:Math.max(10,Math.round(Math.abs(value)/maximum*100)),member=<div className="diverging-member"><b>{person.displayName}</b><Person person={person} size={38}/></div>;return <div className={`diverging-row ${value<0?'is-debt':value>0?'is-credit':'is-zero'}`} key={person.id}><div className="diverging-left">{value<0?<span className="diverging-bar debt" style={{width:`${width}%`}}><strong>-{money(Math.abs(value),currency)}</strong></span>:member}</div><div className="diverging-right">{value>0?<span className="diverging-bar credit" style={{width:`${width}%`}}><strong>+{money(value,currency)}</strong></span>:value<0?member:<strong className="zero-amount">{money(0,currency)}</strong>}</div></div>})}</div><div className="balance-check"><Check/> 所有人的結餘加總為 {money(0,currency)}</div><button className="primary wide" onClick={close}>了解</button></Modal>
}
function SettlementHelp({group,close}){const currency=group.currency||'TWD';return <Modal close={close} label="結算說明"><span className="eyebrow"><CircleHelp/> 結算說明</span><h2>我們如何簡化轉帳？</h2><p className="modal-copy">系統會先把所有支出換算成每個人的最終淨額，再重新安排付款對象，原始帳目不會被修改，每個人最後付出或收到的總額也完全相同</p><div className="settlement-example"><div className="example-title"><b>舉個例子</b><small>A、B、C 三人結算</small></div><div className="example-columns"><section><b>原始 · 3 筆</b><p>A → C　{money(10000,currency)}</p><p>B → C　{money(30000,currency)}</p><p>A → B　{money(5000,currency)}</p></section><ArrowRight/><section className="simplified"><b>簡化後 · 2 筆</b><p>A → C　{money(15000,currency)}</p><p>B → C　{money(25000,currency)}</p></section></div><div className="example-net"><span>A 應付 {money(15000,currency)}</span><span>B 應付 {money(25000,currency)}</span><span>C 應收 {money(40000,currency)}</span></div></div><div className="algorithm-note"><b>目前採用的方式</b><p>先配對金額完全相同的人，再讓小額欠款者優先一次付清，目標是讓更多付款人只轉一次；較大的欠款者必要時可能拆成多筆，因此不保證全群總筆數是數學上的絕對最少</p></div><button className="primary wide" onClick={close}>了解</button></Modal>}
function Modal({children,close,label='對話視窗',className='',closeDisabled=false}){
 const overlayRef=useRef(null),dialogRef=useRef(null),closeRef=useRef(close),closeDisabledRef=useRef(closeDisabled),returnFocus=useRef(document.activeElement);
 closeRef.current=close;
 closeDisabledRef.current=closeDisabled;
 useEffect(()=>{
  const overlay=overlayRef.current,dialog=dialogRef.current;
  const focusable='button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const releaseEnvironment=acquireModalEnvironment(overlay);
  const initialTimer=setTimeout(()=>{if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector(focusable)?.focus()},0);
  const onKeyDown=event=>{
   const topModal=[...document.querySelectorAll('[aria-modal="true"]')].at(-1);
   if(topModal!==dialog)return;
   if(event.key==='Escape'){event.preventDefault();if(!closeDisabledRef.current)closeRef.current();return}
   if(event.key!=='Tab'||!dialog)return;
   const items=[...dialog.querySelectorAll(focusable)].filter(item=>item.getClientRects().length);
   if(!items.length)return;
   const first=items[0],last=items.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  document.addEventListener('keydown',onKeyDown);
  return ()=>{
   clearTimeout(initialTimer);
   document.removeEventListener('keydown',onKeyDown);
   releaseEnvironment();
   returnFocus.current?.focus?.();
  };
 },[]);
 return createPortal(<div ref={overlayRef} className="overlay" onMouseDown={event=>event.target===event.currentTarget&&!closeDisabled&&close()}><div ref={dialogRef} className={`modal real-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label}><button type="button" className="modal-x" onClick={close} disabled={closeDisabled} aria-label="關閉對話視窗"><X/></button>{children}</div></div>,document.body);
}
function ProfileModal({me,close,saved}){
 const [form,setForm]=useState(EMPTY_BANK_ACCOUNT),[configured,setConfigured]=useState(Boolean(me.bankAccount?.configured)),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [confirmingRemove,setConfirmingRemove]=useState(false),[removeError,setRemoveError]=useState('');
 useEffect(()=>{let active=true;api('/api/me/bank-account').then(({bankAccount})=>{if(!active)return;if(bankAccount){setForm({...EMPTY_BANK_ACCOUNT,...bankAccount,branchCode:bankAccount.branchCode||''});setConfigured(true)}}).catch(loadError=>active&&setError(loadError.message)).finally(()=>active&&setLoading(false));return()=>{active=false}},[]);
 const update=(field,value)=>setForm(current=>({...current,[field]:value}));
 const submit=async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{const result=await api('/api/me/bank-account',{method:'PUT',body:JSON.stringify(form)});saved(result.bankAccount)}catch(saveError){setError(saveError.message);setBusy(false)}};
 const requestRemove=()=>{setError('');setRemoveError('');setConfirmingRemove(true)};
 const remove=async()=>{if(busy)return;setBusy(true);setRemoveError('');try{const result=await api('/api/me/bank-account',{method:'DELETE'});saved(result.bankAccount)}catch(removeAccountError){setRemoveError(removeAccountError.message);setBusy(false)}};
 const removeConfirmation=bankAccountRemovalConfirmation();
 return <>
 <Modal close={close} label="個人資料與收款帳戶">
  <div className="profile-heading"><Person person={me} size={52}/><div><span className="eyebrow">個人資料</span><h2>{me.displayName}</h2><p>LINE 帳號已連結</p></div></div>
  <div className="profile-privacy" id="bank-account-privacy"><ShieldCheck/><div><b>帳戶由你主動提供給付款人</b><p>資料只供檢視與複製，系統不會代為轉帳；結清後付款人會立即失去查看權限，更新帳戶也會撤銷舊授權</p></div></div>
  {loading?<div className="profile-loading" role="status"><LoaderCircle/><span>正在讀取帳戶資料…</span></div>:<form className="profile-form" onSubmit={submit}>
    <div className="profile-form-title"><div><b>常用收款帳戶</b><small>{configured?`目前帳號末四碼 ${me.bankAccount?.last4||form.accountNumber.slice(-4)}`:'尚未設定'}</small></div><WalletCards/></div>
    <div className="form-two">
      <label>銀行代碼 <span className="required-mark" aria-hidden="true">*</span><input autoFocus inputMode="numeric" maxLength="3" pattern="[0-9]{3}" value={form.bankCode} onChange={event=>update('bankCode',event.target.value)} placeholder="例如：822" required aria-describedby="bank-account-privacy"/></label>
      <label>銀行名稱 <span className="required-mark" aria-hidden="true">*</span><input maxLength="60" value={form.bankName} onChange={event=>update('bankName',event.target.value)} placeholder="例如：中國信託" required/></label>
    </div>
    <label>分行代碼<input inputMode="numeric" maxLength="7" pattern="[0-9]{3,7}" value={form.branchCode} onChange={event=>update('branchCode',event.target.value)} placeholder="選填，3–7 位數"/><small className="field-help">若不確定可先留白</small></label>
    <label>戶名 <span className="required-mark" aria-hidden="true">*</span><input maxLength="80" autoComplete="name" value={form.accountHolderName} onChange={event=>update('accountHolderName',event.target.value)} placeholder="銀行帳戶戶名" required/></label>
    <label>帳號 <span className="required-mark" aria-hidden="true">*</span><input inputMode="numeric" autoComplete="off" maxLength="24" pattern="[0-9 -]{6,24}" value={form.accountNumber} onChange={event=>update('accountNumber',event.target.value)} placeholder="請輸入 6–20 位數帳號" required aria-describedby="bank-account-number-help"/><small className="field-help" id="bank-account-number-help">帳號會加密保存，可輸入空格或連字號，儲存時會自動整理</small></label>
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions profile-actions">{configured&&<button type="button" className="profile-remove" onClick={requestRemove} disabled={busy}><Trash2/>移除帳戶</button>}<button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy}>{busy?<LoaderCircle/>:<Check/>}{busy?'儲存中…':'儲存帳戶'}</button></div>
  </form>}
 </Modal>
 {confirmingRemove&&<ConfirmModal {...removeConfirmation} busy={busy} error={removeError} onCancel={()=>!busy&&setConfirmingRemove(false)} onConfirm={remove}/>}
 </>;
}
function CreateGroup({currencies=DEFAULT_CURRENCIES,close,done}){
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[currency,setCurrency]=useState('TWD'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const selectedCurrency=getCurrency(currency);
 const submit=async event=>{
  event.preventDefault();
  if(busy)return;
  setBusy(true);setError('');
  try{done(await api('/api/groups',{method:'POST',body:JSON.stringify({name,description,currency})}))}
  catch(submitError){setError(submitError.message);setBusy(false)}
 };
 return <Modal close={close} closeDisabled={busy} label="建立分帳群組">
  <span className="eyebrow">新的共同帳本</span>
  <h2>建立分帳群組</h2>
  <p className="modal-copy">先為這次旅行取一個容易辨識的名稱，建立後即可邀請旅伴</p>
  <form onSubmit={submit}>
   <label>群組名稱 <span className="required-mark" aria-hidden="true">*</span><input autoFocus maxLength="60" value={name} onChange={event=>setName(event.target.value)} placeholder="例如：花蓮三天兩夜" required aria-invalid={Boolean(error&&!name.trim())}/><small className="field-help">最多 60 個字，建議包含地點或日期</small></label>
   <label>簡短說明<input maxLength="200" value={description} onChange={event=>setDescription(event.target.value)} placeholder="例如：14 人畢旅共同花費"/><small className="field-help">選填，讓旅伴快速確認群組用途</small></label>
   <label>帳本幣別 <span className="required-mark" aria-hidden="true">*</span><select value={currency} onChange={event=>setCurrency(event.target.value)} required>{currencies.map(item=><option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select><small className="field-help">{selectedCurrency.code} 金額保留小數點後 {selectedCurrency.decimals} 位；建立後仍可在群組管理中換算</small></label>
   {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
   <div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy||!name.trim()}>{busy?<LoaderCircle/>:<Plus/>}{busy?'建立中…':'建立群組'}</button></div>
  </form>
 </Modal>;
}
function InviteModal({group,close}){const link=`${location.origin}/invite/${group.inviteToken}`;const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');const copy=async()=>{setCopyError('');try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setCopyError('無法自動複製，請手動選取上方連結')}};return <Modal close={close} label="邀請成員"><span className="eyebrow">邀請成員</span><h2>把連結傳到 LINE 群組</h2><p className="modal-copy">朋友點開後使用 LINE 登入，就會自動加入「{group.name}」</p><div className="invite-link"><Link2/><span>{link}</span></div>{copyError&&<p className="form-error" role="alert"><AlertCircle/>{copyError}</p>}<button className="line-share" onClick={()=>location.href=`https://line.me/R/share?text=${encodeURIComponent(`加入「${group.name}」一起分帳：${link}`)}`}><DoorOpen/> 用 LINE 分享</button><button className="copy-link" onClick={copy} aria-live="polite">{copied?<Check/>:<Clipboard/>}{copied?'已複製邀請連結':'複製邀請連結'}</button></Modal>}
