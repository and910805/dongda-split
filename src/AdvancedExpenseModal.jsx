import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,Check,LoaderCircle,ReceiptText,X} from './ui-icons.jsx';
import {SUPPORTED_CURRENCIES,amountCentsToInputValue,convertAmountCents,formatCurrencyAmount,getCurrency,getCurrencyName,isSupportedCurrency,parseCurrencyAmount} from '../currency.mjs';
import {createExpenseRequestOptions,createExpenseSubmissionKeyStore} from './expense-idempotency.mjs';
import {getLanguageHeaders,translateApiMessage,useI18n} from './i18n.jsx';

const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:getLanguageHeaders({'content-type':'application/json',...(options.headers||{})})}),data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(translateApiMessage(data.error||'操作失敗'));error.status=response.status;error.data=data;throw error}return data};
function Person({person,size=32,decorative=false}){return person.pictureUrl?<img className="avatar" src={person.pictureUrl} alt={decorative?'':person.displayName} aria-hidden={decorative||undefined} style={{width:size,height:size}}/>:<span className="avatar initial" style={{width:size,height:size,background:'#1f9d69'}} aria-label={decorative?undefined:person.displayName} aria-hidden={decorative||undefined}>{person.displayName.slice(0,1)}</span>}
function Modal({children,close,labelledBy,describedBy}){const overlayRef=useRef(null),dialogRef=useRef(null),closeRef=useRef(close),returnFocus=useRef(document.activeElement);closeRef.current=close;useEffect(()=>{const overlay=overlayRef.current,dialog=dialogRef.current,focusable='button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',blocked=[...(overlay?.parentElement?.children||[])].filter(item=>item!==overlay).map(item=>({item,inert:item.inert,hidden:item.getAttribute('aria-hidden')})),previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';blocked.forEach(({item})=>{item.inert=true;item.setAttribute('aria-hidden','true')});const initialTimer=setTimeout(()=>{if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector(focusable)?.focus()},0);const onKeyDown=event=>{if(event.key==='Escape'){event.preventDefault();closeRef.current();return}if(event.key!=='Tab'||!dialog)return;const items=[...dialog.querySelectorAll(focusable)].filter(item=>item.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};document.addEventListener('keydown',onKeyDown);return()=>{clearTimeout(initialTimer);document.removeEventListener('keydown',onKeyDown);document.body.style.overflow=previousOverflow;blocked.forEach(({item,inert,hidden})=>{item.inert=inert;if(hidden===null)item.removeAttribute('aria-hidden');else item.setAttribute('aria-hidden',hidden)});returnFocus.current?.focus?.()}},[]);return <div ref={overlayRef} className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><div ref={dialogRef} className="modal real-modal advanced-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>{children}</div></div>}

export function AdvancedExpenseModal({group,currencies=[],expense=null,currentUserId,close,done}){
  const {language,t,translateApiError}=useI18n();
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
    if(!raw)return allowZero?{cents:0,error:''}:{cents:null,error:t('expense.validation.amountRequired')};
    try{return{cents:parseCurrencyAmount(raw,currencyCode,{allowZero,allowNegative:false}),error:''}}
    catch(parseError){return{cents:null,error:translateApiError(parseError.message)}}
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
      setRateError(t('expense.rate.manualFallback',{message:rateRequestError.message}));
    }).finally(()=>{if(active)setRateLoading(false)});
    return()=>{active=false};
  },[currencyCode,exchangeRateMode,group.id,ledgerCurrencyCode,t]);
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
  const validationError=useMemo(()=>{if(!title.trim())return t('expense.validation.titleRequired');if(totalCents===null)return parsedTotal.error;if(totalCents<=0)return t('expense.validation.totalPositive');if(currencyCode!==ledgerCurrencyCode&&rateLoading)return t('expense.validation.rateLoading');if(!rateValid)return t('expense.validation.rateRequired',{source:currencyCode,target:ledgerCurrencyCode});if(convertedPreviewCents===0)return t('expense.validation.convertedTooSmall',{currency:ledgerCurrencyCode});if(!selected.length)return t('expense.validation.participantRequired');if(payMode==='multiple'&&payerInputInvalid)return t('expense.validation.payersPrecision',{currency:currencyCode});if(payMode==='multiple'&&payerTotalCents!==totalCents)return t('expense.validation.payersTotal',{expected:formatCurrencyAmount(totalCents,currencyCode),actual:formatCurrencyAmount(payerTotalCents,currencyCode)});if(mode==='exact'&&(valueInputInvalid||blankCount>0))return t('expense.validation.exactRequired',{currency:currencyCode});if(mode==='exact'&&valueTotalCents!==totalCents)return t('expense.validation.exactTotal');if(mode==='hybrid'&&valueInputInvalid)return t('expense.validation.hybridPrecision',{currency:currencyCode});if(mode==='hybrid'&&(valueTotalCents>=totalCents||blankCount===0))return t('expense.validation.hybridRemainder');if(mode==='weights'&&weightInvalid)return t('expense.validation.weightPositive');return ''},[title,totalCents,parsedTotal.error,currencyCode,ledgerCurrencyCode,rateLoading,rateValid,convertedPreviewCents,selected,payMode,payerInputInvalid,payerTotalCents,mode,valueInputInvalid,blankCount,valueTotalCents,weightInvalid,t]);
  const submit=async e=>{e.preventDefault();if(busy)return;setAttempted(true);if(validationError){setError('');setTimeout(()=>{const invalid=formRef.current?.querySelector('[aria-invalid="true"]');if(invalid)invalid.focus();else errorRef.current?.focus()},0);return}setBusy(true);setError('');try{const payload={kind,title,amount:amount.trim(),currency:ledgerCurrencyCode,expenseCurrency:currencyCode,exchangeRate:currencyCode===ledgerCurrencyCode?'1':String(exchangeRate).trim(),exchangeRateMode:currencyCode===ledgerCurrencyCode?'identity':exchangeRateMode,exchangeRateToken:exchangeRateMode==='quoted'?exchangeRateToken:'',ledgerVersion:group.ledgerVersion,category,splitMode:mode,participantIds:selected};if(payMode==='single')payload.payerId=payerId;else payload.payers=payers.filter(p=>(parsedPayers[p.id]?.cents||0)>0).map(p=>({userId:p.id,amount:String(payerAmounts[p.id]).trim()}));if(mode==='exact')payload.shares=selected.map(userId=>({userId,amount:String(values[userId]).trim()}));if(mode==='hybrid')payload.fixedShares=selected.filter(id=>(parsedValues[id]?.cents||0)>0).map(userId=>({userId,amount:String(values[userId]).trim()}));if(mode==='weights')payload.weights=selected.map(userId=>({userId,weight:String(values[userId]||1).trim()}));const method=expense?'PATCH':'POST',requestOptions=createExpenseRequestOptions({method,payload,keyStore:submissionKeyStoreRef.current});await api(expense?`/api/groups/${group.id}/expenses/${expense.id}`:`/api/groups/${group.id}/expenses`,requestOptions);if(!expense)submissionKeyStoreRef.current.complete();done()}catch(err){setError(err.message);setBusy(false)}};
  const valueLabel=mode==='weights'?t('expense.split.weightLabel'):t('expense.split.amountLabel');
  const splitHelp=t(`expense.split.help.${mode}`);
  const displayError=error||(attempted?validationError:'');
