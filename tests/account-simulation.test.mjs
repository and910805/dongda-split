import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeSimulatedAccountInput} from '../account-simulation.mjs';

test('會整理模擬帳號名稱與使用情境的空白',()=>{
  assert.deepEqual(
    normalizeSimulatedAccountInput({displayName:'  東京\n旅伴  ',note:'  測試\t多人分帳  '}),
    {displayName:'東京 旅伴',note:'測試 多人分帳'}
  );
});

test('顯示名稱為必填且最多 40 個字',()=>{
  assert.throws(()=>normalizeSimulatedAccountInput({displayName:'   '}),/顯示名稱需為 1–40 個字/);
  assert.throws(()=>normalizeSimulatedAccountInput({displayName:'旅'.repeat(41)}),/顯示名稱需為 1–40 個字/);
  assert.equal(normalizeSimulatedAccountInput({displayName:'旅'.repeat(40)}).displayName.length,40);
});

test('使用情境最多 120 個字',()=>{
  assert.throws(
    ()=>normalizeSimulatedAccountInput({displayName:'測試旅伴',note:'行'.repeat(121)}),
    /使用情境最多 120 個字/
  );
});
