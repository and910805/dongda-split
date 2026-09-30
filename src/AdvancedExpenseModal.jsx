import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,Check,ChevronDown,ChevronLeft,ChevronRight,LoaderCircle,MoreHorizontal,X} from './ui-icons.jsx';
import {SUPPORTED_CURRENCIES,amountCentsToInputValue,convertAmountCents,formatCurrencyAmount,getCurrency,isSupportedCurrency,parseCurrencyAmount} from '../currency.mjs';
import {createExpenseSubmissionKeyStore} from './expense-idempotency.mjs';
import {currentExpenseDate,expenseCalendarDate,isValidExpenseDate} from '../expense-date.mjs';
import {canRetryPendingExpense,createExpensePendingStore,createPendingExpenseSubmission,expenseSavedSnapshot,isUncertainExpenseError,pendingExpenseRequestOptions,reconcileExpenseSubmission,requestExpenseJson} from './expense-submission.mjs';
import {createExpensePreview,EXPENSE_SPLIT_LABELS} from './expense-preview.mjs';
import {ExpensePreview,ExpenseShares,EntryAvatar,formatPreviewShare} from './ExpensePreview.jsx';
import {formatEntryAmount,formatEntryDate,isSelectedMember} from './expense-entry-presentation.mjs';
import './expense-entry.css';

const COMPACT_ENTRY_QUERY = '(max-width: 767px)';
const ENTRY_STEPS = ['支出內容','付款與分攤','確認'];
const CATEGORIES = ['餐飲','住宿','交通','購物','其他'];
const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}}),data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'操作失敗');error.status=response.status;error.data=data;throw error}return data};

