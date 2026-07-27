import React,{useCallback,useDeferredValue,useEffect,useMemo,useState} from 'react';
import {AlertCircle,ArrowLeft,ArrowRight,Building2,Check,ChevronLeft,ChevronRight,FlaskConical,History,Info,LoaderCircle,LogOut,Pencil,Play,Plus,RefreshCcw,Search,ShieldCheck,Trash2,UserPlus,Users} from './ui-icons.jsx';
import {BrandLogo,BrandMark} from './BrandLogo.jsx';
import {ConfirmModal} from './ConfirmModal.jsx';
import {roleChangeConfirmation} from './confirmation-actions.mjs';
import {filterAdminItems,paginateAdminItems} from './admin-list-state.mjs';
import {presentAuditItem} from './audit-log.mjs';

const adminApi=async(url,options={})=>{
  const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'管理資料讀取失敗');
  return data;
};

const money=cents=>`NT$ ${Math.round(Number(cents||0)/100).toLocaleString()}`;
const date=value=>new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium'}).format(new Date(value));
const auditDate=value=>new Intl.DateTimeFormat('zh-TW',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const adminTabs=[
  {id:'users',label:'使用者管理',icon:Users,unit:'位'},
  {id:'simulations',label:'帳戶模擬',icon:FlaskConical,unit:'個'},
  {id:'groups',label:'群組清單',icon:Building2,unit:'個'},
  {id:'audit',label:'稽核紀錄',icon:History,unit:'筆'}
];
const pageSizes={users:10,simulations:6,groups:8,audit:12};
const initialQueries={users:'',simulations:'',groups:'',audit:''};
const initialPages={users:1,simulations:1,groups:1,audit:1};

function AdminAvatar({user,size=38}){
  return user?.pictureUrl
    ?<img className="admin-avatar" src={user.pictureUrl} alt={user.displayName||'使用者'} style={{width:size,height:size}} referrerPolicy="no-referrer"/>
    :<span className="admin-avatar admin-avatar-initial" style={{width:size,height:size}} aria-label={user?.displayName||'使用者'}>{user?.displayName?.slice(0,1)||'旅'}</span>;
}

const auditIcons={create:Plus,update:Pencil,delete:Trash2,join:UserPlus,settlement:Check,system:History};
function AuditLogItem({item}){
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
    <time dateTime={item.createdAt}>{auditDate(item.createdAt)}</time>
  </article>;
}

function AdminPanelHeader({id,eyebrow,title,description,query,onQuery,placeholder,count,total,unit}){
  const countText=count===total?`${total} ${unit}`:`${count} / ${total} ${unit}`;
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
  return <nav className="admin-pagination" aria-label={`${label}分頁`}>
    <p>{totalItems?`顯示第 ${start}–${end} 筆，共 ${totalItems} 筆`:'目前沒有資料'}</p>
    <div>
      <button type="button" onClick={()=>onPageChange(page-1)} disabled={page<=1} aria-label={`上一頁：${label}`}>
        <ChevronLeft/>
      </button>
      <span aria-current="page">第 <b>{page}</b> / {totalPages} 頁</span>
      <button type="button" onClick={()=>onPageChange(page+1)} disabled={page>=totalPages} aria-label={`下一頁：${label}`}>
        <ChevronRight/>
      </button>
    </div>
  </nav>;
}

function AccountSimulator({accounts,refresh,onNotice,search}){
  const [form,setForm]=useState({displayName:'',note:''});
  const [attempted,setAttempted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [startingId,setStartingId]=useState('');
  const [error,setError]=useState('');
  const [startError,setStartError]=useState(null);
  const displayName=form.displayName.trim();
  const displayNameLength=Array.from(displayName).length;
  const displayNameError=attempted&&(displayNameLength<1||displayNameLength>40)?'請輸入 1–40 個字的顯示名稱':'';
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
      onNotice(`已建立模擬帳號：${displayName}`);
    }catch(createError){setError(createError.message)}
    finally{setBusy(false)}
  };
  const start=async account=>{
    setStartingId(account.id);
    setStartError(null);
    try{
      await adminApi(`/api/admin/simulated-accounts/${account.id}/session`,{method:'POST'});
      location.assign('/app');
    }catch(startAccountError){
      setStartError({accountId:account.id,message:startAccountError.message});
      setStartingId('');
    }
  };

  return <div className="admin-account-simulator">
    <div className="admin-simulator-body">
      <form className="admin-simulator-form" onSubmit={submit} noValidate>
        <div className="admin-simulator-card-title"><span><UserPlus/></span><div><h3>建立虛擬帳號</h3><p>帳號只會存在 TripTab，並與真實使用者及真實群組隔離</p></div></div>
        <div className="admin-simulator-field">
          <label htmlFor="simulated-display-name">顯示名稱 <b aria-hidden="true">*</b></label>
          <input id="simulated-display-name" value={form.displayName} onChange={event=>update('displayName',event.target.value)} onBlur={()=>setAttempted(true)} maxLength="40" placeholder="例如：測試旅伴 A" autoComplete="off" required aria-required="true" disabled={busy} aria-invalid={Boolean(displayNameError)} aria-describedby={displayNameError?'simulated-display-name-error':'simulated-display-name-help'}/>
          {displayNameError?<small id="simulated-display-name-error" className="admin-simulator-field-error" role="alert">{displayNameError}</small>:<small id="simulated-display-name-help">建立後仍可像一般旅伴使用分帳功能</small>}
        </div>
        <div className="admin-simulator-field">
          <label htmlFor="simulated-note">使用情境 <i aria-hidden="true">{noteLength}/120</i></label>
          <textarea id="simulated-note" value={form.note} onChange={event=>update('note',event.target.value)} maxLength="120" rows="3" placeholder="例如：測試五人日本旅行的分攤流程" disabled={busy} aria-describedby="simulated-note-help"/>
          <small id="simulated-note-help">選填，方便日後辨識這個帳號的測試用途</small>
        </div>
        {error&&<p className="admin-simulator-error" role="alert"><AlertCircle/>{error}</p>}
        <button className="admin-simulator-submit" disabled={busy}>
          {busy?<LoaderCircle/>:<UserPlus/>}{busy?'建立中…':'建立虛擬帳號'}
        </button>
      </form>

      <section className="admin-simulator-list" aria-label="虛擬帳號清單">
        <div className="admin-simulator-list-head"><div><h3>可用帳號</h3><p>進入後會顯示持續狀態列，可隨時安全返回管理帳號</p></div><span><Info/>僅限測試群組</span></div>
        <div className="admin-simulator-accounts">
          {accounts.map(account=><article key={account.id}>
            <div className="admin-simulator-identity"><AdminAvatar user={account} size={44}/><div><b>{account.displayName}</b><small>{account.note||'尚未填寫使用情境'}</small></div></div>
            <dl>
              <div><dt>群組</dt><dd>{account.groupCount} 個</dd></div>
              <div><dt>建立者</dt><dd>{account.createdByName||'系統管理者'}</dd></div>
              <div><dt>建立時間</dt><dd><time dateTime={account.createdAt}>{date(account.createdAt)}</time></dd></div>
            </dl>
            {startError?.accountId===account.id&&<p className="admin-simulator-start-error" role="alert"><AlertCircle/>{startError.message}</p>}
            <button type="button" onClick={()=>start(account)} disabled={Boolean(startingId)} aria-label={`以 ${account.displayName} 開始帳戶模擬`}>
              {startingId===account.id?<LoaderCircle/>:<Play/>}{startingId===account.id?'切換中…':'進入模擬'}
            </button>
          </article>)}
          {!accounts.length&&<div className="admin-empty"><FlaskConical/><p>{search?`找不到符合「${search}」的模擬帳號`:'尚未建立虛擬帳號，請先建立第一個測試旅伴'}</p></div>}
        </div>
      </section>
    </div>
  </div>;
}

