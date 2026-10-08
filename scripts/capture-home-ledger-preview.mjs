// Maintenance only: run after npm run build. Renders the real ProductApp offline.
// Public homepage receives one inert image, never this fixture or mock API code.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, page} from '../tests/helpers/ledger-browser.mjs';
import {assertRenderedTaipei} from '../tests/helpers/font-fixture.mjs';
import {createHomeLedgerFixture} from '../tests/fixtures/home-ledger.mjs';

const directory = resolve(process.env.HOME_PREVIEW_OUTPUT || 'public');
const width = 390, height = 756, deviceScaleFactor = 2;
const ledger = createHomeLedgerFixture();
const browser = await launch();
try {
  const p = await page(browser, width, height, 'settled', ledger, {
    me: {...ledger.members[0], isSuperuser: false, bankAccount: {configured: false}},
  });
  try {
    await p.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor, mobile: false});
    await p.send('Emulation.setScrollbarsHidden', {hidden: true});
    await p.click('.mobile-bottom-nav button:nth-child(2)');
    await p.evaluate('window.scrollTo(0,0)');
    await p.evaluate('document.fonts.ready');
    await delay(100);
    await assertRenderedTaipei(p, '.mobile-expense-record-title b');
    assert.equal(await p.evaluate('document.querySelector(".mobile-group-picker b").textContent'), ledger.name);
    assert.equal(await p.evaluate('document.querySelector(".real-dashboard").dataset.mobileView'), 'expenses');
    assert.equal(await p.evaluate('document.querySelectorAll(".mobile-expense-record").length'), ledger.expenses.length);
    assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await p.evaluate('document.querySelectorAll(".mobile-expense-record-more").length'), 0);
    assert.equal(await p.evaluate(`(()=>{const e=document.querySelector('.mobile-bottom-add'),r=e.getBoundingClientRect();return r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`), true);
    assert.equal(await p.evaluate("document.querySelector('.mobile-expense-record:last-child') !== null"), true);
    assert.equal(await p.evaluate("[...document.querySelectorAll('.mobile-expense-record')].at(-1).getBoundingClientRect().bottom <= document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top - 8"), true, 'The last example must not hide behind the bottom nav');
    assert.equal(await p.evaluate('__qa.requests.some(request=>request.method!=="GET")'), false);
    assert.deepEqual(await p.evaluate('__qa.errors'), []);
    // Capture full viewport, including the actual app header and bottom navigation.
    const {data} = await p.send('Page.captureScreenshot', {format: 'webp', quality: 96});
    const bytes = Buffer.from(data, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, 'hero-ledger-expenses-v1.webp'), bytes);
    const sourceSha256 = createHash('sha256').update(await readFile(new URL('../src/ProductApp.jsx', import.meta.url))).digest('hex');
    await writeFile(join(directory, 'hero-ledger-expenses-v1.json'), JSON.stringify({
      description: 'Real ProductApp expense page rendered with synthetic public-demo data',
      ledgerName: ledger.name, currency: ledger.currency, memberCount: ledger.members.length,
      expenseCount: ledger.expenses.length, totalExpenseCents: ledger.totalExpenseCents,
      viewport: {width, height, deviceScaleFactor}, pixelWidth: width * deviceScaleFactor,
      pixelHeight: height * deviceScaleFactor, font: 'Taipei Sans TC',
      imageSha256: createHash('sha256').update(bytes).digest('hex'), productSourceSha256: sourceSha256,
    }, null, 2) + '\n');
    console.log(`Captured actual expense page: ${width * deviceScaleFactor}x${height * deviceScaleFactor}, ${bytes.length} bytes, no account writes`);
  } finally {await p.close();}
} finally {await browser.close();}
