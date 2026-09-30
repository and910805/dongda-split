import React from 'react';
import {Check, ReceiptText} from './ui-icons.jsx';
import {formatCurrencyAmount} from '../currency.mjs';
import {EXPENSE_SPLIT_LABELS} from './expense-preview.mjs';

export function formatPreviewShare(row, currency) {
  if (!row) return formatCurrencyAmount(0, currency);
  const first = formatCurrencyAmount(row.minCents, currency);
  return row.minCents === row.maxCents ? first : `${first}–${formatCurrencyAmount(row.maxCents, currency, {includeSymbol: false})}`;
}

export function ExpensePreview({preview, people, currentUserId, title, totalCents, currencyCode,
  ledgerCurrencyCode, convertedPreviewCents, expenseDate, kind, mode, payMode, payerId,
  parsedPayers, selectedCount, onEdit, disabled, pending}) {
  const refund = kind === 'refund';
  const amount = formatCurrencyAmount(totalCents || 0, currencyCode);
  const personById = new Map(people.map(person => [String(person.id), person]));
  const name = id => String(id) === String(currentUserId) ? '你' : personById.get(String(id))?.displayName || '成員';
  const ownRow = preview.rows.find(row => row.userId === String(currentUserId));
  const ownPaid = payMode === 'single'
    ? (String(payerId) === String(currentUserId) ? totalCents || 0 : 0)
    : parsedPayers[currentUserId]?.cents || 0;
  const payments = payMode === 'single'
    ? [{userId: payerId, amountCents: totalCents || 0}]
    : people.filter(person => parsedPayers[person.id]?.cents > 0)
      .map(person => ({userId: person.id, amountCents: parsedPayers[person.id].cents}));
  return <div className="entry-preview-card">
    <div className="entry-preview-heading"><span><ReceiptText aria-hidden="true"/>分攤預覽</span><span className="entry-preview-badge">{pending ? '結果待確認' : '尚未儲存'}</span></div>
    <div className="entry-preview-total">
      <div><h3>{title.trim() || (refund ? '這筆退款' : '這筆支出')}</h3><button type="button" className="entry-edit" onClick={() => onEdit(0)} disabled={disabled}>修改內容</button></div>
      <strong>{amount}</strong>
      <p>{expenseDate || '尚未選擇日期'} · {currencyCode}</p>
      {currencyCode !== ledgerCurrencyCode && convertedPreviewCents !== null && <p className="entry-converted">記入帳本 {formatCurrencyAmount(refund ? -convertedPreviewCents : convertedPreviewCents, ledgerCurrencyCode)}</p>}
    </div>
    <div className="entry-preview-payment">
      <span>{refund ? '退款接收' : '先付款'}</span>
      <div>{payments.map(payment => <p key={payment.userId}><b>{name(payment.userId)}</b><span>{formatCurrencyAmount(payment.amountCents, currencyCode)}</span></p>)}</div>
    </div>
    <div className="entry-preview-members-title"><span>{selectedCount} 人 · {EXPENSE_SPLIT_LABELS[mode]}</span><button type="button" className="entry-edit" onClick={() => onEdit(1)} disabled={disabled}>修改分攤</button></div>
    {preview.error ? <p className="entry-preview-empty">{preview.error}</p> : <>
      <ul className="entry-preview-members" aria-label={refund ? '每人分回金額' : '每人分攤金額'}>
        {preview.rows.map(row => <li key={row.userId}>
          <span className="entry-person-initial" aria-hidden="true">{Array.from(name(row.userId))[0]}</span>
          <span className="entry-person-name">{name(row.userId)}</span>
          <strong>{formatPreviewShare(row, currencyCode)}</strong>
        </li>)}
      </ul>
      <div className="entry-preview-sum"><span>合計</span><strong>{amount}</strong></div>
      {preview.hasRemainder && <p className="entry-preview-note">無法整除，以上為可能金額範圍；尾差由系統於儲存時分配，合計不變。</p>}
      <div className="entry-personal-result" aria-live="polite" aria-atomic="true">
        <span>{refund ? '你收到退款' : '你先付'} {formatCurrencyAmount(ownPaid, currencyCode)}</span>
        <strong>{refund ? '你分回' : '你分攤'} {formatPreviewShare(ownRow, currencyCode)}</strong>
        {!ownRow && <small>你未參與這筆{refund ? '退款分配' : '分攤'}</small>}
      </div>
      {selectedCount === 1 && ownRow && people.length > 1 && <p className="entry-preview-note">目前只有你分攤；要一起分，請選擇其他成員。</p>}
    </>}
    {currencyCode !== ledgerCurrencyCode && <p className="entry-preview-note">每人金額以 {currencyCode} 顯示。帳本換算後的尾差以儲存結果為準。</p>}
    <p className="entry-preview-footnote"><Check aria-hidden="true"/>{pending ? '請確認儲存結果，避免另建一筆重複帳目' : '按下儲存後才會記入帳本，不會自動轉帳'}</p>
  </div>;
}
