import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight, BarChart3, Bell, Check, ChevronRight, CircleDollarSign, Menu, Plus, ReceiptText, Search, Sparkles, Users, WalletCards, X} from 'lucide-react';
import './style.css';
import './mobile.css';
import './dashboard.css';
import ProductApp from './ProductApp.jsx';
import {BrandLogo as Brand} from './BrandLogo.jsx';

const people=[{name:'小羅',img:'/xiaoluo-avatar.png',color:'#1f9d69'},{name:'安安',initial:'安',color:'#ef8b5a'},{name:'阿哲',initial:'哲',color:'#6c72d9'}];
const seed=[
  {id:1,title:'東大門夜市晚餐',payer:'小羅',amount:1280,date:'今天 19:32',cat:'餐飲',members:3},
  {id:2,title:'民宿訂金',payer:'安安',amount:3600,date:'昨天 21:08',cat:'住宿',members:3},
  {id:3,title:'租車加油',payer:'阿哲',amount:950,date:'7月20日',cat:'交通',members:3},
];
function Avatar({p,size=38}){return p.img?<img className="avatar" style={{width:size,height:size}} src={p.img}/>:<span className="avatar initial" style={{width:size,height:size,background:p.color}}>{p.initial}</span>}
function IosStatusIcons(){return <span className="ios-system-icons" aria-hidden="true"><svg viewBox="0 0 67 14" focusable="false">
  <g className="status-cellular"><rect x="0" y="9" width="2.5" height="4" rx="1"/><rect x="4.25" y="7" width="2.5" height="6" rx="1"/><rect x="8.5" y="4" width="2.5" height="9" rx="1"/><rect x="12.75" y="1" width="2.5" height="12" rx="1"/></g>
  <g className="status-wifi"><path d="M19.5 5.1C24.2.9 31.8.9 36.5 5.1l-1.7 1.8c-3.7-3.2-9.9-3.2-13.6 0l-1.7-1.8Z"/><path d="M23 8.4c2.7-2.4 7.3-2.4 10 0l-1.7 1.8c-1.8-1.5-4.8-1.5-6.6 0L23 8.4Z"/><circle cx="28" cy="12.15" r="1.3"/></g>
  <g className="status-battery"><rect x="43.5" y="2" width="19.5" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="45.5" y="4" width="15.2" height="6" rx="1.5"/><path d="M64.5 5.1c1.1.35 1.75 1 1.75 1.9s-.65 1.55-1.75 1.9V5.1Z" opacity=".42"/></g>
 </svg></span>}
function HeroFoliage(){return <div className="hero-foliage" aria-hidden="true"><svg viewBox="0 0 460 330" focusable="false">
  <g className="foliage-branch foliage-branch-back">
    <path className="foliage-stem" d="M458 330C425 252 389 174 351 77"/>
    <g transform="translate(421 254) rotate(192)"><g className="foliage-leaf foliage-leaf-1"><path d="M0 0C15-16 38-23 58-14C50 7 29 18 0 0Z"/><path className="foliage-vein" d="M7-1 48-13"/></g></g>
    <g transform="translate(404 218) rotate(139)"><g className="foliage-leaf foliage-leaf-2"><path d="M0 0C13-14 34-20 52-12C45 7 26 16 0 0Z"/><path className="foliage-vein" d="M6-1 43-11"/></g></g>
    <g transform="translate(385 176) rotate(195)"><g className="foliage-leaf foliage-leaf-3"><path d="M0 0C13-14 34-20 52-12C45 7 26 16 0 0Z"/><path className="foliage-vein" d="M6-1 43-11"/></g></g>
    <g transform="translate(368 131) rotate(138)"><g className="foliage-leaf foliage-leaf-4"><path d="M0 0C12-13 31-18 47-11C41 6 24 14 0 0Z"/><path className="foliage-vein" d="M6-1 39-10"/></g></g>
  </g>
  <g className="foliage-branch foliage-branch-middle">
    <path className="foliage-stem" d="M460 327C390 299 326 254 247 170"/>
    <g transform="translate(386 286) rotate(204)"><g className="foliage-leaf foliage-leaf-2"><path d="M0 0C15-17 40-24 61-15C53 8 31 19 0 0Z"/><path className="foliage-vein" d="M7-1 51-14"/></g></g>
    <g transform="translate(347 261) rotate(144)"><g className="foliage-leaf foliage-leaf-4"><path d="M0 0C14-15 36-21 55-13C48 7 28 17 0 0Z"/><path className="foliage-vein" d="M6-1 46-12"/></g></g>
    <g transform="translate(308 226) rotate(207)"><g className="foliage-leaf foliage-leaf-1"><path d="M0 0C14-15 36-21 55-13C48 7 28 17 0 0Z"/><path className="foliage-vein" d="M6-1 46-12"/></g></g>
    <g transform="translate(274 192) rotate(145)"><g className="foliage-leaf foliage-leaf-3"><path d="M0 0C12-13 31-18 47-11C41 6 24 14 0 0Z"/><path className="foliage-vein" d="M6-1 39-10"/></g></g>
  </g>
  <g className="foliage-branch foliage-branch-front">
    <path className="foliage-stem" d="M460 330C358 324 268 293 148 240"/>
    <g transform="translate(369 314) rotate(221)"><g className="foliage-leaf foliage-leaf-3"><path d="M0 0C17-19 45-27 69-17C60 9 35 22 0 0Z"/><path className="foliage-vein" d="M8-1 58-15"/></g></g>
    <g transform="translate(320 299) rotate(153)"><g className="foliage-leaf foliage-leaf-1"><path d="M0 0C16-18 42-25 64-16C56 9 33 20 0 0Z"/><path className="foliage-vein" d="M7-1 54-14"/></g></g>
    <g transform="translate(268 283) rotate(220)"><g className="foliage-leaf foliage-leaf-4"><path d="M0 0C15-17 40-24 61-15C53 8 31 19 0 0Z"/><path className="foliage-vein" d="M7-1 51-14"/></g></g>
    <g transform="translate(211 261) rotate(153)"><g className="foliage-leaf foliage-leaf-2"><path d="M0 0C14-15 36-21 55-13C48 7 28 17 0 0Z"/><path className="foliage-vein" d="M6-1 46-12"/></g></g>
  </g>
 </svg></div>}
