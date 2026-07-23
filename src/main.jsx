import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight, BarChart3, Bell, Check, ChevronRight, CircleDollarSign, Menu, Plus, ReceiptText, Search, Sparkles, Users, WalletCards, X} from 'lucide-react';
import './style.css';
import './mobile.css';
import './dashboard.css';
import ProductApp from './ProductApp.jsx';

const people=[{name:'小羅',img:'/xiaoluo-avatar.png',color:'#1f9d69'},{name:'安安',initial:'安',color:'#ef8b5a'},{name:'阿哲',initial:'哲',color:'#6c72d9'}];
const seed=[
  {id:1,title:'東大門夜市晚餐',payer:'小羅',amount:1280,date:'今天 19:32',cat:'餐飲',members:3},
  {id:2,title:'民宿訂金',payer:'安安',amount:3600,date:'昨天 21:08',cat:'住宿',members:3},
  {id:3,title:'租車加油',payer:'阿哲',amount:950,date:'7月20日',cat:'交通',members:3},
];
function Brand({light=false}){return <div className={'brand '+(light?'light':'')}><span className="brandmark"><span>旅</span></span><span className="brand-lockup"><b>旅帳</b><small>TripTab</small></span></div>}
function Avatar({p,size=38}){return p.img?<img className="avatar" style={{width:size,height:size}} src={p.img}/>:<span className="avatar initial" style={{width:size,height:size,background:p.color}}>{p.initial}</span>}
function IosStatusIcons(){return <span className="ios-system-icons" aria-hidden="true"><svg viewBox="0 0 67 14" focusable="false">
  <g className="status-cellular"><rect x="0" y="9" width="2.5" height="4" rx="1"/><rect x="4.25" y="7" width="2.5" height="6" rx="1"/><rect x="8.5" y="4" width="2.5" height="9" rx="1"/><rect x="12.75" y="1" width="2.5" height="12" rx="1"/></g>
  <g className="status-wifi"><path d="M19.5 5.1C24.2.9 31.8.9 36.5 5.1l-1.7 1.8c-3.7-3.2-9.9-3.2-13.6 0l-1.7-1.8Z"/><path d="M23 8.4c2.7-2.4 7.3-2.4 10 0l-1.7 1.8c-1.8-1.5-4.8-1.5-6.6 0L23 8.4Z"/><circle cx="28" cy="12.15" r="1.3"/></g>
  <g className="status-battery"><rect x="43.5" y="2" width="19.5" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="45.5" y="4" width="15.2" height="6" rx="1.5"/><path d="M64.5 5.1c1.1.35 1.75 1 1.75 1.9s-.65 1.55-1.75 1.9V5.1Z" opacity=".42"/></g>
 </svg></span>}
