import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Info, MoreHorizontal, Pencil, ReceiptText, Trash2} from './ui-icons.jsx';

// A non-modal menu stays above the table's scrolling container, below dialogs.
export function LedgerExpenseActions({expense, canManage, busy, onDetails, onEdit, onDelete}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({left: 0, top: 0});
  const trigger = useRef(null), menu = useRef(null);
  const menuId = useId();
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({preventScroll: true});
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const panel = menu.current;
      if (!anchor || !panel) return;
      const view = window.visualViewport;
      const leftEdge = view?.offsetLeft || 0, topEdge = view?.offsetTop || 0;
      const rightEdge = leftEdge + (view?.width || innerWidth);
      const bottomEdge = topEdge + (view?.height || innerHeight);
      const width = panel.offsetWidth, height = panel.offsetHeight, gutter = 8;
      const top = anchor.bottom + height + gutter <= bottomEdge
        ? anchor.bottom + 4 : Math.max(topEdge + gutter, anchor.top - height - 4);
      setPosition({left: Math.max(leftEdge + gutter, Math.min(anchor.right - width, rightEdge - width - gutter)), top});
    };
    place();
    menu.current?.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const keyboard = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {event.preventDefault(); close(true); return;}
      if (event.key === 'Tab') {close(true); return;}
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...(menu.current?.querySelectorAll('button:not(:disabled)') || [])];
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);
  const act = callback => {close(true); callback(expense);};
  return <>
    <button ref={trigger} type="button" className="ledger-row-more" disabled={busy}
      aria-label={`「${expense.title}」帳目操作`} title="帳目操作" aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {if (event.key === 'ArrowDown') {event.preventDefault(); setOpen(true);}}}>
      <MoreHorizontal aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="ledger-row-menu" role="menu"
      aria-label={`「${expense.title}」帳目操作`} style={position}>
      <button role="menuitem" type="button" onClick={() => act(onDetails)}>
        {expense.isLocked ? <Info/> : <ReceiptText/>}{expense.isLocked ? '查看鎖定原因與明細' : '查看帳目明細'}
      </button>
      {canManage && !expense.isLocked && <>
        <button role="menuitem" type="button" onClick={() => act(onEdit)}><Pencil/>修改支出</button>
        <button role="menuitem" type="button" className="is-danger" onClick={() => act(onDelete)}><Trash2/>刪除支出</button>
      </>}
    </div>, document.body)}
  </>;
}
