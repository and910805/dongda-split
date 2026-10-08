import React, {useState} from 'react';
import {HeroPreviewAvatars} from './HeroPreviewAvatars.jsx';
import './home-ledger-preview.css';

// The real expense-page capture stays unchanged; only authorized photos are added.
// Keep this public preview inert: it must never fetch a private ledger or save data.
export function HeroLedgerPreview() {
  const [failed, setFailed] = useState(false);
  return <div className="phone-content phone-content-real">
    {failed ? <div className="hero-preview-fallback" role="status">
      <b>宜筆勾銷</b><span>支出介面預覽暫時無法載入</span>
      <small>仍可使用左側或上方按鈕開始分帳</small>
    </div> : <>
      <img className="hero-ledger-screenshot" src="/hero-ledger-expenses-v1.webp"
        width="780" height="1512" decoding="async" fetchPriority="high"
        alt="宜筆勾銷的實際手機支出頁面，使用已授權的真人頭像，姓名與帳目為示範資料；保留搜尋、篩選、排序、分攤金額與底部導覽，此為靜態預覽"
        onError={() => setFailed(true)}/>
      <HeroPreviewAvatars onError={() => setFailed(true)}/>
    </>}
  </div>;
}