function HeroBirds(){return <div className="hero-birds" aria-hidden="true">
  <svg className="hero-bird hero-bird-one" viewBox="0 0 32 16" focusable="false"><path className="bird-wing bird-wing-left" d="M2 12C7 6 11 5 16 10"/><path className="bird-wing bird-wing-right" d="M16 10C21 5 25 6 30 12"/></svg>
  <svg className="hero-bird hero-bird-two" viewBox="0 0 28 14" focusable="false"><path className="bird-wing bird-wing-left" d="M2 11C6 6 10 5 14 9"/><path className="bird-wing bird-wing-right" d="M14 9C18 5 22 6 26 11"/></svg>
  <svg className="hero-bird hero-bird-three" viewBox="0 0 24 12" focusable="false"><path className="bird-wing bird-wing-left" d="M2 10C5 6 8 5 12 8"/><path className="bird-wing bird-wing-right" d="M12 8C16 5 19 6 22 10"/></svg>
 </div>}
function HeroWaves(){return <div className="hero-waves" aria-hidden="true"><svg viewBox="0 0 2000 190" preserveAspectRatio="none" focusable="false">
  <path className="hero-wave hero-wave-back" d="M-180 64C120 154 400 158 698 95C1015 28 1278 26 1572 84C1795 128 1970 120 2180 72V220H-180Z"/>
  <path className="hero-wave hero-wave-front" d="M-180 132C126 48 417 39 721 116C995 186 1284 182 1576 108C1804 51 1986 53 2180 101V220H-180Z"/>
  <path className="hero-wave-edge" d="M-180 128C126 44 417 35 721 112C995 182 1284 178 1576 104C1804 47 1986 49 2180 97"/>
 </svg></div>}
