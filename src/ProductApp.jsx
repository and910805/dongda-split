import React,{useCallback,useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,ArrowDown,ArrowRight,ArrowUp,ArrowUpDown,Check,ChevronDown,ChevronLeft,ChevronRight,CircleHelp,Clipboard,Clock3,DoorOpen,FlaskConical,History,Link2,LoaderCircle,LogOut,MessageCircle,Pencil,Plus,ReceiptText,RefreshCcw,Search,ShieldCheck,Trash2,Users,WalletCards,X} from './ui-icons.jsx';
import {AdvancedExpenseModal} from './AdvancedExpenseModal.jsx';
import {AdminConsole} from './AdminConsole.jsx';
import {BrandLogo,BrandMark} from './BrandLogo.jsx';
import {ConfirmModal} from './ConfirmModal.jsx';
import {bankAccountRemovalConfirmation,expenseDeletionConfirmation,groupDeletionConfirmation,settlementVoidConfirmation} from './confirmation-actions.mjs';
import {DEFAULT_EXPENSE_SORT,filterExpenses,nextExpenseSort,sortExpenses} from './expense-sort.mjs';
import {acquireModalEnvironment} from './modal-environment.mjs';
import {buildSettlementNotice,settlementLineShareUrl} from './settlement-notice.mjs';
import {prioritizeSettlementsForMember} from './settlement-order.mjs';
import {getLanguageHeaders,LanguageSwitcher,translateApiMessage,useI18n} from './i18n.jsx';
import {SUPPORTED_CURRENCIES,amountCentsToInputValue,formatCurrencyAmount,getCurrency} from '../currency.mjs';

const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:getLanguageHeaders({'content-type':'application/json',...(options.headers||{})})});if(response.status===401)throw Object.assign(new Error('unauthorized'),{status:401});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(translateApiMessage(data.error||'操作失敗')),{status:response.status,data});return data};
const money=(cents,currency='TWD',options)=>formatCurrencyAmount(Number(cents||0),currency,options);
const conversionDeltaLabel=(cents,currency='TWD',locale='zh-TW')=>{
  const definition=getCurrency(currency),numeric=Number(cents||0),absolute=BigInt(Math.abs(numeric));
  if(!Number.isSafeInteger(numeric))return '—';
  if(numeric%definition.quantum===0)return money(Math.abs(numeric),currency);
  const whole=absolute/100n,fraction=(absolute%100n).toString().padStart(2,'0').replace(/0+$/,'');
  return `${definition.symbol} ${whole.toLocaleString(locale)}${fraction?`.${fraction}`:''}`;
};
const DEFAULT_CURRENCIES=SUPPORTED_CURRENCIES.map(code=>getCurrency(code));
const currencyName=(t,currency)=>t(`product.currency.name.${String(currency?.code||currency||'TWD').toUpperCase()}`);
const categoryName=(t,category)=>t(`product.category.${['餐飲','住宿','交通','購物','其他'].includes(category)?category:'其他'}`);
const TABLE_PAGE_SIZE=8;
const SETTLEMENT_PAGE_SIZE=4;
const EMPTY_BANK_ACCOUNT={bankCode:'',bankName:'',branchCode:'',accountHolderName:'',accountNumber:''};
function Person({person,size=36}){
  const {t}=useI18n();
  const [imageFailed,setImageFailed]=useState(false);
  useEffect(()=>setImageFailed(false),[person?.pictureUrl]);
  if(person?.isFund)return <span className="avatar fund-avatar" style={{width:size,height:size}} aria-label={person.displayName||t('product.person.fund')}><WalletCards/></span>;
  if(person?.pictureUrl&&!imageFailed)return <img className="avatar" src={person.pictureUrl} alt={person.displayName||t('product.person.avatar')} style={{width:size,height:size}} referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>;
  const displayName=String(person?.displayName||'').trim();
  return <span className="avatar initial" style={{width:size,height:size,background:'#1f9d69'}} aria-label={displayName||t('product.person.member')}>{Array.from(displayName)[0]||'T'}</span>;
}
function expenseShareRows(expense,members,formerMember='Former member'){
  const memberById=new Map((members||[]).map(member=>[String(member.id),member]));
  const memberOrder=new Map((members||[]).map((member,index)=>[String(member.id),index]));
  return (expense?.shares||[]).map(share=>{
    const userId=String(share.userId);
    return {userId,amountCents:Number(share.amountCents||0),person:memberById.get(userId)||{id:userId,displayName:formerMember}};
  }).sort((left,right)=>(memberOrder.get(left.userId)??Number.MAX_SAFE_INTEGER)-(memberOrder.get(right.userId)??Number.MAX_SAFE_INTEGER)||left.userId.localeCompare(right.userId));
}
function ExpenseShareAvatars({expense,members,onOpen}){
  const {t}=useI18n();
  const rows=expenseShareRows(expense,members,t('product.members.former')),visibleRows=rows.slice(0,4),remaining=rows.length-visibleRows.length,isRefund=Number(expense.amountCents)<0,kindLabel=t(isRefund?'product.expense.refund':'product.expense.split');
  if(!rows.length)return <span className="expense-share-empty">{t('product.expense.noShareMembers',{kind:kindLabel})}</span>;
  const label=t(rows.length===1?'product.expense.viewShareMember':'product.expense.viewShareMembers',{title:expense.title,kind:kindLabel,count:rows.length});
  return <button type="button" className="expense-share-trigger" onClick={()=>onOpen(expense)} aria-label={label} aria-haspopup="dialog" title={label}>
    <span className="expense-share-avatars" aria-hidden="true">
      {visibleRows.map(row=><span className="expense-share-avatar" key={row.userId}><Person person={row.person} size={24}/></span>)}
      {remaining>0&&<span className="expense-share-more">+{remaining}</span>}
    </span>
  </button>;
}
function RecordPagination({page,totalItems,pageSize,onPageChange,label,compact=false}){
  const {t}=useI18n();
  const totalPages=Math.ceil(totalItems/pageSize);
  if(totalPages<=1)return null;
  const safePage=Math.min(Math.max(page,1),totalPages),start=(safePage-1)*pageSize+1,end=Math.min(safePage*pageSize,totalItems);
  return <nav className={`record-pagination ${compact?'compact':''}`} aria-label={t('product.pagination.label',{label})}>
    <span className="record-pagination-summary">{t('product.pagination.summary',{start,end,total:totalItems})}</span>
    <div className="record-pagination-controls"><button type="button" disabled={safePage===1} onClick={()=>onPageChange(safePage-1)} aria-label={t('product.pagination.previous',{label})}><ChevronLeft/></button><span aria-live="polite" aria-atomic="true"><b>{safePage}</b> / {totalPages}</span><button type="button" disabled={safePage===totalPages} onClick={()=>onPageChange(safePage+1)} aria-label={t('product.pagination.next',{label})}><ChevronRight/></button></div>
  </nav>;
}
const expenseSortLabel=(t,key)=>t(`product.expense.sort.${key}`);
const expenseSortDirectionLabel=(t,key,direction)=>{
  if(key==='date')return t(direction==='asc'?'product.expense.sort.oldest':'product.expense.sort.newest');
  return t(direction==='asc'?'product.expense.sort.lowest':'product.expense.sort.highest');
};
function ExpenseSortButton({field,sort,onSort,className=''}) {
  const {t}=useI18n();
  const active=sort.key===field,direction=active?sort.direction:'desc';
  const Icon=active?(direction==='asc'?ArrowUp:ArrowDown):ArrowUpDown;
  const label=expenseSortLabel(t,field);
  const currentLabel=active?t('product.expense.sort.current',{direction:expenseSortDirectionLabel(t,field,direction)}):t('product.expense.sort.notSelected');
  const nextDirection=active&&direction==='desc'?'asc':'desc';
  return <button type="button" className={`expense-sort-button ${active?'is-active':''} ${className}`.trim()} aria-pressed={active} aria-label={t('product.expense.sort.aria',{label,current:currentLabel,next:expenseSortDirectionLabel(t,field,nextDirection)})} title={t('product.expense.sort.title',{label,current:currentLabel})} onClick={()=>onSort(field)}><span>{label}</span><Icon aria-hidden="true"/></button>;
}
function DevAccessBar({login,loading,error}){const {t}=useI18n();return <aside className="dev-access-bar" aria-label={t('product.dev.aria')}><div><small>LOCAL DEVELOPMENT</small><b>{t('product.dev.title')}</b></div><button type="button" onClick={login} disabled={loading}>{loading?<LoaderCircle/>:<ArrowRight/>}{t(loading?'product.dev.loggingIn':'product.dev.enter')}</button>{error&&<p role="alert">{error}</p>}</aside>}

