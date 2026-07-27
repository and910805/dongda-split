import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {AlertCircle,ArrowLeft,ArrowRight,Building2,Check,FlaskConical,History,Info,LoaderCircle,LogOut,Play,RefreshCcw,Search,ShieldCheck,UserPlus,Users} from 'lucide-react';
import {BrandLogo,BrandMark} from './BrandLogo.jsx';

const adminApi=async(url,options={})=>{
  const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'管理資料讀取失敗');
  return data;
};
const money=cents=>`NT$ ${Math.round(Number(cents||0)/100).toLocaleString()}`;
const date=value=>new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium'}).format(new Date(value));
const auditLabels={
  grant_superuser:'授予超級使用者權限',
  revoke_superuser:'移除超級使用者權限',
  update_expense:'以管理者身分修改支出',
  delete_expense:'以管理者身分刪除支出',
  delete_group:'以管理者身分刪除群組',
  create_simulated_account:'建立模擬帳號',
  start_account_simulation:'開始帳戶模擬',
  end_account_simulation:'結束帳戶模擬',
  simulation_action:'模擬帳號執行操作'
};

function AdminAvatar({user,size=38}){
  return user?.pictureUrl
    ?<img className="admin-avatar" src={user.pictureUrl} alt={user.displayName||'使用者'} style={{width:size,height:size}} referrerPolicy="no-referrer"/>
    :<span className="admin-avatar admin-avatar-initial" style={{width:size,height:size}} aria-label={user?.displayName||'使用者'}>{user?.displayName?.slice(0,1)||'旅'}</span>;
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
    }catch(startError){
      setStartError({accountId:account.id,message:startError.message});
      setStartingId('');
    }
  };

  return <section className="admin-panel admin-account-simulator" id="admin-simulations" aria-labelledby="admin-simulations-title">
    <div className="admin-panel-head"><div><span>隔離測試環境</span><h2 id="admin-simulations-title">帳戶模擬</h2><p>建立不需綁定 LINE 的虛擬旅伴，實際走過建群、記帳與結算流程</p></div><b>{accounts.length} 個</b></div>
    <div className="admin-simulator-body">
      <form className="admin-simulator-form" onSubmit={submit} noValidate>
        <div className="admin-simulator-card-title"><span><UserPlus/></span><div><h3>建立虛擬帳號</h3><p>帳號只會存在 TripTab，並與真實使用者及真實群組隔離。</p></div></div>
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
        <div className="admin-simulator-list-head"><div><h3>可用帳號</h3><p>進入後會顯示持續狀態列，可隨時安全返回管理帳號。</p></div><span><Info/>僅限測試群組</span></div>
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
  </section>;
}

