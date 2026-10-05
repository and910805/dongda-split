import React, {useEffect, useMemo, useRef, useState} from 'react';
import {SUPPORTED_CURRENCIES, amountCentsToInputValue, convertAmountCents, getCurrency, isSupportedCurrency, parseCurrencyAmount} from '../currency.mjs';
import {createExpenseSubmissionKeyStore} from './expense-idempotency.mjs';
import {currentExpenseDate, expenseCalendarDate, isValidExpenseDate} from '../expense-date.mjs';
import {canRetryPendingExpense, createExpensePendingStore, createPendingExpenseSubmission, expenseSavedSnapshot, isUncertainExpenseError, pendingExpenseRequestOptions, reconcileExpenseSubmission, requestExpenseJson} from './expense-submission.mjs';
import {createExpensePreview} from './expense-preview.mjs';
import {EntryAvatar, EntryIcon, EntrySectionTitle} from './ExpenseEntryParts.jsx';
import {ENTRY_CATEGORIES, ENTRY_CURRENCY_NAMES, ENTRY_SPLITS, entryAmountError, entryCategoryLabel, entryPreviewError, entryServiceError, entryShare, formatEntryAmount as formatCurrencyAmount} from './expense-entry-ui.mjs';
import './expense-single-modal.css';

const api = async (url, options = {}) => {
  const response = await fetch(url, {...options, headers: {'content-type': 'application/json', ...(options.headers || {})}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('請求失敗');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

function Modal({children, close}) {
  const overlayRef = useRef(null), dialogRef = useRef(null), closeRef = useRef(close);
  const returnFocus = useRef(document.activeElement);
  closeRef.current = close;
  useEffect(() => {
    const overlay = overlayRef.current, dialog = dialogRef.current;
    const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const blocked = [...(overlay?.parentElement?.children || [])].filter(item => item !== overlay)
      .map(item => ({item, inert: item.inert, hidden: item.getAttribute('aria-hidden')}));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    blocked.forEach(({item}) => { item.inert = true; item.setAttribute('aria-hidden', 'true'); });
    const timer = setTimeout(() => {
      if (dialog && !dialog.contains(document.activeElement)) dialog.querySelector(selector)?.focus();
    }, 0);
    const keydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll(selector)].filter(item => !item.matches(':disabled') && item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      blocked.forEach(({item, inert, hidden}) => {
        item.inert = inert;
        if (hidden === null) item.removeAttribute('aria-hidden'); else item.setAttribute('aria-hidden', hidden);
      });
      returnFocus.current?.focus?.();
    };
  }, []);
  return <div ref={overlayRef} className="overlay expense-single-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="modal real-modal advanced-modal expense-single-modal" role="dialog" aria-modal="true" aria-labelledby="es-title" aria-describedby="es-context" lang="zh-TW" tabIndex={-1}>{children}</div>
  </div>;
}

export function AdvancedExpenseModal({group,currencies=[],expense=null,initialKind='expense',currentUserId,onNotice,close,done}){
  const formRef=useRef(null),errorRef=useRef(null),submissionKeyStoreRef=useRef(null),savingRef=useRef(false),pendingStoreRef=useRef(null);
  if(!submissionKeyStoreRef.current)submissionKeyStoreRef.current=createExpenseSubmissionKeyStore();
  if(!pendingStoreRef.current)pendingStoreRef.current=createExpensePendingStore({userId:currentUserId,groupId:group.id,expenseId:expense?.id});
  const [initialPending]=useState(()=>pendingStoreRef.current.load());
  const restored=initialPending?.form||{};
  const scrollRef = useRef(null);
  // Keep the action bar above the virtual keyboard without losing form state.
  useEffect(()=>{
    const viewport=window.visualViewport;
    if(!viewport)return;
    const update=()=>{
      const dialog=formRef.current?.closest('.expense-single-modal');
      dialog?.style.setProperty('--es-viewport-height',`${viewport.height}px`);
      const overlay=dialog?.parentElement;
      if(overlay){overlay.style.height=`${viewport.height}px`;overlay.style.top=`${viewport.offsetTop}px`;overlay.style.bottom='auto'}
    };
    update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
    return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update)};
  },[]);

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
    if(!raw)return allowZero?{cents:0,error:''}:{cents:null,error:'請輸入金額。'};
    try{return{cents:parseCurrencyAmount(raw,currencyCode,{allowZero,allowNegative:false}),error:''}}
    catch(parseError){return{cents:null,error:entryAmountError(currencyCode)}}
  };
  const people=(group.members||[]).filter(x=>!x.isFund),payers=people;
  const defaultPerson=people.find(person=>String(person.id)===String(currentUserId))||people[0],defaultPersonId=defaultPerson?.id;
  const shareAmounts=storedShares.map(x=>Math.abs(Number(x.amountCents))),looksEqual=shareAmounts.length>0&&Math.max(...shareAmounts)-Math.min(...shareAmounts)<=initialCurrency.quantum;
  const supportedModes=['equal','exact','hybrid','weights'],initialMode=supportedModes.includes(expense?.splitMode)?expense.splitMode:expense?(looksEqual?'equal':'exact'):'equal';
  const metadataParticipants=Array.isArray(splitMeta.participantIds)?splitMeta.participantIds.map(String):[],metadataRows=initialMode==='weights'&&Array.isArray(splitMeta.weights)?splitMeta.weights:initialMode==='hybrid'&&Array.isArray(splitMeta.fixedShares)?splitMeta.fixedShares:initialMode==='exact'&&Array.isArray(splitMeta.shares)?splitMeta.shares:[];
  const initialSelected=expense?(metadataParticipants.length?metadataParticipants:metadataRows.length?metadataRows.map(x=>String(x.userId)):storedShares.map(x=>String(x.userId))):defaultPersonId===undefined?[]:[defaultPersonId];
  const initialValueRows=metadataRows.length?metadataRows.map(x=>({userId:String(x.userId),value:initialMode==='weights'?String(x.weight??''):String(x.amount??'')})):storedShares.map(x=>({userId:String(x.userId),value:inputAmount(x.amountCents,initialCurrencyCode)}));
  const legacyHybrid=Boolean(expense&&initialMode==='hybrid'&&!Array.isArray(splitMeta.fixedShares));
  const preserveManualRate=storedCurrencyMeta.rateMode==='manual'&&storedCurrencyMeta.ledgerCurrency===ledgerCurrencyCode&&initialCurrencyCode!==ledgerCurrencyCode;
  const [currencyCode,setCurrencyCode]=useState(restored.currencyCode??initialCurrencyCode),[kind,setKind]=useState(restored.kind??(expense?((storedCurrencyMeta.inputAmountCents??expense.amountCents)<0?'refund':'expense'):initialKind)),[title,setTitle]=useState(restored.title??expense?.title??''),[amount,setAmount]=useState(restored.amount??(expense?inputAmount(storedCurrencyMeta.inputAmountCents??expense.amountCents,initialCurrencyCode):'')),[category,setCategory]=useState(restored.category??expense?.category??'\u9910\u98f2'),[payMode,setPayMode]=useState(restored.payMode??(storedPayments.length>1?'multiple':'single')),[payerId,setPayerId]=useState(restored.payerId??(expense?(storedPayments[0]?.userId||payers[0]?.id):defaultPersonId)),[payerAmounts,setPayerAmounts]=useState(restored.payerAmounts??Object.fromEntries(storedPayments.map(x=>[x.userId,inputAmount(x.amountCents,initialCurrencyCode)]))),[mode,setMode]=useState(restored.mode??initialMode),[selected,setSelected]=useState(restored.selected??initialSelected),[values,setValues]=useState(restored.values??Object.fromEntries(initialValueRows.map(x=>[x.userId,x.value]))),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState('');
  const [expenseDate,setExpenseDate]=useState(restored.expenseDate??(expense?expenseCalendarDate(expense):currentExpenseDate()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [discardAction, setDiscardAction] = useState(null);
  const [fixedMembers, setFixedMembers] = useState(() => new Set(initialValueRows.filter(row => Number(row.value) > 0).map(row => String(row.userId))));
  const initialDraftRef = useRef(null);
  const detailsButtonRef = useRef(null), discardRef = useRef(null);
  const [pending,setPending]=useState(initialPending),[pendingPersisted,setPendingPersisted]=useState(Boolean(initialPending)),[submissionState,setSubmissionState]=useState(initialPending?'unknown':'idle');
  const [latestConflict,setLatestConflict]=useState(false);
  const [pendingResolution,setPendingResolution]=useState(null);
  const [exchangeRate,setExchangeRate]=useState(restored.exchangeRate??(preserveManualRate?String(storedCurrencyMeta.rate||''):'')),[exchangeRateMode,setExchangeRateMode]=useState(restored.exchangeRateMode??(preserveManualRate?'manual':'quoted')),[exchangeRateToken,setExchangeRateToken]=useState(restored.exchangeRateToken??''),[rateLoading,setRateLoading]=useState(false),[rateError,setRateError]=useState(''),[rateInfo,setRateInfo]=useState(null);
  useEffect(()=>{
    if(!['unknown','failed'].includes(submissionState)||busy)return;
    const frame=requestAnimationFrame(()=>{
      const notice=errorRef.current;
      if(!notice)return;
      notice.focus({preventScroll:true});
      const dialog=notice.closest('[role="dialog"]');
      if(submissionState==='unknown'&&scrollRef.current)scrollRef.current.scrollTop=0;
      else notice.scrollIntoView({block:'center',behavior:'instant'});
    });
    return()=>cancelAnimationFrame(frame);
  },[submissionState,error,busy]);
  const currency=getCurrency(currencyCode);
  useEffect(()=>{
    if(pending)return;
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
      setRateError('目前無法取得匯率，請輸入自訂匯率後繼續。');
    }).finally(()=>{if(active)setRateLoading(false)});
    return()=>{active=false};
  },[currencyCode,exchangeRateMode,group.id,ledgerCurrencyCode,Boolean(pending)]);
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
  const weightInvalid=selected.some(id=>! /^(\d+)(?:\.\d+)?$/.test(String(values[id]||'1').trim())||Number(values[id]||1)<=0);
  const dateError=isValidExpenseDate(expenseDate)?'':'請選擇有效日期。';
  const rateValid=currencyCode===ledgerCurrencyCode||(/^(\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(exchangeRate).trim())&&Number(exchangeRate)>0);
  let convertedPreviewCents=null;
  if(totalCents!==null&&totalCents>0&&rateValid){
    try{convertedPreviewCents=currencyCode===ledgerCurrencyCode?totalCents:convertAmountCents(totalCents,exchangeRate,ledgerCurrencyCode,{sourceCurrency:currencyCode})}
    catch{convertedPreviewCents=null}
  }
  const conversionError = totalCents > 0 && currencyCode !== ledgerCurrencyCode && !rateLoading && rateValid && convertedPreviewCents === null ? '換算後金額超出可處理範圍，請檢查金額與匯率。' : '';
  const basicError=!title.trim()?'請填寫項目名稱。':totalCents===null?parsedTotal.error:totalCents<=0?'總金額必須大於 0。':dateError||conversionError||(currencyCode!==ledgerCurrencyCode&&rateLoading?'正在取得匯率，請稍候。':!rateValid?`請輸入 1 ${currencyCode} 可兌換多少 ${ledgerCurrencyCode}。`:convertedPreviewCents===0?`換算後金額小於 ${ledgerCurrencyCode} 的最小單位。`:'');
  const preview=useMemo(()=>createExpensePreview({amountCents:totalCents,currency:currencyCode,mode,participantIds:selected,values}),[totalCents,currencyCode,mode,selected,values]);
  const validationError=useMemo(()=>{if(basicError)return basicError;if(!selected.length)return '請至少選擇一位分攤成員。';if(payMode==='multiple'&&payerInputInvalid)return `每筆付款金額必須符合 ${currencyCode} 的小數位規則。`;if(payMode==='multiple'&&payerTotalCents!==totalCents)return `付款加總必須為 ${formatCurrencyAmount(totalCents,currencyCode)}，目前為 ${formatCurrencyAmount(payerTotalCents,currencyCode)}。`;if(mode==='exact'&&(valueInputInvalid||blankCount>0))return `請為每位已選成員填寫大於 0 的 ${currencyCode} 金額。`;if(mode==='exact'&&valueTotalCents!==totalCents)return '每人金額加總必須等於總金額。';if(mode==='hybrid'&&valueInputInvalid)return `固定金額必須符合 ${currencyCode} 的小數位規則。`;if(mode==='hybrid'&&(valueTotalCents>=totalCents||blankCount===0))return '請保留至少一人均分剩餘金額，且固定金額加總必須小於總金額。';if(mode==='weights'&&weightInvalid)return '每位成員的份數必須大於 0。';return ''},[basicError,totalCents,currencyCode,selected,payMode,payerInputInvalid,payerTotalCents,mode,valueInputInvalid,blankCount,valueTotalCents,weightInvalid]);
  const completeSubmission=result=>{
    pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();
    setPending(null);setSubmissionState('idle');setBusy(false);savingRef.current=false;
    done(result);
  };
  const keepUncertain=(record,message='儲存結果尚未確認，原始輸入內容已保留。')=>{
    setPending(record);setSubmissionState('unknown');setError(message);
    setPendingPersisted(pendingStoreRef.current.save(record));
  };
  const checkSavedExpense=async record=>{
    const latest=await requestExpenseJson(`/api/groups/${group.id}`);
    return reconcileExpenseSubmission(record,latest);
  };
  const sendSubmission=async(record,{retry=false}={})=>{
    if(savingRef.current)return;
    savingRef.current=true;setBusy(true);setError('');
    try{
      if(retry&&!canRetryPendingExpense(record)){
        setPendingResolution('expired');
        keepUncertain(record,'已超過安全重試期限，請先核對帳本，避免重複新增。');return;
      }
      if(retry&&record.method==='PATCH'){
        const outcome=await checkSavedExpense(record);
        if(outcome==='applied'){completeSubmission({alreadyApplied:true});return}
        if(outcome!=='unchanged'){
          setLatestConflict(outcome==='changed');
          keepUncertain(record,'帳目已變更或暫時無法核對，請查看最新帳本；原始輸入仍保留在此分頁。');return;
        }
      }
      const url=record.method==='PATCH'?`/api/groups/${group.id}/expenses/${record.expenseId}`:`/api/groups/${group.id}/expenses`;
      const result=await requestExpenseJson(url,pendingExpenseRequestOptions(record));
      if(!result.id)throw new Error('尚未收到可確認的儲存結果。');
      completeSubmission(result);
    }catch(requestError){
      if(isUncertainExpenseError(requestError)){
        if(record.method==='PATCH'){
          try{if(await checkSavedExpense(record)==='applied'){completeSubmission({alreadyApplied:true});return}}catch{}
        }
        keepUncertain(record);
      }else if(retry&&requestError.data?.code==='ACCOUNT_CHANGED'){
        keepUncertain(record,'登入帳號已變更，請切回原帳號後再確認這次儲存結果。');
      }else if(retry&&requestError.status===410&&requestError.data?.code==='IDEMPOTENT_RESOURCE_DELETED'){
        setPendingResolution('deleted');
        keepUncertain(record,'這筆帳目曾經儲存，之後已被刪除；確認結果不會重新建立帳目。');
      }else if(retry&&record.method==='PATCH'){
        try{const outcome=await checkSavedExpense(record);if(outcome==='applied'){completeSubmission({alreadyApplied:true});return}setLatestConflict(outcome==='changed'||(outcome==='unchanged'&&requestError.data?.code==='LEDGER_VERSION_CHANGED'))}catch{}
        keepUncertain(record,`前一次儲存結果仍未確認。 ${entryServiceError(requestError)}`);
      }else if(retry&&([401,403,404,410].includes(requestError.status)||requestError.data?.code==='IDEMPOTENCY_KEY_REUSED')){
        keepUncertain(record,`暫時無法核對前一次儲存結果。 ${entryServiceError(requestError)}`);
      }else{
        pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();
        setPending(null);setSubmissionState('failed');setError(entryServiceError(requestError));
      }
    }finally{savingRef.current=false;setBusy(false)}
  };
  const closeModal=()=>{
    if(savingRef.current||busy)return;
    if(pending&&!pendingPersisted){setError('瀏覽器無法暫存這次提交，請保持視窗開啟並確認儲存結果。');return}
    if(!pending&&isDirty){setDiscardAction('close');return;}
    if(pending)onNotice?.('這筆帳目的儲存結果尚未確認，請重新開啟記帳視窗確認。','info');
    close();
  };
  const keepLatestExpense=()=>{
    if((!latestConflict&&!pendingResolution)||savingRef.current||busy)return;
    pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();
    done({cancelled:true,reason:pendingResolution||'changed'});
  };
  const submit=e=>{
    e.preventDefault();if(savingRef.current||busy)return;
    if(pending){sendSubmission(pending,{retry:true});return}
    setAttempted(true);
    if(validationError||dateError||preview.error||fixedError){setError('');setSubmissionState('idle');focusError();return}
    const payload={kind,title,amount:amount.trim(),currency:ledgerCurrencyCode,expenseCurrency:currencyCode,expenseDate,exchangeRate:currencyCode===ledgerCurrencyCode?'1':String(exchangeRate).trim(),exchangeRateMode:currencyCode===ledgerCurrencyCode?'identity':exchangeRateMode,exchangeRateToken:exchangeRateMode==='quoted'?exchangeRateToken:'',expectedUserId:currentUserId,ledgerVersion:group.ledgerVersion,category,splitMode:mode,participantIds:selected};
    if(payMode==='single')payload.payerId=payerId;
    else payload.payers=payers.filter(p=>(parsedPayers[p.id]?.cents||0)>0).map(p=>({userId:p.id,amount:String(payerAmounts[p.id]).trim()}));
    if(mode==='exact')payload.shares=selected.map(userId=>({userId,amount:String(values[userId]).trim()}));
    if(mode==='hybrid')payload.fixedShares=selected.filter(id=>(parsedValues[id]?.cents||0)>0).map(userId=>({userId,amount:String(values[userId]).trim()}));
    if(mode==='weights')payload.weights=selected.map(userId=>({userId,weight:String(values[userId]||1).trim()}));
    const form={kind,title,amount,currencyCode,expenseDate,exchangeRate,exchangeRateMode,exchangeRateToken,category,payMode,payerId,payerAmounts,mode,selected,values};
    const record=createPendingExpenseSubmission({method:expense?'PATCH':'POST',payload,keyStore:submissionKeyStoreRef.current,expenseId:expense?.id,initialSnapshot:expenseSavedSnapshot(expense,ledgerCurrencyCode),form});
    setPending(record);setPendingPersisted(pendingStoreRef.current.save(record));sendSubmission(record);
  };
  const draft = {kind, title, amount, currencyCode, expenseDate, category, payMode, payerId, payerAmounts, mode, selected, values, exchangeRateMode, exchangeRate: exchangeRateMode === 'manual' ? exchangeRate : ''};
  const draftSignature = JSON.stringify(draft);
  if (initialDraftRef.current === null) initialDraftRef.current = draftSignature;
  const isDirty = initialDraftRef.current !== draftSignature;
  const locked = busy || Boolean(pending);
  const refund = kind === 'refund';
  const currentMember = people.find(person => String(person.id) === String(currentUserId));
  const hasSelected = id => selected.some(value => String(value) === String(id));
  const onlyMe = selected.length === 1 && String(selected[0]) === String(currentUserId);
  const personName = person => String(person.id) === String(currentUserId) ? '你' : person.displayName || '成員';
  const paidName = id => personName(people.find(person => String(person.id) === String(id)) || {id, displayName: '成員'});
  const ownRow = preview.rows.find(row => row.userId === String(currentUserId));
  const ownPaid = payMode === 'single'
    ? (String(payerId) === String(currentUserId) ? totalCents || 0 : 0)
    : parsedPayers[currentUserId]?.cents || 0;
  const previewMessage = entryPreviewError(preview, {totalCents, currency: currencyCode, selectedCount: selected.length, mode});
  const fixedError = mode === 'hybrid' && selected.some(id => fixedMembers.has(String(id)) && (parsedValues[id]?.cents || 0) <= 0)
    ? '請輸入大於 0 的固定金額，或改選「均分剩餘」。' : '';
  const displayError = error || (attempted ? dateError || validationError || fixedError || previewMessage : '');
  const canPreview = !preview.error && !fixedError;
  const selectedSplit = ENTRY_SPLITS.find(item => item.id === mode) || ENTRY_SPLITS[0];
  const ownAmount = canPreview ? entryShare(ownRow, currencyCode) : '—';
  const togglePerson = id => setSelected(old => old.some(value => String(value) === String(id)) ? old.filter(value => String(value) !== String(id)) : [...old, id]);
  const selectMode = next => {
    setMode(next);
    if (next === 'hybrid') setFixedMembers(new Set(selected.filter(id => (parsedValues[id]?.cents || 0) > 0).map(String)));
  };
  const fixedRole = id => fixedMembers.has(String(id)) || (parsedValues[id]?.cents || 0) > 0;
  const changeFixedRole = (id, isFixed) => {
    setFixedMembers(old => { const next = new Set(old); isFixed ? next.add(String(id)) : next.delete(String(id)); return next; });
    setValues(old => ({...old, [id]: ''}));
  };
  const jumpTo = section => {
    const target = formRef.current?.querySelector(`#es-${section}`);
    target?.scrollIntoView({block: 'start', behavior: 'instant'});
    target?.querySelector('h3')?.focus({preventScroll: true});
  };
  const focusError = () => requestAnimationFrame(() => {
    const invalid = [...(formRef.current?.querySelectorAll('[aria-invalid="true"]') || [])].find(node => node.getClientRects().length);
    const target = invalid || errorRef.current;
    target?.focus({preventScroll: true});
    target?.scrollIntoView({block: 'center', behavior: 'instant'});
  });
  const toggleDetails = () => {
    if (detailsOpen) { setDetailsOpen(false); detailsButtonRef.current?.focus(); return; }
    setDetailsOpen(true);
    requestAnimationFrame(() => {
      const details = formRef.current?.querySelector('#es-details');
      details?.scrollIntoView({block: 'start', behavior: 'instant'});
      details?.querySelector('h3')?.focus({preventScroll: true});
    });
  };
  useEffect(() => {
    if (!discardAction) return;
    discardRef.current?.scrollIntoView({block: 'start', behavior: 'instant'});
    discardRef.current?.querySelector('button')?.focus({preventScroll: true});
  }, [discardAction]);
  const resetDraft = () => {
    if (locked) return;
    setKind('expense'); setTitle(''); setAmount(''); setCurrencyCode(ledgerCurrencyCode);
    setExpenseDate(currentExpenseDate()); setCategory(ENTRY_CATEGORIES[0].value);
    setPayMode('single'); setPayerId(defaultPersonId); setPayerAmounts({});
    setMode('equal'); setSelected(defaultPersonId === undefined ? [] : [defaultPersonId]);
    setValues({}); setFixedMembers(new Set()); setExchangeRateMode('quoted');
    setExchangeRate('1'); setExchangeRateToken(''); setRateInfo(null); setRateError('');
    setError(''); setAttempted(false); setDetailsOpen(false); setDiscardAction(null);
    setSubmissionState('idle');
    initialDraftRef.current = JSON.stringify({kind: 'expense', title: '', amount: '', currencyCode: ledgerCurrencyCode,
      expenseDate: currentExpenseDate(), category: ENTRY_CATEGORIES[0].value, payMode: 'single', payerId: defaultPersonId,
      payerAmounts: {}, mode: 'equal', selected: defaultPersonId === undefined ? [] : [defaultPersonId], values: {},
      exchangeRateMode: 'quoted', exchangeRate: ''});
    requestAnimationFrame(() => { jumpTo('basics'); formRef.current?.querySelector('#es-amount')?.focus(); });
  };
  const confirmDiscard = () => { if (locked) return; if (discardAction === 'reset') resetDraft(); else close(); };
  const paymentRows = payMode === 'single' ? [{userId: payerId, cents: totalCents || 0}]
    : people.filter(person => parsedPayers[person.id]?.cents > 0).map(person => ({userId: person.id, cents: parsedPayers[person.id].cents}));

  return <Modal close={() => { if (discardAction) setDiscardAction(null); else closeModal(); }}>
    <header className="es-modal-header">
      <div><p id="es-context" className="es-context"><EntryIcon name="pin"/><span>{group.name}</span><span className="es-ledger-code">{ledgerCurrencyCode} 帳本</span></p>
        <div className="es-heading-line"><h2 id="es-title">{expense ? '編輯帳目' : '記一筆'}</h2><span className="es-one-page">一頁完成</span></div>
        <p className="es-intro">填金額、選成員，分攤立即算好。</p>
      </div>
      <div className="es-header-actions">{!expense && <button type="button" className="es-reset" disabled={locked} onClick={() => isDirty ? setDiscardAction('reset') : resetDraft()}>清空表單</button>}
        <button type="button" className="es-close" aria-label="關閉記帳視窗" onClick={closeModal} disabled={busy}><EntryIcon name="close"/></button>
      </div>
    </header>
    <nav className="es-jump" aria-label="跳至記帳區塊">
      <button type="button" onClick={() => jumpTo('basics')}><span aria-hidden="true">1</span>支出內容</button>
      <button type="button" onClick={() => jumpTo('payments')}><span aria-hidden="true">2</span>{refund ? '誰收退款' : '誰先付'}</button>
      <button type="button" onClick={() => jumpTo('participants')}><span aria-hidden="true">3</span>誰一起分</button>
    </nav>
    <form ref={formRef} className="es-form" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="es-scroll" ref={scrollRef}>
        {discardAction && <section ref={discardRef} className="es-notice es-discard" aria-label="尚未儲存的變更">
          <div><strong>{discardAction === 'reset' ? '要清空這份草稿嗎？' : '要放棄尚未儲存的變更嗎？'}</strong><p>本次變更尚未儲存，不會影響帳本中既有的紀錄。</p></div>
          <div className="es-notice-actions"><button type="button" className="es-secondary" onClick={() => setDiscardAction(null)}>繼續編輯</button><button type="button" className="es-danger" onClick={confirmDiscard}>{discardAction === 'reset' ? '清空草稿' : '放棄並關閉'}</button></div>
        </section>}
        {submissionState === 'unknown' && <section ref={errorRef} className="es-notice es-unknown" role="alert" tabIndex={-1}>
          <div><strong><EntryIcon name="info"/>{pendingResolution === 'deleted' ? '這筆帳目已刪除' : '儲存結果尚未確認'}</strong>
            <p>{error || '已恢復上次的提交，請先確認儲存結果，再新增其他帳目。'}</p>
            <small>{pendingPersisted ? '原始提交已保留在此分頁；確認時會沿用同一次提交，避免重複記帳。' : '瀏覽器無法暫存，請保持視窗開啟並確認儲存結果。'}</small>
            {(latestConflict || pendingResolution) && <div className="es-resolution"><p>{pendingResolution === 'deleted'
              ? '可以結束這次確認，不會新增或撤銷任何帳目。'
              : pendingResolution === 'expired' ? '請先到帳本核對這筆紀錄。結束確認只會清除此分頁的待確認提交，不會撤銷已儲存的帳目。'
              : '帳本已有較新版本。保留最新帳目並放棄本機未確認的輸入，不會撤銷任何已儲存內容。'}</p>
              <button type="button" className="es-secondary" disabled={busy} onClick={keepLatestExpense}>{pendingResolution === 'deleted' ? '結束確認' : pendingResolution === 'expired' ? '已核對帳本，結束確認' : '保留最新帳目並關閉'}</button>
            </div>}
          </div>
        </section>}
        <div className={`es-card${refund ? ' es-refund' : ''}`}>
          <div className="es-card-head"><span><EntryIcon name="edit"/>{expense ? '修改內容' : refund ? '新增退款' : '新增支出'}</span>
            <div className="es-switch" role="group" aria-label="紀錄類型">
              <button type="button" aria-pressed={!refund} disabled={locked} onClick={() => setKind('expense')}>支出</button>
              <button type="button" aria-pressed={refund} disabled={locked} onClick={() => setKind('refund')}>退款</button>
            </div>
          </div>
          <fieldset className="es-grid" disabled={locked || Boolean(discardAction)}>
            <section className="es-section es-basics" id="es-basics" aria-labelledby="es-basics-heading">
              <EntrySectionTitle number="1" id="es-basics-heading" extra={<span className="es-label-note">金額與項目必填</span>}>{refund ? '收到多少退款？' : '這筆花了多少？'}</EntrySectionTitle>
              <div className="es-basics-grid">
                <div className={`es-amount-block${attempted && (totalCents === null || totalCents <= 0) ? ' es-invalid' : ''}`}>
                  <div className="es-amount-top"><label htmlFor="es-amount">{refund ? '退款金額' : '總金額'}</label><label className="es-sr-only" htmlFor="es-currency">記帳幣別</label>
                    <select id="es-currency" className="es-currency" value={currencyCode} onChange={event => changeCurrency(event.target.value)}>{currencyOptions.map(item => <option key={item.code} value={item.code}>{item.code} · {ENTRY_CURRENCY_NAMES[item.code] || item.code}</option>)}</select>
                  </div>
                  <div className="es-amount-line"><span aria-hidden="true">{currency.symbol}</span><input id="es-amount" autoFocus={!initialPending && window.matchMedia('(min-width: 761px)').matches} type="text" inputMode={currency.decimals ? 'decimal' : 'numeric'} autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" maxLength={24} required aria-invalid={attempted && (totalCents === null || totalCents <= 0)} aria-describedby="es-amount-error"/></div>
                  <p id="es-amount-error" className="es-field-error" hidden={!attempted || (totalCents !== null && totalCents > 0)}>{entryAmountError(currencyCode)}</p>
                </div>
                <label className="es-title-field" htmlFor="es-description"><span>{refund ? '退款項目' : '用在哪裡？'}</span><input id="es-description" type="text" value={title} onChange={event => setTitle(event.target.value)} placeholder={refund ? '例如：民宿退押金' : '例如：晚餐、住宿費'} maxLength={100} required autoComplete="off" aria-invalid={attempted && !title.trim()} aria-describedby="es-title-error"/></label>
                <p id="es-title-error" className="es-field-error" hidden={!attempted || Boolean(title.trim())}>請填寫項目名稱。</p>
                <div className="es-metadata"><label htmlFor="es-category"><EntryIcon name="food"/><span>分類</span><select id="es-category" value={category} onChange={event => setCategory(event.target.value)}>{!ENTRY_CATEGORIES.some(item => item.value === category) && <option value={category}>其他（既有分類）</option>}{ENTRY_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label htmlFor="es-date"><EntryIcon name="calendar"/><span>日期</span><input id="es-date" type="date" value={expenseDate} onChange={event => setExpenseDate(event.target.value)} required aria-invalid={attempted && Boolean(dateError)} aria-describedby="es-date-error"/></label>
                </div>
                <p id="es-date-error" className="es-field-error" hidden={!attempted || !dateError}>{dateError}</p>
                {expense && !expense.expenseDate && <p className="es-note">這筆舊帳目未記錄消費日期，暫以建立日期帶入，請確認後儲存。</p>}
              </div>
              {currencyCode !== ledgerCurrencyCode && <div className="es-rate-panel">
                <div className="es-rate-head"><b>換算為 {ledgerCurrencyCode}</b><span>{exchangeRateMode === 'manual' ? '自訂匯率' : rateLoading ? '取得匯率中…' : rateInfo?.rateDate ? `匯率日期 ${rateInfo.rateDate}` : '系統匯率'}</span></div>
                <div className="es-rate-inputs"><label htmlFor="es-rate">1 {currencyCode} =</label><input id="es-rate" type="number" min="0.000000001" step="any" inputMode="decimal" value={exchangeRate} onChange={event => {setExchangeRate(event.target.value); setExchangeRateMode('manual'); setExchangeRateToken(''); setRateError('');}} aria-label={`${ledgerCurrencyCode} ／每 1 ${currencyCode}`} aria-invalid={attempted && !rateValid}/><span>{ledgerCurrencyCode}</span>{exchangeRateMode === 'manual' && <button type="button" className="es-text-button" onClick={useLatestRate}>改用系統匯率</button>}</div>
                {rateError && <p className="es-field-error" role="status">{rateError}</p>}
                {rateInfo?.health?.warning && <p className="es-field-error" role="status">匯率來源發出警告，請核對匯率或輸入自訂匯率。</p>}
                {convertedPreviewCents !== null && <p className="es-rate-note">記入帳本 <strong>{formatCurrencyAmount(refund ? -Math.abs(convertedPreviewCents) : convertedPreviewCents, ledgerCurrencyCode)}</strong>；儲存後固定使用此匯率。</p>}
              </div>}
            </section>
            <section className="es-section es-payments" id="es-payments" aria-labelledby="es-payments-heading">
              <EntrySectionTitle number="2" id="es-payments-heading" extra={<div className="es-switch" role="group" aria-label="付款或收款人數"><button type="button" aria-pressed={payMode === 'single'} onClick={() => setPayMode('single')}>一人</button><button type="button" aria-pressed={payMode === 'multiple'} onClick={() => setPayMode('multiple')}>多人</button></div>}>{refund ? '誰收到退款？' : '誰先付款？'}</EntrySectionTitle>
              {payMode === 'single' ? <div className="es-pay-people" role="group" aria-label={refund ? '退款接收者' : '付款人'}>{people.map((person, index) => <button type="button" key={person.id} className="es-payer-chip" aria-pressed={String(payerId) === String(person.id)} onClick={() => setPayerId(person.id)}><EntryAvatar person={person} currentUserId={currentUserId} index={index}/><span>{personName(person)}</span>{String(payerId) === String(person.id) && <EntryIcon name="check"/>}</button>)}</div>
                : <div className="es-multiple-rows">{people.map((person, index) => <div className="es-multi-row" key={person.id}><label htmlFor={`es-paid-${index}`}><EntryAvatar person={person} currentUserId={currentUserId} index={index}/><span>{personName(person)}</span></label><div className="es-input-money"><span aria-hidden="true">{currency.symbol}</span><input id={`es-paid-${index}`} type="text" inputMode={currency.decimals ? 'decimal' : 'numeric'} maxLength={24} value={payerAmounts[person.id] || ''} onChange={event => setPayerAmounts(old => ({...old, [person.id]: event.target.value}))} placeholder="0" aria-label={`${refund ? '退款接收金額：' : '付款金額：'}${personName(person)} (${currencyCode})`} aria-invalid={attempted && parsedPayers[person.id]?.cents === null}/></div></div>)}
                  <p className="es-calculation" data-state={payerInputInvalid || payerTotalCents !== totalCents ? 'error' : 'ok'}><span>{payerInputInvalid ? '請檢查付款金額' : payerTotalCents === totalCents ? '付款加總一致' : (totalCents || 0) - payerTotalCents < 0 ? '超出' : '還差'}</span><strong>{payerTotalCents === totalCents ? formatCurrencyAmount(payerTotalCents, currencyCode) : formatCurrencyAmount(Math.abs((totalCents || 0) - payerTotalCents), currencyCode)}</strong></p>
                </div>}
              {!people.length && <p className="es-field-error">目前沒有可用成員，請先新增成員再記帳。</p>}
              <p className="es-note">{refund ? '收到退款的人不一定參與分配，可另外選擇分配成員。' : '先付款的人不一定參與分攤，請另外選擇分攤成員。'}</p>
            </section>
            <section className="es-section es-participants" id="es-participants" aria-labelledby="es-participants-heading">
              <EntrySectionTitle number="3" id="es-participants-heading" extra={<span className="es-label-note" aria-live="polite">已選 {selected.length}／{people.length} 人</span>}>{refund ? '誰分回退款？' : '誰一起分？'}</EntrySectionTitle>
              <div className="es-people-heading"><div role="group" aria-label="快速選擇分攤成員"><button type="button" className="es-quick-person" aria-pressed={onlyMe} disabled={!currentMember} onClick={() => setSelected(currentMember ? [currentMember.id] : [])}>只有我</button><button type="button" className="es-quick-person" aria-pressed={people.length > 0 && selected.length === people.length} onClick={() => setSelected(people.map(person => person.id))}>全部 {people.length} 人</button></div><span>點名字即可加入或移除</span></div>
              <div className="es-split-options" role="group" aria-label="分攤方式">{ENTRY_SPLITS.map(item => <button type="button" key={item.id} className="es-split-option" aria-pressed={mode === item.id} onClick={() => selectMode(item.id)}><EntryIcon name={item.icon}/>{item.label}</button>)}</div>
              <p className="es-split-description">{selectedSplit.help}</p>
              {legacyHybrid && mode === 'hybrid' && <p className="es-own-note"><EntryIcon name="info"/>這筆舊帳目未保留原始固定金額，請重新核對，並保留至少一人均分剩餘金額。</p>}
              <div className="es-people-table">{people.map((person, index) => {
                const included = hasSelected(person.id), row = preview.rows.find(item => item.userId === String(person.id));
                return <div className={`es-member-row es-mode-${mode}`} key={person.id} data-selected={included}>
                  <button type="button" className="es-person-button" aria-pressed={included} aria-label={`${included ? '移除' : '加入'} ${personName(person)}`} onClick={() => togglePerson(person.id)}><span className="es-check-box" aria-hidden="true">{included && <EntryIcon name="check"/>}</span><EntryAvatar person={person} currentUserId={currentUserId} index={index}/><span>{personName(person)}</span></button>
                  {!included ? <span className="es-not-included">未參與</span> : mode === 'equal' ? <strong className="es-member-amount">{canPreview ? entryShare(row, currencyCode) : '—'}</strong> : <div className="es-member-controls">
                    {mode === 'hybrid' && <select value={fixedRole(person.id) ? 'fixed' : 'remainder'} onChange={event => changeFixedRole(person.id, event.target.value === 'fixed')} aria-label={`分攤方式：${personName(person)}`}><option value="remainder">均分剩餘</option><option value="fixed">固定金額</option></select>}
                    {mode !== 'hybrid' || fixedRole(person.id) ? <div className="es-input-money">{mode !== 'weights' && <span aria-hidden="true">{currency.symbol}</span>}<input type="text" inputMode="decimal" maxLength={24} value={values[person.id] || ''} onChange={event => setValues(old => ({...old, [person.id]: event.target.value}))} placeholder={mode === 'weights' ? '1' : '0'} aria-label={`${mode === 'weights' ? '份數' : '分攤金額'}：${personName(person)}${mode === 'weights' ? '' : ` (${currencyCode})`}`} aria-invalid={attempted && (mode === 'weights' ? !/^(\d+)(?:\.\d+)?$/.test(String(values[person.id] || '1').trim()) || Number(values[person.id] || 1) <= 0 : parsedValues[person.id]?.cents === null || (parsedValues[person.id]?.cents || 0) <= 0)}/>{mode === 'weights' && <span>份</span>}</div> : <strong className="es-member-amount">{canPreview ? entryShare(row, currencyCode) : '—'}</strong>}
                  </div>}
                </div>;
              })}</div>
              <div className="es-calculation" aria-live="polite" data-state={canPreview ? 'ok' : 'error'}><span>{canPreview ? <><EntryIcon name="check"/>{refund ? '退款分配合計一致' : '分攤合計一致'}</> : mode === 'exact' && totalCents > 0 && !valueInputInvalid && valueTotalCents !== totalCents ? (valueTotalCents > totalCents ? '超出' : '尚未分配') : fixedError || previewMessage}</span><strong>{canPreview ? formatCurrencyAmount(totalCents, currencyCode) : mode === 'exact' && totalCents > 0 && !valueInputInvalid && valueTotalCents !== totalCents ? formatCurrencyAmount(Math.abs(totalCents - valueTotalCents), currencyCode) : ''}</strong></div>
              {mode === 'hybrid' && !valueInputInvalid && totalCents > valueTotalCents && <p className="es-note">固定金額： {formatCurrencyAmount(valueTotalCents, currencyCode)}；剩餘： {formatCurrencyAmount(totalCents - valueTotalCents, currencyCode)}，由 {blankCount} 人均分。</p>}
              {onlyMe && people.length > 1 && <p className="es-own-note"><EntryIcon name="info"/><span>目前只有你參與。要一起分配，請按「全部 {people.length} 人」，或點選其他成員。</span></p>}
              {preview.hasRemainder && <p className="es-note">顯示金額為可能範圍；尾差由系統於儲存時分配，合計不變。</p>}
              {currencyCode !== ledgerCurrencyCode && <p className="es-note">每人金額以 {currencyCode} 顯示，換算後的尾差以系統儲存結果為準。</p>}
            </section>
          </fieldset>
        </div>
        {submissionState !== 'unknown' && displayError && <div ref={errorRef} className="es-notice es-error" role="alert" tabIndex={-1}><EntryIcon name="info"/><div><strong>{submissionState === 'failed' ? '未儲存' : '請檢查帳目內容'}</strong><p>{displayError}</p></div></div>}
        <section hidden={!detailsOpen} id="es-details" className="es-details" aria-labelledby="es-details-heading">
          <div className="es-details-head"><h3 id="es-details-heading" tabIndex={-1}>帳目明細 <small>{pending ? '結果待確認' : '尚未儲存'}</small></h3><button type="button" className="es-text-button" onClick={toggleDetails}>收起明細<EntryIcon name="close"/></button></div>
          <div className="es-receipt-grid"><div><h4>{title.trim() || (refund ? '這筆退款' : '這筆支出')}</h4><strong className="es-receipt-total">{formatCurrencyAmount(totalCents || 0, currencyCode)}</strong><p>{expenseDate} · {currencyCode} · {entryCategoryLabel(category)}</p>
            <div className="es-receipt-rule"/>{paymentRows.map(row => <p className="es-receipt-row" key={row.userId}><span>{paidName(row.userId)} {refund ? '收到退款' : '先付'}</span><strong>{formatCurrencyAmount(row.cents, currencyCode)}</strong></p>)}
            {currencyCode !== ledgerCurrencyCode && convertedPreviewCents !== null && <p className="es-receipt-row"><span>帳本金額（{ledgerCurrencyCode}）</span><strong>{formatCurrencyAmount(refund ? -convertedPreviewCents : convertedPreviewCents, ledgerCurrencyCode)}</strong></p>}
          </div><div><p>{selected.length} 人 · {selectedSplit.label}</p>{canPreview ? preview.rows.map(row => <p className="es-receipt-row" key={row.userId}><span>{paidName(row.userId)}</span><strong>{entryShare(row, currencyCode)}</strong></p>) : <p>{fixedError || previewMessage}</p>}
            {preview.hasRemainder && <p className="es-note">目前為預估範圍，尾差以系統儲存結果為準。</p>}
            <div className="es-personal-summary"><span>你 {refund ? '收到退款' : '先付'} {formatCurrencyAmount(ownPaid, currencyCode)}</span><strong>{refund ? '你分回' : '你分攤'} {ownAmount}</strong></div>
          </div></div>
        </section>
        <p className="es-security-note"><EntryIcon name="lock"/>按下儲存才會記入帳本，不會自動轉帳。</p>
      </div>
      <footer className="es-save-dock">
        <div className="es-dock-summary" aria-live="polite" aria-atomic="true"><strong>{refund ? '你分回' : '你分攤'} {ownAmount}</strong><small>你 {refund ? '收到退款' : '先付'} {formatCurrencyAmount(ownPaid, currencyCode)} · {selected.length} 人 · {selectedSplit.label}</small></div>
        <button ref={detailsButtonRef} type="button" className="es-text-button es-dock-detail" aria-expanded={detailsOpen} aria-controls="es-details" onClick={toggleDetails}>{detailsOpen ? '收起明細' : '查看明細'}<EntryIcon name="right"/></button>
        <div className="es-dock-actions"><button type="button" className="es-text-button es-cancel" onClick={closeModal} disabled={busy}>{pending ? '稍後確認' : '取消'}</button><button type="submit" className="es-save" disabled={busy || Boolean(discardAction)}><EntryIcon name={busy ? 'ratio' : 'check'} className={busy ? 'es-busy' : ''}/><span>{busy ? pending && submissionState === 'unknown' ? '確認中…' : '儲存中…' : pending ? '確認儲存結果' : expense ? '儲存修改' : refund ? '儲存退款' : '儲存支出'}</span></button></div>
      </footer>
    </form>
  </Modal>;
}
