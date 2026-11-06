import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,page,fixture} from './helpers/ledger-browser.mjs';

const token='aBcD0123_-aBcD0123_-aBcD';
const joinedGroup={...structuredClone(fixture),id:'joined',name:'新加入的旅行帳本'};

test('installed mobile view joins only a link on its own origin',{timeout:120000},async()=>{
  const browser=await launch();
  try{
    const p=await page(browser,390,844,'settled',fixture,{joinGroup:joinedGroup});
    try{
      await p.click('.mobile-group-picker');
      await p.click('.ledger-switcher-join');
      await p.wait('!!document.querySelector(".join-group-modal")');
      await p.screenshot('invite-join-mobile');
      assert.equal(await p.evaluate('document.querySelectorAll("[aria-modal=true]").length'),1);

      const origin=await p.evaluate('location.origin');
      await p.setValue('#join-invite-link',`https://evil.example/invite/${token}`);
      await p.click('.join-group-modal button[type=submit]');
      assert.match(await p.evaluate('document.querySelector(".join-group-modal [role=alert]")?.textContent'),/目前旅帳網域/);
      assert.equal(await p.evaluate('__qa.requests.filter(item=>item.path.includes("/api/invites/")).length'),0);

      await p.setValue('#join-invite-link',`${origin}/invite/${token}`);
      await p.click('.join-group-modal button[type=submit]');
      await p.wait('document.querySelector(".mobile-group-picker-copy b")?.textContent==="新加入的旅行帳本"');
      assert.deepEqual(await p.evaluate('__qa.requests.filter(item=>item.path.includes("/api/invites/"))'),[
        {path:`/api/invites/${token}/join`,method:'POST',body:null},
      ]);
      assert.equal(await p.evaluate('!!document.querySelector(".join-group-modal")'),false);
      assert.deepEqual(await p.evaluate('__qa.errors'),[]);
    }finally{await p.close()}
  }finally{await browser.close()}
});

test('a member with no ledgers can join from the empty state',{timeout:120000},async()=>{
  const browser=await launch();
  try{
    const p=await page(browser,390,844,'settled',fixture,{groups:[],joinGroup:joinedGroup});
    try{
      await p.click('.empty-groups-actions .secondary-button');
      const origin=await p.evaluate('location.origin');
      await p.setValue('#join-invite-link',`${origin}/invite/${token}`);
      await p.click('.join-group-modal button[type=submit]');
      await p.wait('document.querySelector(".mobile-group-picker-copy b")?.textContent==="新加入的旅行帳本"');
      assert.equal(await p.evaluate('!!document.querySelector(".real-dashboard")'),true);
    }finally{await p.close()}
  }finally{await browser.close()}
});
