import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCY_REGISTRY,
  SUPPORTED_CURRENCIES,
  allocateLargestRemainder,
  amountCentsToInputValue,
  convertAmountCents,
  convertAmountCentsDetailed,
  decimalToFraction,
  formatCurrencyAmount,
  getCurrencyName,
  isValidAmountCents,
  parseCurrencyAmount,
} from '../currency.mjs';
import { allocateByWeights, allocateEqual, allocateHybrid, isWholeTwd } from '../finance.mjs';

test('集中註冊六種支援幣別與精度', () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['TWD', 'JPY', 'KRW', 'USD', 'CNY', 'THB']);
  assert.equal(CURRENCY_REGISTRY.TWD.quantum, 100);
  assert.equal(CURRENCY_REGISTRY.JPY.decimals, 0);
  assert.equal(CURRENCY_REGISTRY.KRW.step, '1');
  assert.equal(CURRENCY_REGISTRY.USD.quantum, 1);
  assert.equal(CURRENCY_REGISTRY.CNY.decimals, 2);
  assert.equal(CURRENCY_REGISTRY.THB.symbol, '฿');
});

test('幣別名稱可依繁中與英文顯示', () => {
  assert.equal(getCurrencyName('TWD', 'zh-TW'), '新台幣');
  assert.equal(getCurrencyName('TWD', 'en'), 'New Taiwan Dollar');
  assert.equal(getCurrencyName('JPY', 'en-US'), 'Japanese Yen');
});

test('安全解析整數與兩位小數幣別', () => {
  assert.equal(parseCurrencyAmount('12600', 'TWD'), 1_260_000);
  assert.equal(parseCurrencyAmount('-500', 'JPY'), -50_000);
  assert.equal(parseCurrencyAmount('12.60', 'USD'), 1_260);
  assert.equal(parseCurrencyAmount('0.01', 'CNY'), 1);
  assert.equal(parseCurrencyAmount('12.6', 'THB'), 1_260);
  assert.throws(() => parseCurrencyAmount('1.2', 'KRW'), /最多可輸入|不支援小數/);
  assert.throws(() => parseCurrencyAmount('1.234', 'USD'), /最多可輸入/);
  assert.throws(() => parseCurrencyAmount('1e3', 'USD'), /有效金額/);
  assert.throws(() => parseCurrencyAmount('1,000', 'TWD'), /有效金額/);
});

test('金額驗證依幣別最小單位處理', () => {
  assert.equal(isValidAmountCents(100, 'TWD'), true);
  assert.equal(isValidAmountCents(1, 'TWD'), false);
  assert.equal(isValidAmountCents(1, 'USD'), true);
  assert.equal(isWholeTwd(100), true);
  assert.equal(isWholeTwd(1), false);
});

test('格式化不混淆的符號與固定小數位', () => {
  assert.equal(formatCurrencyAmount(1_260_000, 'TWD'), 'NT$ 12,600');
  assert.equal(formatCurrencyAmount(1_260_000, 'JPY'), '¥ 12,600');
  assert.equal(formatCurrencyAmount(1_260, 'USD'), 'US$ 12.60');
  assert.equal(formatCurrencyAmount(-1, 'CNY', { includeCode: true }), '-CN¥ 0.01 CNY');
  assert.equal(formatCurrencyAmount(123_456, 'THB'), '฿ 1,234.56');
  assert.equal(amountCentsToInputValue(120, 'USD'), '1.20');
});

test('十進位匯率與 ratio object 都能精確表示', () => {
  assert.deepEqual(decimalToFraction('5.05025377'), {
    numerator: 505025377n,
    denominator: 100000000n,
  });
  assert.deepEqual(decimalToFraction('3.1e-2'), {
    numerator: 31n,
    denominator: 1000n,
  });
  assert.deepEqual(decimalToFraction({
    ratioNumerator: '31',
    ratioDenominator: '1000',
  }), {
    numerator: 31n,
    denominator: 1000n,
  });
});

test('匯率換算依目標幣別精度四捨五入且保留正負號', () => {
  assert.equal(convertAmountCents(10_000, '5.05025377', 'JPY', { sourceCurrency: 'TWD' }), 50_500);
  assert.equal(convertAmountCents(10_000, '0.030868902', 'USD', { sourceCurrency: 'TWD' }), 309);
  assert.equal(convertAmountCents(-10_000, '0.030868902', 'USD', { sourceCurrency: 'TWD' }), -309);
  assert.equal(convertAmountCents(10_000, {
    ratioNumerator: '30868902',
    ratioDenominator: '1000000000',
  }, 'USD', { sourceCurrency: 'TWD' }), 309);
  const detail = convertAmountCentsDetailed(100, '0.005', 'USD', { sourceCurrency: 'TWD' });
  assert.equal(detail.amountCents, 1);
  assert.notEqual(detail.roundingDeltaNumerator, '0');
});

test('largest-remainder 分配不遺失尾差並以穩定鍵解決同分', () => {
  const rows = allocateLargestRemainder(100, [
    { userId: 'c', weight: '1' },
    { userId: 'a', weight: '1' },
    { userId: 'b', weight: '1' },
  ], { quantum: 1 });
  assert.deepEqual(rows.map(({ userId, amountCents }) => ({ userId, amountCents })), [
    { userId: 'c', amountCents: 33 },
    { userId: 'a', amountCents: 34 },
    { userId: 'b', amountCents: 33 },
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 100);
});

test('既有分攤函式可依群組幣別使用不同最小單位', () => {
  const equal = allocateEqual(100, ['a', 'b', 'c'], { currency: 'USD', randomize: false });
  assert.deepEqual(equal.map(row => row.shareCents), [34, 33, 33]);

  const weighted = allocateByWeights(101, [
    { userId: 'a', weight: '1.5' },
    { userId: 'b', weight: '1' },
  ], { currency: 'USD' });
  assert.equal(weighted.reduce((sum, row) => sum + row.shareCents, 0), 101);

  const hybrid = allocateHybrid(1_000, ['a', 'b', 'c'], [
    { userId: 'a', shareCents: 250 },
  ], { currency: 'USD' });
  assert.equal(hybrid.reduce((sum, row) => sum + row.shareCents, 0), 1_000);
  assert.equal(hybrid.find(row => row.userId === 'a').shareCents, 250);
});
