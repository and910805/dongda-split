import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight,BarChart3,Bell,Check,ChevronRight,CircleDollarSign,Menu,Plus,ReceiptText,Search,Sparkles,Users,WalletCards,X} from './ui-icons.jsx';
import './style.css';
import './mobile.css';
import './dashboard.css';
import './operation.css';
import './admin.css';
import ProductApp from './ProductApp.jsx';
import {BrandLogo as Brand} from './BrandLogo.jsx';
import {LanguageProvider,LanguageSwitcher,useI18n} from './i18n.jsx';

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
const heroBackground='/hero-fuji-sakura.png?v=20260723-fuji-sakura';
const heroAirplane='/hero-airplane-watercolor.png?v=20260723-watercolor-plane';
function waitForImage(src){return new Promise(resolve=>{const image=new Image();let finished=false;const done=()=>{if(finished)return;finished=true;resolve()};image.onload=()=>image.decode?image.decode().catch(()=>{}).then(done):done();image.onerror=done;image.src=src;if(image.complete)image.onload()})}
function HeroAirplane(){return <div className="hero-airplane" aria-hidden="true"><span className="airplane-contrail"></span><img src={heroAirplane} alt="" width="720" height="249" decoding="async"/></div>}
function HeroWaves(){return <div className="hero-waves" aria-hidden="true"><svg viewBox="0 0 2000 190" preserveAspectRatio="none" focusable="false">
  <path className="hero-wave hero-wave-back" d="M-180 64C120 154 400 158 698 95C1015 28 1278 26 1572 84C1795 128 1970 120 2180 72V220H-180Z"/>
  <path className="hero-wave hero-wave-front" d="M-180 132C126 48 417 39 721 116C995 186 1284 182 1576 108C1804 51 1986 53 2180 101V220H-180Z"/>
  <path className="hero-wave-edge" d="M-180 128C126 44 417 35 721 112C995 182 1284 178 1576 104C1804 47 1986 49 2180 97"/>
 </svg></div>}
