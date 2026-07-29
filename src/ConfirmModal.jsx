import React,{useEffect,useId,useRef} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,Check,LoaderCircle,ShieldCheck,Trash2,X} from './ui-icons.jsx';
import {acquireModalEnvironment} from './modal-environment.mjs';
import {useI18n} from './i18n.jsx';

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone='danger',
  busy=false,
  error='',
  onCancel,
  onConfirm
}){
  const {t,translateApiError}=useI18n();
  const titleId=useId(),descriptionId=useId(),errorId=useId();
  const overlayRef=useRef(null),dialogRef=useRef(null),cancelRef=useRef(null);
  const cancelHandlerRef=useRef(onCancel),busyRef=useRef(busy),returnFocusRef=useRef(document.activeElement);
  cancelHandlerRef.current=onCancel;
  busyRef.current=busy;

  useEffect(()=>{
    const overlay=overlayRef.current,dialog=dialogRef.current;
    const focusable='button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const releaseEnvironment=acquireModalEnvironment(overlay);

    const initialTimer=setTimeout(()=>cancelRef.current?.focus(),0);
    const onKeyDown=event=>{
      const topModal=[...document.querySelectorAll('[aria-modal="true"]')].at(-1);
      if(topModal!==dialog)return;
      if(event.key==='Escape'){
        event.preventDefault();
        if(!busyRef.current)cancelHandlerRef.current();
        return;
      }
      if(event.key!=='Tab'||!dialog)return;
      const items=[...dialog.querySelectorAll(focusable)].filter(item=>item.getClientRects().length);
      if(!items.length)return;
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    document.addEventListener('keydown',onKeyDown);

    return ()=>{
      clearTimeout(initialTimer);
      document.removeEventListener('keydown',onKeyDown);
      releaseEnvironment();
      returnFocusRef.current?.focus?.();
    };
  },[]);

  const ActionIcon=tone==='danger'?Trash2:ShieldCheck;
  const describedBy=error?`${descriptionId} ${errorId}`:descriptionId;

  return createPortal(
    <div ref={overlayRef} className="overlay confirm-overlay" onMouseDown={event=>event.target===event.currentTarget&&!busy&&onCancel()}>
      <div
        ref={dialogRef}
        className={`modal real-modal confirm-modal is-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy||undefined}
      >
        <button type="button" className="modal-x" onClick={onCancel} disabled={busy} aria-label={t('confirm.close')}><X/></button>
        <div className="confirm-modal-heading">
          <span className="confirm-modal-icon" aria-hidden="true"><ActionIcon/></span>
          <div>
            <span className="eyebrow">{t(tone==='danger'?'confirm.dangerEyebrow':'confirm.permissionEyebrow')}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
        </div>
        <p className="confirm-modal-copy" id={descriptionId}>{description}</p>
        {error&&<p className="form-error confirm-modal-error" id={errorId} role="alert"><AlertCircle/>{translateApiError(error)}</p>}
        <div className="confirm-modal-actions">
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onCancel} disabled={busy}>{cancelLabel||t('common.cancel')}</button>
          <button type="button" className={tone==='danger'?'confirm-modal-danger':'primary'} onClick={onConfirm} disabled={busy}>
            {busy?<LoaderCircle/>:tone==='danger'?<Trash2/>:<Check/>}
            {busy?t('common.processing'):confirmLabel||t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
