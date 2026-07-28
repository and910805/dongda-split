import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExpenseIdempotencyKey,
  createExpenseRequestOptions,
  createExpenseSubmissionKeyStore,
  expenseSubmissionFingerprint,
} from '../src/expense-idempotency.mjs';

const payload = {
  title: '東京住宿',
  amount: '120.00',
  currency: 'USD',
  participantIds: ['user-a', 'user-b'],
  splitMode: 'equal',
};

test('新增支出鍵使用可傳送的 UUID 格式', () => {
  assert.match(
    createExpenseIdempotencyKey(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('相同內容的新增支出重試會重用同一個 Idempotency-Key', () => {
  let sequence = 0;
  const keyStore = createExpenseSubmissionKeyStore({createKey: () => `key-${++sequence}`});

  const first = createExpenseRequestOptions({method: 'POST', payload, keyStore});
  const retry = createExpenseRequestOptions({
    method: 'POST',
    payload: {...payload},
    keyStore,
  });

  assert.equal(first.headers['Idempotency-Key'], 'key-1');
  assert.equal(retry.headers['Idempotency-Key'], 'key-1');
  assert.equal(sequence, 1);
});

test('輸入內容修改後才會為下一次提交建立新鍵', () => {
  let sequence = 0;
  const keyStore = createExpenseSubmissionKeyStore({createKey: () => `key-${++sequence}`});

  const first = createExpenseRequestOptions({method: 'POST', payload, keyStore});
  const changed = createExpenseRequestOptions({
    method: 'POST',
    payload: {...payload, amount: '121.00'},
    keyStore,
  });

  assert.equal(first.headers['Idempotency-Key'], 'key-1');
  assert.equal(changed.headers['Idempotency-Key'], 'key-2');
});

test('成功完成後的下一筆相同內容支出會取得新鍵', () => {
  let sequence = 0;
  const keyStore = createExpenseSubmissionKeyStore({createKey: () => `key-${++sequence}`});

  const first = createExpenseRequestOptions({method: 'POST', payload, keyStore});
  keyStore.complete();
  const next = createExpenseRequestOptions({method: 'POST', payload, keyStore});

  assert.equal(first.headers['Idempotency-Key'], 'key-1');
  assert.equal(next.headers['Idempotency-Key'], 'key-2');
});

test('欄位順序不影響提交內容指紋', () => {
  const reordered = {
    splitMode: 'equal',
    participantIds: ['user-a', 'user-b'],
    currency: 'USD',
    amount: '120.00',
    title: '東京住宿',
  };

  assert.equal(expenseSubmissionFingerprint(payload), expenseSubmissionFingerprint(reordered));
});

test('修改支出不會附加新增支出專用的 Idempotency-Key', () => {
  const keyStore = createExpenseSubmissionKeyStore({createKey: () => 'unused'});
  const options = createExpenseRequestOptions({method: 'PATCH', payload, keyStore});

  assert.equal(options.headers, undefined);
  assert.equal(keyStore.current(), null);
});
