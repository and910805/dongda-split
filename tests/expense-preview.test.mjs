import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpensePreview} from '../src/expense-preview.mjs';
import {allocateEqual, allocateHybrid, allocateByWeights} from '../finance.mjs';

const ids = ['u1', 'u2', 'u3', 'u4'];
const preview = overrides => createExpensePreview({amountCents: 120000, participantIds: ids, ...overrides});
const exactValues = result => result.rows.map(row => row.minCents);

test('preview: equal split uses original currency and conserves the total', () => {
  const result = preview({});
  assert.equal(result.error, '');
  assert.equal(result.hasRemainder, false);
  assert.deepEqual(exactValues(result), [30000, 30000, 30000, 30000]);
});

test('preview: equal remainder is a range, not a promised recipient', () => {
  const result = preview({amountCents: 120100});
  assert.equal(result.hasRemainder, true);
  assert.ok(result.rows.every(row => row.minCents === 30000 && row.maxCents === 30100));
  for (let run = 0; run < 50; run++) {
    for (const actual of allocateEqual(120100, ids)) {
      const row = result.rows.find(item => item.userId === actual.userId);
      assert.ok(actual.shareCents >= row.minCents && actual.shareCents <= row.maxCents);
    }
  }
});

test('preview: selecting only self remains a valid full-share expense', () => {
  assert.deepEqual(exactValues(preview({participantIds: ['u1']})), [120000]);
});

test('preview: normalizes and deduplicates IDs without mutating inputs', () => {
  const participants = [1, '1', 'u2'];
  const result = preview({participantIds: participants});
  assert.deepEqual(result.rows.map(row => row.userId), ['1', 'u2']);
  assert.deepEqual(participants, [1, '1', 'u2']);
});

test('preview: empty members and invalid totals never produce fabricated rows', () => {
  for (const amountCents of [null, undefined, NaN, Infinity, 0, -100, 100.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = preview({amountCents});
    assert.ok(result.error); assert.deepEqual(result.rows, []);
  }
  assert.ok(preview({participantIds: []}).error);
});

test('preview: whole-unit currencies reject fractions and insufficient amounts', () => {
  for (const currency of ['TWD', 'JPY', 'KRW']) {
    assert.ok(preview({currency, amountCents: 12345}).error);
    assert.ok(preview({currency, amountCents: 300}).error);
    assert.equal(preview({currency, amountCents: 400}).error, '');
  }
});

test('preview: two-decimal currencies keep one-cent precision', () => {
  const result = preview({currency: 'USD', amountCents: 1201});
  assert.ok(result.rows.every(row => row.minCents === 300 && row.maxCents === 301));
  assert.deepEqual(exactValues(preview({currency: 'USD', amountCents: 1200})), [300, 300, 300, 300]);
});

test('preview: exact amounts must be positive and sum to total', () => {
  const values = {u1: '100', u2: '200', u3: '300', u4: '600'};
  assert.deepEqual(exactValues(preview({mode: 'exact', values})), [10000, 20000, 30000, 60000]);
  for (const value of ['', '0', '-1', '0.1', 'NaN', '700']) {
    assert.ok(preview({mode: 'exact', values: {...values, u4: value}}).error);
  }
});

test('preview: hybrid preserves fixed amounts and server-compatible flexible ranges', () => {
  const result = preview({amountCents: 120100, mode: 'hybrid', values: {u1: '200', u2: '', u3: '0'}});
  assert.equal(result.rows[0].minCents, 20000);
  assert.equal(result.rows[0].maxCents, 20000);
  assert.deepEqual(result.rows.map(row => row.userId), ids);
  for (const actual of allocateHybrid(120100, ids, [{userId: 'u1', shareCents: 20000}])) {
    const row = result.rows.find(item => item.userId === actual.userId);
    assert.ok(actual.shareCents >= row.minCents && actual.shareCents <= row.maxCents);
  }
});

test('preview: hybrid requires remaining amount and at least one flexible member', () => {
  assert.ok(preview({mode: 'hybrid', values: {u1: '1200'}}).error);
  assert.ok(preview({mode: 'hybrid', values: {u1: '100', u2: '100', u3: '100', u4: '100'}}).error);
});

test('preview: decimal weights use the same exact allocator as the server', () => {
  const values = {u1: '1.5', u2: '1', u3: '2', u4: '0.5'};
  const result = preview({mode: 'weights', values, amountCents: 120100});
  const actual = allocateByWeights(120100, ids.map(userId => ({userId, weight: values[userId]})));
  assert.equal(result.error, '');
  assert.deepEqual(exactValues(result), actual.map(row => row.shareCents));
  assert.ok(result.rows.every(row => row.minCents === row.maxCents));
});

test('preview: empty weight defaults to one; invalid weights fail safely', () => {
  assert.deepEqual(exactValues(preview({mode: 'weights', values: {u1: ''}})), [30000, 30000, 30000, 30000]);
  for (const weight of ['0', '-1', 'NaN', 'Infinity', '1e3']) {
    assert.ok(preview({mode: 'weights', values: {u1: weight}}).error);
  }
});

test('preview: BigInt summation catches unsafe or excessive fixed sums', () => {
  assert.ok(preview({mode: 'exact', values: Object.fromEntries(ids.map(id => [id, '90071992547409']))}).error);
  assert.ok(preview({mode: 'hybrid', values: {u1: '9007199254740991'}}).error);
});

test('preview: unknown mode is rejected without throwing', () => {
  assert.ok(preview({mode: 'unsupported'}).error);
});

test('preview: randomized currency totals stay within server allocation bounds', () => {
  for (const currency of ['TWD', 'JPY', 'USD']) {
    const quantum = currency === 'USD' ? 1 : 100;
    for (let count = 1; count <= 20; count++) {
      const participantIds = Array.from({length: count}, (_, index) => `user-${index}`);
      const amountCents = (1003 + count) * quantum;
      const result = preview({currency, amountCents, participantIds});
      for (const actual of allocateEqual(amountCents, participantIds, {currency})) {
        const row = result.rows.find(item => item.userId === actual.userId);
        assert.ok(actual.shareCents >= row.minCents && actual.shareCents <= row.maxCents);
      }
    }
  }
});
