import {allocateLargestRemainder, getCurrency, parseCurrencyAmount} from '../currency.mjs';

export const EXPENSE_SPLIT_LABELS = Object.freeze({
  equal: '平均分攤', exact: '指定金額', hybrid: '指定＋均分', weights: '比例／份數',
});

/**
 * Read-only, original-currency preview. Never supplies amounts to the API.
 * Equal/hybrid remainders are randomized by the server: show a range instead
 * of promising which person receives the rounding unit.
 */
export function createExpensePreview({amountCents, currency = 'TWD', mode = 'equal', participantIds = [], values = {}}) {
  const result = {rows: [], hasRemainder: false, error: ''};
  try {
    const {quantum} = getCurrency(currency);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents % quantum) {
      return {...result, error: '填入有效金額後，這裡會顯示每人的分攤'};
    }
    const ids = [...new Set(participantIds.map(String))];
    if (!ids.length) return {...result, error: '請選擇至少一位分攤成員'};
    const exactRow = (userId, cents) => ({userId, minCents: cents, maxCents: cents});
    const equalRows = (total, members) => {
      const units = total / quantum;
      const base = Math.floor(units / members.length) * quantum;
      if (base < quantum) throw new Error('金額太小，無法讓每位成員至少分攤一個最小單位');
      const remainder = units % members.length;
      if (remainder) result.hasRemainder = true;
      return members.map(userId => ({userId, minCents: base, maxCents: base + (remainder ? quantum : 0)}));
    };
    const readAmount = id => parseCurrencyAmount(String(values[id] ?? '').trim() || '0', currency, {allowZero: true, allowNegative: false});
    if (mode === 'equal') result.rows = equalRows(amountCents, ids);
    else if (mode === 'weights') {
      const weights = ids.map(userId => ({userId, weight: String(values[userId] || '1').trim()}));
      if (weights.some(({weight}) => !/^(\d+)(?:\.\d+)?$/.test(weight) || Number(weight) <= 0)) {
        throw new Error('每位成員的份數必須大於 0');
      }
      result.rows = allocateLargestRemainder(amountCents, weights, {currency, requirePositive: true})
        .map(({userId, amountCents: cents}) => exactRow(userId, cents));
    } else if (mode === 'exact' || mode === 'hybrid') {
      const amounts = ids.map(userId => ({userId, cents: readAmount(userId)}));
      const fixedTotal = amounts.reduce((sum, row) => sum + BigInt(row.cents), 0n);
      if (mode === 'exact') {
        if (amounts.some(row => row.cents <= 0) || fixedTotal !== BigInt(amountCents)) {
          throw new Error('請填好每人的金額，合計需等於總金額');
        }
        result.rows = amounts.map(({userId, cents}) => exactRow(userId, cents));
      } else {
        const flexible = amounts.filter(row => row.cents === 0).map(row => row.userId);
        if (!flexible.length || fixedTotal >= BigInt(amountCents)) {
          throw new Error('請保留至少一人分攤剩餘金額');
        }
        const rows = [
          ...amounts.filter(row => row.cents > 0).map(({userId, cents}) => exactRow(userId, cents)),
          ...equalRows(Number(BigInt(amountCents) - fixedTotal), flexible),
        ];
        const byId = new Map(rows.map(row => [row.userId, row]));
        result.rows = ids.map(id => byId.get(id));
      }
    } else throw new Error('不支援的分攤方式');
    return result;
  } catch (error) {
    return {...result, rows: [], hasRemainder: false, error: error.message};
  }
}
