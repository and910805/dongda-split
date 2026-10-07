import React, {useEffect, useRef} from 'react';
import {ReceiptText, Users, WalletCards} from './ui-icons.jsx';
import './ledger-brush-summary.css';

// These labels are supplied by the existing ledger calculations, not by the artwork.
// expenseDates uses the same descending, validated calendar dates as the date filter.
export function LedgerBrushSummary({name, memberCount, expenseCount, settlementCount, totalLabel, balanceLabel, balanceCents, isMember, expenseDates=[]}) {
  const sectionRef = useRef(null);
  // Keep the scenery behind the full header/summary when text or amounts wrap.
  // This changes only a decorative absolute layer, never the layout or data.
  useEffect(() => {
    const section = sectionRef.current;
    const workspace = section?.closest('.real-workspace');
    if (!section || !workspace || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!section.getClientRects().length) {
          workspace.style.removeProperty('--ledger-art-height');
          return;
        }
        const height = Math.ceil(section.getBoundingClientRect().bottom - workspace.getBoundingClientRect().top + 8);
        const value = `${height}px`;
        if (workspace.style.getPropertyValue('--ledger-art-height') !== value) workspace.style.setProperty('--ledger-art-height', value);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    observer.observe(section);
    measure();
    return () => {observer.disconnect();cancelAnimationFrame(frame);workspace.style.removeProperty('--ledger-art-height');};
  }, []);
  const firstDate = expenseDates.at(-1);
  const lastDate = expenseDates[0];
  const displayDate = value => value.split('-').map(Number).join('.');
  const balanceTitle = !isMember ? '帳本檢視' : balanceCents < 0 ? '你尚需支付' : balanceCents > 0 ? '你尚可收回' : '我的餘額';
  const settlementHint = !expenseCount ? '從第一筆花費開始' : settlementCount ? '應收應付請見結算明細' : '目前沒有待結算款項';

  return <section ref={sectionRef} className="mobile-summary-cluster ledger-brush-summary" aria-label="帳本摘要">
    <dl className="ledger-brush-metrics">
      <div className="ledger-brush-metric" data-summary-metric="members">
        <dt><Users className="ledger-brush-icon" aria-hidden="true"/>同行成員</dt><dd className="ledger-brush-value">{memberCount}<span>位</span></dd><dd className="ledger-brush-caption">一起記下共同花費</dd>
      </div>
      <div className="ledger-brush-metric" data-summary-metric="total">
        <dt><svg className="ledger-brush-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="24" cy="9" rx="11" ry="4.5"/><path d="M13 9v6m22-6v15c0 2.5-4.9 4.5-11 4.5M35 16c0 2.5-4.9 4.5-11 4.5"/>
          <ellipse cx="16" cy="20" rx="11" ry="4.5"/><path d="M5 20v12c0 2.5 4.9 4.5 11 4.5S27 34.5 27 32V20M5 26c0 2.5 4.9 4.5 11 4.5S27 28.5 27 26"/>
        </svg>帳本總支出</dt><dd className="ledger-brush-value">{totalLabel}</dd><dd className="ledger-brush-caption">共 {expenseCount} 筆共同花費</dd>
      </div>
      <div className="ledger-brush-metric" data-summary-metric="settlements">
        <dt><WalletCards className="ledger-brush-icon" aria-hidden="true"/>待結算</dt><dd className="ledger-brush-value">{settlementCount}<span>筆</span></dd><dd className="ledger-brush-caption">{settlementHint}</dd>
      </div>
    </dl>
    <aside className="ledger-summary-note" aria-label="帳本與個人餘額">
      <div className="ledger-summary-note-title"><ReceiptText aria-hidden="true"/><strong title={name}>{name}</strong></div>
      <p className="ledger-summary-date"><span>消費紀錄</span>{firstDate ? <><time dateTime={firstDate}>{displayDate(firstDate)}</time>{lastDate !== firstDate && <> – <time dateTime={lastDate}>{displayDate(lastDate)}</time></>}</> : <span>尚無日期紀錄</span>}</p>
      <p className={`ledger-summary-balance ${isMember && balanceCents < 0 ? 'is-payable' : ''}`}><span>{balanceTitle}</span><strong>{isMember ? balanceLabel : '非成員'}</strong></p>
    </aside>
  </section>;
}
