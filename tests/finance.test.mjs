import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateByWeights,allocateEqual,allocateHybrid,minimizeSettlements} from '../finance.mjs';

const sum = rows => rows.reduce((total,row)=>total+row.shareCents,0);

test('14 人平均分攤 14,000',()=>{
  const rows=allocateEqual(1_400_000,Array.from({length:14},(_,i)=>`u${i}`),false);
  assert.equal(rows.length,14);assert.ok(rows.every(x=>x.shareCents===100_000));assert.equal(sum(rows),1_400_000);
});

test('14 人群組可只指定 10 人分酒錢',()=>{
  const rows=allocateEqual(120_000,Array.from({length:10},(_,i)=>`u${i}`),false);
  assert.ok(rows.every(x=>x.shareCents===12_000));
});

test('指定金額後，剩餘金額由其他人均分',()=>{
  const ids=Array.from({length:14},(_,i)=>`u${i}`),rows=allocateHybrid(450_000,ids,[{userId:'u0',shareCents:80_000},{userId:'u1',shareCents:20_000}]);
  assert.equal(sum(rows),450_000);assert.equal(rows.find(x=>x.userId==='u0').shareCents,80_000);assert.equal(rows.find(x=>x.userId==='u1').shareCents,20_000);assert.equal(rows.length,14);
});

test('按住宿天數或家庭人數的份數比例分攤',()=>{
  const weights=[...Array.from({length:2},(_,i)=>({userId:`short${i}`,weight:1})),...Array.from({length:12},(_,i)=>({userId:`full${i}`,weight:2}))],rows=allocateByWeights(2_600_000,weights);
  assert.equal(sum(rows),2_600_000);assert.ok(rows.filter(x=>x.userId.startsWith('short')).every(x=>x.shareCents===100_000));assert.ok(rows.filter(x=>x.userId.startsWith('full')).every(x=>x.shareCents===200_000));
});

test('退款以負數平均沖回成員負擔',()=>{
  const rows=allocateEqual(-200_000,['a','b','c','d'],false);assert.deepEqual(rows.map(x=>x.shareCents),[-50_000,-50_000,-50_000,-50_000]);assert.equal(sum(rows),-200_000);
});

test('1,000 元三人均分，只有一人承擔一元尾差',()=>{
  const rows=allocateEqual(100_000,['a','b','c'],false);assert.deepEqual(rows.map(x=>x.shareCents).sort((a,b)=>a-b),[33_333,33_333,33_334]);assert.equal(sum(rows),100_000);
});

test('直接代購只產生 A 與 B 一筆轉帳',()=>{
  const transfers=minimizeSettlements([{id:'a',displayName:'A',balanceCents:12_500},{id:'b',displayName:'B',balanceCents:-12_500},{id:'c',displayName:'C',balanceCents:0}]);assert.equal(transfers.length,1);assert.equal(transfers[0].from.id,'b');assert.equal(transfers[0].to.id,'a');assert.equal(transfers[0].amountCents,12_500);
});

test('零和子群最佳化會保留可獨立結清的群組',()=>{
  const transfers=minimizeSettlements([{id:'a',balanceCents:500},{id:'b',balanceCents:-500},{id:'c',balanceCents:400},{id:'d',balanceCents:-400}]);assert.equal(transfers.length,2);
});
