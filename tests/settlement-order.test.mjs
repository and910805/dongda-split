import assert from 'node:assert/strict';
import test from 'node:test';
import {prioritizeSettlementsForMember} from '../src/settlement-order.mjs';

test('收款人為目前使用者的結算會優先，且各組維持原本順序',()=>{
  const settlements=[
    {id:'other-1',from:{id:'member-b'},to:{id:'member-c'}},
    {id:'mine-pay',from:{id:'member-a'},to:{id:'member-b'}},
    {id:'other-2',from:{id:'member-c'},to:{id:'member-b'}},
    {id:'mine-receive',from:{id:'member-b'},to:{id:'member-a'}}
  ];
  assert.deepEqual(prioritizeSettlementsForMember(settlements,'member-a').map(item=>item.id),['mine-pay','mine-receive','other-1','other-2']);
});

test('接收者識別碼可安全比較字串與數字，且不修改原始陣列',()=>{
  const settlements=[{id:'other',from:{id:2},to:{id:3}},{id:'mine',from:{id:1},to:{id:2}}];
  const original=[...settlements];
  assert.deepEqual(prioritizeSettlementsForMember(settlements,'1').map(item=>item.id),['mine','other']);
  assert.deepEqual(settlements,original);
});

test('付款與收款項目在各自群組內保留原始演算法順序',()=>{
  const settlements=[
    {id:'receive-first',from:{id:'b'},to:{id:'me'}},
    {id:'pay-second',from:{id:'me'},to:{id:'c'}},
    {id:'receive-third',from:{id:'d'},to:{id:'me'}}
  ];
  assert.deepEqual(prioritizeSettlementsForMember(settlements,'me').map(item=>item.id),[
    'receive-first','pay-second','receive-third'
  ]);
});
