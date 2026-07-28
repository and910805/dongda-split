import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,Check,LoaderCircle,ReceiptText,X} from './ui-icons.jsx';
import {SUPPORTED_CURRENCIES,amountCentsToInputValue,convertAmountCents,formatCurrencyAmount,getCurrency,isSupportedCurrency,parseCurrencyAmount} from '../currency.mjs';
import {createExpenseRequestOptions,createExpenseSubmissionKeyStore} from './expense-idempotency.mjs';

const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}}),data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'操作失敗');error.status=response.status;error.data=data;throw error}return data};
function Person({person,size=32,decorative=false}){return person.pictureUrl?<img className="avatar" src={person.pictureUrl} alt={decorative?'':person.displayName} aria-hidden={decorative||undefined} style={{width:size,height:size}}/>:<span className="avatar initial" style={{width:size,height:size,background:'#1f9d69'}} aria-label={decorative?undefined:person.displayName} aria-hidden={decorative||undefined}>{person.displayName.slice(0,1)}</span>}
function Modal({children,close,labelledBy,describedBy}){const overlayRef=useRef(null),dialogRef=useRef(null),closeRef=useRef(close),returnFocus=useRef(document.activeElement);closeRef.current=close;useEffect(()=>{const overlay=overlayRef.current,dialog=dialogRef.current,focusable='button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',blocked=[...(overlay?.parentElement?.children||[])].filter(item=>item!==overlay).map(item=>({item,inert:item.inert,hidden:item.getAttribute('aria-hidden')})),previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';blocked.forEach(({item})=>{item.inert=true;item.setAttribute('aria-hidden','true')});const initialTimer=setTimeout(()=>{if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector(focusable)?.focus()},0);const onKeyDown=event=>{if(event.key==='Escape'){event.preventDefault();closeRef.current();return}if(event.key!=='Tab'||!dialog)return;const items=[...dialog.querySelectorAll(focusable)].filter(item=>item.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};document.addEventListener('keydown',onKeyDown);return()=>{clearTimeout(initialTimer);document.removeEventListener('keydown',onKeyDown);document.body.style.overflow=previousOverflow;blocked.forEach(({item,inert,hidden})=>{item.inert=inert;if(hidden===null)item.removeAttribute('aria-hidden');else item.setAttribute('aria-hidden',hidden)});returnFocus.current?.focus?.()}},[]);return <div ref={overlayRef} className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><div ref={dialogRef} className="modal real-modal advanced-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>{children}</div></div>}

export function AdvancedExpenseModal({group,currencies=[],expense=null,currentUserId,close,done}){
  const formRef=useRef(null),errorRef=useRef(null),submissionKeyStoreRef=useRef(null);
  if(!submissionKeyStoreRef.current)submissionKeyStoreRef.current=createExpenseSubmissionKeyStore();
  const ledgerCurrencyCode=group.currency||'TWD';
  const currencyOptions=(Array.isArray(currencies)&&currencies.length?currencies:SUPPORTED_CURRENCIES.map(code=>getCurrency(code)));
  const storedCurrencyMeta=expense?.currencyMeta&&typeof expense.currencyMeta==='object'?expense.currencyMeta:{};
  const initialCurrencyCode=isSupportedCurrency(storedCurrencyMeta.inputCurrency)?storedCurrencyMeta.inputCurrency:ledgerCurrencyCode;
  const initialCurrency=getCurrency(initialCurrencyCode);
  const storedShares=Array.isArray(storedCurrencyMeta.inputShares)&&storedCurrencyMeta.inputShares.length?storedCurrencyMeta.inputShares:(expense?.shares||[]);
  const storedPayments=Array.isArray(storedCurrencyMeta.inputPayments)&&storedCurrencyMeta.inputPayments.length?storedCurrencyMeta.inputPayments:(expense?.payments||[]);
  const splitMeta=storedCurrencyMeta.inputSplitMeta&&typeof storedCurrencyMeta.inputSplitMeta==='object'?storedCurrencyMeta.inputSplitMeta:(expense?.splitMeta||{});
  const inputAmount=(value,currencyCode=initialCurrencyCode)=>amountCentsToInputValue(Math.abs(Number(value||0)),currencyCode);
  const parseInput=(value,{allowZero=true}={})=>{
    const raw=String(value??'').trim();
    if(!raw)return allowZero?{cents:0,error:''}:{cents:null,error:'請輸入金額'};
    try{return{cents:parseCurrencyAmount(raw,currencyCode,{allowZero,allowNegative:false}),error:''}}
    catch(parseError){return{cents:null,error:parseError.message}}
  };
  const people=group.members.filter(x=>!x.isFund),payers=people;
  const defaultPerson=people.find(person=>String(person.id)===String(currentUserId))||people[0],defaultPersonId=defaultPerson?.id;
  const shareAmounts=storedShares.map(x=>Math.abs(Number(x.amountCents))),looksEqual=shareAmounts.length>0&&Math.max(...shareAmounts)-Math.min(...shareAmounts)<=initialCurrency.quantum;
  const supportedModes=['equal','exact','hybrid','weights'],initialMode=supportedModes.includes(expense?.splitMode)?expense.splitMode:expense?(looksEqual?'equal':'exact'):'equal';
  const metadataParticipants=Array.isArray(splitMeta.participantIds)?splitMeta.participantIds.map(String):[],metadataRows=initialMode==='weights'&&Array.isArray(splitMeta.weights)?splitMeta.weights:initialMode==='hybrid'&&Array.isArray(splitMeta.fixedShares)?splitMeta.fixedShares:initialMode==='exact'&&Array.isArray(splitMeta.shares)?splitMeta.shares:[];
  const initialSelected=expense?(metadataParticipants.length?metadataParticipants:metadataRows.length?metadataRows.map(x=>String(x.userId)):storedShares.map(x=>String(x.userId))):defaultPersonId===undefined?[]:[defaultPersonId];
  const initialValueRows=metadataRows.length?metadataRows.map(x=>({userId:String(x.userId),value:initialMode==='weights'?String(x.weight??''):String(x.amount??'')})):storedShares.map(x=>({userId:String(x.userId),value:inputAmount(x.amountCents,initialCurrencyCode)}));
  const legacyHybrid=Boolean(expense&&initialMode==='hybrid'&&!Array.isArray(splitMeta.fixedShares));
  const preserveManualRate=storedCurrencyMeta.rateMode==='manual'&&storedCurrencyMeta.ledgerCurrency===ledgerCurrencyCode&&initialCurrencyCode!==ledgerCurrencyCode;
  const [currencyCode,setCurrencyCode]=useState(initialCurrencyCode),[kind,setKind]=useState((storedCurrencyMeta.inputAmountCents??expense?.amountCents)<0?'refund':'expense'),[title,setTitle]=useState(expense?.title||''),[amount,setAmount]=useState(expense?inputAmount(storedCurrencyMeta.inputAmountCents??expense.amountCents,initialCurrencyCode):''),[category,setCategory]=useState(expense?.category||'餐飲'),[payMode,setPayMode]=useState(storedPayments.length>1?'multiple':'single'),[payerId,setPayerId]=useState(expense?(storedPayments[0]?.userId||payers[0]?.id):defaultPersonId),[payerAmounts,setPayerAmounts]=useState(Object.fromEntries(storedPayments.map(x=>[x.userId,inputAmount(x.amountCents,initialCurrencyCode)]))),[mode,setMode]=useState(initialMode),[selected,setSelected]=useState(initialSelected),[values,setValues]=useState(Object.fromEntries(initialValueRows.map(x=>[x.userId,x.value]))),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState('');
  const [exchangeRate,setExchangeRate]=useState(preserveManualRate?String(storedCurrencyMeta.rate||''):''),[exchangeRateMode,setExchangeRateMode]=useState(preserveManualRate?'manual':'quoted'),[exchangeRateToken,setExchangeRateToken]=useState(''),[rateLoading,setRateLoading]=useState(false),[rateError,setRateError]=useState(''),[rateInfo,setRateInfo]=useState(null);
  const currency=getCurrency(currencyCode);
  const toggle=id=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
  useEffect(()=>{
    if(currencyCode===ledgerCurrencyCode){
      setExchangeRate('1');setExchangeRateToken('');setRateError('');setRateInfo(null);setRateLoading(false);
      return;
    }
    if(exchangeRateMode==='manual')return;
    let active=true;
    setRateLoading(true);setRateError('');setExchangeRateToken('');
    api(`/api/groups/${group.id}/expense-rate`,{
      method:'POST',
      body:JSON.stringify({sourceCurrency:currencyCode})
    }).then(result=>{
      if(!active)return;
      setExchangeRate(String(result.rate||''));
      setExchangeRateToken(result.exchangeRateToken||'');
      setRateInfo(result);
    }).catch(rateRequestError=>{
      if(!active)return;
      setExchangeRate('');
      setRateInfo(null);
      setRateError(`${rateRequestError.message}，你仍可輸入自訂匯率`);
    }).finally(()=>{if(active)setRateLoading(false)});
    return()=>{active=false};
  },[currencyCode,exchangeRateMode,group.id,ledgerCurrencyCode]);
  const changeCurrency=nextCurrency=>{
    setCurrencyCode(nextCurrency);
    setExchangeRateMode('quoted');
    setExchangeRate('');
    setExchangeRateToken('');
    setRateInfo(null);
    setRateError('');
  };
  const useLatestRate=()=>{
    setExchangeRateMode('quoted');
    setExchangeRate('');
    setExchangeRateToken('');
    setRateInfo(null);
    setRateError('');
  };
  const parsedTotal=parseInput(amount,{allowZero:false}),totalCents=parsedTotal.cents;
  const parsedPayers=Object.fromEntries(payers.map(person=>[person.id,parseInput(payerAmounts[person.id])]));
  const payerInputInvalid=Object.values(parsedPayers).some(result=>result.cents===null),payerTotalCents=Object.values(parsedPayers).reduce((sum,result)=>sum+(result.cents||0),0);
  const parsedValues=Object.fromEntries(selected.map(id=>[id,parseInput(values[id])]));
  const valueInputInvalid=Object.values(parsedValues).some(result=>result.cents===null),valueTotalCents=Object.values(parsedValues).reduce((sum,result)=>sum+(result.cents||0),0),blankCount=selected.filter(id=>(parsedValues[id]?.cents||0)===0).length;
  const weightInvalid=selected.some(id=>!/^(\d+)(?:\.\d+)?$/.test(String(values[id]||'1').trim())||Number(values[id]||1)<=0);
  const rateValid=currencyCode===ledgerCurrencyCode||(/^(\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(exchangeRate).trim())&&Number(exchangeRate)>0);
  let convertedPreviewCents=null;
  if(totalCents!==null&&totalCents>0&&rateValid){
    try{convertedPreviewCents=currencyCode===ledgerCurrencyCode?totalCents:convertAmountCents(totalCents,exchangeRate,ledgerCurrencyCode,{sourceCurrency:currencyCode})}
    catch{convertedPreviewCents=null}
  }
  const validationError=useMemo(()=>{if(!title.trim())return '請先填寫項目名稱';if(totalCents===null)return parsedTotal.error;if(totalCents<=0)return '總金額必須大於 0';if(currencyCode!==ledgerCurrencyCode&&rateLoading)return '正在取得匯率，請稍候';if(!rateValid)return `請輸入 1 ${currencyCode} 可換多少 ${ledgerCurrencyCode}`;if(convertedPreviewCents===0)return `換算後金額小於 ${ledgerCurrencyCode} 的最小單位`;if(!selected.length)return '請至少選擇一位分攤成員';if(payMode==='multiple'&&payerInputInvalid)return `共同付款金額必須符合 ${currencyCode} 的小數位規則`;if(payMode==='multiple'&&payerTotalCents!==totalCents)return `付款加總需要是 ${formatCurrencyAmount(totalCents,currencyCode)}，目前是 ${formatCurrencyAmount(payerTotalCents,currencyCode)}`;if(mode==='exact'&&(valueInputInvalid||blankCount>0))return `每位成員都必須填寫符合 ${currencyCode} 規則的負擔金額`;if(mode==='exact'&&valueTotalCents!==totalCents)return '每人金額加總必須等於支出總額';if(mode==='hybrid'&&valueInputInvalid)return `指定金額必須符合 ${currencyCode} 的小數位規則`;if(mode==='hybrid'&&(valueTotalCents>=totalCents||blankCount===0))return '指定金額後，必須保留至少一人分攤剩餘金額';if(mode==='weights'&&weightInvalid)return '每位成員的份數必須大於 0';return ''},[title,totalCents,parsedTotal.error,currencyCode,ledgerCurrencyCode,rateLoading,rateValid,convertedPreviewCents,selected,payMode,payerInputInvalid,payerTotalCents,mode,valueInputInvalid,blankCount,valueTotalCents,weightInvalid]);
  const submit=async e=>{e.preventDefault();if(busy)return;setAttempted(true);if(validationError){setError('');setTimeout(()=>{const invalid=formRef.current?.querySelector('[aria-invalid="true"]');if(invalid)invalid.focus();else errorRef.current?.focus()},0);return}setBusy(true);setError('');try{const payload={kind,title,amount:amount.trim(),currency:ledgerCurrencyCode,expenseCurrency:currencyCode,exchangeRate:currencyCode===ledgerCurrencyCode?'1':String(exchangeRate).trim(),exchangeRateMode:currencyCode===ledgerCurrencyCode?'identity':exchangeRateMode,exchangeRateToken:exchangeRateMode==='quoted'?exchangeRateToken:'',ledgerVersion:group.ledgerVersion,category,splitMode:mode,participantIds:selected};if(payMode==='single')payload.payerId=payerId;else payload.payers=payers.filter(p=>(parsedPayers[p.id]?.cents||0)>0).map(p=>({userId:p.id,amount:String(payerAmounts[p.id]).trim()}));if(mode==='exact')payload.shares=selected.map(userId=>({userId,amount:String(values[userId]).trim()}));if(mode==='hybrid')payload.fixedShares=selected.filter(id=>(parsedValues[id]?.cents||0)>0).map(userId=>({userId,amount:String(values[userId]).trim()}));if(mode==='weights')payload.weights=selected.map(userId=>({userId,weight:String(values[userId]||1).trim()}));const method=expense?'PATCH':'POST',requestOptions=createExpenseRequestOptions({method,payload,keyStore:submissionKeyStoreRef.current});await api(expense?`/api/groups/${group.id}/expenses/${expense.id}`:`/api/groups/${group.id}/expenses`,requestOptions);if(!expense)submissionKeyStoreRef.current.complete();done()}catch(err){setError(err.message);setBusy(false)}};
  const valueLabel=mode==='weights'?'份數／權重':'負擔金額';
  const splitHelp={equal:'所有已選成員平均分攤，尾差會自動分配',exact:'逐一輸入每位成員應負擔的確切金額',hybrid:'先指定部分金額，剩餘金額由留空成員平均分攤',weights:'依住宿天數、家庭人數等份數比例分攤'}[mode];
  const displayError=error||(attempted?validationError:'');
return <Modal close={close} labelledBy="expense-modal-title" describedBy="expense-modal-description">
  <header className="modal-head expense-modal-head">
    <div className="expense-modal-heading">
      <span className="expense-modal-eyebrow">{expense?'編輯帳目':'建立帳目'}</span>
      <h2 id="expense-modal-title">{expense?'修改支出':kind==='expense'?'新增共同支出':'記錄一筆退款'}</h2>
      <p id="expense-modal-description">記下款項、付款人與分攤方式</p>
    </div>
    <button type="button" className="modal-x" onClick={close} aria-label="關閉共同支出表單"><X/></button>
  </header>

  <form ref={formRef} className="advanced-form expense-form" onSubmit={submit} noValidate aria-busy={busy}>
    <div className="expense-kind-row">
      <div className="expense-kind-copy">
        <b>紀錄類型</b>
        <small>選擇一般支出或收到的退款</small>
      </div>
      <div className="kind-toggle" role="group" aria-label="紀錄類型">
        <button type="button" aria-pressed={kind==='expense'} className={kind==='expense'?'active':''} onClick={()=>setKind('expense')}>一般支出</button>
        <button type="button" aria-pressed={kind==='refund'} className={kind==='refund'?'active refund':''} onClick={()=>setKind('refund')}>退款／退押金</button>
      </div>
    </div>

    <fieldset className="form-section expense-form-section expense-basics">
      <legend>
        <span className="expense-section-title">
          <span className="expense-section-number" aria-hidden="true">1</span>
          <span><b>支出內容</b><small>填寫方便旅伴辨識的項目與金額</small></span>
        </span>
      </legend>
      <label className="expense-title-field">項目名稱 <span className="required-mark" aria-hidden="true">*</span><input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder={kind==='expense'?'例如：民宿尾款':'例如：民宿退押金'} required aria-invalid={attempted&&!title.trim()}/><small className="field-help">清楚的名稱能讓日後查找與對帳更容易</small></label>
      <div className="form-two">
        <label className="expense-amount-field">{kind==='expense'?'總金額':'退款金額'}（{currencyCode}） <span className="required-mark" aria-hidden="true">*</span><input type="number" min={currency.step} step={currency.step} inputMode={currency.decimals?'decimal':'numeric'} value={amount} onChange={e=>setAmount(e.target.value)} placeholder={`${currency.symbol} 0${currency.decimals?'.00':''}`} required aria-invalid={attempted&&(totalCents===null||totalCents<=0)}/><small className="field-help">{currency.name}最多輸入小數點後 {currency.decimals} 位</small></label>
        <label>支出幣別<select value={currencyCode} onChange={event=>changeCurrency(event.target.value)}>{currencyOptions.map(item=><option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select><small className="field-help">預設使用群組幣別 {ledgerCurrencyCode}</small></label>
        <label>分類<select value={category} onChange={e=>setCategory(e.target.value)}><option>餐飲</option><option>住宿</option><option>交通</option><option>購物</option><option>其他</option></select></label>
      </div>
      {currencyCode!==ledgerCurrencyCode&&<div className="expense-exchange-rate">
        <div className="expense-rate-heading"><span><b>換算匯率</b><small>{exchangeRateMode==='manual'?'使用這筆支出的自訂匯率':rateLoading?'正在取得最新匯率…':rateInfo?.rateDate?`匯率日期 ${rateInfo.rateDate}`:'系統匯率'}</small></span>{exchangeRateMode==='manual'&&<button type="button" onClick={useLatestRate}>改用系統匯率</button>}</div>
        <label><span>1 {currencyCode} =</span><input type="number" min="0.000000001" step="any" inputMode="decimal" value={exchangeRate} onChange={event=>{setExchangeRate(event.target.value);setExchangeRateMode('manual');setExchangeRateToken('');setRateError('')}} aria-invalid={attempted&&!rateValid}/><span>{ledgerCurrencyCode}</span></label>
        {rateError&&<p role="status"><AlertCircle/>{rateError}</p>}
        {rateInfo?.health?.warning&&<p role="status"><AlertCircle/>{rateInfo.health.warning}</p>}
        {convertedPreviewCents!==null&&<div className="expense-converted-preview"><span>記入群組帳本</span><strong>{formatCurrencyAmount(kind==='refund'?-Math.abs(convertedPreviewCents):convertedPreviewCents,ledgerCurrencyCode)}</strong><small>儲存後固定採用這個匯率，不會隨每日匯率變動</small></div>}
      </div>}
    </fieldset>

    <fieldset className="form-section expense-form-section">
      <legend>
        <span className="expense-section-title">
          <span className="expense-section-number" aria-hidden="true">2</span>
          <span><b>{kind==='expense'?'付款方式':'退款去向'}</b><small>{kind==='expense'?'確認誰先代墊這筆款項':'確認誰收到這筆退款'}</small></span>
        </span>
      </legend>
      <div className="mini-toggle" role="group" aria-label={kind==='expense'?'付款人數':'退款接收人數'}>
        <button type="button" aria-pressed={payMode==='single'} className={payMode==='single'?'active':''} onClick={()=>setPayMode('single')}>單人</button>
        <button type="button" aria-pressed={payMode==='multiple'} className={payMode==='multiple'?'active':''} onClick={()=>setPayMode('multiple')}>{kind==='expense'?'多人湊款':'多人收款'}</button>
      </div>
      {payMode==='single'
        ?<label className="select-field">{kind==='expense'?'付款人':'退款接收者'}<select value={payerId} onChange={e=>setPayerId(e.target.value)}>{payers.map(p=><option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label>
        :<div className="amount-rows">{payers.map(p=><div key={p.id}><Person person={p}/><span>{p.displayName}</span><label>{currency.symbol}<input type="number" min="0" step={currency.step} inputMode={currency.decimals?'decimal':'numeric'} aria-label={`${p.displayName}的${kind==='expense'?'付款':'退款接收'}金額（${currencyCode}）`} value={payerAmounts[p.id]||''} onChange={e=>setPayerAmounts(old=>({...old,[p.id]:e.target.value}))} placeholder="0"/></label></div>)}<p className={totalCents!==null&&payerTotalCents===totalCents?'ok':''}>{kind==='expense'?'付款':'退款接收'}加總 {formatCurrencyAmount(payerTotalCents,currencyCode)}／{formatCurrencyAmount(totalCents||0,currencyCode)}</p></div>}
    </fieldset>

    <fieldset className="form-section expense-form-section">
      <legend>
        <span className="expense-section-title">
          <span className="expense-section-number" aria-hidden="true">3</span>
          <span><b>分攤方式</b><small>選擇成員與這筆款項的計算方式</small></span>
        </span>
      </legend>
      <div className="split-tabs" role="group" aria-label="分攤方式">{[['equal','平均'],['exact','指定金額'],['hybrid','指定＋均分'],['weights','比例／份數']].map(([id,label])=><button type="button" key={id} aria-pressed={mode===id} className={mode===id?'active':''} onClick={()=>setMode(id)}>{label}</button>)}</div>
      <p className="split-help">{splitHelp}</p>
      {legacyHybrid&&mode==='hybrid'&&<p className="split-warning" role="note">這筆舊資料未保留原始指定欄位，請確認固定金額，並將要均分的成員留空後再儲存</p>}
      <div className="participant-heading"><b>參與成員</b><small>已選 {selected.length}／{people.length} 人</small></div>
      <div className={'advanced-participants '+(mode!=='equal'?'with-values':'')}>{people.map(p=><div className={selected.includes(p.id)?'selected':''} key={p.id}><button type="button" aria-pressed={selected.includes(p.id)} onClick={()=>toggle(p.id)}><Person person={p} decorative/><span>{p.displayName}</span>{selected.includes(p.id)&&<Check/>}</button>{selected.includes(p.id)&&mode!=='equal'&&<label>{valueLabel}<input type="number" min={mode==='weights'?'0.01':'0'} step={mode==='weights'?'0.1':currency.step} inputMode="decimal" aria-label={`${p.displayName}的${valueLabel}${mode==='weights'?'':`（${currencyCode}）`}`} value={values[p.id]||''} onChange={e=>setValues(old=>({...old,[p.id]:e.target.value}))} placeholder={mode==='weights'?'1':mode==='hybrid'?'留空＝均分':'0'}/></label>}</div>)}</div>
      {mode==='exact'&&<div className={'share-summary '+(totalCents!==null&&valueTotalCents===totalCents&&!blankCount?'balanced':'')}><span>已分配 {formatCurrencyAmount(valueTotalCents,currencyCode)}</span><b>還差 {formatCurrencyAmount((totalCents||0)-valueTotalCents,currencyCode)}</b></div>}
      {mode==='hybrid'&&<div className={'share-summary '+(totalCents!==null&&valueTotalCents<totalCents&&blankCount?'balanced':'')}><span>指定 {formatCurrencyAmount(valueTotalCents,currencyCode)}</span><b>剩餘 {formatCurrencyAmount((totalCents||0)-valueTotalCents,currencyCode)} 由 {blankCount} 人均分</b></div>}
    </fieldset>

    {displayError&&<p ref={errorRef} className="form-error" role="alert" tabIndex="-1"><AlertCircle/>{displayError}</p>}
    <div className="form-actions sticky-actions expense-form-actions">
      <div className="expense-save-summary" aria-live="polite">
        <small>{kind==='expense'?'共同支出':'退款'} · {selected.length} 位成員</small>
        <strong>{formatCurrencyAmount(totalCents||0,currencyCode)}</strong>
        {currencyCode!==ledgerCurrencyCode&&convertedPreviewCents!==null&&<small>帳本 {formatCurrencyAmount(convertedPreviewCents,ledgerCurrencyCode)}</small>}
      </div>
      <div className="expense-action-buttons">
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button>
        <button type="submit" className="primary" disabled={busy}>{busy?<LoaderCircle/>:<ReceiptText/>}{busy?'儲存中…':expense?'儲存修改':kind==='refund'?'儲存退款':'儲存支出'}</button>
      </div>
    </div>
  </form>
</Modal>
}
