# Site typography

All rendered HTML and inline text use **GenSen Rounded TW 2.100** (源泉圓體月 / TW)
The source is ButTaiwan/gensen-font at commit `d347d3fffcb45e08857052433a0b432ed4f7ace8`
The TC classical-print variant is not used

`src/typography.css` is the single family override, imported last from the existing entry
The only overridden presentation property is `font-family`
Existing font sizes, weights, line heights, spacing, layouts and all business logic remain unchanged
SVG/path logos and words baked into background artwork are not editable font text and are unchanged

## Delivery

Six real weights (250 / 300 / 400 / 500 / 700 / 900) are served from our own origin
WOFF2 files are content-hashed and divided into disjoint Unicode ranges for Latin, static UI copy and uncommon characters
Every Unicode codepoint mapped by the upstream TW font is retained across the shards
The browser requests only the ranges it renders; user text is never sent to a font service
`font-display: swap` keeps the interface readable with a Traditional Chinese sans-serif fallback while fonts load or if delivery fails
No external font scripts, new npm dependencies, lockfile changes or runtime font-generation step are required
The upstream OFL license is included beside the assets, and copyright/license font metadata is retained

## Maintenance and checks

`public/fonts/gensen-tw-2.1.0/manifest.json` records the source and each font checksum, weight and Unicode range
A normal build simply uses those static resources
`scripts/prepare-gensen-fonts.py` is an optional, maintenance-only rebuild tool; its pinned tooling runs in a disposable environment, not in the application or production Docker image

Unit tests check local fingerprints, disjoint ranges and family-only changes
Browser tests serve the actual font files over loopback and use Chrome's rendered-platform-font inspection rather than checking CSS names alone
Existing ledger, mobile, modal and branding tests also use the actual webfonts
Post-merge verification reads the public CSS, JS, font manifest and every font shard, without authentication or private ledger access