function Modal({children,close,labelledBy,describedBy}){const overlayRef=useRef(null),dialogRef=useRef(null),closeRef=useRef(close),returnFocus=useRef(document.activeElement);closeRef.current=close;useEffect(()=>{const overlay=overlayRef.current,dialog=dialogRef.current,focusable='button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',blocked=[...(overlay?.parentElement?.children||[])].filter(item=>item!==overlay).map(item=>({item,inert:item.inert,hidden:item.getAttribute('aria-hidden')})),previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';blocked.forEach(({item})=>{item.inert=true;item.setAttribute('aria-hidden','true')});const initialTimer=setTimeout(()=>{if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector(focusable)?.focus()},0);const onKeyDown=event=>{if(event.key==='Escape'){event.preventDefault();closeRef.current();return}if(event.key!=='Tab'||!dialog)return;const items=[...dialog.querySelectorAll(focusable)].filter(item=>item.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};document.addEventListener('keydown',onKeyDown);return()=>{clearTimeout(initialTimer);document.removeEventListener('keydown',onKeyDown);document.body.style.overflow=previousOverflow;blocked.forEach(({item,inert,hidden})=>{item.inert=inert;if(hidden===null)item.removeAttribute('aria-hidden');else item.setAttribute('aria-hidden',hidden)});returnFocus.current?.focus?.()}},[]);return <div ref={overlayRef} className="overlay expense-entry-overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><div ref={dialogRef} className="modal real-modal advanced-modal expense-entry-dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>{children}</div></div>}

export function AdvancedExpenseModal({group,currencies=[],expense=null,initialKind='expense',currentUserId,onNotice,close,done}){
  const formRef=useRef(null),errorRef=useRef(null),submissionKeyStoreRef=useRef(null),savingRef=useRef(false),pendingStoreRef=useRef(null);
  if(!submissionKeyStoreRef.current)submissionKeyStoreRef.current=createExpenseSubmissionKeyStore();
  if(!pendingStoreRef.current)pendingStoreRef.current=createExpensePendingStore({userId:currentUserId,groupId:group.id,expenseId:expense?.id});
  const [initialPending]=useState(()=>pendingStoreRef.current.load());
  const restored=initialPending?.form||{};
  const [compact,setCompact]=useState(()=>window.matchMedia(COMPACT_ENTRY_QUERY).matches);
  const [step,setStep]=useState(initialPending?2:0);
  const [amountFocused,setAmountFocused]=useState(false);
  const stepTitleRef=useRef(null),scrollRef=useRef(null),extraRef=useRef(null);
  useEffect(()=>{
    const media=window.matchMedia(COMPACT_ENTRY_QUERY);
    const update=()=>setCompact(media.matches);
    media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  // Resize the shared dialog, not the draft, when the virtual keyboard opens.
  useEffect(()=>{
    const viewport=window.visualViewport;
    if(!viewport)return;
    const update=()=>{
      const dialog=formRef.current?.closest('.expense-entry-dialog');
      dialog?.style.setProperty('--entry-viewport-height',`${viewport.height}px`);
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
  const [currencyCode,setCurrencyCode]=useState(restored.currencyCode??initialCurrencyCode),[kind,setKind]=useState(restored.kind??(expense?((storedCurrencyMeta.inputAmountCents??expense.amountCents)<0?'refund':'expense'):initialKind)),[title,setTitle]=useState(restored.title??expense?.title??''),[amount,setAmount]=useState(restored.amount??(expense?inputAmount(storedCurrencyMeta.inputAmountCents??expense.amountCents,initialCurrencyCode):'')),[category,setCategory]=useState(restored.category??expense?.category??'餐飲'),[payMode,setPayMode]=useState(restored.payMode??(storedPayments.length>1?'multiple':'single')),[payerId,setPayerId]=useState(restored.payerId??(expense?(storedPayments[0]?.userId||payers[0]?.id):defaultPersonId)),[payerAmounts,setPayerAmounts]=useState(restored.payerAmounts??Object.fromEntries(storedPayments.map(x=>[x.userId,inputAmount(x.amountCents,initialCurrencyCode)]))),[mode,setMode]=useState(restored.mode??initialMode),[selected,setSelected]=useState(restored.selected??initialSelected),[values,setValues]=useState(restored.values??Object.fromEntries(initialValueRows.map(x=>[x.userId,x.value]))),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState('');
  const [expenseDate,setExpenseDate]=useState(restored.expenseDate??(expense?expenseCalendarDate(expense):currentExpenseDate()));
  const [extraOpen,setExtraOpen]=useState(Boolean(expense||initialKind==='refund'||restored.kind==='refund')),[splitOpen,setSplitOpen]=useState((restored.mode??initialMode)!=='equal');
  const [membersOpen,setMembersOpen]=useState((restored.mode??initialMode)!=='equal');
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
      if(submissionState==='unknown'&&scrollRef.current)scrollRef.current.scrollTop=0;
      else notice.scrollIntoView({block:'center',behavior:'instant'});
    });
    return()=>cancelAnimationFrame(frame);
  },[submissionState,error,busy]);
  const currency=getCurrency(currencyCode);
  const toggle=id=>setSelected(old=>isSelectedMember(old,id)?old.filter(x=>String(x)!==String(id)):[...old,id]);
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
      method:'POST',body:JSON.stringify({sourceCurrency:currencyCode})
    }).then(result=>{
      if(!active)return;
      setExchangeRate(String(result.rate||''));setExchangeRateToken(result.exchangeRateToken||'');setRateInfo(result);
    }).catch(rateRequestError=>{
      if(!active)return;
      setExchangeRate('');setRateInfo(null);setRateError(`${rateRequestError.message}，你仍可輸入自訂匯率`);
    }).finally(()=>{if(active)setRateLoading(false)});
    return()=>{active=false};
  },[currencyCode,exchangeRateMode,group.id,ledgerCurrencyCode,Boolean(pending)]);
  const changeCurrency=nextCurrency=>{
    setCurrencyCode(nextCurrency);setExchangeRateMode('quoted');setExchangeRate('');setExchangeRateToken('');setRateInfo(null);setRateError('');
  };
  const useLatestRate=()=>{
    setExchangeRateMode('quoted');setExchangeRate('');setExchangeRateToken('');setRateInfo(null);setRateError('');
  };
  const parsedTotal=parseInput(amount,{allowZero:false}),totalCents=parsedTotal.cents;
  const parsedPayers=Object.fromEntries(payers.map(person=>[person.id,parseInput(payerAmounts[person.id])]));
  const payerInputInvalid=Object.values(parsedPayers).some(result=>result.cents===null),payerTotalCents=Object.values(parsedPayers).reduce((sum,result)=>sum+(result.cents||0),0);
  const parsedValues=Object.fromEntries(selected.map(id=>[id,parseInput(values[id])]));
  const valueInputInvalid=Object.values(parsedValues).some(result=>result.cents===null),valueTotalCents=Object.values(parsedValues).reduce((sum,result)=>sum+(result.cents||0),0),blankCount=selected.filter(id=>(parsedValues[id]?.cents||0)===0).length;
  const weightInvalid=selected.some(id=>!/^(\d+)(?:\.\d+)?$/.test(String(values[id]||'1').trim())||Number(values[id]||1)<=0);
  const dateError=isValidExpenseDate(expenseDate)?'':'請選擇有效的消費日期';
  const rateValid=currencyCode===ledgerCurrencyCode||(/^(\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(exchangeRate).trim())&&Number(exchangeRate)>0);
  let convertedPreviewCents=null;
  if(totalCents!==null&&totalCents>0&&rateValid){
    try{convertedPreviewCents=currencyCode===ledgerCurrencyCode?totalCents:convertAmountCents(totalCents,exchangeRate,ledgerCurrencyCode,{sourceCurrency:currencyCode})}
    catch{convertedPreviewCents=null}
  }
  const basicError=!title.trim()?'請先填寫項目名稱':totalCents===null?parsedTotal.error:totalCents<=0?'總金額必須大於 0':dateError||(currencyCode!==ledgerCurrencyCode&&rateLoading?'正在取得匯率，請稍候':!rateValid?`請輸入 1 ${currencyCode} 可換多少 ${ledgerCurrencyCode}`:convertedPreviewCents===0?`換算後金額小於 ${ledgerCurrencyCode} 的最小單位`:'');
  const preview=useMemo(()=>createExpensePreview({amountCents:totalCents,currency:currencyCode,mode,participantIds:selected,values}),[totalCents,currencyCode,mode,selected,values]);
  const validationError=useMemo(()=>{if(basicError)return basicError;if(!selected.length)return '請至少選擇一位分攤成員';if(payMode==='multiple'&&payerInputInvalid)return `共同付款金額必須符合 ${currencyCode} 的小數位規則`;if(payMode==='multiple'&&payerTotalCents!==totalCents)return `付款加總需要是 ${formatCurrencyAmount(totalCents,currencyCode)}，目前是 ${formatCurrencyAmount(payerTotalCents,currencyCode)}`;if(mode==='exact'&&(valueInputInvalid||blankCount>0))return `每位成員都必須填寫符合 ${currencyCode} 規則的負擔金額`;if(mode==='exact'&&valueTotalCents!==totalCents)return '每人金額加總必須等於支出總額';if(mode==='hybrid'&&valueInputInvalid)return `指定金額必須符合 ${currencyCode} 的小數位規則`;if(mode==='hybrid'&&(valueTotalCents>=totalCents||blankCount===0))return '指定金額後，必須保留至少一人分攤剩餘金額';if(mode==='weights'&&weightInvalid)return '每位成員的份數必須大於 0';return ''},[basicError,totalCents,currencyCode,selected,payMode,payerInputInvalid,payerTotalCents,mode,valueInputInvalid,blankCount,valueTotalCents,weightInvalid]);
  const completeSubmission=result=>{
    pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();
    setPending(null);setSubmissionState('idle');setBusy(false);savingRef.current=false;done(result);
  };
  const keepUncertain=(record,message='尚未確認是否儲存成功，輸入內容已保留')=>{
    setPending(record);setSubmissionState('unknown');setError(message);setPendingPersisted(pendingStoreRef.current.save(record));
  };
  const checkSavedExpense=async record=>{
    const latest=await requestExpenseJson(`/api/groups/${group.id}`);return reconcileExpenseSubmission(record,latest);
  };
  const sendSubmission=async(record,{retry=false}={})=>{
    if(savingRef.current)return;
    savingRef.current=true;setBusy(true);setError('');
    try{
      if(retry&&!canRetryPendingExpense(record)){
        setPendingResolution('expired');keepUncertain(record,'這次提交已超過安全重試期限，請先在支出列表核對，勿重複新增');return;
      }
      if(retry&&record.method==='PATCH'){
        const outcome=await checkSavedExpense(record);
        if(outcome==='applied'){completeSubmission({alreadyApplied:true});return}
        if(outcome!=='unchanged'){
          setLatestConflict(outcome==='changed');keepUncertain(record,'帳目已變更或暫時無法核對，請先查看最新支出，原輸入仍保留在這個分頁');return;
        }
      }
      const url=record.method==='PATCH'?`/api/groups/${group.id}/expenses/${record.expenseId}`:`/api/groups/${group.id}/expenses`;
      const result=await requestExpenseJson(url,pendingExpenseRequestOptions(record));
      if(!result.id)throw new Error('尚未收到可確認的儲存結果');
      completeSubmission(result);
    }catch(requestError){
      if(isUncertainExpenseError(requestError)){
        if(record.method==='PATCH'){
          try{if(await checkSavedExpense(record)==='applied'){completeSubmission({alreadyApplied:true});return}}catch{}
        }
        keepUncertain(record);
      }else if(retry&&requestError.data?.code==='ACCOUNT_CHANGED'){
        keepUncertain(record,'登入帳號已變更，請切回原帳號後再確認這次儲存結果');
      }else if(retry&&requestError.status===410&&requestError.data?.code==='IDEMPOTENT_RESOURCE_DELETED'){
        setPendingResolution('deleted');keepUncertain(record,'已確認這筆支出曾經建立，之後已被刪除，這次確認不會重新建立支出');
      }else if(retry&&record.method==='PATCH'){
        try{const outcome=await checkSavedExpense(record);if(outcome==='applied'){completeSubmission({alreadyApplied:true});return}setLatestConflict(outcome==='changed'||(outcome==='unchanged'&&requestError.data?.code==='LEDGER_VERSION_CHANGED'))}catch{}
        keepUncertain(record,`尚未確認前一次的儲存結果：${requestError.message}`);
      }else if(retry&&([401,403,404,410].includes(requestError.status)||requestError.data?.code==='IDEMPOTENCY_KEY_REUSED')){
        keepUncertain(record,`暫時無法確認前一次的儲存結果：${requestError.message}`);
      }else{
        pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();setPending(null);setSubmissionState('failed');setError(requestError.message);
      }
    }finally{savingRef.current=false;setBusy(false)}
  };
  const closeModal=()=>{
    if(savingRef.current||busy)return;
    if(pending&&!pendingPersisted){setError('瀏覽器無法暫存這次提交，請先確認儲存結果，以免關閉後遺失輸入');return}
    if(pending)onNotice?.('這筆帳目的儲存結果尚未確認，請回到記帳表單確認','info');
    close();
  };
  const keepLatestExpense=()=>{
    if((!latestConflict&&!pendingResolution)||savingRef.current||busy)return;
    pendingStoreRef.current.clear();submissionKeyStoreRef.current.complete();done({cancelled:true,reason:pendingResolution||'changed'});
  };
  const submit=e=>{
    e.preventDefault();if(savingRef.current||busy)return;
    if(pending){sendSubmission(pending,{retry:true});return}
    setAttempted(true);
    if(validationError||dateError||preview.error){setError('');setSubmissionState('idle');if(compact)setStep(basicError?0:1);focusError();return}
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
  const valueLabel=mode==='weights'?'份數／權重':'負擔金額';
  const splitHelp={equal:'所有已選成員平均分攤，尾差會自動分配',exact:'逐一輸入每位成員應負擔的確切金額',hybrid:'先指定部分金額，剩餘金額由留空成員平均分攤',weights:'依住宿天數、家庭人數等份數比例分攤'}[mode];
  const displayError=error||(attempted?(compact&&step===0?basicError:dateError||validationError||preview.error):'');
  const ownPreview=preview.rows.find(row=>row.userId===String(currentUserId));
  const focusError=()=>requestAnimationFrame(()=>{
    const invalid=[...(formRef.current?.querySelectorAll('[aria-invalid="true"]')||[])].find(node=>node.getClientRects().length);
    const target=invalid||errorRef.current;target?.focus({preventScroll:true});target?.scrollIntoView({block:'center'});
  });
  const goToStep=next=>{
    if(busy||pending)return;
    setStep(next);setAttempted(false);setError('');
    requestAnimationFrame(()=>{scrollRef.current?.scrollTo({top:0});stepTitleRef.current?.focus({preventScroll:true})});
  };
  const advance=()=>{
    if(busy||pending)return;
    const problem=step===0?basicError:validationError||dateError||preview.error;
    if(problem){setAttempted(true);focusError();return}
    goToStep(Math.min(2,step+1));
  };
  // Intermediate steps never submit; every view uses the same draft and request path.
  const handleSubmit=event=>{
    if(compact&&step<2&&!pending){event.preventDefault();advance();return}
    submit(event);
  };
  const locked=busy||Boolean(pending);
  const refund=kind==='refund';
  const nameOf=person=>String(person?.id)===String(currentUserId)?'你':person?.displayName||'成員';
  const payer=payers.find(person=>String(person.id)===String(payerId));
  const ownPaid=payMode==='single'?(String(payerId)===String(currentUserId)?totalCents:0):parsedPayers[currentUserId]?.cents;
  const ownShareText=preview.error?'—':formatPreviewShare(ownPreview,currencyCode);
  const ownPaidText=totalCents===null||(payMode==='multiple'&&payerInputInvalid)?'—':formatCurrencyAmount(ownPaid||0,currencyCode);
  const personalSummary=`${refund?'你收到':'你先付'} ${ownPaidText} · ${refund?'你分回':'你分攤'} ${ownShareText}`;
  const splitSummary=`${selected.length} 人${EXPENSE_SPLIT_LABELS[mode]}`;
  const dateLabel=formatEntryDate(expenseDate,currentExpenseDate());
  const selectOnlyMe=()=>setSelected(defaultPersonId===undefined?[]:[defaultPersonId]);
  const openExtra=()=>{
    if(locked)return;
    if(compact)goToStep(0);
    setExtraOpen(true);
    requestAnimationFrame(()=>{extraRef.current?.scrollIntoView({block:'nearest'});extraRef.current?.querySelector('summary')?.focus()});
  };
  const paymentFields=<section className="entry-payment" aria-label="付款設定" hidden={compact&&step!==1}>
    <div className="entry-payment-line">
      <span>{refund?'誰收到退款':'誰先付款'}</span>
      {payMode==='single'?<label className="entry-native-picker entry-payer-picker">
        <span aria-hidden="true"><EntryAvatar person={payer} currentUserId={currentUserId}/><b>{nameOf(payer)}</b><ChevronRight/></span>
        <select aria-label={refund?'退款接收者':'付款人'} value={payerId} onChange={e=>setPayerId(e.target.value)}>
          {payers.map(p=><option value={p.id} key={p.id}>{nameOf(p)}</option>)}
        </select>
      </label>:<b className="entry-multiple-label">多人{refund?'收款':'付款'}</b>}
    </div>
    {payMode==='multiple'&&<div className="entry-payment-amounts" id="expense-payment-members">
      {payers.map(p=><div className="entry-payment-person" key={p.id}>
        <EntryAvatar person={p} currentUserId={currentUserId}/><span className="entry-person-name">{nameOf(p)}</span>
        <label><span aria-hidden="true">{currency.symbol}</span><input type="number" min="0" step={currency.step} inputMode={currency.decimals?'decimal':'numeric'} aria-label={`${p.displayName}的${refund?'退款接收':'付款'}金額（${currencyCode}）`} value={payerAmounts[p.id]||''} onChange={e=>setPayerAmounts(old=>({...old,[p.id]:e.target.value}))} placeholder="0" aria-invalid={attempted&&parsedPayers[p.id]?.cents===null}/></label>
      </div>)}
      <p className="entry-allocation-total">{refund?'退款接收':'付款'}加總 {formatCurrencyAmount(payerTotalCents,currencyCode)}／{formatCurrencyAmount(totalCents||0,currencyCode)}</p>
    </div>}
    <div className="entry-payment-help"><small>{refund?'收到退款的人，不一定參與分配':'先付款的人，不一定都參與分攤'}</small>
      <button type="button" className="entry-text-button" aria-expanded={payMode==='multiple'} onClick={()=>setPayMode(payMode==='single'?'multiple':'single')}>
        {payMode==='multiple'?'改為單人':refund?'多人收款':'多人付款'}<ChevronRight aria-hidden="true"/>
      </button>
    </div>
  </section>;
  const memberPicker=(compact||membersOpen||mode!=='equal')&&<div className="entry-member-picker" id="expense-member-picker" role="group" aria-label="參與分攤的成員">
    {people.map(p=>{const checked=isSelectedMember(selected,p.id);return <div className="entry-member-option" key={p.id} data-selected={checked}>
      <button type="button" className="entry-member-toggle" aria-pressed={checked} onClick={()=>toggle(p.id)}>
        <EntryAvatar person={p} currentUserId={currentUserId}/><span className="entry-person-name">{nameOf(p)}</span>
        <span className="entry-checkbox" aria-hidden="true">{checked&&<Check/>}</span>
      </button>
      {checked&&mode!=='equal'&&<label className="entry-member-value"><span>{valueLabel}</span><input type="number" min={mode==='weights'?'0.01':'0'} step={mode==='weights'?'0.1':currency.step} inputMode="decimal" aria-label={`${p.displayName}的${valueLabel}${mode==='weights'?'':`（${currencyCode}）`}`} value={values[p.id]||''} onChange={e=>setValues(old=>({...old,[p.id]:e.target.value}))} placeholder={mode==='weights'?'1':mode==='hybrid'?'留空＝均分':'0'}/></label>}
    </div>})}
  </div>;
  const splitSettings=<div className="entry-split-settings">
    <div className="entry-split-method"><span>{EXPENSE_SPLIT_LABELS[mode]}</span><button type="button" className="entry-text-button" aria-expanded={splitOpen} aria-controls="expense-split-settings" onClick={()=>setSplitOpen(!splitOpen)}>更改方式<ChevronRight aria-hidden="true"/></button></div>
    {splitOpen&&<div id="expense-split-settings" className="entry-advanced-split">
      <div className="entry-split-tabs" role="group" aria-label="分攤方式">{[['equal','平均'],['exact','指定金額'],['hybrid','指定＋均分'],['weights','比例／份數']].map(([id,label])=><button type="button" key={id} aria-pressed={mode===id} onClick={()=>{setMode(id);if(id!=='equal')setMembersOpen(true)}}>{label}</button>)}</div>
      <p className="entry-help">{splitHelp}</p>
    </div>}
    {legacyHybrid&&mode==='hybrid'&&<p className="entry-warning" role="note">這筆舊資料未保留原始指定欄位，請確認固定金額，並將要均分的成員留空後再儲存</p>}
  </div>;
  return <Modal close={closeModal} labelledBy="expense-modal-title" describedBy="expense-modal-description">
    <header className="modal-head expense-modal-head">
      {compact&&<button type="button" className="entry-icon-button entry-back" onClick={step>0&&!pending?()=>goToStep(step-1):closeModal} disabled={busy} aria-label={step>0&&!pending?'上一步':'關閉共同支出表單'}>{step>0&&!pending?<ChevronLeft/>:<X/>}</button>}
      <div className="expense-modal-heading">
        <h2 ref={stepTitleRef} tabIndex="-1" id="expense-modal-title">{compact&&step===2?(refund?'確認這筆退款':'確認這筆支出'):expense?'修改支出':refund?'記錄退款':'新增支出'}</h2>
        <p id="expense-modal-description" className="expense-ledger-context">記入：<strong>{group.name}</strong> · {ledgerCurrencyCode} 帳本</p>
      </div>
      <button type="button" className="entry-icon-button entry-more" onClick={openExtra} disabled={locked} aria-label="其他設定與退款紀錄" aria-controls="expense-other-settings"><MoreHorizontal/></button>
      {!compact&&<button type="button" className="entry-icon-button modal-x" onClick={closeModal} disabled={busy} aria-label="關閉共同支出表單"><X/></button>}
    </header>
    {compact&&<ol className="entry-stepper" aria-label="記帳進度">{ENTRY_STEPS.map((label,index)=><li key={label} aria-current={step===index?'step':undefined} data-complete={step>index}><span>{index+1}</span>{label}</li>)}</ol>}
    <form ref={formRef} className="advanced-form expense-form entry-form" onSubmit={handleSubmit} onKeyDown={event=>{
      if(compact&&step<2&&!pending&&event.key==='Enter'&&!event.nativeEvent.isComposing&&event.target instanceof HTMLInputElement&&['text','number'].includes(event.target.type)){event.preventDefault();advance()}
    }} noValidate aria-busy={busy} data-step={step}>
      <div className="entry-scroll" ref={scrollRef}>
        {submissionState==='unknown'&&<div ref={errorRef} className="expense-submission-status" data-state="unknown" role="alert" tabIndex="-1">
          <b><AlertCircle/>{pendingResolution==='deleted'?'已確認這筆支出已刪除':'儲存結果尚未確認'}</b>
          <p>{error||'已恢復上次未確認的提交，請先確認結果再記下一筆'}</p>
          <small>{pendingPersisted?'原內容已保留在這個分頁，確認結果時會沿用同一次提交，避免重複記帳':'瀏覽器無法暫存，請保持表單開啟並確認結果'}</small>
          {(latestConflict||pendingResolution)&&<div><p>{pendingResolution==='deleted'?'可以結束這次確認，這不會新增或撤銷任何帳目':pendingResolution==='expired'?'請先關閉表單，到支出列表核對，完成後可回到這裡結束確認，結束確認只會清除本機暫存，不會取消伺服器已儲存的紀錄':'已讀取最新帳目，你可以放棄這次未確認的輸入，保留目前帳目，這不會撤銷任何已儲存內容'}</p><button type="button" className="entry-text-button" disabled={busy} onClick={keepLatestExpense}>{pendingResolution==='deleted'?'結束這次確認':pendingResolution==='expired'?'已核對帳本，結束這次確認':'保留最新帳目並關閉'}</button></div>}
        </div>}
        {compact&&step===1&&<div className="entry-mini-summary"><span>{title} · {dateLabel}</span><strong>{formatCurrencyAmount(totalCents||0,currencyCode)}</strong></div>}
        {compact&&step<2&&<div className="entry-step-intro"><h3>{step===0?(refund?'收到多少退款？':'這筆花了多少？'):(refund?'誰收退款，分回給誰？':'誰先付、誰一起分？')}</h3>{step===0&&<p>先記下金額與用途，下一步再選人</p>}</div>}
        <fieldset className="expense-inputs" disabled={locked}>
          <div className="entry-grid">
            <div className="entry-fields" hidden={compact&&step===2}>
              <section className="entry-basics" aria-label="支出內容" hidden={compact&&step!==0}>
                <div className="entry-amount" data-invalid={attempted&&(totalCents===null||totalCents<=0)}>
                  <div className="entry-amount-heading"><label htmlFor="expense-total-input">{refund?'退款金額':'總金額'}</label>
                    <label className="entry-native-picker entry-currency-picker"><span aria-hidden="true">{currencyCode}<ChevronDown/></span><select aria-label={refund?'退款幣別':'支出幣別'} value={currencyCode} onChange={e=>changeCurrency(e.target.value)}>{currencyOptions.map(item=><option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
                  </div>
                  <div className="entry-amount-value"><span aria-hidden="true">{currency.symbol}</span><input id="expense-total-input" autoFocus={!compact&&!initialPending} type="text" inputMode={currency.decimals?'decimal':'numeric'} value={amountFocused?amount:formatEntryAmount(amount)} onFocus={()=>setAmountFocused(true)} onBlur={()=>setAmountFocused(false)} onChange={e=>setAmount(e.target.value.replace(/,/g,''))} placeholder={currency.decimals?'0.00':'0'} required aria-invalid={attempted&&(totalCents===null||totalCents<=0)} autoComplete="off" spellCheck="false"/></div>
                </div>
                <label className="entry-title-field">項目名稱<input value={title} onChange={e=>setTitle(e.target.value)} placeholder={refund?'例如：民宿退押金':'例如：晚餐、民宿尾款'} required maxLength={100} aria-invalid={attempted&&!title.trim()}/></label>
                <div className="entry-detail-chips">
                  <label className="entry-native-picker entry-chip"><span aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 2v5m3-5v5M4 5.5h3M5.5 7v11M13 2v8h3V2m0 8v8"/></svg>{category}<ChevronDown/></span><select aria-label="分類" value={category} onChange={e=>setCategory(e.target.value)}>{CATEGORIES.map(item=><option key={item}>{item}</option>)}</select></label>
                  <label className="entry-native-picker entry-chip entry-date-chip"><span aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2v4m8-4v4M3 8h14"/></svg>{dateLabel}<ChevronDown/></span><input type="date" aria-label={refund?'退款日期':'消費日期'} required value={expenseDate} onChange={e=>setExpenseDate(e.target.value)} onClick={e=>{try{e.currentTarget.showPicker?.()}catch{}}} aria-invalid={attempted&&Boolean(dateError)}/></label>
                </div>
                {expense&&!expense.expenseDate&&<p className="entry-help">舊帳目未記錄消費日期，暫以建立日期帶入，請確認後儲存</p>}
                {currencyCode!==ledgerCurrencyCode&&<div className="expense-exchange-rate">
                  <div className="expense-rate-heading"><span><b>換算匯率</b><small>{exchangeRateMode==='manual'?'使用這筆支出的自訂匯率':rateLoading?'正在取得最新匯率…':rateInfo?.rateDate?`匯率日期 ${rateInfo.rateDate}`:'系統匯率'}</small></span>{exchangeRateMode==='manual'&&<button type="button" className="entry-text-button" onClick={useLatestRate}>改用系統匯率</button>}</div>
                  <label><span>1 {currencyCode} =</span><input type="number" min="0.000000001" step="any" inputMode="decimal" aria-label="換算匯率" value={exchangeRate} onChange={e=>{setExchangeRate(e.target.value);setExchangeRateMode('manual');setExchangeRateToken('');setRateError('')}} aria-invalid={attempted&&!rateValid}/><span>{ledgerCurrencyCode}</span></label>
                  {rateError&&<p role="status"><AlertCircle/>{rateError}</p>}{rateInfo?.health?.warning&&<p role="status"><AlertCircle/>{rateInfo.health.warning}</p>}
                  {convertedPreviewCents!==null&&<div className="expense-converted-preview"><span>記入帳本</span><strong>{formatCurrencyAmount(refund?-Math.abs(convertedPreviewCents):convertedPreviewCents,ledgerCurrencyCode)}</strong><small>儲存後固定採用這個匯率，不會隨每日匯率變動</small></div>}
                </div>}
                {compact&&<div className="entry-ledger-card"><div><span>記入帳本</span><strong>{group.name}</strong></div><small>幣別與日期都可以在這一步修改</small></div>}
              </section>
              {paymentFields}
              <details ref={extraRef} id="expense-other-settings" className="entry-other-settings" hidden={compact&&(step!==0||!extraOpen)} open={extraOpen} onToggle={e=>setExtraOpen(e.currentTarget.open)}>
                <summary>其他設定 · 退款紀錄<ChevronRight aria-hidden="true"/></summary>
                <p className="entry-help">收到退押金或退款時，改用退款紀錄</p>
                <div className="entry-kind-toggle" role="group" aria-label="紀錄類型"><button type="button" aria-pressed={!refund} onClick={()=>setKind('expense')}>一般支出</button><button type="button" aria-pressed={refund} onClick={()=>setKind('refund')}>退款／退押金</button></div>
              </details>
            </div>
            <section className="entry-split" hidden={compact&&step!==1} aria-label="分攤設定">
              <div className="entry-split-heading"><h3>{compact?'參與分攤的成員':refund?'誰分回退款？':'誰要分攤？'}</h3><small aria-live="polite">已選 {selected.length} 人</small></div>
              <div className="expense-participant-tools" role="group" aria-label="快速選擇分攤成員">
                <button type="button" aria-pressed={selected.length===1&&isSelectedMember(selected,defaultPersonId)} onClick={selectOnlyMe}>{String(defaultPersonId)===String(currentUserId)?'只有我':'僅'+nameOf(defaultPerson)}</button>
                <button type="button" aria-pressed={people.length>0&&people.every(person=>isSelectedMember(selected,person.id))} onClick={()=>setSelected(people.map(person=>person.id))}>全部 {people.length} 人</button>
                <button type="button" aria-expanded={compact||membersOpen||mode!=='equal'} aria-controls="expense-member-picker" onClick={()=>{if(compact){document.getElementById('expense-member-picker')?.scrollIntoView({block:'nearest'});document.querySelector('#expense-member-picker button')?.focus()}else setMembersOpen(!membersOpen)}}>{!compact&&membersOpen?'收起名單':'選人…'}</button>
              </div>
              {!compact&&splitSettings}
              {memberPicker}
              {compact&&splitSettings}
              {mode==='exact'&&<p className="entry-allocation-total">已分配 {formatCurrencyAmount(valueTotalCents,currencyCode)} · 還差 {formatCurrencyAmount((totalCents||0)-valueTotalCents,currencyCode)}</p>}
              {mode==='hybrid'&&<p className="entry-allocation-total">指定 {formatCurrencyAmount(valueTotalCents,currencyCode)} · 剩餘 {formatCurrencyAmount((totalCents||0)-valueTotalCents,currencyCode)} 由 {blankCount} 人均分</p>}
              {!compact&&<ExpenseShares preview={preview} people={people} currentUserId={currentUserId} totalCents={totalCents} currencyCode={currencyCode} refund={refund}/>}
              {compact&&<div className="entry-inline-result" aria-live="polite"><span>{mode==='equal'&&!preview.error?'每人'+(refund?'分回':'分攤'):refund?'你分回':'你分攤'}</span><strong>{preview.error?'—':formatPreviewShare(mode==='equal'?preview.rows[0]:ownPreview,currencyCode)}</strong></div>}
              {compact&&preview.hasRemainder&&<p className="entry-help">無法整除，顯示可能金額範圍；尾差由系統於儲存時分配。</p>}
              {selected.length===1&&isSelectedMember(selected,currentUserId)&&people.length>1&&<p className="entry-help">目前只有你{refund?'分回退款':'分攤'}；要一起分，請選擇其他成員。</p>}
              {currencyCode!==ledgerCurrencyCode&&<p className="entry-help">每人金額以 {currencyCode} 顯示，帳本換算後的尾差以儲存結果為準。</p>}
            </section>
            <aside className="entry-preview" hidden={!compact||step!==2} aria-label="帳目確認">
              <ExpensePreview preview={preview} people={people} currentUserId={currentUserId} title={title} category={category} groupName={group.name} totalCents={totalCents} currencyCode={currencyCode} ledgerCurrencyCode={ledgerCurrencyCode} convertedPreviewCents={convertedPreviewCents} expenseDate={expenseDate} kind={kind} mode={mode} payMode={payMode} payerId={payerId} parsedPayers={parsedPayers} selectedCount={selected.length} onEdit={goToStep} disabled={locked} pending={Boolean(pending)}/>
            </aside>
          </div>
        </fieldset>
        {submissionState!=='unknown'&&displayError&&<div ref={errorRef} className="expense-submission-status form-error" data-state="failed" role="alert" tabIndex="-1"><AlertCircle/><div>{submissionState==='failed'&&<b>未儲存</b>}<p>{displayError}</p></div></div>}
      </div>
      <div className="form-actions expense-form-actions entry-actions">
        <div className="expense-save-summary" aria-live="polite" aria-atomic="true">
          {!compact?<><strong>{refund?'你分回':'你分攤'} {ownShareText}</strong><small>{refund?'你收到':'你先付'} {ownPaidText} · {splitSummary}</small></>:<small>{pending?'原內容已保留，請先確認儲存結果':step===0?'第 1 步／共 3 步':step===1?'付款人與分攤成員是兩件不同的事':personalSummary}</small>}
        </div>
        <div className="expense-action-buttons">
          {(!compact||pending)&&<button type="button" className="entry-cancel" onClick={closeModal} disabled={busy}>{pending?'稍後確認':'取消'}</button>}
          {compact&&step<2&&!pending?<button key="entry-next" type="button" className="primary" onClick={event=>{event.preventDefault();advance()}} disabled={busy}>{step===0?'繼續：付款與分攤':'繼續：檢查這筆支出'}</button>:<button key="entry-save" type="submit" className="primary" disabled={busy}>{busy?<LoaderCircle aria-hidden="true"/>:<Check aria-hidden="true"/>}{busy?(pending&&submissionState==='unknown'?'確認中…':'儲存中…'):pending?'確認儲存結果':expense?'儲存修改':refund?'儲存退款':compact?'確認儲存':'儲存支出'}</button>}
        </div>
      </div>
    </form>
  </Modal>;
}
