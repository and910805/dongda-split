import React from 'react';
import {ArrowRight,ChevronRight,Plus,ReceiptText} from './ui-icons.jsx';
import {formatCurrencyAmount} from '../currency.mjs';
import {formatExpenseDate} from '../expense-date.mjs';
import {DEFAULT_EXPENSE_SORT,sortExpenses} from './expense-sort.mjs';

export function MobileLedgerOverview({group,me,mine,isMember,openSettlements,openExpenses,openDetails,addExpense}){
  const currency=group.currency||'TWD';
  const money=value=>formatCurrencyAmount(Number(value||0),currency);
  const recent=sortExpenses(group.expenses,DEFAULT_EXPENSE_SORT).slice(0,3);
  const total=group.expenses.reduce((sum,expense)=>sum+Number(expense.amountCents),0);
  const empty=group.expenses.length===0;
  const label=!isMember?'帳本待結算':empty?'從第一筆開始':mine<0?'你尚需支付':mine>0?'你尚可收回':'我的餘額';
  const context=!isMember?'查看成員的應收應付與還款紀錄':empty?'記下共同花費，旅帳會幫你算好分攤':mine<0?'查看付款對象，完成付款後再記錄':mine>0?'旅伴回報付款後，這裡會更新':'目前沒有你的待結算款項';
  return <section className="mobile-overview-v2" aria-label="帳本總覽">
    <article className={`mobile-personal-balance ${mine>0?'is-receivable':mine<0?'is-payable':'is-settled'}`}>
      <div className="balance-top"><span className="balance-label">{label}</span><span className="balance-state">{!isMember?'管理檢視':empty?'尚無支出':mine===0?'無待結算':mine<0?'待付款':'待收款'}</span></div>
      <strong className="balance-total">{isMember?money(Math.abs(mine)):`${group.settlements.length} 筆`}</strong>
      <p className="balance-context">{context}</p>
      <button type="button" className="balance-link" onClick={empty&&addExpense?addExpense:openSettlements}>{empty&&addExpense?'記下第一筆':'查看結算'}<ArrowRight aria-hidden="true"/></button>
    </article>
    <div className="mobile-ledger-metrics" aria-label="帳本摘要">
      <div className="mobile-ledger-total"><small>帳本總支出</small><strong>{money(total)}</strong></div>
      <span className="mobile-ledger-count">已記錄 <strong>{group.expenses.length}</strong> 筆</span>
    </div>
    <div className="mobile-recent-heading"><h2>最近支出</h2><button type="button" onClick={openExpenses}>查看全部<ChevronRight aria-hidden="true"/></button></div>
    {recent.length?<div className="mobile-recent-list">{recent.map(expense=>{
      const share=(expense.shares||[]).find(item=>String(item.userId)===String(me.id));
      const amountLabel=isMember?(share?money(Math.abs(share.amountCents)):'未參與'):money(expense.amountCents);
      const splitLabel=!isMember?'本筆總額':Number(expense.amountCents)<0?'退回給你':'你分攤';
      return <button type="button" className="mobile-expense-row" key={expense.id} onClick={()=>openDetails(expense)} aria-label={`查看「${expense.title}」明細，${splitLabel} ${amountLabel}`} aria-haspopup="dialog">
        <span className="mobile-expense-category" aria-hidden="true"><ReceiptText/></span>
        <span className="mobile-expense-copy"><b>{expense.title}</b><small>{expense.payerName} {Number(expense.amountCents)<0?'經手退款':'先付'} · {formatExpenseDate(expense,{short:true})}</small></span>
        <span className="mobile-expense-share"><b>{amountLabel}</b><small>{splitLabel}</small></span>
      </button>;
    })}</div>:<div className="mobile-recent-empty"><ReceiptText aria-hidden="true"/><b>還沒有共同支出</b><p>住宿、餐費或車票，都可以從這裡開始記</p>{addExpense&&<button type="button" onClick={addExpense}><Plus aria-hidden="true"/>記一筆</button>}</div>}
  </section>;
}
