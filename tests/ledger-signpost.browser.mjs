// Only offline ledger fixtures are used; the sign is a non-interactive background.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launch, page} from './helpers/ledger-browser.mjs';
import {assertRenderedTaipei} from './helpers/font-fixture.mjs';
const svg = readFileSync(new URL('../public/ledger-signpost-v6.svg', import.meta.url));
const layer = `data:image/svg+xml;base64,${svg.toString('base64')}`;
const shown = selector => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;

test('Version 6 signpost: registered artwork and untouched controls', {timeout: 120000}, async t => {
  const browser = await launch();
  try {
    for (const width of [901, 1024, 1280, 1672, 1920]) await t.test(`${width}px desktop: aligned signpost and operable header`, async () => {
      const p = await page(browser, width, 941);
      try {
        const background = await p.evaluate(`getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundImage`);
        assert.ok(background.startsWith(`url("${layer}")`), 'Selected signboard must be the front layer');
        assert.ok(background.includes('data:image/webp;base64,'), 'The existing coast remains behind the sign');
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundSize.split(',').every(size=>size.trim()==='cover')`), true);
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector('.real-workspace'),'::before').pointerEvents`), 'none');
        assert.equal(await p.evaluate(`new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth===1458&&i.naturalHeight===465);i.onerror=()=>reject(new Error('Signpost failed to decode'));i.src=${JSON.stringify(layer)};})`), true);
        await assertRenderedTaipei(p, '.group-title-row h1');
        await p.evaluate('window.scrollTo(0,0)');
        await p.screenshot(`version6-desktop-${width}`);
        await p.click('.header-primary');
        await p.wait(shown('.expense-single-modal'));
        await p.click('.es-cancel');
        assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
        assert.deepEqual(await p.evaluate('__qa.errors'), []);
        assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'), 0);
      } finally { await p.close(); }
    });
    for (const width of [320, 390, 900]) await t.test(`${width}px mobile: existing scenery and single expense modal remain`, async () => {
      const p = await page(browser, width, 844);
      try {
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector('.real-workspace'),'::before').backgroundImage.includes(${JSON.stringify(layer)})`), false);
        await assertRenderedTaipei(p, '.mobile-ledger-heading h1');
        await p.screenshot(`version6-mobile-${width}`);
        await p.click('.mobile-bottom-add');
        await p.wait(shown('.expense-single-modal'));
        assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'), 1);
        const canSave = await p.evaluate(`(()=>{const e=document.querySelector('.es-save'),r=e.getBoundingClientRect();return r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
        assert.equal(canSave, true);
        await p.screenshot(`version6-expense-${width}`);
        await p.click('.es-cancel');
        assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
        assert.deepEqual(await p.evaluate('__qa.errors'), []);
        assert.equal(await p.evaluate('__qa.requests.filter(r=>r.method!=="GET").length'), 0);
      } finally { await p.close(); }
    });
  } finally { await browser.close(); }
});
