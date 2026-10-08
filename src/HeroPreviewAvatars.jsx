import React, {useId} from 'react';
import photos from './hero-ledger-avatar-photos.json';

// Coordinates are measured from the unchanged 780x1512 ProductApp capture.
// Keep the photos registered to that image, not to viewport or device pixels.
const PREVIEW_IMAGE_SHA256 = 'a0230b4e3a91b032f38d91353b0b0f9e03c0acdf1997fa9fab3750bf6c9fbff8';
const ROW_TOPS = [847.46875, 1031.46875, 1215.46875];
const STACK_LEFTS = [56, 92, 128, 164];
const FRAMES = [
  {photo: 0, x: 674, y: 34, size: 76, border: 0},
  {photo: 0, x: 422, y: 588.375, size: 40, border: 2},
  ...ROW_TOPS.flatMap((y, row) => STACK_LEFTS.slice(0, row === 0 ? 2 : 4)
    .map((x, photo) => ({photo, x, y, size: 48, border: 4}))),
];

export function HeroPreviewAvatars({onError}) {
  const id = useId();
  const maskId = `${id}-keep-counts`;
  const photoId = index => `${id}-photo-${index}`;
  return <svg className="hero-ledger-avatar-overlay" width="780" height="1512"
    viewBox="0 0 780 1512" preserveAspectRatio="xMidYMid meet"
    aria-hidden="true" focusable="false" data-avatar-revision="authorized-photos-1"
    data-base-image-sha256={PREVIEW_IMAGE_SHA256}>
    <defs>
      {photos.photos.map((photo, index) => <image key={photo.id} id={photoId(index)}
        width={photos.width} height={photos.height}
        xlinkHref={`data:image/webp;base64,${photo.webpBase64}`} onError={onError}/>)}
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="780" height="1512">
        <rect width="780" height="1512" fill="white"/>
        {/* The original +10 / +6 badges must remain above the last photo. */}
        {ROW_TOPS.slice(1).map(y => <circle key={y} cx="224" cy={y + 24} r="24" fill="black"/>)}
      </mask>
    </defs>
    <g mask={`url(#${maskId})`}>
      {FRAMES.map((frame, index) => <g key={index} data-avatar-instance={index + 1}>
        <circle cx={frame.x + frame.size / 2} cy={frame.y + frame.size / 2}
          r={frame.size / 2} fill="#fff"/>
        <use xlinkHref={`#${photoId(frame.photo)}`}
          transform={`translate(${frame.x + frame.border} ${frame.y + frame.border}) scale(${(frame.size - 2 * frame.border) / photos.width})`}/>
      </g>)}
    </g>
  </svg>;
}
