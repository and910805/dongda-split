import {formatCurrencyAmount, getCurrency} from '../currency.mjs';

// Use Traditional Chinese without full stops in system copy only.
// Persisted values and user-provided punctuation must remain unchanged.
export const ENTRY_CATEGORIES = Object.freeze([
  {value: '\u9910\u98f2', label: '餐飲'},
  {value: '\u4f4f\u5bbf', label: '住宿'},
  {value: '\u4ea4\u901a', label: '交通'},
  {value: '\u8cfc\u7269', label: '購物'},
  {value: '\u5176\u4ed6', label: '其他'},
]);
export const ENTRY_CURRENCY_NAMES = Object.freeze({
  TWD: '新台幣', JPY: '日圓', KRW: '韓元',
  USD: '美元', CNY: '人民幣', THB: '泰銖',
});
export const ENTRY_SPLITS = Object.freeze([
  {id: 'equal', label: '平均分攤', icon: 'equal', help: '選中的人平均分攤；點名字即可加入或移除'},
  {id: 'exact', label: '各分多少', icon: 'coins', help: '填入每個人的負擔金額，合計必須等於總金額'},
  {id: 'hybrid', label: '先指定，再均分', icon: 'split', help: '有人負擔固定金額，就選「固定金額」；其他人選「均分剩餘」'},
  {id: 'weights', label: '按份數', icon: 'ratio', help: '填入每人份數，例如大人 2 份、小孩 1 份，依比例分攤'},
]);

export function entryCategoryLabel(value) {
  return ENTRY_CATEGORIES.find(item => item.value === value)?.label || '其他';
}

// Validation totals can overflow even when each individual input is valid.
// This formatter never repairs or submits a value; the server remains authoritative.
export function formatEntryAmount(cents, currency) {
  if (!Number.isSafeInteger(cents)) return '超出範圍';
  try { return formatCurrencyAmount(cents, currency); }
  catch { return '無效金額'; }
}

export function entryShare(row, currency) {
  if (!row) return formatEntryAmount(0, currency);
  const lower = formatEntryAmount(row.minCents, currency);
  return row.minCents === row.maxCents ? lower : `${lower}–${formatCurrencyAmount(row.maxCents, currency, {includeSymbol: false})}`;
}

export function entryAmountError(currency) {
  const {decimals} = getCurrency(currency);
  return decimals ? `請輸入有效的 ${currency} 金額，最多 ${decimals} 位小數` : `請輸入有效的 ${currency} 整數金額`;
}

// Keep service codes and stored content unchanged. Do not expose raw database
// errors or raw service messages in this Traditional Chinese entry surface.
export function entryServiceError(error) {
  const code = error?.data?.code;
  const known = {
    ACCOUNT_CHANGED: '登入帳號已變更，請切回原帳號後再確認這次儲存結果',
    LEDGER_VERSION_CHANGED: '帳本已變更，請關閉記帳視窗、重新整理帳本，核對後再儲存',
    IDEMPOTENCY_KEY_REUSED: '這個提交識別碼已使用，請先確認原始儲存結果，再新增其他帳目',
    IDEMPOTENT_RESOURCE_DELETED: '這筆帳目曾經儲存，之後已被刪除；確認結果不會重新建立帳目',
  };
  if (Object.hasOwn(known, code)) return known[code];
  if (error?.status === 401) return '登入已逾期，請重新登入後再確認儲存結果';
  if (error?.status === 403) return '你已沒有修改此帳本的權限';
  if (error?.status === 404) return '此帳本或帳目已不存在，或目前無法存取';
  if (error?.status === 409) return '帳目已變更，請重新整理帳本並核對最新版本';
  if (error?.status === 429) return '操作過於頻繁，請稍候再試';
  return '無法完成這次請求，輸入內容已保留，請檢查帳目後再試';
}

export function entryPreviewError(preview, {totalCents, currency, selectedCount, mode}) {
  if (!preview.error) return '';
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return '填入金額後，即可查看每人的分攤';
  if (!selectedCount) return '請至少選擇一位成員';
  if (mode === 'exact') return '請為每位已選成員填寫大於 0 的金額，合計必須等於總金額';
  if (mode === 'hybrid') return '請保留至少一人均分剩餘金額，固定金額也需留下足夠的餘額';
  if (mode === 'weights') return '份數必須大於 0，且總額須足夠讓每人至少分配一個最小單位';
  return `總金額太小，無法讓每人至少分配一個 ${currency} 的最小單位`;
}