return <Modal close={close} labelledBy="expense-modal-title" describedBy="expense-modal-description">
  <header className="modal-head expense-modal-head">
    <div className="expense-modal-heading">
      <span className="expense-modal-eyebrow">{t(expense?'expense.eyebrow.edit':'expense.eyebrow.create')}</span>
      <h2 id="expense-modal-title">{t(expense?'expense.title.edit':kind==='expense'?'expense.title.create':'expense.title.refund')}</h2>
      <p id="expense-modal-description">{t('expense.description')}</p>
    </div>
    <button type="button" className="modal-x" onClick={close} aria-label={t('expense.close')}><X/></button>
  </header>

  <form ref={formRef} className="advanced-form expense-form" onSubmit={submit} noValidate aria-busy={busy}>
    <div className="expense-kind-row">
      <div className="expense-kind-copy">
        <b>{t('expense.kind.label')}</b>
        <small>{t('expense.kind.help')}</small>
      </div>
      <div className="kind-toggle" role="group" aria-label={t('expense.kind.label')}>
        <button type="button" aria-pressed={kind==='expense'} className={kind==='expense'?'active':''} onClick={()=>setKind('expense')}>{t('expense.kind.expense')}</button>
        <button type="button" aria-pressed={kind==='refund'} className={kind==='refund'?'active refund':''} onClick={()=>setKind('refund')}>{t('expense.kind.refund')}</button>
      </div>
    </div>

    <fieldset className="form-section expense-form-section expense-basics">
      <legend>
        <span className="expense-section-title">
          <span className="expense-section-number" aria-hidden="true">1</span>
          <span><b>{t('expense.details.title')}</b><small>{t('expense.details.help')}</small></span>
        </span>
      </legend>
      <label className="expense-title-field">{t('expense.field.title')} <span className="required-mark" aria-hidden="true">*</span><input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder={t(kind==='expense'?'expense.placeholder.expense':'expense.placeholder.refund')} required aria-invalid={attempted&&!title.trim()}/><small className="field-help">{t('expense.field.titleHelp')}</small></label>
      <div className="form-two">
        <label className="expense-amount-field">{t('expense.field.amountWithCurrency',{label:t(kind==='expense'?'expense.field.total':'expense.field.refundAmount'),currency:currencyCode})} <span className="required-mark" aria-hidden="true">*</span><input type="number" min={currency.step} step={currency.step} inputMode={currency.decimals?'decimal':'numeric'} value={amount} onChange={e=>setAmount(e.target.value)} placeholder={`${currency.symbol} 0${currency.decimals?'.00':''}`} required aria-invalid={attempted&&(totalCents===null||totalCents<=0)}/><small className="field-help">{t(currency.decimals?'expense.field.amountHelp':'expense.field.amountHelpWhole',{currency:getCurrencyName(currencyCode,language),decimals:currency.decimals})}</small></label>
        <label>{t('expense.field.currency')}<select value={currencyCode} onChange={event=>changeCurrency(event.target.value)}>{currencyOptions.map(item=><option key={item.code} value={item.code}>{item.code} · {getCurrencyName(item.code,language)}</option>)}</select><small className="field-help">{t('expense.field.currencyHelp',{currency:ledgerCurrencyCode})}</small></label>
        <label>{t('expense.field.category')}<select value={category} onChange={e=>setCategory(e.target.value)}><option value="餐飲">{t('expense.category.food')}</option><option value="住宿">{t('expense.category.stay')}</option><option value="交通">{t('expense.category.transport')}</option><option value="購物">{t('expense.category.shopping')}</option><option value="其他">{t('expense.category.other')}</option></select></label>
      </div>
      {currencyCode!==ledgerCurrencyCode&&<div className="expense-exchange-rate">
        <div className="expense-rate-heading"><span><b>{t('expense.rate.title')}</b><small>{exchangeRateMode==='manual'?t('expense.rate.manual'):rateLoading?t('expense.rate.loading'):rateInfo?.rateDate?t('expense.rate.date',{date:rateInfo.rateDate}):t('expense.rate.system')}</small></span>{exchangeRateMode==='manual'&&<button type="button" onClick={useLatestRate}>{t('expense.rate.useSystem')}</button>}</div>
        <label><span>1 {currencyCode} =</span><input type="number" min="0.000000001" step="any" inputMode="decimal" value={exchangeRate} onChange={event=>{setExchangeRate(event.target.value);setExchangeRateMode('manual');setExchangeRateToken('');setRateError('')}} aria-invalid={attempted&&!rateValid}/><span>{ledgerCurrencyCode}</span></label>
        {rateError&&<p role="status"><AlertCircle/>{rateError}</p>}
        {rateInfo?.health?.warning&&<p role="status"><AlertCircle/>{translateApiError(rateInfo.health.warning)}</p>}
        {convertedPreviewCents!==null&&<div className="expense-converted-preview"><span>{t('expense.rate.ledgerPreview')}</span><strong>{formatCurrencyAmount(kind==='refund'?-Math.abs(convertedPreviewCents):convertedPreviewCents,ledgerCurrencyCode)}</strong><small>{t('expense.rate.fixed')}</small></div>}
      </div>}
    </fieldset>

    <fieldset className="form-section expense-form-section">
      <legend>
        <span className="expense-section-title">
          <span className="expense-section-number" aria-hidden="true">2</span>
          <span><b>{t(kind==='expense'?'expense.payment.title':'expense.payment.refundTitle')}</b><small>{t(kind==='expense'?'expense.payment.help':'expense.payment.refundHelp')}</small></span>
        </span>
      </legend>
      <div className="mini-toggle" role="group" aria-label={t(kind==='expense'?'expense.payment.count':'expense.payment.refundCount')}>
        <button type="button" aria-pressed={payMode==='single'} className={payMode==='single'?'active':''} onClick={()=>setPayMode('single')}>{t('expense.payment.single')}</button>
        <button type="button" aria-pressed={payMode==='multiple'} className={payMode==='multiple'?'active':''} onClick={()=>setPayMode('multiple')}>{t(kind==='expense'?'expense.payment.multiple':'expense.payment.multipleRefund')}</button>
      </div>
      {payMode==='single'
        ?<label className="select-field">{t(kind==='expense'?'expense.payment.payer':'expense.payment.recipient')}<select value={payerId} onChange={e=>setPayerId(e.target.value)}>{payers.map(p=><option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label>
        :<div className="amount-rows">{payers.map(p=><div key={p.id}><Person person={p}/><span>{p.displayName}</span><label>{currency.symbol}<input type="number" min="0" step={currency.step} inputMode={currency.decimals?'decimal':'numeric'} aria-label={t('expense.payment.amountAria',{name:p.displayName,type:t(kind==='expense'?'expense.payment.payType':'expense.payment.refundType'),currency:currencyCode})} value={payerAmounts[p.id]||''} onChange={e=>setPayerAmounts(old=>({...old,[p.id]:e.target.value}))} placeholder="0"/></label></div>)}<p className={totalCents!==null&&payerTotalCents===totalCents?'ok':''}>{t('expense.payment.total',{type:t(kind==='expense'?'expense.payment.payType':'expense.payment.refundType'),current:formatCurrencyAmount(payerTotalCents,currencyCode),total:formatCurrencyAmount(totalCents||0,currencyCode)})}</p></div>}
    </fieldset>

    <fieldset className="form-section expense-form-section">
      <legend>
        <span className="expense-section-title">
          <span className="expense-section-number" aria-hidden="true">3</span>
          <span><b>{t('expense.split.title')}</b><small>{t('expense.split.sectionHelp')}</small></span>
        </span>
      </legend>
      <div className="split-tabs" role="group" aria-label={t('expense.split.title')}>{['equal','exact','hybrid','weights'].map(id=><button type="button" key={id} aria-pressed={mode===id} className={mode===id?'active':''} onClick={()=>setMode(id)}>{t(`expense.split.${id}`)}</button>)}</div>
      <p className="split-help">{splitHelp}</p>
      {legacyHybrid&&mode==='hybrid'&&<p className="split-warning" role="note">{t('expense.split.legacyWarning')}</p>}
      <div className="participant-heading"><b>{t('expense.participants.title')}</b><small>{t('expense.participants.selected',{selected:selected.length,total:people.length})}</small></div>
      <div className={'advanced-participants '+(mode!=='equal'?'with-values':'')}>{people.map(p=><div className={selected.includes(p.id)?'selected':''} key={p.id}><button type="button" aria-pressed={selected.includes(p.id)} onClick={()=>toggle(p.id)}><Person person={p} decorative/><span>{p.displayName}</span>{selected.includes(p.id)&&<Check/>}</button>{selected.includes(p.id)&&mode!=='equal'&&<label>{valueLabel}<input type="number" min={mode==='weights'?'0.01':'0'} step={mode==='weights'?'0.1':currency.step} inputMode="decimal" aria-label={t('expense.split.inputAria',{name:p.displayName,label:valueLabel,currency:mode==='weights'?'':` (${currencyCode})`})} value={values[p.id]||''} onChange={e=>setValues(old=>({...old,[p.id]:e.target.value}))} placeholder={mode==='weights'?'1':mode==='hybrid'?t('expense.split.blankEqual'):'0'}/></label>}</div>)}</div>
      {mode==='exact'&&<div className={'share-summary '+(totalCents!==null&&valueTotalCents===totalCents&&!blankCount?'balanced':'')}><span>{t('expense.split.allocated',{amount:formatCurrencyAmount(valueTotalCents,currencyCode)})}</span><b>{t('expense.split.remainingDifference',{amount:formatCurrencyAmount((totalCents||0)-valueTotalCents,currencyCode)})}</b></div>}
      {mode==='hybrid'&&<div className={'share-summary '+(totalCents!==null&&valueTotalCents<totalCents&&blankCount?'balanced':'')}><span>{t('expense.split.fixed',{amount:formatCurrencyAmount(valueTotalCents,currencyCode)})}</span><b>{t(blankCount===1?'expense.split.remainingEqualOne':'expense.split.remainingEqual',{amount:formatCurrencyAmount((totalCents||0)-valueTotalCents,currencyCode),count:blankCount})}</b></div>}
    </fieldset>

    {displayError&&<p ref={errorRef} className="form-error" role="alert" tabIndex="-1"><AlertCircle/>{displayError}</p>}
    <div className="form-actions sticky-actions expense-form-actions">
      <div className="expense-save-summary" aria-live="polite">
        <small>{t(selected.length===1?'expense.summary.member':'expense.summary.members',{type:t(kind==='expense'?'expense.summary.expense':'expense.summary.refund'),count:selected.length})}</small>
        <strong>{formatCurrencyAmount(totalCents||0,currencyCode)}</strong>
        {currencyCode!==ledgerCurrencyCode&&convertedPreviewCents!==null&&<small>{t('expense.summary.ledger',{amount:formatCurrencyAmount(convertedPreviewCents,ledgerCurrencyCode)})}</small>}
      </div>
      <div className="expense-action-buttons">
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>{t('common.cancel')}</button>
        <button type="submit" className="primary" disabled={busy}>{busy?<LoaderCircle/>:<ReceiptText/>}{t(busy?'expense.action.saving':expense?'expense.action.saveChanges':kind==='refund'?'expense.action.saveRefund':'expense.action.saveExpense')}</button>
      </div>
    </div>
  </form>
</Modal>
}