export default function ProductApp({Home}){
  const {t}=useI18n();
  const [me,setMe]=useState(null),[groups,setGroups]=useState([]),[activeId,setActiveId]=useState(null),[group,setGroup]=useState(null),[loading,setLoading]=useState(true),[groupLoading,setGroupLoading]=useState(false),[groupError,setGroupError]=useState(''),[notice,setNotice]=useState(''),[showCreate,setShowCreate]=useState(false),[showExpense,setShowExpense]=useState(false),[editingExpense,setEditingExpense]=useState(null),[showInvite,setShowInvite]=useState(false),[showProfile,setShowProfile]=useState(false),[transferReport,setTransferReport]=useState(null);
  const [currencyData,setCurrencyData]=useState({currencies:DEFAULT_CURRENCIES,exchangeRates:null});
  const [devLoginLoading,setDevLoginLoading]=useState(false),[devLoginError,setDevLoginError]=useState(''),[adminMode,setAdminMode]=useState(false),[adminViewingId,setAdminViewingId]=useState(null),[endingSimulation,setEndingSimulation]=useState(false);
  const groupRequestRef=useRef(0),loadedGroupIdRef=useRef(null);
  const inviteToken=location.pathname.startsWith('/invite/')?location.pathname.split('/')[2]:null;
  const isLocalDevelopment=['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
  useEffect(()=>{if(me&&!adminMode)document.title=t('product.documentTitle')},[adminMode,me,t]);
  useEffect(()=>{let active=true;api('/api/currencies').then(data=>{if(active&&Array.isArray(data.currencies)&&data.currencies.length)setCurrencyData(data)}).catch(()=>{});return()=>{active=false}},[]);
  const refreshGroups=useCallback(async()=>{const list=await api('/api/groups');setGroups(list);setActiveId(current=>current||list[0]?.id||null);return list},[]);
  useEffect(()=>{api('/api/me').then(async user=>{setMe(user);const list=await refreshGroups();if(inviteToken){const joined=await api(`/api/invites/${encodeURIComponent(inviteToken)}/join`,{method:'POST'});setActiveId(joined.groupId);await refreshGroups();history.replaceState({},'', '/app');setNotice(t('product.notice.joined'))}}).catch(error=>{if(error.status===401&&inviteToken){const returnTo=location.pathname;location.replace(`/api/auth/line?returnTo=${encodeURIComponent(returnTo)}&lang=${encodeURIComponent(language)}`);return}if(error.status!==401)setNotice(error.message)}).finally(()=>setLoading(false))},[]);
  const refreshGroup=useCallback(async()=>{const requestedId=activeId,requestId=++groupRequestRef.current;if(!requestedId){loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(false);return}if(loadedGroupIdRef.current!==requestedId)setGroup(null);setGroupLoading(true);setGroupError('');try{const nextGroup=await api(`/api/groups/${requestedId}`);if(requestId!==groupRequestRef.current)return;loadedGroupIdRef.current=requestedId;setGroup(nextGroup);return nextGroup}catch(error){if(requestId!==groupRequestRef.current)return;loadedGroupIdRef.current=null;setGroup(null);setGroupError(error.message);throw error}finally{if(requestId===groupRequestRef.current)setGroupLoading(false)}},[activeId]);
  const selectGroup=useCallback(id=>{if(!id||id===activeId)return;setAdminViewingId(current=>current===id?current:null);groupRequestRef.current+=1;loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(true);setActiveId(id)},[activeId]);
  useEffect(()=>{if(me&&activeId)refreshGroup().catch(()=>{})},[me,activeId,refreshGroup]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer)},[notice]);
  const login=()=>{const returnTo=inviteToken?location.pathname:'/app';location.href=`/api/auth/line?returnTo=${encodeURIComponent(returnTo)}&lang=${encodeURIComponent(language)}`};
  const devLogin=async()=>{setDevLoginLoading(true);setDevLoginError('');try{await api('/api/dev-login',{method:'POST'});const [user,list]=await Promise.all([api('/api/me'),api('/api/groups')]);setGroups(list);setActiveId(list[0]?.id||null);setMe(user);history.replaceState({},'','/app')}catch(error){setDevLoginError(t('product.dev.loginFailed',{message:error.message}))}finally{setDevLoginLoading(false)}};
  const logout=async()=>{await api('/api/auth/logout',{method:'POST'});setAdminMode(false);setAdminViewingId(null);setMe(null);setGroups([]);setGroup(null);history.replaceState({},'','/')};
  const endSimulation=async()=>{if(endingSimulation)return;setEndingSimulation(true);try{await api('/api/admin/simulation/exit',{method:'POST'});location.assign('/app')}catch(error){setNotice(error.message);setEndingSimulation(false)}};
  const created=async data=>{setShowCreate(false);await refreshGroups();selectGroup(data.id);history.replaceState({},'','/app')};
  const expenseAdded=async()=>{setShowExpense(false);setEditingExpense(null);await refreshGroup()};
  const groupDeleted=async target=>{await api(`/api/groups/${target.id}`,{method:'DELETE'});const list=await api('/api/groups');setGroups(list);setGroup(null);setActiveId(list[0]?.id||null);setNotice(t('product.notice.groupDeleted',{name:target.name}))};
  const openNewExpense=()=>{setEditingExpense(null);setShowExpense(true)};
  const closeTransferReport=()=>{setTransferReport(null);requestAnimationFrame(()=>{const target=document.getElementById('settlement-title')||document.querySelector('.workspace-error button, .header-user-avatar');target?.focus()})};
  const openAdminGroup=item=>{setGroups(current=>current.some(groupItem=>groupItem.id===item.id)?current:[{id:item.id,name:item.name,description:item.description,currency:item.currency||'TWD',memberCount:item.memberCount},...current]);setAdminViewingId(item.id);groupRequestRef.current+=1;loadedGroupIdRef.current=null;setGroup(null);setGroupError('');setGroupLoading(true);setActiveId(item.id);setAdminMode(false);history.replaceState({},'','/app')};
  if(loading)return <div className="page-loading"><LoaderCircle/><p>{t('product.loading.ledger')}</p></div>;
  if(!me&&inviteToken)return <div className="page-loading"><LoaderCircle/><p>{t('product.loading.invite')}</p></div>;
  if(!me)return <><Home enter={login}/>{isLocalDevelopment&&<DevAccessBar login={devLogin} loading={devLoginLoading} error={devLoginError}/>}</>;
  if(adminMode&&me.isSuperuser)return <AdminConsole me={me} onExit={()=>setAdminMode(false)} onLogout={logout} onOpenGroup={openAdminGroup}/>;
  const adminViewing=Boolean(me.isSuperuser&&group&&adminViewingId===group.id);
  const activeGroupOption=groups.find(item=>String(item.id)===String(activeId));
  return <div className={`real-app ${me.simulation?.active?'is-simulating':''}`}>
    {me.simulation?.active&&<aside className="simulation-banner" aria-label={t('product.simulation.aria')}><div><FlaskConical/><span><b>{t('product.simulation.active',{name:me.displayName})}</b><small>{t('product.simulation.help')}</small></span></div><button type="button" onClick={endSimulation} disabled={endingSimulation} aria-label={t('product.simulation.exitAria',{name:me.simulation.actor.displayName})} title={t('product.simulation.return',{name:me.simulation.actor.displayName})}>{endingSimulation?<LoaderCircle/>:<ArrowRight/>}<span className="simulation-exit-full">{endingSimulation?t('product.simulation.returning'):t('product.simulation.exitFull',{name:me.simulation.actor.displayName})}</span><span className="simulation-exit-short">{endingSimulation?t('product.simulation.returningShort'):t('product.simulation.exitShort')}</span></button></aside>}
    <aside className="real-side" aria-label={t('product.navigation.primary')}>
      <BrandLogo/>
      <button type="button" className="login-user" onClick={()=>setShowProfile(true)} aria-label={t('product.profile.openSettings')}><Person person={me} size={46}/><div><b>{me.displayName}</b><small>{me.isSimulated?t('product.profile.simulated'):me.bankAccount?.configured?t('product.profile.accountEnding',{last4:me.bankAccount.last4}):t('product.profile.setupAccount')}</small></div><ChevronRight className="login-user-chevron"/></button>
      <div className="side-label">{t('product.groups.mine')}</div>
      <div className="group-switcher">{groups.map(item=><button className={activeId===item.id?'active':''} aria-current={activeId===item.id?'page':undefined} key={item.id} onClick={()=>selectGroup(item.id)}><div><b>{item.name}</b><small>{t('product.members.count',{count:item.memberCount})} · {item.currency||'TWD'}</small></div></button>)}</div>
      <button className="new-group" onClick={()=>setShowCreate(true)}><Plus/> {t('product.groups.createNew')}</button>
      <div className="side-footer">
        {me.isSuperuser&&<button className="superuser-entry" onClick={()=>setAdminMode(true)}><ShieldCheck/> {t('product.admin.mode')}</button>}
        <button className="logout" onClick={logout}><LogOut/> {t('product.auth.logout')}</button>
      </div>
    </aside>
    <section className="real-workspace">
      <header>
        <BrandMark className="mobile-header-mark"/>
        <div className="desktop-group-title"><small>{t(adminViewing?'product.header.adminLedger':'product.header.sharedLedger')}</small><h2>{group?.name||'TripTab'}</h2></div>
        <label className={`mobile-group-picker ${groupLoading?'is-loading':''}`} aria-busy={groupLoading||undefined}>
          <span className="mobile-group-picker-copy"><small>{t('product.groups.current')}</small><b>{activeGroupOption?.name||t('product.groups.select')}</b></span>
          <span className="mobile-group-picker-caret" aria-hidden="true">{groupLoading?<LoaderCircle/>:<ChevronDown/>}</span>
          <select aria-label={t('product.groups.switch')} value={activeId||''} onChange={e=>selectGroup(e.target.value)} disabled={groupLoading}>{groups.map(item=><option key={item.id} value={item.id}>{item.name} ({item.currency||'TWD'})</option>)}</select>
        </label>
        <button type="button" className="mobile-new-group" onClick={()=>setShowCreate(true)} aria-label={t('product.groups.createNew')} title={t('product.groups.createNew')}><Plus/></button>
        <div className="real-header-actions">
          <LanguageSwitcher className="product-header-language"/>
          <button type="button" className="header-user-avatar" onClick={()=>setShowProfile(true)} aria-label={t('product.profile.open')}><Person person={me} size={36}/></button>
          <button className="header-secondary" disabled={!group||adminViewing} onClick={()=>setShowInvite(true)}><Users/> {t('product.invite.members')}</button>
          {adminViewing?<span className="admin-view-badge"><ShieldCheck/>{t('product.admin.view')}</span>:<button className="primary header-primary" disabled={!group||groupLoading} onClick={openNewExpense}><Plus/> {t('product.expense.add')}</button>}
          <button type="button" className="mobile-header-avatar" aria-label={t('product.profile.openSettings')} onClick={()=>setShowProfile(true)}><Person person={me} size={38}/></button>
          <button className="mobile-logout" aria-label={t('product.auth.logout')} onClick={logout}><LogOut/></button>
        </div>
      </header>
      {!groups.length?<EmptyGroups create={()=>setShowCreate(true)}/>:groupError&&!group?<WorkspaceError message={groupError} retry={refreshGroup}/>:!group?<DashboardSkeleton/>:<GroupDashboard key={group.id} group={group} me={me} currencies={currencyData} addExpense={adminViewing?null:openNewExpense} editExpense={expense=>{setEditingExpense(expense);setShowExpense(true)}} invite={()=>setShowInvite(true)} removeGroup={()=>groupDeleted(group)} refresh={refreshGroup} currencyChanged={async result=>{await Promise.all([refreshGroups(),refreshGroup()]);setNotice(result.alreadyApplied?t('product.currency.alreadyConverted'):t('product.currency.converted',{currency:result.currency}))}} refreshing={groupLoading} openAdmin={me.isSuperuser?()=>setAdminMode(true):null} openProfile={()=>setShowProfile(true)} onTransferReported={setTransferReport} adminViewing={adminViewing}/>}
    </section>
    {group&&!adminViewing&&<button className="mobile-expense-fab" onClick={openNewExpense} aria-label={t('product.expense.add')}><Plus/><span>{t('product.common.add')}</span></button>}
    {notice&&<button type="button" className="toast" onClick={()=>setNotice('')} aria-live="polite" aria-label={t('product.notice.dismiss',{notice})}><Check/>{notice}</button>}
    {showCreate&&<CreateGroup currencies={currencyData.currencies} close={()=>setShowCreate(false)} done={created}/>} {showExpense&&group&&<AdvancedExpenseModal group={group} currencies={currencyData.currencies} expense={editingExpense} currentUserId={me.id} close={()=>{setShowExpense(false);setEditingExpense(null)}} done={expenseAdded}/>} {showInvite&&group&&<InviteModal group={group} close={()=>setShowInvite(false)}/>} {showProfile&&<ProfileModal me={me} close={()=>setShowProfile(false)} saved={bankAccount=>{setMe(current=>({...current,bankAccount}));setShowProfile(false);setNotice(bankAccount.configured?t('product.notice.accountUpdated'):t('product.notice.accountRemoved'))}}/>} {transferReport&&<TransferNoticeModal report={transferReport} close={closeTransferReport}/>}
  </div>
}

