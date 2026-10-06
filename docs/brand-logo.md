# TripTab handwritten sun identity

The user-supplied reference board is the source of the handwritten TripTab and 旅帳 lettering

The lettering is traced to SVG paths, retaining its shape without requiring or distributing a font
The muted sun is a separate vector shape
Version labels, palette dots, design notes and the presentation-board tagline are not part of the UI lockup
Because the supplied source is a small raster image, contour smoothing cannot recover original vector control points

## Assets

- `public/triptab-logo.svg`: transparent full lockup for light surfaces
- `public/triptab-logo-light.svg`: the same letterform paths with reversed colors for the dark footer
- `public/triptab-mark.svg`: compact first-T and sun derivative for narrow headers and browser tabs
- `public/triptab-apple-touch-icon.png`: 180×180 home-screen icon from the compact mark

`BrandLogo` and `BrandMark` preserve their existing public props
Use `BrandLogo` for the complete signature and `BrandMark` only in constrained square slots
Asset URLs carry `handwritten-sun-1`; update the version in `BrandLogo.jsx` and `index.html` together when replacing assets
No API, account, ledger, modal, payment, split or persistence behavior is changed

## Verification

Run `pnpm test`, `pnpm build` and `node --test tests/brand-logo.browser.mjs`
The browser regression uses the full compiled application, local asset data and mocked API responses; no production data is accessed or written
Set `BRAND_SCREENSHOTS` to save desktop, mobile, landing-page, footer and administrator screenshots
