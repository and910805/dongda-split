import React from 'react';

export function BrandMark({className=''}) {
  return (
    <span className={`brand-symbol ${className}`.trim()} aria-hidden="true">
      <img src="/triptab-mark.svg" alt="" />
    </span>
  );
}

export function BrandLogo({light=false,className=''}) {
  return (
    <div className={`brand ${light?'light':''} ${className}`.trim()} aria-label="旅帳 TripTab">
      <BrandMark/>
      <span className="brand-wordmark">
        <b className="brand-name">旅帳</b>
        <small className="brand-english"><span>Trip</span><em>Tab</em></small>
      </span>
    </div>
  );
}