function Home({enter}){return <div className="site">
  <nav><Brand/><div className="navlinks"><a href="#features">主打功能</a><a href="#how">使用方式</a><a href="#cases">適用情境</a><a href="#faq">常見問題</a></div><button className="ghost" onClick={enter}>登入</button><button className="primary small" onClick={enter}>開始分帳 <ArrowRight size={17}/></button></nav>
  <main>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={15}/> 旅行分帳，終於可以很簡單</span><h1>旅程一起享受，<br/><em>帳目各自清楚</em></h1><p>旅帳幫你記錄每一筆共同花費，自動計算每個人該付多少、該收多少<br/>不用整理試算表，也不用在群組裡反覆對帳</p><div className="hero-actions"><button className="primary" onClick={enter}>免費建立旅程 <ArrowRight size={18}/></button><span><Check size={17}/> 免下載 App・不用信用卡</span></div><div className="social"><div className="stack">{people.map((p,i)=><Avatar p={p} key={i} size={40}/>)}</div><b>已有 2,840+ 位旅伴使用旅帳<br/><small>從第一筆支出到最後一次結清，都交給旅帳</small></b></div></div>
      <div className="hero-visual" aria-label="旅帳 TripTab 的 iPhone 分帳畫面預覽">
        <div className="ticket"><span>TAITUNG TRIP</span><b>台東三日小旅行</b><small>3 位旅伴 · TWD</small><i aria-hidden="true"></i></div>
        <div className="phone">
          <span className="phone-side phone-silent" aria-hidden="true"></span>
          <span className="phone-side phone-volume-up" aria-hidden="true"></span>
          <span className="phone-side phone-volume-down" aria-hidden="true"></span>
          <span className="phone-side phone-power" aria-hidden="true"></span>
          <span className="phone-side phone-camera-control" aria-hidden="true"></span>
          <div className="phone-screen">
            <div className="ios-statusbar" aria-hidden="true">
              <time>9:41</time>
              <span className="dynamic-island"><i></i></span>
              <IosStatusIcons/>
            </div>
            <div className="phone-content">
              <div className="phone-head"><Brand/><Avatar p={people[0]} size={34}/></div>
              <p className="muted">本次旅程結算</p>
              <h2>你應收 <strong>NT$ 1,260</strong></h2>
              <div className="mini-card"><span className="mini-type food" aria-hidden="true">食</span><div><b>東大門夜市</b><small>萬安先付</small></div><strong>NT$ 1,280</strong></div>
              <div className="mini-card"><span className="mini-type stay" aria-hidden="true">住</span><div><b>海邊民宿</b><small>哲宇先付</small></div><strong>NT$ 3,600</strong></div>
              <div className="mini-card"><span className="mini-type ride" aria-hidden="true">行</span><div><b>租車費用</b><small>你先付</small></div><strong>NT$ 2,400</strong></div>
              <button className="phone-add" onClick={enter}><Plus/> 新增共同支出</button>
            </div>
            <span className="home-indicator" aria-hidden="true"></span>
          </div>
        </div>
        <div className="float-note"><CircleDollarSign/><div><small>已自動簡化轉帳</small><b>只需要轉帳 2 次</b></div></div>
      </div>
    </section>
    <section className="proof"><span>不用再開計算機</span><span>不用催朋友匯款</span><span>不用下載 App</span><span>多幣別也能分</span></section>
    <section id="features" className="section"><span className="eyebrow">旅帳 TripTab</span><h2>分帳該有的，剛剛好</h2><p className="lead">少一點表格，多一點旅行每個功能都為了讓你更快結清</p><div className="features"><article className="big feature green"><div><span className="icon"><ReceiptText/></span><h3>新增一筆，比點餐還快</h3><p>輸入金額、選付款人，系統會自動均分，也能自訂每個人的份額</p></div><div className="receipt"><b>山海咖啡</b><h3>NT$ 780</h3><div className="split-row">分給 3 人 <span>每人 NT$ 260</span></div><button>儲存這筆支出</button></div></article><article className="feature"><span className="icon orange"><WalletCards/></span><h3>欠誰多少，一眼看懂</h3><p>即時更新每個人的餘額，結算時自動找出最少轉帳次數</p><div className="balance-line"><Avatar p={people[1]} size={34}/><span>萬安付給你</span><b>NT$ 1,260</b></div></article><article className="feature"><span className="icon blue"><BarChart3/></span><h3>旅行花在哪，都有答案</h3><p>餐飲、住宿、交通自動分類，掌握群組花費不用自己做表</p><div className="bars"><i></i><i></i><i></i><i></i><i></i></div></article></div></section>
    <section id="how" className="section steps"><span className="eyebrow">三步就出發</span><h2>從揪團到結清，一路順</h2><div className="stepgrid">{[['01','建立旅程','取個群組名稱，選擇主要幣別'],['02','邀請旅伴','分享一條連結，朋友不用下載'],['03','記帳與結算','共同支出即時同步，最後一鍵結清']].map(x=><article key={x[0]}><b>{x[0]}</b><h3>{x[1]}</h3><p>{x[2]}</p></article>)}</div></section>
    <section id="cases" className="section use-cases"><span className="eyebrow">適用情境</span><h2>只要一起花錢，就適合用旅帳</h2><p className="lead">從週末小旅行到多人活動，誰先付、誰分攤，都能留下清楚紀錄</p><div className="case-grid"><article><span className="icon"><Users/></span><h3>朋友旅行</h3><p>住宿、交通、餐費一次記好，旅程結束不用再翻聊天紀錄</p></article><article><span className="icon orange"><WalletCards/></span><h3>家庭與聚會</h3><p>採買、訂金與共同費用公開透明，不必由一個人獨自整理</p></article><article><span className="icon blue"><ReceiptText/></span><h3>社團與活動</h3><p>支援不同付款人與分攤方式，人再多也能清楚結算</p></article></div></section>
    <section id="faq" className="section faq"><span className="eyebrow">常見問題</span><h2>開始前，先把問題說清楚</h2><div className="faq-list"><details><summary>需要下載 App 嗎？</summary><p>不用開啟邀請連結即可加入旅程，手機與電腦都能使用</p></details><details><summary>每一筆支出都只能平均分嗎？</summary><p>不是你可以平均分攤，也能依實際情況自訂每個人的金額</p></details><details><summary>旅帳會自動幫我算誰該付誰嗎？</summary><p>會旅帳會依每個人的支出與分攤結果計算餘額，並簡化需要轉帳的次數</p></details><details><summary>建立旅程需要信用卡嗎？</summary><p>不需要信用卡，建立旅程後就能直接邀請旅伴開始記帳</p></details></div></section>
    <section className="cta"><img src="/xiaoluo-avatar.png" alt="旅行成員頭像"/><div><span className="eyebrow">一起出發，清楚結算</span><h2>回憶留在旅程，帳目交給旅帳</h2><p>免費建立第一個旅程，30 秒開始分帳</p></div><button className="dark" onClick={enter}>免費建立旅程 <ArrowRight/></button></section>
  </main><footer><Brand light/><p>回憶留在旅程，帳目交給旅帳</p><span>© 2026 旅帳 TripTab</span></footer>
  </div>}

