import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSettlementNotice,
  formatSettlementReportAmount,
  formatSettlementReportTime,
  settlementLineShareUrl
} from '../src/settlement-notice.mjs';

const report={
  groupName:'東京五日旅行',
  from:{
    id:'debtor-uuid',
    displayName:'小明',
    bankAccount:{accountNumber:'000123456789'}
  },
  to:{
    id:'creditor-uuid',
    displayName:'小美'
  },
  reportedBy:{id:'debtor-uuid',displayName:'小明'},
  amountCents:12_600_00,
  reportedAt:new Date(2026,6,27,14,5),
  inviteToken:'secret-invite-token'
};

test('產生可供 LINE 分享的制式轉帳通知',()=>{
  const notice=buildSettlementNotice(report);
  assert.equal(notice.amountLabel,'NT$ 12,600');
  assert.match(notice.timeLabel,/^2026\/07\/27 14:05$/);
  assert.match(notice.text,/【旅帳 TripTab｜轉帳紀錄】/);
  assert.match(notice.text,/旅程：東京五日旅行/);
  assert.match(notice.text,/付款人：小明/);
  assert.match(notice.text,/收款人：小美/);
  assert.match(notice.text,/轉帳金額：NT\$ 12,600/);
  assert.match(notice.text,/實際入帳狀態以銀行紀錄為準/);
});

test('通知不會洩漏帳戶、識別碼或邀請權杖',()=>{
  const {text}=buildSettlementNotice(report);
  assert.doesNotMatch(text,/000123456789/);
  assert.doesNotMatch(text,/debtor-uuid|creditor-uuid/);
  assert.doesNotMatch(text,/secret-invite-token/);
  assert.doesNotMatch(text,/https?:\/\//);
});

test('代管公費回報時會另外標示實際回報人',()=>{
  const {text}=buildSettlementNotice({
    ...report,
    from:{id:'fund',displayName:'旅程公費',isFund:true},
    reportedBy:{id:'owner',displayName:'群組管理員'}
  });
  assert.match(text,/付款人：旅程公費/);
  assert.match(text,/回報人：群組管理員/);
});

test('群組建立者代成員確認時會保留付款人與實際回報人',()=>{
  const {text}=buildSettlementNotice({
    ...report,
    reportedBy:{id:'owner',displayName:'群組管理員'}
  });
  assert.match(text,/付款人：小明/);
  assert.match(text,/回報人：群組管理員/);
  assert.match(text,/群組管理員 已將這筆款項標記為「已轉帳」/);
});

test('金額、時間與 LINE 分享網址維持可預期格式',()=>{
  assert.equal(formatSettlementReportAmount(746_00),'NT$ 746');
  assert.equal(formatSettlementReportAmount('invalid'),'NT$ 0');
  assert.equal(formatSettlementReportAmount(-100),'NT$ 0');
  assert.equal(formatSettlementReportTime('invalid'),'時間未記錄');
  const url=settlementLineShareUrl(report);
  assert.match(url,/^https:\/\/line\.me\/R\/share\?text=/);
  assert.match(decodeURIComponent(url),/旅帳 TripTab｜轉帳紀錄/);
});

test('名稱中的換行不會破壞制式通知欄位',()=>{
  const {text}=buildSettlementNotice({
    ...report,
    groupName:'東京\n五日旅行',
    from:{displayName:'小明\n付款人'},
    to:{displayName:'小美\r\n收款人'}
  });
  assert.match(text,/旅程：東京 五日旅行/);
  assert.match(text,/付款人：小明 付款人/);
  assert.match(text,/收款人：小美 收款人/);
});