export function AdminConsole({me,onExit,onLogout,onOpenGroup}){
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
    catch(loadError){setError(loadError.message)}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{load()},[load]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer)},[notice]);

  const sourceItems=useMemo(()=>({
    users:data?.users||[],
    simulations:data?.simulatedAccounts||[],
    groups:data?.groups||[],
    audit:(data?.auditLog||[]).map(presentAuditItem)
  }),[data]);
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
    setPendingRoleChange({user:target,...roleChangeConfirmation(target)});
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
      setNotice(`已${action}：${user.displayName}`);
      setPendingRoleChange(null);
    }catch(updateError){setRoleError(updateError.message)}
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
    unit:adminTabs.find(item=>item.id===tab).unit,
    ...details
  });
  const paginationProps=tab=>({
    ...paginatedItems[tab],
    onPageChange:page=>updatePage(tab,page),
    label:adminTabs.find(item=>item.id===tab).label
  });

  return <div className="admin-shell">
    <aside className="admin-side" aria-label="管理者功能">
      <BrandLogo/>
      <div className="admin-account"><AdminAvatar user={me} size={44}/><div><b>{me.displayName}</b><span><ShieldCheck/>管理者</span></div></div>
      <div className="admin-side-mode"><ShieldCheck/><div><b>管理者模式</b><span>系統資料與測試工具</span></div></div>
      <div className="admin-side-footer">
        <button onClick={onExit}><ArrowLeft/>返回一般模式</button>
        <button onClick={onLogout}><LogOut/>登出</button>
      </div>
    </aside>
    <section className="admin-workspace">
      <header>
        <BrandMark className="admin-mobile-mark"/>
        <div><small>TripTab Administration</small><h1>管理者中心</h1></div>
        <button className="admin-refresh" onClick={load} disabled={loading} aria-label="重新整理管理資料">{loading?<LoaderCircle/>:<RefreshCcw/>}</button>
        <button className="admin-mobile-exit" onClick={onExit}><ArrowLeft/><span>返回</span></button>
      </header>
      <main className="admin-main">
        {error&&<div className="admin-alert" role="alert"><AlertCircle/><span>{error}</span><button onClick={()=>setError('')} aria-label="關閉錯誤訊息">×</button></div>}
        {loading&&!data?<div className="admin-loading" aria-busy="true"><LoaderCircle/><p>正在整理管理資料…</p></div>:data&&<>
          <section className="admin-stats" aria-label="系統統計">
            <article><span><Users/></span><div><small>真實使用者</small><b>{data.stats.userCount.toLocaleString()}</b></div></article>
            <article><span><ShieldCheck/></span><div><small>管理者帳號</small><b>{data.stats.superuserCount.toLocaleString()}</b></div></article>
            <article><span><Building2/></span><div><small>分帳群組</small><b>{data.stats.groupCount.toLocaleString()}</b></div></article>
            <article><span><History/></span><div><small>支出紀錄</small><b>{data.stats.expenseCount.toLocaleString()}</b></div></article>
          </section>

          <nav className="admin-tabs" role="tablist" aria-label="管理者功能">
            {adminTabs.map(({id,label,icon:Icon})=><button key={id} id={`admin-tab-${id}`} type="button" role="tab" aria-selected={activeTab===id} aria-controls={`admin-panel-${id}`} tabIndex={activeTab===id?0:-1} onClick={()=>activateTab(id)} onKeyDown={event=>handleTabKeyDown(event,id)}>
              <Icon/><span>{label}</span><b>{tabCounts[id].toLocaleString()}</b>
            </button>)}
          </nav>

          <section className="admin-panel admin-tab-panel" id="admin-panel-users" role="tabpanel" aria-labelledby="admin-tab-users" tabIndex="0" hidden={activeTab!=='users'}>
            <AdminPanelHeader {...panelHeaderProps('users',{eyebrow:'帳號與權限',title:'使用者管理',description:'授予管理權限前請先核對顯示名稱與加入時間',placeholder:'搜尋名稱、使用者 ID 或角色'})}/>
            <div className="admin-user-table">
              <div className="admin-table-head" aria-hidden="true"><span>使用者</span><span>加入群組</span><span>建立時間</span><span>系統角色</span><span>操作</span></div>
              {paginatedItems.users.items.map(user=><article key={user.id}>
                <div className="admin-user-name"><AdminAvatar user={user}/><div><b>{user.displayName}</b><small>{user.id}</small></div></div>
                <span data-label="加入群組">{user.groupCount} 個</span>
                <time data-label="建立時間" dateTime={user.createdAt}>{date(user.createdAt)}</time>
                <span className={`admin-role ${user.isSuperuser?'is-superuser':''}`}><ShieldCheck/>{user.isSuperuser?'管理者':'一般使用者'}</span>
                <button className={user.isSuperuser?'admin-role-remove':'admin-role-grant'} disabled={updating===user.id||user.id===me.id} onClick={()=>requestSuperuserUpdate(user)}>
                  {updating===user.id?<LoaderCircle/>:<ShieldCheck/>}
                  {user.id===me.id?'目前帳號':user.isSuperuser?'移除管理權限':'設為管理者'}
                </button>
              </article>)}
              {!paginatedItems.users.items.length&&<div className="admin-empty"><Search/><p>{queries.users?`找不到符合「${queries.users}」的使用者`:'目前沒有使用者資料'}</p></div>}
            </div>
            <AdminPagination {...paginationProps('users')}/>
          </section>

          <section className="admin-panel admin-tab-panel" id="admin-panel-simulations" role="tabpanel" aria-labelledby="admin-tab-simulations" tabIndex="0" hidden={activeTab!=='simulations'}>
            <AdminPanelHeader {...panelHeaderProps('simulations',{eyebrow:'隔離測試環境',title:'帳戶模擬',description:'建立不需綁定 LINE 的虛擬旅伴，實際走過建群、記帳與結算流程',placeholder:'搜尋名稱、用途或建立者'})}/>
            <AccountSimulator accounts={paginatedItems.simulations.items} refresh={load} onNotice={setNotice} search={queries.simulations}/>
            <AdminPagination {...paginationProps('simulations')}/>
          </section>

          <section className="admin-panel admin-tab-panel" id="admin-panel-groups" role="tabpanel" aria-labelledby="admin-tab-groups" tabIndex="0" hidden={activeTab!=='groups'}>
            <AdminPanelHeader {...panelHeaderProps('groups',{eyebrow:'全站帳本',title:'群組清單',description:'用於客服排查與系統健康檢查，不會改變群組成員關係',placeholder:'搜尋群組、建立者、說明或群組 ID'})}/>
            <div className="admin-group-table">
              <div className="admin-table-head" aria-hidden="true"><span>群組</span><span>建立者</span><span>成員</span><span>支出</span><span>累計金額</span><span>建立時間</span><span>操作</span></div>
              {paginatedItems.groups.items.map(group=><article key={group.id}>
                <div className="admin-group-name"><span><Building2/></span><div><b>{group.name}</b><small>{group.description||'未填寫說明'}</small></div></div>
                <span data-label="建立者">{group.ownerName}</span>
                <span data-label="成員">{group.memberCount} 位</span>
                <span data-label="支出">{group.expenseCount} 筆</span>
                <strong data-label="累計金額">{money(group.totalCents)}</strong>
                <time data-label="建立時間" dateTime={group.createdAt}>{date(group.createdAt)}</time>
                <button className="admin-open-group" onClick={()=>onOpenGroup(group)}>開啟帳本<ArrowRight/></button>
              </article>)}
              {!paginatedItems.groups.items.length&&<div className="admin-empty"><Search/><p>{queries.groups?`找不到符合「${queries.groups}」的群組`:'目前沒有群組資料'}</p></div>}
            </div>
            <AdminPagination {...paginationProps('groups')}/>
          </section>

          <section className="admin-panel admin-tab-panel" id="admin-panel-audit" role="tabpanel" aria-labelledby="admin-tab-audit" tabIndex="0" hidden={activeTab!=='audit'}>
            <AdminPanelHeader {...panelHeaderProps('audit',{eyebrow:'異動軌跡',title:'稽核紀錄',description:'查看誰在何時對哪個群組、哪個項目進行新增、修改或刪除',placeholder:'搜尋人員、群組、項目或動作'})}/>
            <div className="admin-audit-list">
              {paginatedItems.audit.items.map(item=><AuditLogItem key={item.id} item={item}/>)}
              {!paginatedItems.audit.items.length&&<div className="admin-empty"><Check/><p>{queries.audit?`找不到符合「${queries.audit}」的稽核紀錄`:'目前沒有異動紀錄'}</p></div>}
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
