import React,{useCallback,useDeferredValue,useEffect,useMemo,useState} from 'react';
import {AlertCircle,ArrowLeft,ArrowRight,Building2,Check,ChevronLeft,ChevronRight,FlaskConical,History,Info,LoaderCircle,LogOut,Pencil,Play,Plus,RefreshCcw,Search,ShieldCheck,Trash2,UserPlus,Users} from './ui-icons.jsx';
import {BrandLogo,BrandMark} from './BrandLogo.jsx';
import {ConfirmModal} from './ConfirmModal.jsx';
import {roleChangeConfirmation} from './confirmation-actions.mjs';
import {filterAdminItems,paginateAdminItems} from './admin-list-state.mjs';
import {presentAuditItem} from './audit-log.mjs';
import {formatCurrencyAmount} from '../currency.mjs';
import {getLanguageHeaders,LanguageSwitcher,translateApiMessage,useI18n} from './i18n.jsx';

const adminApi=async(url,options={})=>{
  const response=await fetch(url,{...options,headers:getLanguageHeaders({'content-type':'application/json',...(options.headers||{})})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(translateApiMessage(data.error||'管理資料讀取失敗'));
  return data;
};

const money=(cents,currency='TWD')=>formatCurrencyAmount(Number(cents||0),currency);
const date=(value,locale)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(value));
const auditDate=(value,locale)=>new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const adminTabs=[
  {id:'users',labelKey:'admin.tab.users',countKey:'admin.tab.users.count',icon:Users},
  {id:'simulations',labelKey:'admin.tab.simulations',countKey:'admin.tab.simulations.count',icon:FlaskConical},
  {id:'groups',labelKey:'admin.tab.groups',countKey:'admin.tab.groups.count',icon:Building2},
  {id:'audit',labelKey:'admin.tab.audit',countKey:'admin.tab.audit.count',icon:History}
];
const pageSizes={users:10,simulations:6,groups:8,audit:12};
const initialQueries={users:'',simulations:'',groups:'',audit:''};
const initialPages={users:1,simulations:1,groups:1,audit:1};

function AdminAvatar({user,size=38}){
  const {isEnglish,t}=useI18n();
  return user?.pictureUrl
    ?<img className="admin-avatar" src={user.pictureUrl} alt={user.displayName||t('admin.user')} style={{width:size,height:size}} referrerPolicy="no-referrer"/>
    :<span className="admin-avatar admin-avatar-initial" style={{width:size,height:size}} aria-label={user?.displayName||t('admin.user')}>{user?.displayName?.slice(0,1)||(isEnglish?'T':'旅')}</span>;
}

const auditIcons={create:Plus,update:Pencil,delete:Trash2,join:UserPlus,settlement:Check,system:History};
function AuditLogItem({item}){
  const {locale}=useI18n();
  const ActionIcon=auditIcons[item.actionTone]||History;
  return <article className={`admin-audit-item is-${item.actionTone}`}>
    <AdminAvatar user={{displayName:item.actorName,pictureUrl:item.actorPictureUrl}} size={34}/>
    <div className="admin-audit-event">
      <div className="admin-audit-summary">
        <b>{item.summary}</b>
        <span className="admin-audit-action"><ActionIcon aria-hidden="true"/>{item.actionLabel}</span>
      </div>
      {item.detail&&<p>{item.detail}</p>}
    </div>
    <time dateTime={item.createdAt}>{auditDate(item.createdAt,locale)}</time>
  </article>;
}

function AdminPanelHeader({id,eyebrow,title,description,query,onQuery,placeholder,count,total,countKey}){
  const {t}=useI18n();
  const totalText=t(countKey,{count:total});
  const countText=count===total?totalText:`${count} / ${totalText}`;
  return <div className="admin-panel-head">
    <div className="admin-panel-copy">
      <span>{eyebrow}</span>
      <h2 id={`${id}-title`}>{title}</h2>
      <p>{description}</p>
    </div>
    <div className="admin-panel-tools">
      <label className="admin-panel-search" htmlFor={`${id}-search`}>
        <Search/>
        <span className="sr-only">{placeholder}</span>
        <input id={`${id}-search`} type="search" value={query} onChange={event=>onQuery(event.target.value)} placeholder={placeholder} autoComplete="off"/>
      </label>
      <output aria-live="polite">{countText}</output>
    </div>
  </div>;
}

function AdminPagination({page,totalPages,start,end,totalItems,onPageChange,label}){
  const {t}=useI18n();
  return <nav className="admin-pagination" aria-label={t('admin.paginationAria',{label})}>
    <p>{totalItems?t('admin.pagination.range',{start,end,total:totalItems}):t('admin.pagination.empty')}</p>
    <div>
      <button type="button" onClick={()=>onPageChange(page-1)} disabled={page<=1} aria-label={t('admin.pagination.previous',{label})}>
        <ChevronLeft/>
      </button>
      <span aria-current="page">{t('admin.pagination.page',{page,pages:totalPages})}</span>
      <button type="button" onClick={()=>onPageChange(page+1)} disabled={page>=totalPages} aria-label={t('admin.pagination.next',{label})}>
        <ChevronRight/>
      </button>
    </div>
  </nav>;
}

function AccountSimulator({accounts,refresh,onNotice,search}){
  const {locale,t,translateApiError}=useI18n();
  const [form,setForm]=useState({displayName:'',note:''});
  const [attempted,setAttempted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [startingId,setStartingId]=useState('');
  const [error,setError]=useState('');
  const [startError,setStartError]=useState(null);
  const displayName=form.displayName.trim();
  const displayNameLength=Array.from(displayName).length;
  const displayNameError=attempted&&(displayNameLength<1||displayNameLength>40)?t('admin.simulator.validationName'):'';
  const noteLength=Array.from(form.note).length;

  const update=(field,value)=>{
    setForm(current=>({...current,[field]:value}));
    setError('');
  };
  const submit=async event=>{
    event.preventDefault();
    setAttempted(true);
    if(displayNameLength<1||displayNameLength>40||noteLength>120)return;
    setBusy(true);
    setError('');
    try{
      await adminApi('/api/admin/simulated-accounts',{method:'POST',body:JSON.stringify({displayName,note:form.note})});
      setForm({displayName:'',note:''});
      setAttempted(false);
      await refresh();
      onNotice(t('admin.simulator.created',{name:displayName}));
    }catch(createError){setError(translateApiError(createError.message))}
    finally{setBusy(false)}
  };
  const start=async account=>{
    setStartingId(account.id);
    setStartError(null);
    try{
      await adminApi(`/api/admin/simulated-accounts/${account.id}/session`,{method:'POST'});
      location.assign('/app');
    }catch(startAccountError){
      setStartError({accountId:account.id,message:translateApiError(startAccountError.message)});
      setStartingId('');
    }
  };

  return <div className="admin-account-simulator">
    <div className="admin-simulator-body">
      <form className="admin-simulator-form" onSubmit={submit} noValidate>
        <div className="admin-simulator-card-title"><span><UserPlus/></span><div><h3>{t('admin.simulator.createTitle')}</h3><p>{t('admin.simulator.createDescription')}</p></div></div>
        <div className="admin-simulator-field">
          <label htmlFor="simulated-display-name">{t('admin.simulator.displayName')} <b aria-hidden="true">*</b></label>
          <input id="simulated-display-name" value={form.displayName} onChange={event=>update('displayName',event.target.value)} onBlur={()=>setAttempted(true)} maxLength="40" placeholder={t('admin.simulator.displayNamePlaceholder')} autoComplete="off" required aria-required="true" disabled={busy} aria-invalid={Boolean(displayNameError)} aria-describedby={displayNameError?'simulated-display-name-error':'simulated-display-name-help'}/>
          {displayNameError?<small id="simulated-display-name-error" className="admin-simulator-field-error" role="alert">{displayNameError}</small>:<small id="simulated-display-name-help">{t('admin.simulator.displayNameHelp')}</small>}
        </div>
        <div className="admin-simulator-field">
          <label htmlFor="simulated-note">{t('admin.simulator.note')} <i aria-hidden="true">{noteLength}/120</i></label>
          <textarea id="simulated-note" value={form.note} onChange={event=>update('note',event.target.value)} maxLength="120" rows="3" placeholder={t('admin.simulator.notePlaceholder')} disabled={busy} aria-describedby="simulated-note-help"/>
          <small id="simulated-note-help">{t('admin.simulator.noteHelp')}</small>
        </div>
        {error&&<p className="admin-simulator-error" role="alert"><AlertCircle/>{error}</p>}
        <button className="admin-simulator-submit" disabled={busy}>
          {busy?<LoaderCircle/>:<UserPlus/>}{t(busy?'admin.simulator.creating':'admin.simulator.create')}
        </button>
      </form>

      <section className="admin-simulator-list" aria-label={t('admin.simulator.listAria')}>
        <div className="admin-simulator-list-head"><div><h3>{t('admin.simulator.available')}</h3><p>{t('admin.simulator.availableDescription')}</p></div><span><Info/>{t('admin.simulator.testOnly')}</span></div>
        <div className="admin-simulator-accounts">
          {accounts.map(account=><article key={account.id}>
            <div className="admin-simulator-identity"><AdminAvatar user={account} size={44}/><div><b>{account.displayName}</b><small>{account.note||t('admin.simulator.noNote')}</small></div></div>
            <dl>
              <div><dt>{t('admin.simulator.groups')}</dt><dd>{t('admin.simulator.groupCount',{count:account.groupCount})}</dd></div>
              <div><dt>{t('admin.simulator.creator')}</dt><dd>{account.createdByName||t('admin.simulator.systemAdmin')}</dd></div>
              <div><dt>{t('admin.simulator.createdAt')}</dt><dd><time dateTime={account.createdAt}>{date(account.createdAt,locale)}</time></dd></div>
            </dl>
            {startError?.accountId===account.id&&<p className="admin-simulator-start-error" role="alert"><AlertCircle/>{startError.message}</p>}
            <button type="button" onClick={()=>start(account)} disabled={Boolean(startingId)} aria-label={t('admin.simulator.startAria',{name:account.displayName})}>
              {startingId===account.id?<LoaderCircle/>:<Play/>}{t(startingId===account.id?'admin.simulator.switching':'admin.simulator.enter')}
            </button>
          </article>)}
          {!accounts.length&&<div className="admin-empty"><FlaskConical/><p>{t(search?'admin.simulator.notFound':'admin.simulator.empty',{query:search})}</p></div>}
        </div>
      </section>
    </div>
  </div>;
}

export function AdminConsole({me,onExit,onLogout,onOpenGroup}){
  const {language,locale,t,translateApiError}=useI18n();
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [updating,setUpdating]=useState('');
  const [notice,setNotice]=useState('');
  const [activeTab,setActiveTab]=useState('users');
  const [queries,setQueries]=useState(initialQueries);
  const [pages,setPages]=useState(initialPages);
  const [pendingRoleChange,setPendingRoleChange]=useState(null);
  const [roleError,setRoleError]=useState('');
  const deferredQueries=useDeferredValue(queries);

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    try{setData(await adminApi('/api/admin/overview'))}
    catch(loadError){setError(translateApiError(loadError.message))}
    finally{setLoading(false)}
  },[translateApiError]);

  useEffect(()=>{document.title=t('admin.documentTitle')},[language,t]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer)},[notice]);

  const sourceItems=useMemo(()=>({
    users:data?.users||[],
    simulations:data?.simulatedAccounts||[],
    groups:data?.groups||[],
    audit:(data?.auditLog||[]).map(item=>presentAuditItem(item,{language}))
  }),[data,language]);
  const filteredItems=useMemo(()=>({
    users:filterAdminItems('users',sourceItems.users,deferredQueries.users),
    simulations:filterAdminItems('simulations',sourceItems.simulations,deferredQueries.simulations),
    groups:filterAdminItems('groups',sourceItems.groups,deferredQueries.groups),
    audit:filterAdminItems('audit',sourceItems.audit,deferredQueries.audit)
  }),[sourceItems,deferredQueries]);
  const paginatedItems=useMemo(()=>({
    users:paginateAdminItems(filteredItems.users,pages.users,pageSizes.users),
    simulations:paginateAdminItems(filteredItems.simulations,pages.simulations,pageSizes.simulations),
    groups:paginateAdminItems(filteredItems.groups,pages.groups,pageSizes.groups),
    audit:paginateAdminItems(filteredItems.audit,pages.audit,pageSizes.audit)
  }),[filteredItems,pages]);

  const updateQuery=(tab,value)=>{
    setQueries(current=>({...current,[tab]:value}));
    setPages(current=>({...current,[tab]:1}));
  };
  const updatePage=(tab,page)=>setPages(current=>({...current,[tab]:page}));
  const activateTab=tab=>{
    setActiveTab(tab);
    requestAnimationFrame(()=>document.getElementById(`admin-tab-${tab}`)?.focus());
  };
  const handleTabKeyDown=(event,tab)=>{
    const currentIndex=adminTabs.findIndex(item=>item.id===tab);
    let nextIndex;
    if(event.key==='ArrowRight')nextIndex=(currentIndex+1)%adminTabs.length;
    else if(event.key==='ArrowLeft')nextIndex=(currentIndex-1+adminTabs.length)%adminTabs.length;
    else if(event.key==='Home')nextIndex=0;
    else if(event.key==='End')nextIndex=adminTabs.length-1;
    else return;
    event.preventDefault();
    activateTab(adminTabs[nextIndex].id);
  };

  const requestSuperuserUpdate=user=>{
    const target={id:user.id,displayName:user.displayName,isSuperuser:Boolean(user.isSuperuser)};
    setError('');
    setRoleError('');
    setPendingRoleChange({user:target,...roleChangeConfirmation(target,{language})});
  };
  const closeRoleConfirmation=()=>{if(updating)return;setRoleError('');setPendingRoleChange(null)};
  const updateSuperuser=async()=>{
    if(!pendingRoleChange||updating)return;
    const {user,nextValue,action}=pendingRoleChange;
    setUpdating(user.id);
    setError('');
    setRoleError('');
    try{
      await adminApi(`/api/admin/users/${user.id}/superuser`,{method:'PATCH',body:JSON.stringify({isSuperuser:nextValue})});
      await load();
      setNotice(t('admin.users.notice',{action,name:user.displayName}));
      setPendingRoleChange(null);
    }catch(updateError){setRoleError(translateApiError(updateError.message))}
    finally{setUpdating('')}
  };

  const tabCounts={
    users:sourceItems.users.length,
    simulations:sourceItems.simulations.length,
    groups:sourceItems.groups.length,
    audit:sourceItems.audit.length
  };
  const panelHeaderProps=(tab,details)=>({
    id:`admin-${tab}`,
    query:queries[tab],
    onQuery:value=>updateQuery(tab,value),
    count:filteredItems[tab].length,
    total:sourceItems[tab].length,
    countKey:adminTabs.find(item=>item.id===tab).countKey,
    ...details
  });
  const paginationProps=tab=>({
    ...paginatedItems[tab],
    onPageChange:page=>updatePage(tab,page),
    label:t(adminTabs.find(item=>item.id===tab).labelKey)
  });

  return <div className="admin-shell">
    <aside className="admin-side" aria-label={t('admin.tabsAria')}>
      <BrandLogo/>
      <div className="admin-account"><AdminAvatar user={me} size={44}/><div><b>{me.displayName}</b><span><ShieldCheck/>{t('admin.administrator')}</span></div></div>
      <div className="admin-side-mode"><ShieldCheck/><div><b>{t('admin.mode')}</b><span>{t('admin.modeDescription')}</span></div></div>
      <div className="admin-side-footer">
        <LanguageSwitcher className="admin-side-language"/>
        <button onClick={onExit}><ArrowLeft/>{t('admin.returnStandard')}</button>
        <button onClick={onLogout}><LogOut/>{t('admin.logout')}</button>
      </div>
    </aside>
    <section className="admin-workspace">
      <header>
        <BrandMark className="admin-mobile-mark"/>
        <div><small>TripTab Administration</small><h1>{t('admin.title')}</h1></div>
        <LanguageSwitcher className="admin-header-language"/>
        <button className="admin-refresh" onClick={load} disabled={loading} aria-label={t('admin.refresh')}>{loading?<LoaderCircle/>:<RefreshCcw/>}</button>
        <button className="admin-mobile-exit" onClick={onExit}><ArrowLeft/><span>{t('admin.return')}</span></button>
      </header>
      <main className="admin-main">
        {error&&<div className="admin-alert" role="alert"><AlertCircle/><span>{error}</span><button onClick={()=>setError('')} aria-label={t('admin.closeError')}>×</button></div>}
        {loading&&!data?<div className="admin-loading" aria-busy="true"><LoaderCircle/><p>{t('admin.loading')}</p></div>:data&&<>
          <section className="admin-stats" aria-label={t('admin.statsAria')}>
            <article><span><Users/></span><div><small>{t('admin.stats.users')}</small><b>{data.stats.userCount.toLocaleString(locale)}</b></div></article>
            <article><span><ShieldCheck/></span><div><small>{t('admin.stats.administrators')}</small><b>{data.stats.superuserCount.toLocaleString(locale)}</b></div></article>
            <article><span><Building2/></span><div><small>{t('admin.stats.groups')}</small><b>{data.stats.groupCount.toLocaleString(locale)}</b></div></article>
            <article><span><History/></span><div><small>{t('admin.stats.expenses')}</small><b>{data.stats.expenseCount.toLocaleString(locale)}</b></div></article>
          </section>

          <nav className="admin-tabs" role="tablist" aria-label={t('admin.tabsAria')}>
            {adminTabs.map(({id,labelKey,icon:Icon})=><button key={id} id={`admin-tab-${id}`} type="button" role="tab" aria-selected={activeTab===id} aria-controls={`admin-panel-${id}`} tabIndex={activeTab===id?0:-1} onClick={()=>activateTab(id)} onKeyDown={event=>handleTabKeyDown(event,id)}>
              <Icon/><span>{t(labelKey)}</span><b>{tabCounts[id].toLocaleString(locale)}</b>
            </button>)}
          </nav>

          <section className="admin-panel admin-tab-panel" id="admin-panel-users" role="tabpanel" aria-labelledby="admin-tab-users" tabIndex="0" hidden={activeTab!=='users'}>
            <AdminPanelHeader {...panelHeaderProps('users',{eyebrow:t('admin.panel.users.eyebrow'),title:t('admin.tab.users'),description:t('admin.panel.users.description'),placeholder:t('admin.panel.users.search')})}/>
            <div className="admin-user-table">
              <div className="admin-table-head" aria-hidden="true"><span>{t('admin.users.column.user')}</span><span>{t('admin.users.column.groups')}</span><span>{t('admin.users.column.created')}</span><span>{t('admin.users.column.role')}</span><span>{t('admin.users.column.actions')}</span></div>
              {paginatedItems.users.items.map(user=><article key={user.id}>
                <div className="admin-user-name"><AdminAvatar user={user}/><div><b>{user.displayName}</b><small>{user.id}</small></div></div>
                <span data-label={t('admin.users.column.groups')}>{t('admin.users.groupCount',{count:user.groupCount})}</span>
                <time data-label={t('admin.users.column.created')} dateTime={user.createdAt}>{date(user.createdAt,locale)}</time>
                <span className={`admin-role ${user.isSuperuser?'is-superuser':''}`}><ShieldCheck/>{t(user.isSuperuser?'admin.administrator':'admin.users.standard')}</span>
                <button className={user.isSuperuser?'admin-role-remove':'admin-role-grant'} disabled={updating===user.id||user.id===me.id} onClick={()=>requestSuperuserUpdate(user)}>
                  {updating===user.id?<LoaderCircle/>:<ShieldCheck/>}
                  {t(user.id===me.id?'admin.users.current':user.isSuperuser?'admin.users.removeAdmin':'admin.users.grantAdmin')}
                </button>
              </article>)}
              {!paginatedItems.users.items.length&&<div className="admin-empty"><Search/><p>{t(queries.users?'admin.users.notFound':'admin.users.empty',{query:queries.users})}</p></div>}
            </div>
            <AdminPagination {...paginationProps('users')}/>
          </section>

          <section className="admin-panel admin-tab-panel" id="admin-panel-simulations" role="tabpanel" aria-labelledby="admin-tab-simulations" tabIndex="0" hidden={activeTab!=='simulations'}>
            <AdminPanelHeader {...panelHeaderProps('simulations',{eyebrow:t('admin.panel.simulations.eyebrow'),title:t('admin.tab.simulations'),description:t('admin.panel.simulations.description'),placeholder:t('admin.panel.simulations.search')})}/>
            <AccountSimulator accounts={paginatedItems.simulations.items} refresh={load} onNotice={setNotice} search={queries.simulations}/>
            <AdminPagination {...paginationProps('simulations')}/>
          </section>

          <section className="admin-panel admin-tab-panel" id="admin-panel-groups" role="tabpanel" aria-labelledby="admin-tab-groups" tabIndex="0" hidden={activeTab!=='groups'}>
            <AdminPanelHeader {...panelHeaderProps('groups',{eyebrow:t('admin.panel.groups.eyebrow'),title:t('admin.tab.groups'),description:t('admin.panel.groups.description'),placeholder:t('admin.panel.groups.search')})}/>
            <div className="admin-group-table">
              <div className="admin-table-head" aria-hidden="true"><span>{t('admin.groups.column.group')}</span><span>{t('admin.groups.column.owner')}</span><span>{t('admin.groups.column.members')}</span><span>{t('admin.groups.column.expenses')}</span><span>{t('admin.groups.column.total')}</span><span>{t('admin.groups.column.created')}</span><span>{t('admin.groups.column.actions')}</span></div>
              {paginatedItems.groups.items.map(group=><article key={group.id}>
                <div className="admin-group-name"><span><Building2/></span><div><b>{group.name} <em className="admin-group-currency">{group.currency||'TWD'}</em></b><small>{group.description||t('admin.groups.noDescription')}</small></div></div>
                <span data-label={t('admin.groups.column.owner')}>{group.ownerName}</span>
                <span data-label={t('admin.groups.column.members')}>{t('admin.groups.memberCount',{count:group.memberCount})}</span>
                <span data-label={t('admin.groups.column.expenses')}>{t('admin.groups.expenseCount',{count:group.expenseCount})}</span>
                <strong data-label={t('admin.groups.totalLabel',{currency:group.currency||'TWD'})}>{money(group.totalCents,group.currency)}</strong>
                <time data-label={t('admin.groups.column.created')} dateTime={group.createdAt}>{date(group.createdAt,locale)}</time>
                <button className="admin-open-group" onClick={()=>onOpenGroup(group)}>{t('admin.groups.open')}<ArrowRight/></button>
              </article>)}
              {!paginatedItems.groups.items.length&&<div className="admin-empty"><Search/><p>{t(queries.groups?'admin.groups.notFound':'admin.groups.empty',{query:queries.groups})}</p></div>}
            </div>
            <AdminPagination {...paginationProps('groups')}/>
          </section>

          <section className="admin-panel admin-tab-panel" id="admin-panel-audit" role="tabpanel" aria-labelledby="admin-tab-audit" tabIndex="0" hidden={activeTab!=='audit'}>
            <AdminPanelHeader {...panelHeaderProps('audit',{eyebrow:t('admin.panel.audit.eyebrow'),title:t('admin.tab.audit'),description:t('admin.panel.audit.description'),placeholder:t('admin.panel.audit.search')})}/>
            <div className="admin-audit-list">
              {paginatedItems.audit.items.map(item=><AuditLogItem key={item.id} item={item}/>)}
              {!paginatedItems.audit.items.length&&<div className="admin-empty"><Check/><p>{t(queries.audit?'admin.audit.notFound':'admin.audit.empty',{query:queries.audit})}</p></div>}
            </div>
            <AdminPagination {...paginationProps('audit')}/>
          </section>
        </>}
      </main>
    </section>
    {notice&&<button type="button" className="admin-toast" onClick={()=>setNotice('')} aria-live="polite"><Check/>{notice}</button>}
    {pendingRoleChange&&<ConfirmModal title={pendingRoleChange.title} description={pendingRoleChange.description} confirmLabel={pendingRoleChange.confirmLabel} tone={pendingRoleChange.tone} busy={updating===pendingRoleChange.user.id} error={roleError} onCancel={closeRoleConfirmation} onConfirm={updateSuperuser}/>}
  </div>;
}
