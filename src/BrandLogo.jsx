import React from 'react';
import './brand-logo.css';

// Stable versions invalidate the previous cached bird mark without remote assets.
const BRAND_ASSETS = Object.freeze({
  logo: '/triptab-logo.svg?v=handwritten-sun-1',
  lightLogo: '/triptab-logo-light.svg?v=handwritten-sun-1',
  mark: '/triptab-mark.svg?v=handwritten-sun-1',
});

export function BrandMark({className=''}) {
  return (
    <span className={`brand-symbol brand-signature-mark ${className}`.trim()} aria-hidden="true">
      <img src={BRAND_ASSETS.mark} alt="" width="64" height="64" decoding="async" />
    </span>
  );
}

export function BrandLogo({light=false,className=''}) {
  return (
    <div className={`brand brand-handwritten ${light?'light':''} ${className}`.trim()} role="img" aria-label="旅帳 TripTab">
      <img className="brand-lockup" src={light ? BRAND_ASSETS.lightLogo : BRAND_ASSETS.logo} alt="" width="176" height="100" decoding="async" />
    </div>
  );
}
