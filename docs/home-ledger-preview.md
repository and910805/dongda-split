# Homepage expense preview

The homepage phone contains a **static capture of the production ProductApp expense page**, not a second hand-built interface and not a live connection to a member's account. Only the phone presentation and its two surrounding captions are changed.

The public example is named 宜筆勾銷 and uses 15 synthetic members with no photos, account numbers, LINE IDs, invitation links or tokens. Three example expenses are allocated by the existing production functions; payments, shares, balances and counts reconcile. The capture contains the real search, date/member filters, sort controls, expense rows and bottom navigation in Taipei Sans TC.

The image is not interactive. Its alternative text and adjacent caption identify a static preview with sample data. Real account creation/login still uses the existing homepage actions. An image-load failure has readable fallback copy and does not disable those actions.

## Refresh the preview after changing the expense UI

In a Node 22 environment with Chrome installed and the existing lockfile dependencies:

```sh
npm run build
node scripts/capture-home-ledger-preview.mjs
npm test
npm run build
node --test tests/home-ledger-preview.browser.mjs
```

The capture script uses the existing offline browser fixture; all API responses are synthetic and no production service is contacted. It captures a 390×756 CSS-pixel viewport at 2× resolution, waits for the actual Taipei webfont, checks the complete final row above the bottom navigation, and writes:

- `public/hero-ledger-expenses-v1.webp`
- `public/hero-ledger-expenses-v1.json` (dimensions, non-private metadata, image and ProductApp source hashes)

The browser's scrollbar is hidden as mobile browser chrome, without overriding application CSS or removing product controls. No image-generation model redraws the interface. `object-fit: contain` preserves the capture's proportions inside the device; surrounding decorations sit behind or below it.

The homepage does not import the capture script, finance fixture or test browser. These tools are for maintenance, not part of production startup. No new application dependencies are required.