function Home({enter}){
 const {language,t}=useI18n();
 const [heroReady,setHeroReady]=useState(false);
 useEffect(()=>{let active=true;Promise.all([waitForImage(heroBackground),waitForImage(heroAirplane)]).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>active&&setHeroReady(true))));return()=>{active=false}},[]);
 useEffect(()=>{document.title=t('landing.documentTitle')},[language,t]);
 const workflowSteps=[1,2,3,4].map(index=>({
  id:String(index).padStart(2,'0'),
  title:t(`landing.workflow.step${index}.title`),
  body:t(`landing.workflow.step${index}.body`),
  meta:t(`landing.workflow.step${index}.meta`),
 }));
 return <div className="site">
  <nav aria-label={t('landing.nav.aria')}>
    <Brand/>
    <div className="navlinks"><a href="#features">{t('landing.nav.features')}</a><a href="#how">{t('landing.nav.how')}</a><a href="#cases">{t('landing.nav.cases')}</a><a href="#faq">{t('landing.nav.faq')}</a></div>
    <LanguageSwitcher className="site-language-switcher"/>
    <button className="ghost" onClick={enter}>{t('landing.nav.login')}</button>
    <button className="primary small" onClick={enter} aria-label={t('landing.nav.start')}><span className="nav-primary-label">{t('landing.nav.start')}</span><ArrowRight size={17}/></button>
  </nav>
  <main>
    <section className={`hero ${heroReady?'hero-ready':'hero-loading'}`}>
      <div className="hero-stage">
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={15}/> {t('landing.hero.eyebrow')}</span><h1>{t('landing.hero.title1')}<br/><em>{t('landing.hero.title2')}</em></h1><p>{t('landing.hero.description1')}<br/>{t('landing.hero.description2')}</p><div className="hero-actions"><button className="primary" onClick={enter}>{t('landing.hero.cta')} <ArrowRight size={18}/></button><span><Check size={17}/> {t('landing.hero.helper')}</span></div><div className="social"><div className="stack">{people.map((p,i)=><Avatar p={p} key={i} size={40}/>)}</div><b>{t('landing.hero.socialHeadline')}<br/><small>{t('landing.hero.socialDetail')}</small></b></div></div>
      <div className="hero-visual" role="img" aria-label={t('landing.preview.aria')}>
        <HeroAirplane/>
        <div className="ticket"><span>TOKYO · FUJI</span><b>{t('landing.preview.tripName')}</b><small>{t('landing.preview.travelers')}</small><i aria-hidden="true"></i></div>
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
              <p className="muted">{t('landing.preview.summary')}</p>
              <h2>{t('landing.preview.receivable')} <strong>¥ 12,600 {t('landing.preview.currency')}</strong></h2>
              <div className="mini-card"><span className="mini-type food" aria-hidden="true">{t('landing.preview.food')}</span><div><b>{t('landing.preview.item1')}</b><small>{t('landing.preview.payer1')}</small></div><strong>¥ 8,400</strong></div>
              <div className="mini-card"><span className="mini-type stay" aria-hidden="true">{t('landing.preview.stay')}</span><div><b>{t('landing.preview.item2')}</b><small>{t('landing.preview.payer2')}</small></div><strong>¥ 62,000</strong></div>
              <div className="mini-card"><span className="mini-type ride" aria-hidden="true">{t('landing.preview.ride')}</span><div><b>{t('landing.preview.item3')}</b><small>{t('landing.preview.payer3')}</small></div><strong>¥ 36,000</strong></div>
              <div className="phone-add" aria-hidden="true"><Plus/> {t('landing.preview.addExpense')}</div>
            </div>
            <span className="home-indicator" aria-hidden="true"></span>
          </div>
        </div>
        <div className="float-note"><CircleDollarSign/><div><small>{t('landing.preview.simplified')}</small><b>{t('landing.preview.transferCount')}</b></div></div>
      </div>
      </div>
      <HeroWaves/>
      <HeroBirds/>
      <HeroFoliage/>
    </section>
    <section className="proof" aria-label={t('landing.proof.aria')}><span>{t('landing.proof.item1')}</span><span>{t('landing.proof.item2')}</span><span>{t('landing.proof.item3')}</span><span>{t('landing.proof.item4')}</span></section>

    <section id="features" className="section product-story">
      <header className="section-intro">
        <span className="section-kicker">01 / {t('landing.features.kicker')}</span>
        <h2>{t('landing.features.title1')}<br/>{t('landing.features.title2')}</h2>
        <p>{t('landing.features.description')}</p>
      </header>
      <div className="product-story-body">
        <aside className="ledger-snapshot" aria-label={t('landing.ledger.aria')}>
          <div className="ledger-head"><div><small>TRIP LEDGER</small><h3>{t('landing.ledger.tripName')}</h3></div><span>{t('landing.ledger.travelers')}</span></div>
          <div className="ledger-total"><span>{t('landing.ledger.total')}</span><strong>NT$ 7,280</strong></div>
          <div className="ledger-rows">
            <div><span><b>{t('landing.ledger.item1')}</b><small>{t('landing.ledger.item1Meta')}</small></span><strong>NT$ 1,280</strong></div>
            <div><span><b>{t('landing.ledger.item2')}</b><small>{t('landing.ledger.item2Meta')}</small></span><strong>NT$ 3,600</strong></div>
            <div><span><b>{t('landing.ledger.item3')}</b><small>{t('landing.ledger.item3Meta')}</small></span><strong>NT$ 2,400</strong></div>
          </div>
          <div className="ledger-settlement"><span>{t('landing.ledger.settlement')}</span><strong>{t('landing.ledger.receivable')} NT$ 1,260</strong></div>
        </aside>
        <div className="feature-list">
          <article><div className="feature-title"><span>01</span><ReceiptText aria-hidden="true"/></div><h3>{t('landing.features.item1Title')}</h3><p>{t('landing.features.item1Body')}</p><small>{t('landing.features.item1Meta')}</small></article>
          <article><div className="feature-title"><span>02</span><WalletCards aria-hidden="true"/></div><h3>{t('landing.features.item2Title')}</h3><p>{t('landing.features.item2Body')}</p><small>{t('landing.features.item2Meta')}</small></article>
          <article><div className="feature-title"><span>03</span><BarChart3 aria-hidden="true"/></div><h3>{t('landing.features.item3Title')}</h3><p>{t('landing.features.item3Body')}</p><small>{t('landing.features.item3Meta')}</small></article>
        </div>
      </div>
    </section>

    <section id="how" className="workflow-section">
      <div className="workflow-inner">
        <header className="section-intro inverse">
          <span className="section-kicker">02 / {t('landing.workflow.kicker')}</span>
          <h2>{t('landing.workflow.title1')}<br/>{t('landing.workflow.title2')}</h2>
        </header>
        <ol className="workflow-list">
          {workflowSteps.map(step=><li key={step.id}><span>{step.id}</span><div><h3>{step.title}</h3><p>{step.body}</p></div><small>{step.meta}</small></li>)}
        </ol>
      </div>
    </section>

    <section id="cases" className="section situations">
      <header className="section-intro horizontal">
        <div><span className="section-kicker">03 / {t('landing.cases.kicker')}</span><h2>{t('landing.cases.title1')}<br/>{t('landing.cases.title2')}</h2></div>
        <p>{t('landing.cases.description')}</p>
      </header>
      <div className="situation-list">
        <article><span className="situation-index">01</span><h3>{t('landing.cases.item1Title')}</h3><p>{t('landing.cases.item1Meta')}</p><strong>{t('landing.cases.item1Body')}</strong></article>
        <article><span className="situation-index">02</span><h3>{t('landing.cases.item2Title')}</h3><p>{t('landing.cases.item2Meta')}</p><strong>{t('landing.cases.item2Body')}</strong></article>
        <article><span className="situation-index">03</span><h3>{t('landing.cases.item3Title')}</h3><p>{t('landing.cases.item3Meta')}</p><strong>{t('landing.cases.item3Body')}</strong></article>
      </div>
    </section>

    <section id="faq" className="section faq faq-editorial">
      <header className="section-intro">
        <span className="section-kicker">04 / {t('landing.faq.kicker')}</span>
        <h2>{t('landing.faq.title1')}<br/>{t('landing.faq.title2')}</h2>
        <p>{t('landing.faq.description')}</p>
      </header>
      <div className="faq-list">
        <details><summary>{t('landing.faq.item1Question')}</summary><p>{t('landing.faq.item1Answer')}</p></details>
        <details><summary>{t('landing.faq.item2Question')}</summary><p>{t('landing.faq.item2Answer')}</p></details>
        <details><summary>{t('landing.faq.item3Question')}</summary><p>{t('landing.faq.item3Answer')}</p></details>
        <details><summary>{t('landing.faq.item4Question')}</summary><p>{t('landing.faq.item4Answer')}</p></details>
        <details><summary>{t('landing.faq.item5Question')}</summary><p>{t('landing.faq.item5Answer')}</p></details>
      </div>
    </section>

    <section className="closing-cta">
      <div><span className="section-kicker">{t('landing.closing.kicker')}</span><h2>{t('landing.closing.title1')}<br/>{t('landing.closing.title2')}</h2></div>
      <div className="closing-actions"><button className="primary" onClick={enter}>{t('landing.hero.cta')} <ArrowRight/></button><span>{t('landing.hero.helper')}</span></div>
    </section>
  </main>
  <footer><Brand light/><p>{t('landing.footer.tagline')}</p><div className="footer-links"><a href="#features">{t('landing.footer.features')}</a><a href="#how">{t('landing.nav.how')}</a><a href="#faq">{t('landing.nav.faq')}</a></div><span>{t('landing.footer.copyright')}</span></footer>
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
createRoot(document.getElementById('root')).render(<LanguageProvider><ProductApp Home={Home}/></LanguageProvider>);
