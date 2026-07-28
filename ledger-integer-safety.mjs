const MAX_SAFE_LEDGER_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_LEDGER_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const POSTGRES_BIGINT_PATTERN = /^-?\d+$/;

export const LEDGER_INTEGER_ERROR_CODES = Object.freeze({
  INVALID_POSTGRES_BIGINT: 'LEDGER_INVALID_POSTGRES_BIGINT',
  UNSAFE_NUMBER: 'LEDGER_UNSAFE_INTEGER',
  GROUP_TOTAL_EXCEEDED: 'LEDGER_GROUP_TOTAL_EXCEEDED',
});

export class LedgerIntegerSafetyError extends RangeError {
  constructor(message, {
    code,
    status,
    details = {},
  }) {
    super(message);
    this.name = 'LedgerIntegerSafetyError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

function safetyError(message, code, status, details) {
  return new LedgerIntegerSafetyError(message, {
    code,
    status,
    details,
  });
}

/**
 * 嚴格解析 PostgreSQL bigint 回傳值。
 * 刻意不接受 Number，避免已經失真的數值再次進入帳務流程。
 */
export function parsePostgresBigInt(value, {
  label = '帳務金額',
} = {}) {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !POSTGRES_BIGINT_PATTERN.test(value)) {
    throw safetyError(
      `${label}不是有效的 PostgreSQL bigint 字串`,
      LEDGER_INTEGER_ERROR_CODES.INVALID_POSTGRES_BIGINT,
      500,
      {label},
    );
  }

  try {
    return BigInt(value);
  } catch {
    throw safetyError(
      `${label}無法解析為 PostgreSQL bigint`,
      LEDGER_INTEGER_ERROR_CODES.INVALID_POSTGRES_BIGINT,
      500,
      {label},
    );
  }
}

/**
 * 僅在值位於 JavaScript 安全整數範圍內時才轉成 Number。
 */
export function postgresBigIntToSafeNumber(value, {
  label = '帳務金額',
} = {}) {
  const parsed = parsePostgresBigInt(value, {label});
  if (
    parsed < MIN_SAFE_LEDGER_INTEGER
    || parsed > MAX_SAFE_LEDGER_INTEGER
  ) {
    throw safetyError(
      `${label}超過系統可安全處理的整數範圍`,
      LEDGER_INTEGER_ERROR_CODES.UNSAFE_NUMBER,
      422,
      {
        label,
        value: parsed.toString(),
        minimum: MIN_SAFE_LEDGER_INTEGER.toString(),
        maximum: MAX_SAFE_LEDGER_INTEGER.toString(),
      },
    );
  }
  return Number(parsed);
}

/**
 * 驗證群組內所有支出的絕對值總和，避免退款與支出互相抵銷後
 * 掩蓋實際已超出 Number.MAX_SAFE_INTEGER 的帳務規模。
 *
 * 支援直接傳入 bigint 字串陣列，或以 getAmount 讀取資料列欄位。
 * 驗證成功時回傳可安全使用的 Number 絕對值總額。
 */
export function assertGroupExpenseAbsoluteTotalSafe(expenses, {
  getAmount = expense => expense?.amountCents,
  label = '群組支出總額',
} = {}) {
  if (!Array.isArray(expenses) || typeof getAmount !== 'function') {
    throw safetyError(
      `${label}資料格式不正確`,
      LEDGER_INTEGER_ERROR_CODES.INVALID_POSTGRES_BIGINT,
      500,
      {label},
    );
  }

  let absoluteTotal = 0n;
  for (let index = 0; index < expenses.length; index += 1) {
    const row = expenses[index];
    const rawAmount = (
      typeof row === 'string'
      || typeof row === 'bigint'
    )
      ? row
      : getAmount(row, index);
    const amount = parsePostgresBigInt(rawAmount, {
      label: `${label}第 ${index + 1} 筆`,
    });
    absoluteTotal += amount < 0n ? -amount : amount;

    if (absoluteTotal > MAX_SAFE_LEDGER_INTEGER) {
      throw safetyError(
        `${label}超過系統可安全處理的整數範圍`,
        LEDGER_INTEGER_ERROR_CODES.GROUP_TOTAL_EXCEEDED,
        422,
        {
          label,
          index,
          absoluteTotal: absoluteTotal.toString(),
          maximum: MAX_SAFE_LEDGER_INTEGER.toString(),
        },
      );
    }
  }

  return Number(absoluteTotal);
}
