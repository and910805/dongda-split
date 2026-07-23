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
  const rows=allocateEqual(100_000,['a','b','c'],false);assert.deepEqual(rows.map(x=>x.shareCents).sort((a,b)=>a-b),[33_300,33_300,33_400]);assert.equal(sum(rows),100_000);assert.ok(rows.every(x=>x.shareCents%100===0));
});

test('所有自動分攤都只產生整數元',()=>{
  const equal=allocateEqual(100_100,['a','b','c'],false),weighted=allocateByWeights(100_100,[{userId:'a',weight:1},{userId:'b',weight:2},{userId:'c',weight:3}]),hybrid=allocateHybrid(100_100,['a','b','c'],[{userId:'a',shareCents:10_000}]);
  for(const rows of [equal,weighted,hybrid]){assert.equal(sum(rows),100_100);assert.ok(rows.every(x=>x.shareCents%100===0))}
});

test('直接代購只產生 A 與 B 一筆轉帳',()=>{
  const transfers=minimizeSettlements([{id:'a',displayName:'A',balanceCents:12_500},{id:'b',displayName:'B',balanceCents:-12_500},{id:'c',displayName:'C',balanceCents:0}]);assert.equal(transfers.length,1);assert.equal(transfers[0].from.id,'b');assert.equal(transfers[0].to.id,'a');assert.equal(transfers[0].amountCents,12_500);
});

test('零和子群最佳化會保留可獨立結清的群組',()=>{
  const transfers=minimizeSettlements([{id:'a',balanceCents:500},{id:'b',balanceCents:-500},{id:'c',balanceCents:400},{id:'d',balanceCents:-400}]);assert.equal(transfers.length,2);
});

const payCounts = transfers => transfers.reduce((map,t)=>map.set(t.from.id,(map.get(t.from.id)||0)+1),new Map());

test('小額付款人都能一次付清，尾數由欠最多的人吸收',()=>{
  // c 欠 1,000 元；a、b、d 各欠 100 元，三個小額付款人應各自一筆結清
  const transfers=minimizeSettlements([{id:'a',balanceCents:-10_000},{id:'b',balanceCents:-10_000},{id:'d',balanceCents:-10_000},{id:'c',balanceCents:-100_000},{id:'x',balanceCents:70_000},{id:'y',balanceCents:60_000}]);
  const counts=payCounts(transfers);
  assert.equal(counts.get('a'),1);assert.equal(counts.get('b'),1);assert.equal(counts.get('d'),1);
  assert.ok(!counts.has('x')&&!counts.has('y'),'收款人不應該需要轉帳');
});

test('隨機情境都能完全結清，且收款人永遠不必轉帳',()=>{
  for(let seed=0;seed<400;seed++){
    const size=3+seed%12,balances=[];let total=0;
    for(let i=0;i<size-1;i++){const value=((seed*7+i*13)%2?1:-1)*(((seed*31+i*17)%900)+1)*100;balances.push({id:`u${i}`,balanceCents:value});total+=value}
    balances.push({id:`u${size-1}`,balanceCents:-total});
    if(balances.some(x=>x.balanceCents===0))continue;
    const transfers=minimizeSettlements(balances);
    const net=new Map(balances.map(x=>[x.id,x.balanceCents]));
    for(const t of transfers){net.set(t.from.id,net.get(t.from.id)+t.amountCents);net.set(t.to.id,net.get(t.to.id)-t.amountCents)}
    assert.ok([...net.values()].every(v=>v===0),`seed ${seed} 未完全結清`);
    assert.ok(transfers.every(t=>t.amountCents>0),`seed ${seed} 出現非正數金額`);
    const creditors=new Set(balances.filter(x=>x.balanceCents>0).map(x=>x.id));
    assert.ok(transfers.every(t=>!creditors.has(t.from.id)),`seed ${seed} 讓收款人轉了帳`);
  }
});
