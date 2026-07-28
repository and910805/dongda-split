import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_INTEGER_ERROR_CODES,
  LedgerIntegerSafetyError,
  assertGroupExpenseAbsoluteTotalSafe,
  parsePostgresBigInt,
  postgresBigIntToSafeNumber,
} from '../ledger-integer-safety.mjs';

const MAX_SAFE = String(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = String(Number.MIN_SAFE_INTEGER);

function assertSafetyError(error, {
  code,
  status,
}) {
  assert.ok(error instanceof LedgerIntegerSafetyError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.equal(error.statusCode, status);
  return true;
}

test('以 BigInt 精確解析 PostgreSQL bigint 字串', () => {
  assert.equal(parsePostgresBigInt('0'), 0n);
  assert.equal(parsePostgresBigInt('-0'), 0n);
  assert.equal(parsePostgresBigInt('00100'), 100n);
  assert.equal(parsePostgresBigInt('-500'), -500n);
  assert.equal(
    parsePostgresBigInt('9223372036854775807'),
    9223372036854775807n,
  );
  assert.equal(parsePostgresBigInt(123n), 123n);
});

test('拒絕已轉成 Number 或不是 PostgreSQL bigint 的資料', () => {
  for (const value of [
    100,
    Number.MAX_SAFE_INTEGER,
    '',
    ' 1',
    '1 ',
    '+1',
    '1.00',
    '1e3',
    null,
    undefined,
  ]) {
    assert.throws(
      () => parsePostgresBigInt(value),
      error => assertSafetyError(error, {
        code: LEDGER_INTEGER_ERROR_CODES.INVALID_POSTGRES_BIGINT,
        status: 500,
      }),
    );
  }
});

test('只有安全範圍內的 bigint 才能轉為 Number', () => {
  assert.equal(postgresBigIntToSafeNumber(MAX_SAFE), Number.MAX_SAFE_INTEGER);
  assert.equal(postgresBigIntToSafeNumber(MIN_SAFE), Number.MIN_SAFE_INTEGER);
  assert.equal(postgresBigIntToSafeNumber('0'), 0);
  assert.equal(postgresBigIntToSafeNumber('-500'), -500);

  for (const value of [
    '9007199254740992',
    '-9007199254740992',
    '9223372036854775807',
    '-9223372036854775808',
  ]) {
    assert.throws(
      () => postgresBigIntToSafeNumber(value, {label: '結算餘額'}),
      error => {
        assertSafetyError(error, {
          code: LEDGER_INTEGER_ERROR_CODES.UNSAFE_NUMBER,
          status: 422,
        });
        assert.equal(error.details.label, '結算餘額');
        assert.equal(error.details.value, value);
        return true;
      },
    );
  }
});

test('群組總額以絕對值累加，退款不能抵銷支出', () => {
  assert.equal(
    assertGroupExpenseAbsoluteTotalSafe([
      {amountCents: '1000'},
      {amountCents: '-500'},
      {amountCents: '0'},
    ]),
    1500,
  );

  assert.throws(
    () => assertGroupExpenseAbsoluteTotalSafe([
      {amountCents: MAX_SAFE},
      {amountCents: '-1'},
    ]),
    error => {
      assertSafetyError(error, {
        code: LEDGER_INTEGER_ERROR_CODES.GROUP_TOTAL_EXCEEDED,
        status: 422,
      });
      assert.equal(error.details.index, 1);
      assert.equal(error.details.absoluteTotal, '9007199254740992');
      assert.equal(error.details.maximum, MAX_SAFE);
      return true;
    },
  );
});

test('群組總額允許零、空帳本與安全範圍邊界', () => {
  assert.equal(assertGroupExpenseAbsoluteTotalSafe([]), 0);
  assert.equal(assertGroupExpenseAbsoluteTotalSafe(['0', '-0']), 0);
  assert.equal(
    assertGroupExpenseAbsoluteTotalSafe([
      '9007199254740990',
      '-1',
    ]),
    Number.MAX_SAFE_INTEGER,
  );
});

test('群組總額支援自訂欄位讀取方式', () => {
  assert.equal(
    assertGroupExpenseAbsoluteTotalSafe(
      [
        {amount_cents: '200'},
        {amount_cents: '-300'},
      ],
      {getAmount: row => row.amount_cents},
    ),
    500,
  );
});

test('群組總額遇到遺漏或錯誤欄位時回傳穩定錯誤', () => {
  assert.throws(
    () => assertGroupExpenseAbsoluteTotalSafe([
      {amountCents: '100'},
      {},
    ]),
    error => {
      assertSafetyError(error, {
        code: LEDGER_INTEGER_ERROR_CODES.INVALID_POSTGRES_BIGINT,
        status: 500,
      });
      assert.equal(error.details.label, '群組支出總額第 2 筆');
      return true;
    },
  );
});