function Home({enter}){return <div className="site">
  <nav><Brand/><div className="navlinks"><a href="#features">主打功能</a><a href="#how">使用方式</a><a href="#cases">適用情境</a><a href="#faq">常見問題</a></div><button className="ghost" onClick={enter}>登入</button><button className="primary small" onClick={enter}>開始分帳 <ArrowRight size={17}/></button></nav>
  <main>
    <section className="hero">
      <div className="hero-stage">
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={15}/> 旅行分帳，終於可以很簡單</span><h1>旅程一起享受<br/><em>帳目各自清楚</em></h1><p>旅帳幫你記錄每一筆共同花費，自動計算每個人該付多少、該收多少<br/>不用整理試算表，也不用在群組裡反覆對帳</p><div className="hero-actions"><button className="primary" onClick={enter}>免費建立旅程 <ArrowRight size={18}/></button><span><Check size={17}/> 免下載 App・不用信用卡</span></div><div className="social"><div className="stack">{people.map((p,i)=><Avatar p={p} key={i} size={40}/>)}</div><b>已有 2,840+ 位旅伴使用旅帳<br/><small>從第一筆支出到最後一次結清，都交給旅帳</small></b></div></div>
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
      </div>
      <HeroWaves/>
      <HeroBirds/>
      <HeroFoliage/>
    </section>
    <section className="proof" aria-label="旅帳產品特點"><span>不用再開計算機</span><span>不用催朋友匯款</span><span>不用下載 App</span><span>多幣別也能分</span></section>

    <section id="features" className="section product-story">
      <header className="section-intro">
        <span className="section-kicker">01 / 核心功能</span>
        <h2>每一筆支出<br/>都能說得清楚</h2>
        <p>旅帳把記帳、分攤與結算放在同一個地方，旅途中只管記，回程前就能結清</p>
      </header>
      <div className="product-story-body">
        <aside className="ledger-snapshot" aria-label="台東三日小旅行帳目範例">
          <div className="ledger-head"><div><small>TRIP LEDGER</small><h3>台東三日小旅行</h3></div><span>3 位旅伴</span></div>
          <div className="ledger-total"><span>目前共同支出</span><strong>NT$ 7,280</strong></div>
          <div className="ledger-rows">
            <div><span><b>東大門夜市</b><small>萬安先付 · 餐飲</small></span><strong>NT$ 1,280</strong></div>
            <div><span><b>海邊民宿</b><small>哲宇先付 · 住宿</small></span><strong>NT$ 3,600</strong></div>
            <div><span><b>租車費用</b><small>你先付 · 交通</small></span><strong>NT$ 2,400</strong></div>
          </div>
          <div className="ledger-settlement"><span>你的結算</span><strong>應收 NT$ 1,260</strong></div>
        </aside>
        <div className="feature-list">
          <article><div className="feature-title"><span>01</span><ReceiptText aria-hidden="true"/></div><h3>記帳不打斷旅程</h3><p>輸入金額、付款人與分攤方式，一筆共同支出就完成</p><small>平均分攤 · 自訂金額 · 依份數分攤</small></article>
          <article><div className="feature-title"><span>02</span><WalletCards aria-hidden="true"/></div><h3>每個人的餘額持續更新</h3><p>誰先付、誰該付與誰該收都留在同一份帳目，不用再回頭翻群組訊息</p><small>所有旅伴看到相同明細</small></article>
          <article><div className="feature-title"><span>03</span><BarChart3 aria-hidden="true"/></div><h3>結算只留下必要轉帳</h3><p>旅帳依照每個人的收付結果自動整理，減少來回轉帳與人工計算</p><small>範例旅程只需轉帳 2 次</small></article>
        </div>
      </div>
    </section>

    <section id="how" className="workflow-section">
      <div className="workflow-inner">
        <header className="section-intro inverse">
          <span className="section-kicker">02 / 使用方式</span>
          <h2>一條連結<br/>開始共同記帳</h2>
        </header>
        <ol className="workflow-list">
          {[
            ['01','建立旅程','輸入旅程名稱與主要幣別','約 30 秒'],
            ['02','分享給旅伴','傳送邀請連結，開啟後即可加入','免下載'],
            ['03','邊花邊記','每個人都能新增支出與查看明細','即時同步'],
            ['04','查看結算','自動整理每個人的應收應付','簡化轉帳'],
          ].map(step=><li key={step[0]}><span>{step[0]}</span><div><h3>{step[1]}</h3><p>{step[2]}</p></div><small>{step[3]}</small></li>)}
        </ol>
      </div>
    </section>

    <section id="cases" className="section situations">
      <header className="section-intro horizontal">
        <div><span className="section-kicker">03 / 適用情境</span><h2>不只旅行<br/>共同支出都適用</h2></div>
        <p>同一套清楚的記錄方式，從三人小旅行到多人活動都能使用</p>
      </header>
      <div className="situation-list">
        <article><span className="situation-index">01</span><h3>朋友旅行</h3><p>住宿 · 交通 · 餐費</p><strong>旅程結束不用再翻聊天紀錄</strong></article>
        <article><span className="situation-index">02</span><h3>家庭與聚會</h3><p>採買 · 訂金 · 共同費用</p><strong>每個人都看得到完整明細</strong></article>
        <article><span className="situation-index">03</span><h3>社團與活動</h3><p>多位付款人 · 不同分攤方式</p><strong>人再多也能清楚結算</strong></article>
      </div>
    </section>

    <section id="faq" className="section faq faq-editorial">
      <header className="section-intro">
        <span className="section-kicker">04 / 常見問題</span>
        <h2>開始前<br/>先把問題說清楚</h2>
        <p>如果還有其他問題，可以先建立測試旅程，所有功能都能直接體驗</p>
      </header>
      <div className="faq-list">
        <details><summary>需要下載 App 嗎？</summary><p>不用，開啟邀請連結即可加入旅程，手機與電腦都能使用</p></details>
        <details><summary>每一筆支出都只能平均分嗎？</summary><p>不是，可以平均分攤，也能依實際情況自訂每個人的金額或份數</p></details>
        <details><summary>旅帳會自動計算誰該付誰嗎？</summary><p>會，旅帳會依每個人的支出與分攤結果計算餘額，並簡化需要轉帳的次數</p></details>
        <details><summary>建立旅程需要信用卡嗎？</summary><p>不需要信用卡，建立旅程後就能直接邀請旅伴開始記帳</p></details>
      </div>
    </section>

    <section className="closing-cta">
      <div><span className="section-kicker">準備出發</span><h2>回憶留在旅程<br/>帳目交給旅帳</h2></div>
      <div className="closing-actions"><button className="primary" onClick={enter}>免費建立旅程 <ArrowRight/></button><span>免下載 App · 不用信用卡</span></div>
    </section>
  </main>
  <footer><Brand light/><p>一起出發，清楚結算</p><div className="footer-links"><a href="#features">功能</a><a href="#how">使用方式</a><a href="#faq">常見問題</a></div><span>© 2026 旅帳 TripTab</span></footer>
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