function EmptyGroups({create}){const {t}=useI18n();return <main className="empty-groups"><img src="/xiaoluo-avatar.png" alt={t('product.empty.avatar')}/><span className="eyebrow">{t('product.empty.welcome')}</span><h1>{t('product.empty.title')}</h1><p>{t('product.empty.description')}</p><button className="primary" onClick={create}><Plus/> {t('product.groups.create')}</button></main>}
function DashboardSkeleton(){const {t}=useI18n();return <main className="dashboard-skeleton" aria-label={t('product.loading.group')} aria-busy="true"><div className="skeleton skeleton-hero"></div><div className="skeleton-stats">{[0,1,2].map(item=><div className="skeleton" key={item}></div>)}</div><div className="skeleton-grid"><div className="skeleton"></div><div className="skeleton"></div></div><span className="sr-only">{t('product.loading.group')}</span></main>}
function WorkspaceError({message,retry}){const {t}=useI18n();const [retrying,setRetrying]=useState(false);const handleRetry=async()=>{setRetrying(true);try{await retry()}catch{}finally{setRetrying(false)}};return <main className="workspace-error" role="alert"><span><AlertCircle/></span><h1>{t('product.error.groupLoadTitle')}</h1><p>{message||t('product.error.networkRetry')}</p><button className="primary" disabled={retrying} onClick={handleRetry}>{retrying?<LoaderCircle/>:<RefreshCcw/>}{t(retrying?'product.error.reloading':'product.error.reload')}</button></main>}
function SettlementBankDetails({groupId,settlement}){
  const {t}=useI18n();
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
    catch{setError(t('product.bank.copyError'))}
  };
  return <div className="settlement-bank">
    <button type="button" className="settlement-bank-toggle" onClick={toggle} disabled={loading} aria-expanded={expanded} aria-controls={panelId}>
      {loading?<LoaderCircle/>:<WalletCards/>}{t(loading?'product.bank.loading':expanded?'product.bank.collapse':'product.bank.view')}<ChevronDown/>
    </button>
    {error&&<p className="settlement-bank-error" role="alert"><AlertCircle/>{error}</p>}
    {expanded&&details&&<div className={`settlement-bank-panel ${details.bankAccount?'':'is-empty'}`} id={panelId}>
      {!details.bankAccount?<><AlertCircle/><div><b>{t('product.bank.recipientNotConfigured',{name:details.recipient.displayName})}</b><p>{t('product.bank.otherMethod')}</p></div></>:<>
        <div className="settlement-bank-recipient"><Person person={details.recipient} size={34}/><span><small>{t('product.bank.transferTo')}</small><b>{details.recipient.displayName}</b></span><ShieldCheck aria-label={t('product.bank.payerOnly')}/></div>
        <dl>
          <div><dt>{t('product.bank.bank')}</dt><dd>{details.bankAccount.bankName} ({details.bankAccount.bankCode})</dd></div>
          {details.bankAccount.branchCode&&<div><dt>{t('product.bank.branchCode')}</dt><dd>{details.bankAccount.branchCode}</dd></div>}
          <div><dt>{t('product.bank.holder')}</dt><dd>{details.bankAccount.accountHolderName}</dd></div>
          <div className="bank-account-number"><dt>{t('product.bank.accountNumber')}</dt><dd>{details.bankAccount.accountNumber}</dd></div>
        </dl>
        <button type="button" className="settlement-bank-copy" onClick={copyAccount} aria-live="polite">{copied?<Check/>:<Clipboard/>}{t(copied?'product.bank.copied':'product.bank.copy')}</button>
        <small className="settlement-bank-manual">{t('product.bank.manualNotice')}</small>
      </>}
    </div>}
  </div>;
}
function SettlementBankUnavailable(){
  const {t}=useI18n();
  return <div className="settlement-bank-unavailable"><WalletCards/><div><b>{t('product.bank.unavailable')}</b><p>{t('product.bank.contactRecipient')}</p></div></div>;
}
function SettlementBankShare({groupId,settlement,shared,configured,refresh,openProfile}){
  const {t}=useI18n();
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
    <div><ShieldCheck/><span><b>{t(shared?'product.bank.shared':'product.bank.shareSafely')}</b><p>{t(shared?'product.bank.sharedHelp':'product.bank.shareHelp')}</p></span></div>
    <button type="button" onClick={updateAccess} disabled={busy}>{busy?<LoaderCircle/>:configured?shared?<X/>:<WalletCards/>:<Plus/>}{t(busy?'product.common.processing':configured?shared?'product.bank.revoke':'product.bank.share':'product.profile.setupAccount')}</button>
    {error&&<p className="settlement-bank-error" role="alert"><AlertCircle/>{error}</p>}
  </div>;
}
function GroupDashboard({group,me,currencies,addExpense,editExpense,invite,removeGroup,refresh,currencyChanged,refreshing=false,openAdmin,openProfile,onTransferReported,adminViewing=false}){
  const {t,locale,language}=useI18n();
  const [paying,setPaying]=useState(''),[pendingSettlement,setPendingSettlement]=useState(null),[transferError,setTransferError]=useState(''),[deleting,setDeleting]=useState(''),[deletingGroup,setDeletingGroup]=useState(false),[showSettlementHelp,setShowSettlementHelp]=useState(false),[showBalances,setShowBalances]=useState(false),[selectedExpenseShares,setSelectedExpenseShares]=useState(null),[selectedMemberId,setSelectedMemberId]=useState(null),[actionError,setActionError]=useState('');
  const [showCurrencyChange,setShowCurrencyChange]=useState(false),[groupAdminOpen,setGroupAdminOpen]=useState(false);
  const [pendingAction,setPendingAction]=useState(null),[confirmationError,setConfirmationError]=useState('');
  const [activityTab,setActivityTab]=useState('expenses'),[expensePage,setExpensePage]=useState(1),[settlementPage,setSettlementPage]=useState(1),[expenseSort,setExpenseSort]=useState(DEFAULT_EXPENSE_SORT),[expenseQuery,setExpenseQuery]=useState('');
  const expenseMembers=useMemo(()=>group.members.filter(member=>!member.isFund),[group.members]);
  const selectedMember=expenseMembers.find(member=>String(member.id)===selectedMemberId);
  const [expenseMemberId,setExpenseMemberId]=useState(()=>expenseMembers.some(member=>String(member.id)===String(me.id))?String(me.id):'all');
  const selectedExpenseMember=expenseMembers.find(member=>String(member.id)===expenseMemberId);
  const currentUserIsMember=expenseMembers.some(member=>String(member.id)===String(me.id));
  const expenseParticipantId=selectedExpenseMember?.id||(currentUserIsMember?me.id:null);
  const expenseParticipantLabel=selectedExpenseMember?t('product.expense.memberAmount',{name:selectedExpenseMember.displayName}):currentUserIsMember?t('product.expense.myAmount'):t('product.expense.participantAmount');
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
  const expenseSortSummary=t('product.expense.sort.summary',{field:expenseSortLabel(t,expenseSort.key),direction:expenseSortDirectionLabel(t,expenseSort.key,expenseSort.direction)});
  const expenseSearchActive=Boolean(String(deferredExpenseQuery).normalize('NFKC').trim());
  const expenseFiltersActive=expenseMemberId!=='all'||expenseSearchActive;
  const currencyCode=group.currency||'TWD',currencyInfo=getCurrency(currencyCode);
  const groupMoney=(cents,options)=>money(cents,currencyCode,options);
  const total=group.expenses.reduce((sum,e)=>sum+e.amountCents,0);
  const mine=group.balances.find(x=>x.id===me.id)?.balanceCents||0;
  const memberCount=group.members.filter(x=>!x.isFund).length;
  const settlementHistory=group.settlementHistory||[];
  const activeRepayments=settlementHistory.filter(item=>item.reportStatus!=='voided'&&!item.voidedAt);
  const activeRepaymentTotal=activeRepayments.reduce((sum,item)=>sum+Number(item.amountCents||0),0);
  const latestActivity=[
    ...group.expenses.map(item=>item.createdAt),
    ...settlementHistory.flatMap(item=>[item.createdAt,item.voidedAt])
  ].map(value=>new Date(value).getTime()).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  const lastUpdated=latestActivity?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(latestActivity)):t('product.group.noRecords');
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
        setTransferError(uncertain?t('product.transfer.uncertain'):t('product.transfer.notRecorded',{message:requestError.message}));
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
        onTransferReported(current=>current===report?{...report,refreshWarning:t('product.transfer.refreshWarning')}:current);
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
    ?expenseDeletionConfirmation(pendingAction.expense.title,{language})
    :pendingAction?.type==='group'
      ?groupDeletionConfirmation(group.name,{language})
      :null;
  const confirmationBusy=pendingAction?.type==='expense'?deleting===pendingAction.expense.id:deletingGroup;
  const focusActivityTab=nextTab=>{setActivityTab(nextTab);requestAnimationFrame(()=>document.getElementById(`activity-tab-${nextTab}-${group.id}`)?.focus())};
  const openRepaymentHistory=()=>{setActivityTab('repayments');requestAnimationFrame(()=>{const panel=document.getElementById(`activity-panel-repayments-${group.id}`),reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;panel?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'});document.getElementById('repayment-title')?.focus()})};
  const handleActivityTabKeyDown=event=>{let nextTab;if(event.key==='ArrowLeft'||event.key==='Home')nextTab='expenses';if(event.key==='ArrowRight'||event.key==='End')nextTab='repayments';if(!nextTab)return;event.preventDefault();focusActivityTab(nextTab)};
  return <main className={`real-dashboard ${refreshing?'is-refreshing':''}`} aria-busy={refreshing}>
    {refreshing&&<div className="workspace-progress" role="status"><span></span><span className="sr-only">{t('product.group.updating')}</span></div>}
    {actionError&&<div className="inline-alert" role="alert"><AlertCircle/><span>{actionError}</span><button onClick={()=>setActionError('')} aria-label={t('product.error.close')}><X/></button></div>}
    <section className="group-hero" aria-labelledby="group-title">
      <div className="group-overview-side">
        <details className="group-admin-menu" open={groupAdminOpen}><summary aria-expanded={groupAdminOpen} onClick={event=>{event.preventDefault();setGroupAdminOpen(open=>!open)}}>{t('product.group.settings')}</summary><div>
          <div className="group-admin-current"><span>{t('product.currency.ledger')}</span><b>{currencyInfo.code} · {currencyName(t,currencyInfo)}</b></div>
          <button type="button" className="group-currency-action" onClick={()=>{setGroupAdminOpen(false);setShowCurrencyChange(true)}}>{t('product.currency.change')}</button>
          <p>{t('product.currency.changeHelp')}</p>
          {(group.ownerId===me.id||adminViewing)&&<><p>{t(adminViewing?'product.group.adminManaging':'product.group.deleteWarning')}</p><button className="danger-action" disabled={deletingGroup} onClick={requestDeleteCurrentGroup}>{deletingGroup?<LoaderCircle/>:<Trash2/>}{t(deletingGroup?'product.group.deleting':'product.group.delete')}</button></>}
        </div></details>
      </div>
      <div className="group-overview-copy">
        <div className="group-title-row"><h1 id="group-title">{group.name}</h1><span className="currency-badge">{currencyCode}</span></div>
        <p>{group.description||t('product.group.defaultDescription')}</p>
        <div className="group-meta">
          <span className="member-count-meta"><Users/>{t('product.members.count',{count:memberCount})}</span>
          <span><CircleHelp/>{currencyCode} {currencyName(t,currencyInfo)}</span>
          <span><History/>{t('product.group.lastUpdated',{date:lastUpdated})}</span>
        </div>
        <div className="group-member-wall" aria-label={t('product.members.travelersAria',{count:memberCount})}>
          <div className="group-member-wall-head"><span>{t('product.members.travelers')}</span><strong>{t('product.members.countShort',{count:memberCount})}</strong></div>
          <ul className="group-member-avatars">
            {expenseMembers.map(member=><li key={member.id}><button type="button" className="group-member-avatar" onClick={()=>setSelectedMemberId(String(member.id))} aria-label={t('product.members.viewProfile',{name:member.displayName||t('product.person.member')})} aria-haspopup="dialog" title={t('product.members.viewProfile',{name:member.displayName||t('product.person.member')})}><Person person={member} size={32}/></button></li>)}
          </ul>
        </div>
      </div>
    </section>
    <nav className={`mobile-shortcuts ${openAdmin?'has-admin':''}`} aria-label={t('product.shortcuts.aria')}>
      <button className="shortcut-card shortcut-expenses" onClick={()=>{setActivityTab('expenses');requestAnimationFrame(()=>document.querySelector('.activity-column')?.scrollIntoView({behavior:'smooth'}))}}><span className="shortcut-icon" aria-hidden="true"><ReceiptText/></span><span className="shortcut-label">{t('product.shortcuts.expenses')}</span></button>
      <button className="shortcut-card shortcut-balances" onClick={()=>setShowBalances(true)}><span className="shortcut-icon" aria-hidden="true"><WalletCards/></span><span className="shortcut-label">{t('product.shortcuts.balances')}</span></button>
      <button className="shortcut-card shortcut-settlements" onClick={()=>document.querySelector('.settlements')?.scrollIntoView({behavior:'smooth'})}><span className="shortcut-icon" aria-hidden="true"><Check/></span><span className="shortcut-label">{t('product.shortcuts.settlement')}</span></button>
      <button className="shortcut-card shortcut-invite" onClick={invite} disabled={adminViewing}><span className="shortcut-icon" aria-hidden="true"><Users/></span><span className="shortcut-label">{t('product.shortcuts.invite')}</span></button>
      {openAdmin&&<button className="shortcut-card mobile-admin-shortcut" onClick={openAdmin}><span className="shortcut-icon" aria-hidden="true"><ShieldCheck/></span><span className="shortcut-label">{t('product.shortcuts.admin')}</span></button>}
    </nav>
    <div className="real-stats">
      <article className="stat-card"><div><small>{t('product.stats.myBalance')}</small><h3 className={mine>=0?'positive':'negative'}>{t(mine>=0?'product.stats.receivable':'product.stats.payable')} {groupMoney(Math.abs(mine))}</h3><p>{t(mine===0?'product.stats.noPending':mine>0?'product.stats.othersPayYou':'product.stats.youPayOthers')}</p></div></article>
      <article className="stat-card"><div><small>{t('product.stats.groupExpenses')}</small><h3>{groupMoney(total)}</h3><p>{t('product.stats.sharedExpenses',{count:group.expenses.length})}</p></div></article>
      <article className="stat-card settlement-stat"><div><small>{t('product.stats.pendingTransfers')}</small><h3>{t('product.stats.transferCount',{count:group.settlements.length})}</h3><p>{t('product.stats.simplified')}</p></div></article>
    </div>
    <div className="real-grid">
      <div className="activity-column">
        <nav className="activity-tabs" role="tablist" aria-label={t('product.activity.aria')}>
          <button id={`activity-tab-expenses-${group.id}`} type="button" role="tab" aria-selected={activityTab==='expenses'} aria-controls={`activity-panel-expenses-${group.id}`} tabIndex={activityTab==='expenses'?0:-1} className={activityTab==='expenses'?'active':''} onClick={()=>setActivityTab('expenses')} onKeyDown={handleActivityTabKeyDown}><ReceiptText/><span>{t('product.expense.recent')}</span><b>{group.expenses.length}</b></button>
          <button id={`activity-tab-repayments-${group.id}`} type="button" role="tab" aria-selected={activityTab==='repayments'} aria-controls={`activity-panel-repayments-${group.id}`} tabIndex={activityTab==='repayments'?0:-1} className={activityTab==='repayments'?'active':''} onClick={()=>setActivityTab('repayments')} onKeyDown={handleActivityTabKeyDown}><History/><span>{t('product.repayment.history')}</span><b>{(group.settlementHistory||[]).length}</b></button>
        </nav>
        <section className="expense-panel" id={`activity-panel-expenses-${group.id}`} role="tabpanel" aria-labelledby={`activity-tab-expenses-${group.id}`} tabIndex={0} hidden={activityTab!=='expenses'}>
          <div className="section-head">
            <div><h2 id="expense-title">{t('product.expense.recent')}</h2><p aria-live="polite" aria-atomic="true">{expenseSortSummary}</p></div>
            <div className="expense-head-actions">
              <label className="expense-search" htmlFor={`expense-search-${group.id}`}>
                <Search aria-hidden="true"/>
                <span className="sr-only">{t('product.expense.searchRecent')}</span>
                <input id={`expense-search-${group.id}`} type="search" value={expenseQuery} onChange={event=>{setExpenseQuery(event.target.value);setExpensePage(1)}} placeholder={t('product.expense.searchPlaceholder')} autoComplete="off"/>
              </label>
              <label className="expense-member-filter" title={selectedExpenseMember?.displayName||t('product.members.all')}><span className="expense-member-filter-avatar" aria-hidden="true">{selectedExpenseMember?<Person person={selectedExpenseMember} size={26}/>:<Users/>}</span><span className="expense-member-filter-copy" aria-hidden="true"><small>{t('product.expense.members')}</small><b>{selectedExpenseMember?.displayName||t('product.members.all')}</b></span><ChevronDown aria-hidden="true"/><select id={`expense-member-filter-${group.id}`} value={expenseMemberId} onChange={event=>{setExpenseMemberId(event.target.value);setExpensePage(1)}} aria-label={t('product.expense.filterByMember')}><option value="all">{t('product.members.all')}</option>{expenseMembers.map(member=><option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
              <output className={`count-badge expense-count ${expenseFiltersActive?'is-filtered':''}`} htmlFor={`expense-search-${group.id} expense-member-filter-${group.id}`} aria-live="polite" aria-atomic="true"><strong>{visibleExpenses.length}</strong><span>{expenseFiltersActive?t('product.expense.filteredCount',{total:group.expenses.length}):t('product.expense.countLabel')}</span></output>
            </div>
          </div>
          {!group.expenses.length?<div className="empty-list"><ReceiptText/><b>{t('product.expense.emptyTitle')}</b><p>{t(adminViewing?'product.expense.emptyAdmin':'product.expense.emptyDescription')}</p>{addExpense&&<button className="empty-primary" onClick={addExpense}><Plus/> {t('product.expense.addFirst')}</button>}</div>:<>
            {!visibleExpenses.length?<div className="empty-list"><ReceiptText/><b>{t('product.expense.noMatches')}</b><p>{expenseSearchActive?t('product.expense.queryNoMatches',{query:expenseQuery.trim()}):selectedExpenseMember?t('product.expense.memberNoExpenses',{name:selectedExpenseMember.displayName}):t('product.expense.filterNoMatches')}</p></div>:<>
            <div className="mobile-expense-sort" role="group" aria-label={t('product.expense.sort.groupAria')}><ExpenseSortButton field="date" sort={expenseSort} onSort={changeExpenseSort}/><ExpenseSortButton field="participantAmount" sort={expenseSort} onSort={changeExpenseSort}/><ExpenseSortButton field="amount" sort={expenseSort} onSort={changeExpenseSort}/></div>
            <div className="expense-record-table" role="table" aria-labelledby="expense-title">
              <div role="rowgroup"><div className="record-table-head" role="row"><span className="record-sort-cell" role="columnheader" aria-sort={expenseSort.key==='date'?(expenseSort.direction==='asc'?'ascending':'descending'):'none'}><ExpenseSortButton field="date" sort={expenseSort} onSort={changeExpenseSort}/></span><span role="columnheader">{t('product.expense.column.item')}</span><span role="columnheader">{t('product.expense.column.payer')}</span><span className="record-sort-cell numeric" role="columnheader" aria-sort={expenseSort.key==='participantAmount'?(expenseSort.direction==='asc'?'ascending':'descending'):'none'}><ExpenseSortButton field="participantAmount" sort={expenseSort} onSort={changeExpenseSort}/></span><span className="record-sort-cell numeric" role="columnheader" aria-sort={expenseSort.key==='amount'?(expenseSort.direction==='asc'?'ascending':'descending'):'none'}><ExpenseSortButton field="amount" sort={expenseSort} onSort={changeExpenseSort} className="amount-sort"/><small className="record-currency" aria-hidden="true">{currencyCode}</small></span><span className="record-category-heading" role="columnheader">{t('product.expense.column.category')}</span><span role="columnheader">{t('product.expense.column.status')}</span><span role="columnheader">{t('product.expense.column.actions')}</span></div></div>
              <div className="record-list" role="rowgroup">{pagedExpenses.map(e=>{const participantShare=(e.shares||[]).find(share=>String(share.userId)===String(expenseParticipantId)),inputCurrency=e.currencyMeta?.inputCurrency||currencyCode,inputAmountCents=Number(e.currencyMeta?.inputAmountCents??e.amountCents),showOriginal=inputCurrency!==currencyCode;return <article key={e.id} role="row">
                <time className="record-date" dateTime={e.createdAt} role="cell">{new Date(e.createdAt).toLocaleDateString(locale)}</time>
                <div className="record-name" role="cell"><div><b title={e.title}>{e.title}</b><small className="record-meta"><ExpenseShareAvatars expense={e} members={group.members} onOpen={setSelectedExpenseShares}/><span className="record-payer-mobile">{t('product.expense.paidBy',{name:e.payerName})}</span></small></div></div>
                <span className="record-payer" role="cell">{e.payerName}</span>
                <div className={`record-share-amount ${participantShare?'':'is-empty'}`} role="cell"><small>{expenseParticipantLabel}</small><b>{participantShare?groupMoney(participantShare.amountCents):t('product.expense.notParticipating')}</b></div>
                <div className="record-price" role="cell"><b className={e.amountCents<0?'positive':''}>{groupMoney(e.amountCents)}</b>{showOriginal&&<small className="record-original-currency">{t('product.expense.originalCurrency',{amount:money(inputAmountCents,inputCurrency)})}</small>}<small>{e.payerCount>1?t('product.expense.multiplePayers',{count:e.payerCount}):e.splitMode==='equal'?t('product.expense.average',{amount:groupMoney(Math.round(e.amountCents/e.shareCount/currencyInfo.quantum)*currencyInfo.quantum)}):t({exact:'product.expense.splitExact',hybrid:'product.expense.splitHybrid',weights:'product.expense.splitWeights'}[e.splitMode]||'product.expense.splitCustom')}</small></div>
                <span className="record-category" role="cell">{e.amountCents<0?t('product.expense.refund'):categoryName(t,e.category||'其他')}</span>
                <span className={`record-status ${e.isLocked?'is-locked':''}`} role="cell">{e.isLocked?<ShieldCheck/>:<Check/>}{t(e.isLocked?'product.expense.settled':'product.expense.recorded')}</span>
                <div className="expense-row-actions" role="cell">{(e.createdBy===me.id||group.ownerId===me.id||me.isSuperuser)&&(e.isLocked?<button type="button" className="expense-locked" onClick={openRepaymentHistory} aria-label={t('product.expense.viewRelatedRepayments',{title:e.title})}><History/><span>{t('product.expense.viewRepayments')}</span></button>:<><button className="expense-edit" title={t('product.expense.edit')} aria-label={t('product.expense.editNamed',{title:e.title})} onClick={()=>editExpense(e)}><Pencil/></button><button className="expense-delete" title={t('product.expense.delete')} aria-label={t('product.expense.deleteNamed',{title:e.title})} disabled={deleting===e.id} onClick={()=>requestRemoveExpense(e)}>{deleting===e.id?<LoaderCircle/>:<Trash2/>}</button></>)}</div>
              </article>})}</div>
            </div>
            <RecordPagination page={currentExpensePage} totalItems={visibleExpenses.length} pageSize={TABLE_PAGE_SIZE} onPageChange={setExpensePage} label={t('product.expense.recent')}/>
            </>}
          </>}
        </section>
        <SettlementHistory group={group} refresh={refresh} refreshing={refreshing} hidden={activityTab!=='repayments'} id={`activity-panel-repayments-${group.id}`} labelledBy={`activity-tab-repayments-${group.id}`}/>
      </div>
      <aside className="settlements" aria-labelledby="settlement-title">
        <div className="settlement-heading"><div><span className="section-kicker">{t('product.settlement.todo')}</span><h2 id="settlement-title" tabIndex={-1}>{t('product.settlement.title')}</h2><p>{t('product.settlement.calculatedCount',{count:group.settlements.length})}</p></div><button className="settlement-help-button" onClick={()=>setShowSettlementHelp(true)} aria-label={t('product.settlement.learnAlgorithm')}><CircleHelp/></button></div>
        {activeRepayments.length>0&&<button type="button" className="settlement-repayment-note" onClick={openRepaymentHistory}><span>{t(activeRepayments.length===1?'product.settlement.repaymentIncluded':'product.settlement.repaymentsIncluded',{count:activeRepayments.length,amount:groupMoney(activeRepaymentTotal)})}</span><b>{t('product.common.viewRecords')}</b></button>}
        {!group.settlements.length?<div className="all-clear"><Check/><b>{t('product.settlement.allClear')}</b><p>{t('product.settlement.allClearHelp')}</p></div>:<>
          <div className="settlement-list">{pagedSettlements.map(s=>{
            const ownPayment=canPay(s),fundPayment=canManageFundPayment(s),assistedPayment=canAssistMemberPayment(s);
            const actionable=ownPayment||fundPayment||assistedPayment,bankAccess=s.bankAccountAccess||{},canShareBank=Boolean(bankAccess.canShare&&String(s.to.id)===String(me.id));
            return <article className={`settlement-row ${actionable?'payable':''}`} key={settlementKey(s)}>
              <div className="settlement-card-head">
                <span className={`settlement-status ${actionable?'needs-action':''}`}><Clock3/>{t(assistedPayment?'product.settlement.canAssist':actionable?'product.settlement.awaitingYou':'product.settlement.awaitingPayment')}</span>
                <span className="settlement-amount"><small>{t(assistedPayment?'product.settlement.assistedAmount':actionable?(fundPayment?'product.settlement.fundPays':'product.settlement.youPay'):'product.settlement.transferAmount')}</small><strong>{groupMoney(s.amountCents)}</strong></span>
              </div>
              <div className="settlement-route" role="group" aria-label={t('product.settlement.route',{from:s.from.displayName,to:s.to.displayName})}>
                <div className="settlement-person"><Person person={s.from} size={40}/><span className="settlement-person-copy"><small>{t('product.transfer.payer')}</small><b>{s.from.displayName}</b></span></div>
                <span className="settlement-route-arrow" aria-hidden="true"><ArrowRight/></span>
                <div className="settlement-person receiver"><Person person={s.to} size={40}/><span className="settlement-person-copy"><small>{t('product.transfer.recipient')}</small><b>{s.to.displayName}</b></span></div>
              </div>
              {canShareBank&&<SettlementBankShare groupId={group.id} settlement={s} shared={bankAccess.shared} configured={Boolean(me.bankAccount?.configured)} refresh={refresh} openProfile={openProfile}/>}
              {(ownPayment||fundPayment)&&(bankAccess.shared?<SettlementBankDetails groupId={group.id} settlement={s}/>:<SettlementBankUnavailable/>)}
              {actionable?<button className="settlement-confirm" disabled={Boolean(paying)} onClick={()=>beginTransferReport(s)}><Check/>{t(assistedPayment?'product.settlement.markAssisted':fundPayment?'product.settlement.payFromFund':'product.settlement.transferred')}</button>:<div className="settlement-waiting" role="status"><Clock3/><span><b>{t('product.settlement.waitingFor',{name:s.from.displayName})}</b><small>{t('product.settlement.waitingHelp')}</small></span></div>}
            </article>;
          })}</div>
          <RecordPagination page={currentSettlementPage} totalItems={group.settlements.length} pageSize={SETTLEMENT_PAGE_SIZE} onPageChange={setSettlementPage} label={t('product.settlement.pending')} compact/>
        </>}
      </aside>
    </div>
    {showCurrencyChange&&<CurrencyConversionModal group={group} currencies={currencies} close={()=>setShowCurrencyChange(false)} done={currencyChanged}/>} {showSettlementHelp&&<SettlementHelp group={group} close={()=>setShowSettlementHelp(false)}/>} {showBalances&&<BalanceChart group={group} close={()=>setShowBalances(false)}/>} {selectedExpenseShares&&<ExpenseSharesModal expense={selectedExpenseShares} members={group.members} currency={currencyCode} close={()=>setSelectedExpenseShares(null)}/>} {selectedMember&&<MemberInfoModal member={selectedMember} group={group} me={me} close={()=>setSelectedMemberId(null)}/>} {pendingSettlement&&<TransferConfirmationModal group={group} settlement={pendingSettlement} reportedBy={me} busy={paying===settlementKey(pendingSettlement)} error={transferError} close={closeTransferReport} confirm={()=>markPaid(pendingSettlement)}/>}
    {confirmation&&<ConfirmModal {...confirmation} busy={confirmationBusy} error={confirmationError} onCancel={closeConfirmation} onConfirm={confirmPendingAction}/>}
  </main>
}
function CurrencyConversionModal({group,currencies,close,done}){
 const {t,locale}=useI18n();
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
   if(saveError.status===409){setPreview(null);setAgreed(false);setError(t('product.currency.previewChanged'))}
   else setError(saveError.message);
  }finally{setSaving(false)}
 };
 const back=()=>{if(loading||saving)return;setPreview(null);setAgreed(false);setError('');setBlockedIssues([])};
 const formatRate=value=>{const numeric=Number(value);return Number.isFinite(numeric)?new Intl.NumberFormat(locale,{maximumFractionDigits:10}).format(numeric):String(value||'—')};
 const formatDate=value=>{if(!value)return t('product.common.notProvided');const date=new Date(`${value}T00:00:00`);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(date)};
 const roundingDelta=Number(preview?.roundingDeltaCents||0);
 const counts=preview?.counts||{};
 const rateWarning=rateHealth?.warning?translateApiMessage(rateHealth.warning):(rateHealth?.stale||rateHealth?.status==='stale')?t('product.currency.staleWarning'):'';
 return <Modal close={close} closeDisabled={loading||saving} className="currency-conversion-modal" label={t('product.currency.modalLabel',{name:group.name})}>
  <div className="currency-conversion-content" aria-busy={loading||saving}>
   <header className="currency-conversion-heading">
    <span className="eyebrow">{t('product.group.management')}</span>
    <h2>{t('product.currency.change')}</h2>
    <p>{t('product.currency.permanentIntro')}</p>
   </header>
   <ol className="currency-conversion-steps" aria-label={t('product.currency.progress')}>
    <li className={!preview?'active':'complete'}><span>1</span><b>{t('product.currency.select')}</b></li>
    <li className={preview?'active':''}><span>2</span><b>{t('product.currency.review')}</b></li>
   </ol>
   {!preview?<form className="currency-conversion-select" onSubmit={requestPreview}>
    <div className="currency-current-card"><span>{t('product.currency.current')}</span><strong>{current.code}</strong><small>{t('product.currency.decimals',{name:currencyName(t,current),decimals:current.decimals})}</small></div>
    <label htmlFor={`currency-target-${group.id}`}>{t('product.currency.convertTo')}
     <select id={`currency-target-${group.id}`} autoFocus value={targetCurrency} onChange={event=>{setTargetCurrency(event.target.value);setError('');setBlockedIssues([])}} disabled={loading}>
      {available.map(item=><option value={item.code} key={item.code}>{item.code} · {currencyName(t,item)} ({t('product.currency.decimalPlaces',{decimals:item.decimals})})</option>)}
     </select>
     <small className="field-help">{t('product.currency.previewHelp')}</small>
    </label>
    <div className="currency-rate-choice">
     <div className="currency-rate-tabs" role="group" aria-label={t('product.currency.rateSource')}><button type="button" aria-pressed={exchangeRateMode==='quoted'} onClick={()=>{setExchangeRateMode('quoted');setError('')}}>{t('product.currency.systemRate')}</button><button type="button" aria-pressed={exchangeRateMode==='manual'} onClick={()=>{setExchangeRateMode('manual');setError('')}}>{t('product.currency.customRate')}</button></div>
     {exchangeRateMode==='manual'&&<label>1 {currentCode} = <span><input type="number" min="0.000000001" step="any" inputMode="decimal" value={manualRate} onChange={event=>setManualRate(event.target.value)} aria-invalid={!manualRateValid}/><b>{targetCurrency}</b></span><small className="field-help">{t('product.currency.customRateHelp')}</small></label>}
    </div>
    {rateWarning&&<p className="currency-rate-warning" role="status">{rateWarning}</p>}
    {blockedIssues.length>0&&<ul className="currency-blocked-list" role="alert">{blockedIssues.map((issue,index)=><li key={`${issue?.code||'issue'}-${index}`}>{translateApiMessage(issue?.message||String(issue))}</li>)}</ul>}
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={loading}>{t('product.common.cancel')}</button><button type="submit" className="primary" disabled={loading||!targetCurrency||!manualRateValid}>{loading?<LoaderCircle/>:null}{t(loading?'product.currency.calculating':'product.currency.getPreview')}</button></div>
   </form>:<div className="currency-preview">
    <div className="currency-preview-route" aria-label={t('product.currency.route',{from:currentCode,to:target.code})}><div><small>{t('product.currency.now')}</small><strong>{currentCode}</strong><span>{currencyName(t,current)}</span></div><ArrowRight aria-hidden="true"/><div><small>{t('product.currency.after')}</small><strong>{target.code}</strong><span>{currencyName(t,target)}</span></div></div>
    <dl className="currency-preview-facts">
     <div><dt>{t('product.currency.appliedRate')}</dt><dd>1 {preview.fromCurrency} = {formatRate(preview.rate)} {preview.toCurrency}</dd></div>
     <div><dt>{t('product.currency.rateDate')}</dt><dd>{formatDate(preview.rateDate)}</dd></div>
     <div><dt>{t('product.currency.source')}</dt><dd>{preview.rateMode==='manual'?t('product.currency.memberDefined'):preview.sourceUrl?<a href={preview.sourceUrl} target="_blank" rel="noreferrer">{preview.source||'Exchange API'}</a>:preview.source||'Exchange API'}</dd></div>
     <div><dt>{t('product.currency.precision')}</dt><dd>{t('product.currency.precisionValue',{code:target.code,decimals:preview.targetDecimals??target.decimals})}</dd></div>
    </dl>
    <div className="currency-preview-counts" aria-label={t('product.currency.dataCounts')}>
     <span><b>{Number(counts.expenses||0).toLocaleString(locale)}</b>{t('product.currency.countExpenses')}</span>
     <span><b>{Number(counts.payments||0).toLocaleString(locale)}</b>{t('product.currency.countPayments')}</span>
     <span><b>{Number(counts.shares||0).toLocaleString(locale)}</b>{t('product.currency.countShares')}</span>
     <span><b>{Number(counts.settlements||0).toLocaleString(locale)}</b>{t('product.currency.countRepayments')}</span>
    </div>
    <div className="currency-rounding-summary"><span>{t('product.currency.roundingEstimate')}</span><strong className={roundingDelta===0?'is-zero':''}>{roundingDelta===0?t('product.currency.noRounding'):`${roundingDelta>0?'+':'−'}${conversionDeltaLabel(roundingDelta,target.code,locale)}`}</strong><small>{t('product.currency.roundingHelp')}</small></div>
    {Array.isArray(preview.examples)&&preview.examples.length>0&&<div className="currency-preview-examples"><b>{t('product.currency.examples')}</b>{preview.examples.slice(0,3).map((item,index)=><div key={item.id||`${item.title}-${index}`}><span>{item.title||t('product.currency.ledgerItem',{index:index+1})}</span><small>{money(item.beforeAmountCents,preview.fromCurrency)} → {money(item.afterAmountCents,preview.toCurrency)}</small></div>)}</div>}
    {rateWarning&&<p className="currency-rate-warning" role="status">{rateWarning}</p>}
    <div className="currency-permanent-warning"><b>{t('product.currency.irreversible')}</b><p>{t('product.currency.irreversibleHelp')}</p></div>
    <label className="currency-confirm-check"><input type="checkbox" checked={agreed} onChange={event=>setAgreed(event.target.checked)} disabled={saving}/><span>{t('product.currency.acknowledge')}</span></label>
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={back} disabled={saving}>{t('product.currency.back')}</button><button type="button" className="primary" onClick={confirm} disabled={saving||!agreed}>{saving?<LoaderCircle/>:null}{saving?t('product.currency.converting'):t('product.currency.confirm',{code:target.code})}</button></div>
    {preview.expiresAt&&<small className="currency-preview-expiry">{t('product.currency.expires',{time:new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit'}).format(new Date(preview.expiresAt))})}</small>}
   </div>}
  </div>
 </Modal>;
}
function MemberInfoModal({member,group,me,close}){
 const {t}=useI18n();
 const isOwner=member.role==='owner'||String(member.id)===String(group.ownerId),isMe=String(member.id)===String(me.id),roleLabel=t(isOwner?'product.members.owner':'product.members.traveler');
 return <Modal close={close} label={t('product.members.profileLabel',{name:member.displayName||t('product.person.member')})}>
  <div className="member-profile-content">
   <div className="member-profile-heading"><Person person={member} size={72}/><div><span className="eyebrow"><Users/> {t('product.members.groupMember')}</span><h2>{member.displayName||t('product.members.unnamed')}</h2><p>{roleLabel}{isMe?t('product.members.thisIsYou'):''}</p></div></div>
   <dl className="member-profile-details">
    <div><dt>{t('product.members.displayName')}</dt><dd>{member.displayName||t('product.common.notSet')}</dd></div>
    <div><dt>{t('product.members.role')}</dt><dd>{roleLabel}</dd></div>
    <div><dt>{t('product.members.status')}</dt><dd><Check/>{t('product.members.joinedGroup',{name:group.name})}</dd></div>
   </dl>
   <div className="member-profile-privacy"><ShieldCheck/><div><b>{t('product.members.publicOnly')}</b><p>{t('product.members.privacy')}</p></div></div>
   <button type="button" className="primary wide" onClick={close}>{t('product.common.done')}</button>
  </div>
 </Modal>;
}
function ExpenseSharesModal({expense,members,currency='TWD',close}){
 const {t}=useI18n();
 const rows=expenseShareRows(expense,members,t('product.members.former')),isRefund=Number(expense.amountCents)<0,kindLabel=t(isRefund?'product.expense.refund':'product.expense.split');
 return <Modal close={close} label={t('product.expense.shareModalLabel',{title:expense.title,kind:kindLabel})}>
  <div className="expense-shares-modal-content">
   <span className="eyebrow"><Users/> {t(isRefund?'product.expense.refundDistribution':'product.expense.expenseSplit')}</span>
   <h2>{expense.title}</h2>
   <p className="modal-copy">{t(isRefund
     ?rows.length===1?'product.expense.refundMemberDescription':'product.expense.refundMembersDescription'
     :rows.length===1?'product.expense.splitMemberDescription':'product.expense.splitMembersDescription',{count:rows.length})}</p>
   <ul className="expense-share-list" aria-label={t('product.expense.membersAndAmounts',{kind:kindLabel})}>
    {rows.map(row=><li key={row.userId}><Person person={row.person} size={42}/><span><b>{row.person.displayName}</b><small>{t(isRefund?'product.expense.refundAmount':'product.expense.shareAmount')}</small></span><strong>{money(Math.abs(row.amountCents),currency)}</strong></li>)}
   </ul>
   <div className={`expense-share-total ${isRefund?'is-refund':''}`}><span>{t(isRefund?'product.expense.refundTotal':'product.expense.splitTotal')}</span><strong>{money(Math.abs(expense.amountCents),currency)}</strong></div>
   <button type="button" className="primary wide" onClick={close}>{t('product.common.done')}</button>
  </div>
 </Modal>;
}
function TransferConfirmationModal({group,settlement,reportedBy,busy,error,close,confirm}){
 const {t}=useI18n();
 const isFund=Boolean(settlement.from.isFund);
 const isAssisted=String(settlement.from.id)!==String(reportedBy.id);
 return <Modal close={close} closeDisabled={busy} className="transfer-confirm-modal" label={t('product.transfer.confirmLabel')}>
  <div className="transfer-confirm-content" aria-busy={busy}>
   <div className="transfer-modal-heading"><span className="transfer-modal-icon"><Check/></span><div><span className="eyebrow">{t('product.transfer.completionNotice')}</span><h2>{t(isAssisted?'product.transfer.confirmAssistedTitle':'product.transfer.confirmTitle')}</h2><p>{t(isAssisted?'product.transfer.confirmAssistedHelp':'product.transfer.confirmHelp')}</p></div></div>
   <div className="transfer-summary-card">
    <div className="transfer-report-route" role="group" aria-label={t('product.transfer.route',{from:settlement.from.displayName,to:settlement.to.displayName})}>
     <div><Person person={settlement.from} size={42}/><span><small>{t('product.transfer.payer')}</small><b>{settlement.from.displayName}</b></span></div>
     <ArrowRight aria-hidden="true"/>
     <div><Person person={settlement.to} size={42}/><span><small>{t('product.transfer.recipient')}</small><b>{settlement.to.displayName}</b></span></div>
    </div>
    <div className="transfer-summary-amount"><small>{t('product.transfer.reportAmount')}</small><strong>{money(settlement.amountCents,group.currency)}</strong></div>
    <p className="transfer-summary-group"><WalletCards/>{group.name}{isAssisted&&<span>{t('product.transfer.confirmedBy',{name:reportedBy.displayName})}</span>}{!isAssisted&&isFund&&<span>{t('product.transfer.managedBy',{name:reportedBy.displayName})}</span>}</p>
   </div>
   <div className="transfer-verification-note" id="transfer-confirm-note"><AlertCircle/><div><b>{t(isAssisted?'product.transfer.assistedNotVerified':'product.transfer.selfNotVerified')}</b><p>{t(isAssisted?'product.transfer.assistedDisclaimer':'product.transfer.selfDisclaimer')}</p></div></div>
   {error&&<p className="transfer-report-error" role="alert"><AlertCircle/>{error}</p>}
   <div className="transfer-confirm-actions">
    <button type="button" className="secondary-button" onClick={close} disabled={busy}>{t('product.transfer.notNow')}</button>
    <button type="button" className="primary" onClick={confirm} disabled={busy} aria-describedby="transfer-confirm-note">{busy?<LoaderCircle/>:<Check/>}{t(busy?'product.transfer.recording':isAssisted?'product.transfer.confirmAssisted':'product.transfer.confirmAndRecord')}</button>
   </div>
  </div>
 </Modal>;
}
function TransferNoticeModal({report,close}){
 const {t,language}=useI18n();
 const {text,amountLabel,timeLabel}=buildSettlementNotice(report,{language});
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
 return <Modal close={close} className="transfer-report-modal" label={t('product.transfer.reportComplete')}>
  <div className="transfer-report-content">
   <div className="transfer-modal-heading is-success"><span className="transfer-modal-icon"><Check/></span><div><span className="eyebrow">{t('product.transfer.reportComplete')}</span><h2>{t('product.transfer.recordedTitle')}</h2><p>{t('product.transfer.recordedHelp')}</p></div></div>
   <div className="transfer-summary-card">
    <div className="transfer-report-route" role="group" aria-label={t('product.transfer.route',{from:report.from.displayName,to:report.to.displayName})}>
     <div><Person person={report.from} size={42}/><span><small>{t('product.transfer.payer')}</small><b>{report.from.displayName}</b></span></div>
     <ArrowRight aria-hidden="true"/>
     <div><Person person={report.to} size={42}/><span><small>{t('product.transfer.recipient')}</small><b>{report.to.displayName}</b></span></div>
    </div>
    <div className="transfer-summary-amount"><small>{t('product.transfer.reportedAmount')}</small><strong>{amountLabel}</strong></div>
    <dl className="transfer-report-meta"><div><dt>{t('product.transfer.trip')}</dt><dd>{report.groupName}</dd></div><div><dt>{t('product.transfer.recordedAt')}</dt><dd>{timeLabel}</dd></div>{report.reportedBy&&<div><dt>{t('product.transfer.reporter')}</dt><dd>{report.reportedBy.displayName}</dd></div>}</dl>
   </div>
   <div className="transfer-verification-note" id="transfer-report-note"><ShieldCheck/><div><b>{t(isAssisted?'product.transfer.ownerReported':'product.transfer.payerReported')}</b><p>{t('product.transfer.bankDisclaimer')}</p></div></div>
   {report.refreshWarning&&<p className="transfer-refresh-warning" role="alert"><RefreshCcw/>{report.refreshWarning}</p>}
   <details className="transfer-report-preview"><summary>{t('product.transfer.previewText')}</summary><pre>{text}</pre></details>
   <div className="transfer-report-actions">
    <a className="line-share transfer-line-share" href={settlementLineShareUrl(report,{language})} target="_blank" rel="noreferrer" aria-describedby="transfer-report-note" onClick={()=>{setCopyState('');setShareOpened(true)}}><MessageCircle/>{t('product.transfer.shareLine')}</a>
    <button type="button" className="copy-link transfer-copy-link" onClick={copy} aria-describedby="transfer-report-note">{copyState==='copied'?<Check/>:<Clipboard/>}{t(copyState==='copied'?'product.transfer.copiedText':'product.transfer.copyText')}</button>
    <button type="button" className="transfer-report-done" onClick={close}>{t('product.transfer.doneReturn')}</button>
   </div>
   <div className={`transfer-share-feedback ${copyState==='error'?'is-error':''}`} aria-live="polite" role={copyState==='error'?'alert':'status'}>
    {t(copyState==='error'?'product.transfer.copyTextError':copyState==='copied'?'product.transfer.copyTextSuccess':shareOpened?'product.transfer.lineOpened':'product.transfer.lineManual')}
   </div>
  </div>
 </Modal>;
}
function SettlementHistory({group,refresh,refreshing=false,hidden=false,id,labelledBy}){
 const {t,locale,language}=useI18n();
 const sourceRows=group.settlementHistory||[];
 const [localVoids,setLocalVoids]=useState({});
 const rows=sourceRows.map(item=>localVoids[item.id]&&!item.voidedAt?{...item,...localVoids[item.id],canVoid:false}:item);
 const activeCount=rows.filter(item=>item.reportStatus!=='voided'&&!item.voidedAt).length,voidedCount=rows.length-activeCount;
 const [page,setPage]=useState(1),[pendingVoid,setPendingVoid]=useState(null),[voiding,setVoiding]=useState(''),[voidError,setVoidError]=useState(''),[historyError,setHistoryError]=useState(''),[statusMessage,setStatusMessage]=useState('');
 const pageCount=Math.max(1,Math.ceil(rows.length/TABLE_PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const pagedRows=rows.slice((currentPage-1)*TABLE_PAGE_SIZE,currentPage*TABLE_PAGE_SIZE);
 useEffect(()=>{setLocalVoids({});setPage(1);setPendingVoid(null);setVoiding('');setVoidError('');setHistoryError('');setStatusMessage('')},[group.id]);
 useEffect(()=>setPage(value=>Math.min(value,pageCount)),[pageCount]);
 const formatTime=value=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const refreshHistory=async()=>{setHistoryError('');try{await refresh()}catch(error){setHistoryError(error.message||t('product.repayment.refreshError'))}};
 const requestVoid=item=>{setStatusMessage('');setHistoryError('');setVoidError('');setPendingVoid(item)};
 const closeVoid=()=>{if(voiding)return;setVoidError('');setPendingVoid(null)};
 const confirmVoid=async()=>{
  if(!pendingVoid||voiding)return;
  const item=pendingVoid;
  setVoiding(item.id);
  setVoidError('');
  try{
   const result=await api(`/api/groups/${group.id}/settlements/${item.id}/void`,{method:'PATCH'});
   setLocalVoids(current=>({...current,[item.id]:{reportStatus:'voided',voidedAt:result.voidedAt||new Date().toISOString(),voidedBy:{displayName:t('product.common.you')}}}));
   setPendingVoid(null);
   setStatusMessage(t('product.repayment.voidSuccess',{from:item.from.displayName,to:item.to.displayName,amount:money(item.amountCents,group.currency)}));
   try{await refresh()}catch{setStatusMessage(t('product.repayment.voidRefreshWarning'))}
   requestAnimationFrame(()=>document.getElementById('repayment-title')?.focus());
  }catch(error){setVoidError(error.message)}finally{setVoiding('')}
 };
 const confirmation=pendingVoid?settlementVoidConfirmation(pendingVoid,{language}):null;
 return <>
  <section className="repayment-panel" id={id} role="tabpanel" aria-labelledby={labelledBy} tabIndex={0} hidden={hidden}>
   <div className="section-head"><div><h2 id="repayment-title" tabIndex={-1}>{t('product.repayment.history')}</h2><p>{t('product.repayment.summary',{active:activeCount,voided:voidedCount?` · ${t('product.repayment.voidedCount',{count:voidedCount})}`:''})}</p></div><button type="button" className="history-refresh" disabled={refreshing||Boolean(voiding)} onClick={refreshHistory} aria-label={t(refreshing?'product.repayment.refreshing':'product.repayment.refresh')}>{refreshing?<LoaderCircle/>:<RefreshCcw/>}</button></div>
   {statusMessage&&<p className="repayment-feedback" role="status" aria-live="polite"><Check/>{statusMessage}</p>}
   {historyError&&<p className="repayment-feedback is-error" role="alert"><AlertCircle/>{historyError}</p>}
   {!rows.length?<div className="repayment-empty"><History/><span>{t('product.repayment.empty')}</span></div>:<>
    <div className="repayment-table-head" aria-hidden="true"><span>{t('product.expense.sort.date')}</span><span>{t('product.transfer.payer')}</span><span>{t('product.transfer.recipient')}</span><span>{t('product.repayment.amountColumn',{currency:group.currency||'TWD'})}</span><span>{t('product.repayment.reportInfo')}</span><span>{t('product.repayment.statusActions')}</span></div>
    <div className="repayment-log">{pagedRows.map(item=>{const reportedBy=item.reportedBy||item.confirmedBy||{displayName:t('product.person.member')},isVoided=item.reportStatus==='voided'||Boolean(item.voidedAt),voidedBy=item.voidedBy?.displayName||t('product.admin.role'),reportedCurrency=item.reportedCurrency||group.currency||'TWD',reportedAmountCents=Number(item.reportedAmountCents??item.amountCents),showOriginal=reportedCurrency!==(group.currency||'TWD')||reportedAmountCents!==Number(item.amountCents);return <article className={isVoided?'is-voided':''} key={item.id}>
     <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
     <span className="repayment-payer">{item.from.displayName}</span>
     <span className="repayment-receiver">{item.to.displayName}</span>
     <strong className="repayment-amount"><span>{money(item.amountCents,group.currency)}</span>{showOriginal&&<small>{t('product.repayment.originalReported',{amount:money(reportedAmountCents,reportedCurrency)})}</small>}</strong>
     <small className="repayment-meta">{isVoided?t('product.repayment.voidMeta',{voidedBy,reportedBy:reportedBy.displayName}):t('product.repayment.reportMeta',{name:reportedBy.displayName})}</small>
     <div className="repayment-status-actions"><span className={`record-status ${isVoided?'is-voided':''}`}>{isVoided?<History/>:<Check/>}{t(isVoided?'product.repayment.voided':'product.repayment.reported')}</span>{item.canVoid&&<button type="button" className="repayment-void-button" disabled={Boolean(voiding)} onClick={()=>requestVoid(item)} aria-label={t('product.repayment.voidAria',{from:item.from.displayName,to:item.to.displayName,amount:money(item.amountCents,group.currency)})}>{voiding===item.id?<LoaderCircle/>:<RefreshCcw/>}<span>{t(voiding===item.id?'product.common.processing':'product.repayment.void')}</span></button>}</div>
    </article>})}</div>
    <RecordPagination page={currentPage} totalItems={rows.length} pageSize={TABLE_PAGE_SIZE} onPageChange={setPage} label={t('product.repayment.history')}/>
   </>}
  </section>
  {confirmation&&<ConfirmModal {...confirmation} busy={voiding===pendingVoid.id} error={voidError} onCancel={closeVoid} onConfirm={confirmVoid}/>}
 </>;
}
function BalanceChart({group,close}){
 const {t}=useI18n();
 const rows=[...group.balances].sort((a,b)=>a.balanceCents-b.balanceCents);
 const maximum=Math.max(1,...rows.map(x=>Math.abs(x.balanceCents)));
 const currency=group.currency||'TWD';
 return <Modal close={close} label={t('product.balance.title')}><span className="eyebrow"><WalletCards/> Balance</span><h2>{t('product.balance.title')}</h2><p className="modal-copy">{t('product.balance.description')}</p><div className="diverging-legend"><span>← {t('product.stats.payable')}</span><i></i><span>{t('product.stats.receivable')} →</span></div><div className="diverging-chart">{rows.map(person=>{const value=person.balanceCents,width=value===0?0:Math.max(10,Math.round(Math.abs(value)/maximum*100)),member=<div className="diverging-member"><b>{person.displayName}</b><Person person={person} size={38}/></div>;return <div className={`diverging-row ${value<0?'is-debt':value>0?'is-credit':'is-zero'}`} key={person.id}><div className="diverging-left">{value<0?<span className="diverging-bar debt" style={{width:`${width}%`}}><strong>-{money(Math.abs(value),currency)}</strong></span>:member}</div><div className="diverging-right">{value>0?<span className="diverging-bar credit" style={{width:`${width}%`}}><strong>+{money(value,currency)}</strong></span>:value<0?member:<strong className="zero-amount">{money(0,currency)}</strong>}</div></div>})}</div><div className="balance-check"><Check/> {t('product.balance.zeroSum',{amount:money(0,currency)})}</div><button className="primary wide" onClick={close}>{t('product.common.understood')}</button></Modal>
}
function SettlementHelp({group,close}){const {t}=useI18n(),currency=group.currency||'TWD';return <Modal close={close} label={t('product.settlement.helpTitle')}><span className="eyebrow"><CircleHelp/> {t('product.settlement.helpTitle')}</span><h2>{t('product.settlement.how')}</h2><p className="modal-copy">{t('product.settlement.helpDescription')}</p><div className="settlement-example"><div className="example-title"><b>{t('product.settlement.example')}</b><small>{t('product.settlement.examplePeople')}</small></div><div className="example-columns"><section><b>{t('product.settlement.originalCount')}</b><p>A → C　{money(10000,currency)}</p><p>B → C　{money(30000,currency)}</p><p>A → B　{money(5000,currency)}</p></section><ArrowRight/><section className="simplified"><b>{t('product.settlement.simplifiedCount')}</b><p>A → C　{money(15000,currency)}</p><p>B → C　{money(25000,currency)}</p></section></div><div className="example-net"><span>{t('product.settlement.examplePay',{name:'A',amount:money(15000,currency)})}</span><span>{t('product.settlement.examplePay',{name:'B',amount:money(25000,currency)})}</span><span>{t('product.settlement.exampleReceive',{name:'C',amount:money(40000,currency)})}</span></div></div><div className="algorithm-note"><b>{t('product.settlement.currentMethod')}</b><p>{t('product.settlement.algorithm')}</p></div><button className="primary wide" onClick={close}>{t('product.common.understood')}</button></Modal>}
function Modal({children,close,label,className='',closeDisabled=false}){
 const {t}=useI18n();
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
 return createPortal(<div ref={overlayRef} className="overlay" onMouseDown={event=>event.target===event.currentTarget&&!closeDisabled&&close()}><div ref={dialogRef} className={`modal real-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label===undefined?t('product.modal.dialog'):label}><button type="button" className="modal-x" onClick={close} disabled={closeDisabled} aria-label={t('product.modal.close')}><X/></button>{children}</div></div>,document.body);
}
function ProfileModal({me,close,saved}){
 const {t,language}=useI18n();
 const [form,setForm]=useState(EMPTY_BANK_ACCOUNT),[configured,setConfigured]=useState(Boolean(me.bankAccount?.configured)),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [confirmingRemove,setConfirmingRemove]=useState(false),[removeError,setRemoveError]=useState('');
 useEffect(()=>{let active=true;api('/api/me/bank-account').then(({bankAccount})=>{if(!active)return;if(bankAccount){setForm({...EMPTY_BANK_ACCOUNT,...bankAccount,branchCode:bankAccount.branchCode||''});setConfigured(true)}}).catch(loadError=>active&&setError(loadError.message)).finally(()=>active&&setLoading(false));return()=>{active=false}},[]);
 const update=(field,value)=>setForm(current=>({...current,[field]:value}));
 const submit=async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{const result=await api('/api/me/bank-account',{method:'PUT',body:JSON.stringify(form)});saved(result.bankAccount)}catch(saveError){setError(saveError.message);setBusy(false)}};
 const requestRemove=()=>{setError('');setRemoveError('');setConfirmingRemove(true)};
 const remove=async()=>{if(busy)return;setBusy(true);setRemoveError('');try{const result=await api('/api/me/bank-account',{method:'DELETE'});saved(result.bankAccount)}catch(removeAccountError){setRemoveError(removeAccountError.message);setBusy(false)}};
 const removeConfirmation=bankAccountRemovalConfirmation({language});
 return <>
 <Modal close={close} label={t('product.profile.modalLabel')}>
  <div className="profile-heading"><Person person={me} size={52}/><div><span className="eyebrow">{t('product.profile.title')}</span><h2>{me.displayName}</h2><p>{t('product.profile.lineLinked')}</p></div><LanguageSwitcher className="profile-language-switcher"/></div>
  <div className="profile-privacy" id="bank-account-privacy"><ShieldCheck/><div><b>{t('product.profile.shareTitle')}</b><p>{t('product.profile.shareDescription')}</p></div></div>
  {loading?<div className="profile-loading" role="status"><LoaderCircle/><span>{t('product.profile.loading')}</span></div>:<form className="profile-form" onSubmit={submit}>
    <div className="profile-form-title"><div><b>{t('product.profile.usualAccount')}</b><small>{configured?t('product.profile.currentLast4',{last4:me.bankAccount?.last4||form.accountNumber.slice(-4)}):t('product.common.notSet')}</small></div><WalletCards/></div>
    <div className="form-two">
      <label>{t('product.bank.code')} <span className="required-mark" aria-hidden="true">*</span><input autoFocus inputMode="numeric" maxLength="3" pattern="[0-9]{3}" value={form.bankCode} onChange={event=>update('bankCode',event.target.value)} placeholder={t('product.bank.codeExample')} required aria-describedby="bank-account-privacy"/></label>
      <label>{t('product.bank.name')} <span className="required-mark" aria-hidden="true">*</span><input maxLength="60" value={form.bankName} onChange={event=>update('bankName',event.target.value)} placeholder={t('product.bank.nameExample')} required/></label>
    </div>
    <label>{t('product.bank.branchCode')}<input inputMode="numeric" maxLength="7" pattern="[0-9]{3,7}" value={form.branchCode} onChange={event=>update('branchCode',event.target.value)} placeholder={t('product.bank.branchPlaceholder')}/><small className="field-help">{t('product.bank.branchHelp')}</small></label>
    <label>{t('product.bank.holder')} <span className="required-mark" aria-hidden="true">*</span><input maxLength="80" autoComplete="name" value={form.accountHolderName} onChange={event=>update('accountHolderName',event.target.value)} placeholder={t('product.bank.holderPlaceholder')} required/></label>
    <label>{t('product.bank.accountNumber')} <span className="required-mark" aria-hidden="true">*</span><input inputMode="numeric" autoComplete="off" maxLength="24" pattern="[0-9 -]{6,24}" value={form.accountNumber} onChange={event=>update('accountNumber',event.target.value)} placeholder={t('product.bank.accountPlaceholder')} required aria-describedby="bank-account-number-help"/><small className="field-help" id="bank-account-number-help">{t('product.bank.accountHelp')}</small></label>
    {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
    <div className="form-actions profile-actions">{configured&&<button type="button" className="profile-remove" onClick={requestRemove} disabled={busy}><Trash2/>{t('product.profile.removeAccount')}</button>}<button type="button" className="secondary-button" onClick={close} disabled={busy}>{t('product.common.cancel')}</button><button className="primary" disabled={busy}>{busy?<LoaderCircle/>:<Check/>}{t(busy?'product.common.saving':'product.profile.saveAccount')}</button></div>
  </form>}
 </Modal>
 {confirmingRemove&&<ConfirmModal {...removeConfirmation} busy={busy} error={removeError} onCancel={()=>!busy&&setConfirmingRemove(false)} onConfirm={remove}/>}
 </>;
}
function CreateGroup({currencies=DEFAULT_CURRENCIES,close,done}){
 const {t}=useI18n();
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[currency,setCurrency]=useState('TWD'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const selectedCurrency=getCurrency(currency);
 const submit=async event=>{
  event.preventDefault();
  if(busy)return;
  setBusy(true);setError('');
  try{done(await api('/api/groups',{method:'POST',body:JSON.stringify({name,description,currency})}))}
  catch(submitError){setError(submitError.message);setBusy(false)}
 };
 return <Modal close={close} closeDisabled={busy} label={t('product.createGroup.title')}>
  <span className="eyebrow">{t('product.createGroup.eyebrow')}</span>
  <h2>{t('product.createGroup.title')}</h2>
  <p className="modal-copy">{t('product.createGroup.description')}</p>
  <form onSubmit={submit}>
   <label>{t('product.createGroup.name')} <span className="required-mark" aria-hidden="true">*</span><input autoFocus maxLength="60" value={name} onChange={event=>setName(event.target.value)} placeholder={t('product.createGroup.namePlaceholder')} required aria-invalid={Boolean(error&&!name.trim())}/><small className="field-help">{t('product.createGroup.nameHelp')}</small></label>
   <label>{t('product.createGroup.shortDescription')}<input maxLength="200" value={description} onChange={event=>setDescription(event.target.value)} placeholder={t('product.createGroup.descriptionPlaceholder')}/><small className="field-help">{t('product.createGroup.descriptionHelp')}</small></label>
   <label>{t('product.currency.ledger')} <span className="required-mark" aria-hidden="true">*</span><select value={currency} onChange={event=>setCurrency(event.target.value)} required>{currencies.map(item=><option key={item.code} value={item.code}>{item.code} · {currencyName(t,item)}</option>)}</select><small className="field-help">{t('product.createGroup.currencyHelp',{code:selectedCurrency.code,decimals:selectedCurrency.decimals})}</small></label>
   {error&&<p className="form-error" role="alert"><AlertCircle/>{error}</p>}
   <div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>{t('product.common.cancel')}</button><button className="primary" disabled={busy||!name.trim()}>{busy?<LoaderCircle/>:<Plus/>}{t(busy?'product.createGroup.creating':'product.groups.create')}</button></div>
  </form>
 </Modal>;
}
function InviteModal({group,close}){const {t}=useI18n(),link=`${location.origin}/invite/${group.inviteToken}`;const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');const copy=async()=>{setCopyError('');try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setCopyError(t('product.invite.copyError'))}};const shareText=t('product.invite.shareText',{name:group.name,link});return <Modal close={close} label={t('product.invite.members')}><span className="eyebrow">{t('product.invite.members')}</span><h2>{t('product.invite.lineTitle')}</h2><p className="modal-copy">{t('product.invite.description',{name:group.name})}</p><div className="invite-link"><Link2/><span>{link}</span></div>{copyError&&<p className="form-error" role="alert"><AlertCircle/>{copyError}</p>}<button className="line-share" onClick={()=>location.href=`https://line.me/R/share?text=${encodeURIComponent(shareText)}`}><DoorOpen/> {t('product.invite.shareLine')}</button><button className="copy-link" onClick={copy} aria-live="polite">{copied?<Check/>:<Clipboard/>}{t(copied?'product.invite.copied':'product.invite.copy')}</button></Modal>}
