import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {acquireModalEnvironment} from './modal-environment.mjs';
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
    const error = new Error('Request failed');
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
    // A body-level portal keeps fixed navigation outside this modal's stack.
    // Share the existing reference-counted background lock with other dialogs.
    const releaseEnvironment = acquireModalEnvironment(overlay);
    const timer = setTimeout(() => {
      if (dialog && !dialog.contains(document.activeElement)) dialog.querySelector(selector)?.focus();
    }, 0);
    const keydown = event => {
      if (event.isComposing || dialog.closest('[inert]')) return;
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
      releaseEnvironment();
      returnFocus.current?.focus?.();
    };
  }, []);
  return createPortal(<div ref={overlayRef} className="overlay expense-single-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="modal real-modal advanced-modal expense-single-modal" role="dialog" aria-modal="true" aria-labelledby="es-title" aria-describedby="es-context" lang="en" tabIndex={-1}>{children}</div>
  </div>, document.body);
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
    if(!raw)return allowZero?{cents:0,error:''}:{cents:null,error:'Enter an amount.'};
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
      setRateError('The current rate is unavailable. Enter a custom rate to continue.');
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
  const dateError=isValidExpenseDate(expenseDate)?'':'Choose a valid date.';
  const rateValid=currencyCode===ledgerCurrencyCode||(/^(\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(exchangeRate).trim())&&Number(exchangeRate)>0);
  let convertedPreviewCents=null;
  if(totalCents!==null&&totalCents>0&&rateValid){
    try{convertedPreviewCents=currencyCode===ledgerCurrencyCode?totalCents:convertAmountCents(totalCents,exchangeRate,ledgerCurrencyCode,{sourceCurrency:currencyCode})}
    catch{convertedPreviewCents=null}
  }
  const conversionError = totalCents > 0 && currencyCode !== ledgerCurrencyCode && !rateLoading && rateValid && convertedPreviewCents === null ? 'The converted amount is outside the supported range. Check the amount and exchange rate.' : '';
  const basicError=!title.trim()?'Enter a description.':totalCents===null?parsedTotal.error:totalCents<=0?'The total must be greater than zero.':dateError||conversionError||(currencyCode!==ledgerCurrencyCode&&rateLoading?'Getting the exchange rate. Please wait.':!rateValid?`Enter the ${ledgerCurrencyCode} value of 1 ${currencyCode}.`:convertedPreviewCents===0?`The converted amount is below the minimum ${ledgerCurrencyCode} unit.`:'');
  const preview=useMemo(()=>createExpensePreview({amountCents:totalCents,currency:currencyCode,mode,participantIds:selected,values}),[totalCents,currencyCode,mode,selected,values]);
  const validationError=useMemo(()=>{if(basicError)return basicError;if(!selected.length)return 'Select at least one person to split with.';if(payMode==='multiple'&&payerInputInvalid)return `All payment amounts must follow the ${currencyCode} decimal rules.`;if(payMode==='multiple'&&payerTotalCents!==totalCents)return `Payments must total ${formatCurrencyAmount(totalCents,currencyCode)}; currently ${formatCurrencyAmount(payerTotalCents,currencyCode)}.`;if(mode==='exact'&&(valueInputInvalid||blankCount>0))return `Enter a positive ${currencyCode} amount for every selected person.`;if(mode==='exact'&&valueTotalCents!==totalCents)return 'The amounts must add up to the total.';if(mode==='hybrid'&&valueInputInvalid)return `Fixed amounts must follow the ${currencyCode} decimal rules.`;if(mode==='hybrid'&&(valueTotalCents>=totalCents||blankCount===0))return 'Keep at least one person sharing the remainder; fixed amounts must be less than the total.';if(mode==='weights'&&weightInvalid)return 'Each person must have a positive number of shares.';return ''},[basicError,totalCents,currencyCode,selected,payMode,payerInputInvalid,payerTotalCents,mode,valueInputInvalid,blankCount,valueTotalCents,weightInvalid]);
  const completeSubmission=result=>{
    pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();
    setPending(null);setSubmissionState('idle');setBusy(false);savingRef.current=false;
    done(result);
  };
  const keepUncertain=(record,message='The save result is not confirmed. Your original input has been kept.')=>{
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
        keepUncertain(record,'The safe retry period has expired. Check the ledger before creating another entry.');return;
      }
      if(retry&&record.method==='PATCH'){
        const outcome=await checkSavedExpense(record);
        if(outcome==='applied'){completeSubmission({alreadyApplied:true});return}
        if(outcome!=='unchanged'){
          setLatestConflict(outcome==='changed');
          keepUncertain(record,'The entry changed or could not be verified. Check the latest ledger; your original input is kept in this tab.');return;
        }
      }
      const url=record.method==='PATCH'?`/api/groups/${group.id}/expenses/${record.expenseId}`:`/api/groups/${group.id}/expenses`;
      const result=await requestExpenseJson(url,pendingExpenseRequestOptions(record));
      if(!result.id)throw new Error('No confirmed save result was received.');
      completeSubmission(result);
    }catch(requestError){
      if(isUncertainExpenseError(requestError)){
        if(record.method==='PATCH'){
          try{if(await checkSavedExpense(record)==='applied'){completeSubmission({alreadyApplied:true});return}}catch{}
        }
        keepUncertain(record);
      }else if(retry&&requestError.data?.code==='ACCOUNT_CHANGED'){
        keepUncertain(record,'Your account has changed. Switch back to the original account to check this save.');
      }else if(retry&&requestError.status===410&&requestError.data?.code==='IDEMPOTENT_RESOURCE_DELETED'){
        setPendingResolution('deleted');
        keepUncertain(record,'This entry was saved and later deleted. Checking it will not recreate it.');
      }else if(retry&&record.method==='PATCH'){
        try{const outcome=await checkSavedExpense(record);if(outcome==='applied'){completeSubmission({alreadyApplied:true});return}setLatestConflict(outcome==='changed'||(outcome==='unchanged'&&requestError.data?.code==='LEDGER_VERSION_CHANGED'))}catch{}
        keepUncertain(record,`The previous save is still unconfirmed. ${entryServiceError(requestError)}`);
      }else if(retry&&([401,403,404,410].includes(requestError.status)||requestError.data?.code==='IDEMPOTENCY_KEY_REUSED')){
        keepUncertain(record,`The previous save could not be checked. ${entryServiceError(requestError)}`);
      }else{
        pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();
        setPending(null);setSubmissionState('failed');setError(entryServiceError(requestError));
      }
    }finally{savingRef.current=false;setBusy(false)}
  };
  const closeModal=()=>{
    if(savingRef.current||busy)return;
    if(pending&&!pendingPersisted){setError('Your browser could not keep this request. Leave the editor open and check the save result.');return}
    if(!pending&&isDirty){setDiscardAction('close');return;}
    if(pending)onNotice?.('This entry is not yet confirmed. Reopen the editor to check the save result.','info');
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
  const personName = person => String(person.id) === String(currentUserId) ? 'You' : person.displayName || 'Member';
  const paidName = id => personName(people.find(person => String(person.id) === String(id)) || {id, displayName: 'Member'});
  const ownRow = preview.rows.find(row => row.userId === String(currentUserId));
  const ownPaid = payMode === 'single'
    ? (String(payerId) === String(currentUserId) ? totalCents || 0 : 0)
    : parsedPayers[currentUserId]?.cents || 0;
  const previewMessage = entryPreviewError(preview, {totalCents, currency: currencyCode, selectedCount: selected.length, mode});
  const fixedError = mode === 'hybrid' && selected.some(id => fixedMembers.has(String(id)) && (parsedValues[id]?.cents || 0) <= 0)
    ? 'Enter a positive fixed amount, or choose “Share remainder”.' : '';
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
      <div><p id="es-context" className="es-context"><EntryIcon name="pin"/><span>{group.name}</span><span className="es-ledger-code">{ledgerCurrencyCode} ledger</span></p>
        <div className="es-heading-line"><h2 id="es-title">{expense ? 'Edit entry' : 'Add an entry'}</h2><span className="es-one-page">All in one place</span></div>
        <p className="es-intro">Amount, people, done.</p>
      </div>
      <div className="es-header-actions">{!expense && <button type="button" className="es-reset" disabled={locked} onClick={() => isDirty ? setDiscardAction('reset') : resetDraft()}>Clear form</button>}
        <button type="button" className="es-close" aria-label="Close expense editor" onClick={closeModal} disabled={busy}><EntryIcon name="close"/></button>
      </div>
    </header>
    <nav className="es-jump" aria-label="Jump to an entry section">
      <button type="button" onClick={() => jumpTo('basics')}><span aria-hidden="true">1</span>Details</button>
      <button type="button" onClick={() => jumpTo('payments')}><span aria-hidden="true">2</span>{refund ? 'Received by' : 'Paid by'}</button>
      <button type="button" onClick={() => jumpTo('participants')}><span aria-hidden="true">3</span>Split</button>
    </nav>
    <form ref={formRef} className="es-form" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="es-scroll" ref={scrollRef}>
        {discardAction && <section ref={discardRef} className="es-notice es-discard" aria-label="Unsaved changes">
          <div><strong>{discardAction === 'reset' ? 'Clear this draft?' : 'Discard unsaved changes?'}</strong><p>Nothing has been saved. Your existing ledger entries will not be changed.</p></div>
          <div className="es-notice-actions"><button type="button" className="es-secondary" onClick={() => setDiscardAction(null)}>Keep editing</button><button type="button" className="es-danger" onClick={confirmDiscard}>{discardAction === 'reset' ? 'Clear draft' : 'Discard & close'}</button></div>
        </section>}
        {submissionState === 'unknown' && <section ref={errorRef} className="es-notice es-unknown" role="alert" tabIndex={-1}>
          <div><strong><EntryIcon name="info"/>{pendingResolution === 'deleted' ? 'This entry has been deleted' : 'Save result not confirmed'}</strong>
            <p>{error || 'Your previous request has been restored. Check its result before creating another entry.'}</p>
            <small>{pendingPersisted ? 'The original request is kept in this tab. Checking reuses it to avoid a duplicate.' : 'Browser storage is unavailable. Keep this editor open and check the save result.'}</small>
            {(latestConflict || pendingResolution) && <div className="es-resolution"><p>{pendingResolution === 'deleted'
              ? 'You can finish checking. This will not create or undo an entry.'
              : pendingResolution === 'expired' ? 'First check the ledger for this entry. Finishing only clears this tab’s pending request; it does not undo a saved entry.'
              : 'The ledger has a newer version. Keep the latest entry and discard this unconfirmed local input without undoing anything.'}</p>
              <button type="button" className="es-secondary" disabled={busy} onClick={keepLatestExpense}>{pendingResolution === 'deleted' ? 'Finish checking' : pendingResolution === 'expired' ? 'I checked the ledger — finish' : 'Keep latest entry & close'}</button>
            </div>}
          </div>
        </section>}
        <div className={`es-card${refund ? ' es-refund' : ''}`}>
          <div className="es-card-head"><span><EntryIcon name="edit"/>{expense ? 'Edit details' : refund ? 'New refund' : 'New expense'}</span>
            <div className="es-switch" role="group" aria-label="Entry type">
              <button type="button" aria-pressed={!refund} disabled={locked} onClick={() => setKind('expense')}>Expense</button>
              <button type="button" aria-pressed={refund} disabled={locked} onClick={() => setKind('refund')}>Refund</button>
            </div>
          </div>
          <fieldset className="es-grid" disabled={locked || Boolean(discardAction)}>
            <section className="es-section es-basics" id="es-basics" aria-labelledby="es-basics-heading">
              <EntrySectionTitle number="1" id="es-basics-heading" extra={<span className="es-label-note">Amount & description required</span>}>{refund ? 'How much came back?' : 'How much was it?'}</EntrySectionTitle>
              <div className="es-basics-grid">
                <div className={`es-amount-block${attempted && (totalCents === null || totalCents <= 0) ? ' es-invalid' : ''}`}>
                  <div className="es-amount-top"><label htmlFor="es-amount">{refund ? 'Refund amount' : 'Total amount'}</label><label className="es-sr-only" htmlFor="es-currency">Entry currency</label>
                    <select id="es-currency" className="es-currency" value={currencyCode} onChange={event => changeCurrency(event.target.value)}>{currencyOptions.map(item => <option key={item.code} value={item.code}>{item.code} · {ENTRY_CURRENCY_NAMES[item.code] || item.code}</option>)}</select>
                  </div>
                  <div className="es-amount-line"><span aria-hidden="true">{currency.symbol}</span><input id="es-amount" autoFocus={!initialPending && window.matchMedia('(min-width: 761px)').matches} type="text" inputMode={currency.decimals ? 'decimal' : 'numeric'} autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" maxLength={24} required aria-invalid={attempted && (totalCents === null || totalCents <= 0)} aria-describedby="es-amount-error"/></div>
                  <p id="es-amount-error" className="es-field-error" hidden={!attempted || (totalCents !== null && totalCents > 0)}>{entryAmountError(currencyCode)}</p>
                </div>
                <label className="es-title-field" htmlFor="es-description"><span>{refund ? 'What was refunded?' : 'What was it for?'}</span><input id="es-description" type="text" value={title} onChange={event => setTitle(event.target.value)} placeholder={refund ? 'For example, a deposit refund' : 'For example, dinner or a hotel'} maxLength={100} required autoComplete="off" aria-invalid={attempted && !title.trim()} aria-describedby="es-title-error"/></label>
                <p id="es-title-error" className="es-field-error" hidden={!attempted || Boolean(title.trim())}>Enter a description.</p>
                <div className="es-metadata"><label htmlFor="es-category"><EntryIcon name="food"/><span>Category</span><select id="es-category" value={category} onChange={event => setCategory(event.target.value)}>{!ENTRY_CATEGORIES.some(item => item.value === category) && <option value={category}>Other (existing)</option>}{ENTRY_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label htmlFor="es-date"><EntryIcon name="calendar"/><span>Date</span><input id="es-date" type="date" value={expenseDate} onChange={event => setExpenseDate(event.target.value)} required aria-invalid={attempted && Boolean(dateError)} aria-describedby="es-date-error"/></label>
                </div>
                <p id="es-date-error" className="es-field-error" hidden={!attempted || !dateError}>{dateError}</p>
                {expense && !expense.expenseDate && <p className="es-note">This older entry has no expense date. Its creation date is shown; please check it.</p>}
              </div>
              {currencyCode !== ledgerCurrencyCode && <div className="es-rate-panel">
                <div className="es-rate-head"><b>Convert to {ledgerCurrencyCode}</b><span>{exchangeRateMode === 'manual' ? 'Custom rate' : rateLoading ? 'Getting rate…' : rateInfo?.rateDate ? `Rate dated ${rateInfo.rateDate}` : 'System rate'}</span></div>
                <div className="es-rate-inputs"><label htmlFor="es-rate">1 {currencyCode} =</label><input id="es-rate" type="number" min="0.000000001" step="any" inputMode="decimal" value={exchangeRate} onChange={event => {setExchangeRate(event.target.value); setExchangeRateMode('manual'); setExchangeRateToken(''); setRateError('');}} aria-label={`${ledgerCurrencyCode} per ${currencyCode}`} aria-invalid={attempted && !rateValid}/><span>{ledgerCurrencyCode}</span>{exchangeRateMode === 'manual' && <button type="button" className="es-text-button" onClick={useLatestRate}>Use system rate</button>}</div>
                {rateError && <p className="es-field-error" role="status">{rateError}</p>}
                {rateInfo?.health?.warning && <p className="es-field-error" role="status">The rate provider reported a warning. Check the rate or enter your own.</p>}
                {convertedPreviewCents !== null && <p className="es-rate-note">Ledger amount <strong>{formatCurrencyAmount(refund ? -Math.abs(convertedPreviewCents) : convertedPreviewCents, ledgerCurrencyCode)}</strong>. This rate is fixed when saved.</p>}
              </div>}
            </section>
            <section className="es-section es-payments" id="es-payments" aria-labelledby="es-payments-heading">
              <EntrySectionTitle number="2" id="es-payments-heading" extra={<div className="es-switch" role="group" aria-label="Number of payers"><button type="button" aria-pressed={payMode === 'single'} onClick={() => setPayMode('single')}>One</button><button type="button" aria-pressed={payMode === 'multiple'} onClick={() => setPayMode('multiple')}>Multiple</button></div>}>{refund ? 'Who received it?' : 'Who paid first?'}</EntrySectionTitle>
              {payMode === 'single' ? <div className="es-pay-people" role="group" aria-label={refund ? 'Refund recipient' : 'Payer'}>{people.map((person, index) => <button type="button" key={person.id} className="es-payer-chip" aria-pressed={String(payerId) === String(person.id)} onClick={() => setPayerId(person.id)}><EntryAvatar person={person} currentUserId={currentUserId} index={index}/><span>{personName(person)}</span>{String(payerId) === String(person.id) && <EntryIcon name="check"/>}</button>)}</div>
                : <div className="es-multiple-rows">{people.map((person, index) => <div className="es-multi-row" key={person.id}><label htmlFor={`es-paid-${index}`}><EntryAvatar person={person} currentUserId={currentUserId} index={index}/><span>{personName(person)}</span></label><div className="es-input-money"><span aria-hidden="true">{currency.symbol}</span><input id={`es-paid-${index}`} type="text" inputMode={currency.decimals ? 'decimal' : 'numeric'} maxLength={24} value={payerAmounts[person.id] || ''} onChange={event => setPayerAmounts(old => ({...old, [person.id]: event.target.value}))} placeholder="0" aria-label={`${refund ? 'Refund received by' : 'Payment by'} ${personName(person)} (${currencyCode})`} aria-invalid={attempted && parsedPayers[person.id]?.cents === null}/></div></div>)}
                  <p className="es-calculation" data-state={payerInputInvalid || payerTotalCents !== totalCents ? 'error' : 'ok'}><span>{payerInputInvalid ? 'Check payment amounts' : payerTotalCents === totalCents ? 'Payments match' : (totalCents || 0) - payerTotalCents < 0 ? 'Over by' : 'Still needed'}</span><strong>{payerTotalCents === totalCents ? formatCurrencyAmount(payerTotalCents, currencyCode) : formatCurrencyAmount(Math.abs((totalCents || 0) - payerTotalCents), currencyCode)}</strong></p>
                </div>}
              {!people.length && <p className="es-field-error">No members are available. Add a member before recording an entry.</p>}
              <p className="es-note">{refund ? 'The recipient does not have to share in the refund.' : 'Paying first does not automatically include someone in the split.'}</p>
            </section>
            <section className="es-section es-participants" id="es-participants" aria-labelledby="es-participants-heading">
              <EntrySectionTitle number="3" id="es-participants-heading" extra={<span className="es-label-note" aria-live="polite">{selected.length} / {people.length} selected</span>}>{refund ? 'Who shares the refund?' : 'Who’s splitting?'}</EntrySectionTitle>
              <div className="es-people-heading"><div role="group" aria-label="Quick participant selection"><button type="button" className="es-quick-person" aria-pressed={onlyMe} disabled={!currentMember} onClick={() => setSelected(currentMember ? [currentMember.id] : [])}>Just me</button><button type="button" className="es-quick-person" aria-pressed={people.length > 0 && selected.length === people.length} onClick={() => setSelected(people.map(person => person.id))}>All {people.length}</button></div><span>Tap a name to include or exclude</span></div>
              <div className="es-split-options" role="group" aria-label="Split method">{ENTRY_SPLITS.map(item => <button type="button" key={item.id} className="es-split-option" aria-pressed={mode === item.id} onClick={() => selectMode(item.id)}><EntryIcon name={item.icon}/>{item.label}</button>)}</div>
              <p className="es-split-description">{selectedSplit.help}</p>
              {legacyHybrid && mode === 'hybrid' && <p className="es-own-note"><EntryIcon name="info"/>This older entry does not retain its original fixed amounts. Check them and mark at least one person to share the remainder.</p>}
              <div className="es-people-table">{people.map((person, index) => {
                const included = hasSelected(person.id), row = preview.rows.find(item => item.userId === String(person.id));
                return <div className={`es-member-row es-mode-${mode}`} key={person.id} data-selected={included}>
                  <button type="button" className="es-person-button" aria-pressed={included} aria-label={`${included ? 'Exclude' : 'Include'} ${personName(person)}`} onClick={() => togglePerson(person.id)}><span className="es-check-box" aria-hidden="true">{included && <EntryIcon name="check"/>}</span><EntryAvatar person={person} currentUserId={currentUserId} index={index}/><span>{personName(person)}</span></button>
                  {!included ? <span className="es-not-included">Not included</span> : mode === 'equal' ? <strong className="es-member-amount">{canPreview ? entryShare(row, currencyCode) : '—'}</strong> : <div className="es-member-controls">
                    {mode === 'hybrid' && <select value={fixedRole(person.id) ? 'fixed' : 'remainder'} onChange={event => changeFixedRole(person.id, event.target.value === 'fixed')} aria-label={`Split role for ${personName(person)}`}><option value="remainder">Share remainder</option><option value="fixed">Fixed amount</option></select>}
                    {mode !== 'hybrid' || fixedRole(person.id) ? <div className="es-input-money">{mode !== 'weights' && <span aria-hidden="true">{currency.symbol}</span>}<input type="text" inputMode="decimal" maxLength={24} value={values[person.id] || ''} onChange={event => setValues(old => ({...old, [person.id]: event.target.value}))} placeholder={mode === 'weights' ? '1' : '0'} aria-label={`${mode === 'weights' ? 'Shares' : 'Amount'} for ${personName(person)}${mode === 'weights' ? '' : ` (${currencyCode})`}`} aria-invalid={attempted && (mode === 'weights' ? !/^(\d+)(?:\.\d+)?$/.test(String(values[person.id] || '1').trim()) || Number(values[person.id] || 1) <= 0 : parsedValues[person.id]?.cents === null || (parsedValues[person.id]?.cents || 0) <= 0)}/>{mode === 'weights' && <span>shares</span>}</div> : <strong className="es-member-amount">{canPreview ? entryShare(row, currencyCode) : '—'}</strong>}
                  </div>}
                </div>;
              })}</div>
              <div className="es-calculation" aria-live="polite" data-state={canPreview ? 'ok' : 'error'}><span>{canPreview ? <><EntryIcon name="check"/>{refund ? 'Refund split matches' : 'Split matches'}</> : mode === 'exact' && totalCents > 0 && !valueInputInvalid && valueTotalCents !== totalCents ? (valueTotalCents > totalCents ? 'Over by' : 'Still to split') : fixedError || previewMessage}</span><strong>{canPreview ? formatCurrencyAmount(totalCents, currencyCode) : mode === 'exact' && totalCents > 0 && !valueInputInvalid && valueTotalCents !== totalCents ? formatCurrencyAmount(Math.abs(totalCents - valueTotalCents), currencyCode) : ''}</strong></div>
              {mode === 'hybrid' && !valueInputInvalid && totalCents > valueTotalCents && <p className="es-note">Fixed: {formatCurrencyAmount(valueTotalCents, currencyCode)}. Remainder: {formatCurrencyAmount(totalCents - valueTotalCents, currencyCode)}, split between {blankCount} people.</p>}
              {onlyMe && people.length > 1 && <p className="es-own-note"><EntryIcon name="info"/><span>Only you are included. Sharing this cost? Choose “All {people.length}” or tap another name.</span></p>}
              {preview.hasRemainder && <p className="es-note">Amounts show a possible range. The server assigns rounding on save; the total stays the same.</p>}
              {currencyCode !== ledgerCurrencyCode && <p className="es-note">Shares are shown in {currencyCode}. Converted rounding is finalized by the server.</p>}
            </section>
          </fieldset>
        </div>
        {submissionState !== 'unknown' && displayError && <div ref={errorRef} className="es-notice es-error" role="alert" tabIndex={-1}><EntryIcon name="info"/><div><strong>{submissionState === 'failed' ? 'Not saved' : 'Check this entry'}</strong><p>{displayError}</p></div></div>}
        <section hidden={!detailsOpen} id="es-details" className="es-details" aria-labelledby="es-details-heading">
          <div className="es-details-head"><h3 id="es-details-heading" tabIndex={-1}>Entry details <small>{pending ? 'Result unconfirmed' : 'Not saved yet'}</small></h3><button type="button" className="es-text-button" onClick={toggleDetails}>Hide details<EntryIcon name="close"/></button></div>
          <div className="es-receipt-grid"><div><h4>{title.trim() || (refund ? 'This refund' : 'This expense')}</h4><strong className="es-receipt-total">{formatCurrencyAmount(totalCents || 0, currencyCode)}</strong><p>{expenseDate} · {currencyCode} · {entryCategoryLabel(category)}</p>
            <div className="es-receipt-rule"/>{paymentRows.map(row => <p className="es-receipt-row" key={row.userId}><span>{paidName(row.userId)} {refund ? 'received' : 'paid'}</span><strong>{formatCurrencyAmount(row.cents, currencyCode)}</strong></p>)}
            {currencyCode !== ledgerCurrencyCode && convertedPreviewCents !== null && <p className="es-receipt-row"><span>Ledger amount ({ledgerCurrencyCode})</span><strong>{formatCurrencyAmount(refund ? -convertedPreviewCents : convertedPreviewCents, ledgerCurrencyCode)}</strong></p>}
          </div><div><p>{selected.length} people · {selectedSplit.label}</p>{canPreview ? preview.rows.map(row => <p className="es-receipt-row" key={row.userId}><span>{paidName(row.userId)}</span><strong>{entryShare(row, currencyCode)}</strong></p>) : <p>{fixedError || previewMessage}</p>}
            {preview.hasRemainder && <p className="es-note">Ranges are estimates until the server assigns rounding.</p>}
            <div className="es-personal-summary"><span>You {refund ? 'received' : 'paid'} {formatCurrencyAmount(ownPaid, currencyCode)}</span><strong>{refund ? 'Your refund share' : 'Your share'} {ownAmount}</strong></div>
          </div></div>
        </section>
        <p className="es-security-note"><EntryIcon name="lock"/>Only saving records this entry. No money is transferred automatically.</p>
      </div>
      <footer className="es-save-dock">
        <div className="es-dock-summary" aria-live="polite" aria-atomic="true"><strong>{refund ? 'Your refund share' : 'Your share'} {ownAmount}</strong><small>You {refund ? 'received' : 'paid'} {formatCurrencyAmount(ownPaid, currencyCode)} · {selected.length} {selected.length === 1 ? 'person' : 'people'} · {selectedSplit.label.toLowerCase()}</small></div>
        <button ref={detailsButtonRef} type="button" className="es-text-button es-dock-detail" aria-expanded={detailsOpen} aria-controls="es-details" onClick={toggleDetails}>{detailsOpen ? 'Hide details' : 'View details'}<EntryIcon name="right"/></button>
        <div className="es-dock-actions"><button type="button" className="es-text-button es-cancel" onClick={closeModal} disabled={busy}>{pending ? 'Check later' : 'Cancel'}</button><button type="submit" className="es-save" disabled={busy || Boolean(discardAction)}><EntryIcon name={busy ? 'ratio' : 'check'} className={busy ? 'es-busy' : ''}/><span>{busy ? pending && submissionState === 'unknown' ? 'Checking…' : 'Saving…' : pending ? 'Check save result' : expense ? 'Save changes' : refund ? 'Save refund' : 'Save expense'}</span></button></div>
      </footer>
    </form>
  </Modal>;
}