export function AdminConsole({me,onExit,onLogout,onOpenGroup}){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [updating,setUpdating]=useState('');
  const [notice,setNotice]=useState('');
  const [activeSection,setActiveSection]=useState('admin-overview');

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    try{setData(await adminApi('/api/admin/overview'))}
    catch(loadError){setError(loadError.message)}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{load()},[load]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer)},[notice]);

  const normalized=search.trim().toLocaleLowerCase('zh-TW');
  const users=useMemo(()=>data?.users?.filter(user=>!normalized||user.displayName.toLocaleLowerCase('zh-TW').includes(normalized))||[],[data,normalized]);
  const groups=useMemo(()=>data?.groups?.filter(group=>!normalized||`${group.name} ${group.ownerName} ${group.description}`.toLocaleLowerCase('zh-TW').includes(normalized))||[],[data,normalized]);
  const simulatedAccounts=useMemo(()=>data?.simulatedAccounts?.filter(account=>!normalized||`${account.displayName} ${account.note} ${account.createdByName}`.toLocaleLowerCase('zh-TW').includes(normalized))||[],[data,normalized]);
  const goToSection=sectionId=>{
    setActiveSection(sectionId);
    document.querySelector(`#${sectionId}`)?.scrollIntoView({behavior:'smooth'});
  };

  const updateSuperuser=async user=>{
    const nextValue=!user.isSuperuser;
    const action=nextValue?'授予超級使用者權限':'移除超級使用者權限';
    if(!confirm(`確定要${action}給「${user.displayName}」嗎？`))return;
    setUpdating(user.id);
    setError('');
    try{
      await adminApi(`/api/admin/users/${user.id}/superuser`,{method:'PATCH',body:JSON.stringify({isSuperuser:nextValue})});
      await load();
      setNotice(`已${action}：${user.displayName}`);
    }catch(updateError){setError(updateError.message)}
    finally{setUpdating('')}
  };

  return <div className="admin-shell">
    <aside className="admin-side" aria-label="超級使用者導覽">
      <BrandLogo/>
      <div className="admin-account"><AdminAvatar user={me} size={44}/><div><b>{me.displayName}</b><span><ShieldCheck/>超級使用者</span></div></div>
      <nav>
        <button className={activeSection==='admin-overview'?'active':''} onClick={()=>goToSection('admin-overview')}><ShieldCheck/>系統總覽</button>
        <button className={activeSection==='admin-users'?'active':''} onClick={()=>goToSection('admin-users')}><Users/>使用者管理</button>
        <button className={activeSection==='admin-simulations'?'active':''} onClick={()=>goToSection('admin-simulations')}><FlaskConical/>帳戶模擬</button>
        <button className={activeSection==='admin-groups'?'active':''} onClick={()=>goToSection('admin-groups')}><Building2/>群組清單</button>
        <button className={activeSection==='admin-audit'?'active':''} onClick={()=>goToSection('admin-audit')}><History/>稽核紀錄</button>
      </nav>
      <div className="admin-side-footer">
        <button onClick={onExit}><ArrowLeft/>返回一般模式</button>
        <button onClick={onLogout}><LogOut/>登出</button>
      </div>
    </aside>
    <section className="admin-workspace">
      <header>
        <BrandMark className="admin-mobile-mark"/>
        <div><small>TripTab Administration</small><h1>超級使用者管理中心</h1></div>
        <label className="admin-search"><Search/><span className="sr-only">搜尋使用者、模擬帳號或群組</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜尋使用者、模擬帳號或群組"/></label>
        <button className="admin-refresh" onClick={load} disabled={loading} aria-label="重新整理管理資料">{loading?<LoaderCircle/>:<RefreshCcw/>}</button>
        <button className="admin-mobile-exit" onClick={onExit}><ArrowLeft/><span>返回</span></button>
      </header>
      <main className="admin-main">
        <label className="admin-mobile-nav"><span>管理功能</span><select value={activeSection} onChange={event=>goToSection(event.target.value)}><option value="admin-overview">系統總覽</option><option value="admin-users">使用者管理</option><option value="admin-simulations">帳戶模擬</option><option value="admin-groups">群組清單</option><option value="admin-audit">稽核紀錄</option></select></label>
        <section className="admin-intro" id="admin-overview">
          <div><span className="admin-eyebrow"><ShieldCheck/>管理模式已啟用</span><h2>掌握系統狀態，處理需要協助的帳本</h2><p>所有權限操作都由伺服器驗證並留下稽核紀錄。一般使用者不會看到這個管理入口。</p></div>
          <button onClick={onExit}><ArrowLeft/>回到我的旅帳</button>
        </section>
        {error&&<div className="admin-alert" role="alert"><AlertCircle/><span>{error}</span><button onClick={()=>setError('')} aria-label="關閉錯誤訊息">×</button></div>}
        {loading&&!data?<div className="admin-loading" aria-busy="true"><LoaderCircle/><p>正在整理管理資料…</p></div>:data&&<>
          <section className="admin-stats" aria-label="系統統計">
            <article><span><Users/></span><div><small>真實使用者</small><b>{data.stats.userCount.toLocaleString()}</b></div></article>
            <article><span><ShieldCheck/></span><div><small>超級使用者</small><b>{data.stats.superuserCount.toLocaleString()}</b></div></article>
            <article><span><Building2/></span><div><small>分帳群組</small><b>{data.stats.groupCount.toLocaleString()}</b></div></article>
            <article><span><History/></span><div><small>支出紀錄</small><b>{data.stats.expenseCount.toLocaleString()}</b></div></article>
          </section>

          <section className="admin-panel" id="admin-users" aria-labelledby="admin-users-title">
            <div className="admin-panel-head"><div><span>帳號與權限</span><h2 id="admin-users-title">使用者管理</h2><p>授予管理權限前請先核對顯示名稱與加入時間</p></div><b>{users.length} 位</b></div>
            <div className="admin-user-table">
              <div className="admin-table-head" aria-hidden="true"><span>使用者</span><span>加入群組</span><span>建立時間</span><span>系統角色</span><span>操作</span></div>
              {users.map(user=><article key={user.id}>
                <div className="admin-user-name"><AdminAvatar user={user}/><div><b>{user.displayName}</b><small>{user.id}</small></div></div>
                <span data-label="加入群組">{user.groupCount} 個</span>
                <time data-label="建立時間" dateTime={user.createdAt}>{date(user.createdAt)}</time>
                <span className={`admin-role ${user.isSuperuser?'is-superuser':''}`}><ShieldCheck/>{user.isSuperuser?'超級使用者':'一般使用者'}</span>
                <button className={user.isSuperuser?'admin-role-remove':'admin-role-grant'} disabled={updating===user.id||user.id===me.id} onClick={()=>updateSuperuser(user)}>
                  {updating===user.id?<LoaderCircle/>:<ShieldCheck/>}
                  {user.id===me.id?'目前帳號':user.isSuperuser?'移除權限':'設為管理者'}
                </button>
              </article>)}
              {!users.length&&<div className="admin-empty"><Search/><p>找不到符合「{search}」的使用者</p></div>}
            </div>
          </section>

          <AccountSimulator accounts={simulatedAccounts} refresh={load} onNotice={setNotice} search={search}/>

          <section className="admin-panel" id="admin-groups" aria-labelledby="admin-groups-title">
            <div className="admin-panel-head"><div><span>全站帳本</span><h2 id="admin-groups-title">群組清單</h2><p>用於客服排查與系統健康檢查，不會改變群組成員關係</p></div><b>{groups.length} 個</b></div>
            <div className="admin-group-table">
              <div className="admin-table-head" aria-hidden="true"><span>群組</span><span>建立者</span><span>成員</span><span>支出</span><span>累計金額</span><span>建立時間</span><span>操作</span></div>
              {groups.map(group=><article key={group.id}>
                <div className="admin-group-name"><span><Building2/></span><div><b>{group.name}</b><small>{group.description||'未填寫說明'}</small></div></div>
                <span data-label="建立者">{group.ownerName}</span>
                <span data-label="成員">{group.memberCount} 位</span>
                <span data-label="支出">{group.expenseCount} 筆</span>
                <strong data-label="累計金額">{money(group.totalCents)}</strong>
                <time data-label="建立時間" dateTime={group.createdAt}>{date(group.createdAt)}</time>
                <button className="admin-open-group" onClick={()=>onOpenGroup(group)}>開啟帳本<ArrowRight/></button>
              </article>)}
              {!groups.length&&<div className="admin-empty"><Search/><p>找不到符合「{search}」的群組</p></div>}
            </div>
          </section>

          <section className="admin-panel" id="admin-audit" aria-labelledby="admin-audit-title">
            <div className="admin-panel-head"><div><span>安全紀錄</span><h2 id="admin-audit-title">稽核紀錄</h2><p>保留最近的管理權限與跨群組操作</p></div><b>{data.auditLog.length} 筆</b></div>
            <div className="admin-audit-list">
              {data.auditLog.map(item=><article key={item.id}><span><History/></span><div><b>{auditLabels[item.action]||item.action}</b><p>{item.actorName} · {item.metadata?.displayName||item.metadata?.title||item.targetType}</p></div><time dateTime={item.createdAt}>{date(item.createdAt)}</time></article>)}
              {!data.auditLog.length&&<div className="admin-empty"><Check/><p>目前沒有管理操作紀錄</p></div>}
            </div>
          </section>
        </>}
      </main>
    </section>
    {notice&&<button type="button" className="admin-toast" onClick={()=>setNotice('')} aria-live="polite"><Check/>{notice}</button>}
  </div>;
}
