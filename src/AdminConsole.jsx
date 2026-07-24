import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {AlertCircle,ArrowLeft,ArrowRight,Building2,Check,History,LoaderCircle,LogOut,RefreshCcw,Search,ShieldCheck,Users} from 'lucide-react';
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
  delete_group:'以管理者身分刪除群組'
};

function AdminAvatar({user,size=38}){
  return user?.pictureUrl
    ?<img className="admin-avatar" src={user.pictureUrl} alt={user.displayName||'使用者'} style={{width:size,height:size}} referrerPolicy="no-referrer"/>
    :<span className="admin-avatar admin-avatar-initial" style={{width:size,height:size}} aria-label={user?.displayName||'使用者'}>{user?.displayName?.slice(0,1)||'旅'}</span>;
}

export function AdminConsole({me,onExit,onLogout,onOpenGroup}){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [updating,setUpdating]=useState('');
  const [notice,setNotice]=useState('');

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
        <button className="active" onClick={()=>document.querySelector('#admin-overview')?.scrollIntoView({behavior:'smooth'})}><ShieldCheck/>系統總覽</button>
        <button onClick={()=>document.querySelector('#admin-users')?.scrollIntoView({behavior:'smooth'})}><Users/>使用者管理</button>
        <button onClick={()=>document.querySelector('#admin-groups')?.scrollIntoView({behavior:'smooth'})}><Building2/>群組清單</button>
        <button onClick={()=>document.querySelector('#admin-audit')?.scrollIntoView({behavior:'smooth'})}><History/>稽核紀錄</button>
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
        <label className="admin-search"><Search/><span className="sr-only">搜尋使用者或群組</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜尋使用者或群組"/></label>
        <button className="admin-refresh" onClick={load} disabled={loading} aria-label="重新整理管理資料">{loading?<LoaderCircle/>:<RefreshCcw/>}</button>
        <button className="admin-mobile-exit" onClick={onExit}><ArrowLeft/><span>返回</span></button>
      </header>
      <main className="admin-main">
        <section className="admin-intro" id="admin-overview">
          <div><span className="admin-eyebrow"><ShieldCheck/>管理模式已啟用</span><h2>掌握系統狀態，處理需要協助的帳本</h2><p>所有權限操作都由伺服器驗證並留下稽核紀錄。一般使用者不會看到這個管理入口。</p></div>
          <button onClick={onExit}><ArrowLeft/>回到我的旅帳</button>
        </section>
        {error&&<div className="admin-alert" role="alert"><AlertCircle/><span>{error}</span><button onClick={()=>setError('')} aria-label="關閉錯誤訊息">×</button></div>}
        {loading&&!data?<div className="admin-loading" aria-busy="true"><LoaderCircle/><p>正在整理管理資料…</p></div>:data&&<>
          <section className="admin-stats" aria-label="系統統計">
            <article><span><Users/></span><div><small>全部使用者</small><b>{data.stats.userCount.toLocaleString()}</b></div></article>
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