function App(){const [inside,setInside]=useState(false),[records,setRecords]=useState(seed),[modal,setModal]=useState(false),[title,setTitle]=useState(''),[amount,setAmount]=useState(''),[payer,setPayer]=useState('小羅'); const total=records.reduce((s,r)=>s+r.amount,0); const mine=useMemo(()=>records.reduce((s,r)=>s+(r.payer==='小羅'?r.amount:0),0)-total/3,[records,total]);
 const add=e=>{e.preventDefault();if(!title||!amount)return;setRecords([{id:Date.now(),title,payer,amount:Number(amount),date:'剛剛',cat:'其他',members:3},...records]);setTitle('');setAmount('');setModal(false)};
 if(!inside)return <Home enter={()=>setInside(true)}/>;
 return <div className="app-shell"><aside><Brand/><div className="user"><Avatar p={people[0]} size={48}/><div><b>嗨，小羅！</b><small>今天也開心探險</small></div></div><div className="side-title">我的旅程</div><button className="trip active"><span>🌊</span><div><b>台東三日小旅行</b><small>3 位旅伴</small></div></button><button className="newtrip"><Plus/> 建立新旅程</button><div className="side-menu"><button><Users/> 所有旅伴</button><button><Bell/> 提醒事項</button></div><button className="back" onClick={()=>setInside(false)}>← 回到首頁</button></aside>
 <div className="workspace"><header><button className="mobile-menu"><Menu/></button><div><small>我的旅程 /</small><h2>台東三日小旅行 🌊</h2></div><div className="header-actions"><button className="round"><Search/></button><div className="stack">{people.map((p,i)=><Avatar p={p} key={i} size={34}/>)}</div><button className="invite"><Users/> 邀請</button></div></header>
 <main className="dashboard"><section className="welcome"><div><span className="pill">2026 夏日旅行</span><h1>嗨，小羅！今天花了什麼？</h1><p>記下共同花費，旅伴的餘額會立刻更新</p></div><img src="/xiaoluo-avatar.png"/></section>
 <div className="statgrid"><article className="stat"><span className="stat-icon green"><WalletCards/></span><div><small>我的餘額</small><h3 className={mine>=0?'positive':'negative'}>{mine>=0?'應收':'應付'} NT$ {Math.abs(mine).toLocaleString(undefined,{maximumFractionDigits:0})}</h3><p>{mine>=0?'大家總共欠你':'你還需要結清'}</p></div></article><article className="stat"><span className="stat-icon orange"><ReceiptText/></span><div><small>旅程總支出</small><h3>NT$ {total.toLocaleString()}</h3><p>{records.length} 筆共同花費</p></div></article><article className="stat settle"><div><small>聰明結算</small><h3>只需要 2 次轉帳</h3><p>小羅幫你把債務簡化好了</p></div><button>查看結算 <ChevronRight/></button></article></div>
 <section className="activity"><div className="section-head"><div><h2>最近支出</h2><p>台東三日小旅行的共同花費</p></div><button className="primary" onClick={()=>setModal(true)}><Plus/> 新增支出</button></div><div className="filters"><button className="active">全部</button><button>餐飲</button><button>住宿</button><button>交通</button></div><div className="record-list">{records.map(r=><article key={r.id}><span className="record-icon">{r.cat==='餐飲'?'🍜':r.cat==='住宿'?'🏠':r.cat==='交通'?'🚗':'🧾'}</span><div className="record-name"><b>{r.title}</b><small>{r.date} · {r.payer} 先付</small></div><div className="member-dots">{people.map((p,i)=><Avatar p={p} key={i} size={26}/>)}</div><div className="record-price"><b>NT$ {r.amount.toLocaleString()}</b><small>每人 NT$ {Math.round(r.amount/r.members).toLocaleString()}</small></div><button className="more">•••</button></article>)}</div></section></main></div>
 {modal&&<div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&setModal(false)}><form className="modal" onSubmit={add}><div className="modal-head"><div><span className="eyebrow">新增共同花費</span><h2>這次是誰先付？</h2></div><button type="button" className="round" onClick={()=>setModal(false)}><X/></button></div><label>項目名稱<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：東大門夜市晚餐"/></label><label>金額<div className="money"><span>NT$</span><input type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0"/></div></label><label>付款人<select value={payer} onChange={e=>setPayer(e.target.value)}>{people.map(p=><option key={p.name}>{p.name}</option>)}</select></label><div className="split-info"><Users/> 將由 3 位旅伴平均分攤</div><button className="primary wide">儲存支出 <ArrowRight/></button></form></div>}
 </div>}
createRoot(document.getElementById('root')).render(<ProductApp Home={Home}/>);
