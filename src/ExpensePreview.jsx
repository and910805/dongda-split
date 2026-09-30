import React,{useState} from 'react';
import {formatCurrencyAmount,getCurrency} from '../currency.mjs';
import {EXPENSE_SPLIT_LABELS} from './expense-preview.mjs';

export function formatPreviewShare(row,currency) {
  if(!row)return formatCurrencyAmount(0,currency);
  const first=formatCurrencyAmount(row.minCents,currency);
  return row.minCents===row.maxCents?first:`${first}–${formatCurrencyAmount(row.maxCents,currency,{includeSymbol:false})}`;
}

export function EntryAvatar({person,currentUserId}) {
  const [failedUrl,setFailedUrl]=useState(null);
  const self=person&&String(person.id)===String(currentUserId);
  const name=self?'你':person?.displayName||'成員';
  const tone=self?0:Array.from(String(person?.id??'')).reduce((sum,char)=>sum+char.codePointAt(0),0)%4;
  return person?.pictureUrl&&failedUrl!==person.pictureUrl
    ?<img className="entry-avatar" src={person.pictureUrl} alt="" referrerPolicy="no-referrer" onError={()=>setFailedUrl(person.pictureUrl)}/>
    :<span className="entry-avatar" data-tone={tone} aria-hidden="true">{Array.from(name)[0]}</span>;
}

/** Shared, read-only original-currency result. The server still allocates rounding. */
export function ExpenseShares({preview,people,currentUserId,totalCents,currencyCode,refund=false}) {
  const byId=new Map(people.map(person=>[String(person.id),person]));
  if(preview.error)return <p className="entry-preview-empty" role="status">{preview.error}</p>;
  return <div className="entry-shares">
    <ul className="entry-preview-members" aria-label={refund?'每人分回金額':'每人分攤金額'}>
      {preview.rows.map(row=>{
        const person=byId.get(String(row.userId));
        const name=String(row.userId)===String(currentUserId)?'你':person?.displayName||'成員';
        return <li key={row.userId}><EntryAvatar person={person} currentUserId={currentUserId}/><span className="entry-person-name">{name}</span><strong>{formatPreviewShare(row,currencyCode)}</strong></li>;
      })}
    </ul>
    <div className="entry-preview-sum"><span>{refund?'退款分配合計':'分攤合計'}</span><strong>{formatCurrencyAmount(totalCents||0,currencyCode)}</strong></div>
    {preview.hasRemainder&&<p className="entry-help">無法整除，以上為可能金額範圍；尾差由系統於儲存時分配，合計不變。</p>}
  </div>;
}

export function ExpensePreview({preview,people,currentUserId,title,category,groupName,totalCents,currencyCode,
  ledgerCurrencyCode,convertedPreviewCents,expenseDate,kind,mode,payMode,payerId,
  parsedPayers,selectedCount,onEdit,disabled,pending}) {
  const refund=kind==='refund';
  const byId=new Map(people.map(person=>[String(person.id),person]));
  const name=id=>String(id)===String(currentUserId)?'你':byId.get(String(id))?.displayName||'成員';
  const payments=payMode==='single'
    ?[{userId:payerId,amountCents:totalCents||0}]
    :people.filter(person=>parsedPayers[person.id]?.cents>0).map(person=>({userId:person.id,amountCents:parsedPayers[person.id].cents}));
  return <div className="entry-confirmation">
    <div className="entry-confirm-total">
      <p>{title.trim()||(refund?'這筆退款':'這筆支出')} · {category}</p>
      <div><span>{getCurrency(currencyCode).symbol}</span><strong>{formatCurrencyAmount(totalCents||0,currencyCode,{includeSymbol:false})}</strong></div>
      <p>記入：{groupName}</p>
      {currencyCode!==ledgerCurrencyCode&&convertedPreviewCents!==null&&<p className="entry-converted">帳本 {formatCurrencyAmount(refund?-convertedPreviewCents:convertedPreviewCents,ledgerCurrencyCode)}</p>}
    </div>
    <div className="entry-confirm-details">
      <button type="button" className="entry-review-row" onClick={()=>onEdit(0)} disabled={disabled} aria-label="修改消費日期與支出內容"><span>{refund?'退款日期':'消費日期'}</span><span>{expenseDate?.replace(/-/g,'/')||'尚未選擇日期'}</span></button>
      <button type="button" className="entry-review-row entry-confirm-payments" onClick={()=>onEdit(1)} disabled={disabled} aria-label={refund?'修改退款接收者':'修改付款人'}><span>{refund?'誰收到退款':'誰先付款'}</span><span>{payments.map(payment=><span key={payment.userId}>{name(payment.userId)}{refund?'收到':'先付'} {formatCurrencyAmount(payment.amountCents,currencyCode)}</span>)}</span></button>
      <button type="button" className="entry-review-row" onClick={()=>onEdit(1)} disabled={disabled} aria-label="修改分攤方式與成員"><span>分攤方式</span><span>{selectedCount} 人{EXPENSE_SPLIT_LABELS[mode]}</span></button>
    </div>
    <ExpenseShares preview={preview} people={people} currentUserId={currentUserId} totalCents={totalCents} currencyCode={currencyCode} refund={refund}/>
    {currencyCode!==ledgerCurrencyCode&&<p className="entry-help">每人金額以 {currencyCode} 顯示，帳本換算後的尾差以儲存結果為準。</p>}
    {pending&&<p className="entry-help">結果待確認，請勿另建一筆重複帳目。</p>}
  </div>;
}
