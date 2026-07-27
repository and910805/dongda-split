import assert from 'node:assert/strict';
import test from 'node:test';
import {prioritizeSettlementsForReceiver} from '../src/settlement-order.mjs';

test('收款人為目前使用者的結算會優先，且各組維持原本順序',()=>{
  const settlements=[
    {id:'other-1',to:{id:'member-b'}},
    {id:'mine-1',to:{id:'member-a'}},
    {id:'other-2',to:{id:'member-c'}},
    {id:'mine-2',to:{id:'member-a'}}
  ];
  assert.deepEqual(prioritizeSettlementsForReceiver(settlements,'member-a').map(item=>item.id),['mine-1','mine-2','other-1','other-2']);
});

test('接收者識別碼可安全比較字串與數字，且不修改原始陣列',()=>{
  const settlements=[{id:'other',to:{id:2}},{id:'mine',to:{id:1}}];
  const original=[...settlements];
  assert.deepEqual(prioritizeSettlementsForReceiver(settlements,'1').map(item=>item.id),['mine','other']);
  assert.deepEqual(settlements,original);
});
