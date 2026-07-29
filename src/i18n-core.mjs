export const LANGUAGE_STORAGE_KEY = 'triptab-language';
export const SUPPORTED_LANGUAGES = Object.freeze(['zh-TW', 'en']);

export function normalizeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'en' || normalized.startsWith('en-') ? 'en' : 'zh-TW';
}

export function interpolateMessage(template, values = {}) {
  return String(template ?? '').replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

export function createTranslator(language, messages) {
  const normalizedLanguage = normalizeLanguage(language);
  return (key, values = {}) => {
    const entry = messages[key];
    if (!entry) return interpolateMessage(key, values);
    const template = entry[normalizedLanguage] ?? entry['zh-TW'] ?? key;
    return interpolateMessage(template, values);
  };
}

export function translateKnownMessage(message, language, translations) {
  if (normalizeLanguage(language) !== 'en') return String(message || '');
  const source = String(message || '');
  return Object.hasOwn(translations, source) && typeof translations[source] === 'string'
    ? translations[source]
    : source;
}

const API_ERROR_VALUE_TRANSLATIONS = Object.freeze({
  '(空白)': '(blank)',
  '金額': 'Amount',
  '換算後金額': 'Converted amount',
  '分配金額': 'Allocated amount',
  '群組支出合計': 'Group expense total',
  '成員結餘': 'Member balance',
  '付款金額': 'Payment amount',
  '分攤金額': 'Split amount',
  '支出金額': 'Expense amount',
  '還款金額': 'Repayment amount',
  '原回報金額': 'Original reported amount',
  '換算尾差': 'Conversion rounding difference',
  '待轉帳金額': 'Pending transfer amount',
  '原支出金額': 'Original expense amount',
  '共同付款金額': 'Co-payer amount',
  '自訂分攤金額': 'Custom split amount',
  '指定分攤金額': 'Fixed split amount',
  '轉帳金額': 'Transfer amount',
  '自訂匯率': 'Custom rate',
  '付款明細': 'Payment details',
  '分攤明細': 'Split details',
  '換算後群組支出總額': 'Converted group expense total',
});

function translateApiErrorValue(value) {
  return API_ERROR_VALUE_TRANSLATIONS[value] || value;
}

const API_ERROR_PATTERNS = Object.freeze([
  Object.freeze({
    pattern: /^([A-Z]{3}) 最多可輸入小數點後 (\d+) 位$/,
    format: ([, currency, decimals]) => `${currency} supports up to ${decimals} decimal places`,
  }),
  Object.freeze({
    pattern: /^([A-Z]{3}) 不支援小數金額$/,
    format: ([, currency]) => `${currency} does not support decimal amounts`,
  }),
  Object.freeze({
    pattern: /^([A-Z]{3}) 金額不符合小數位規則$/,
    format: ([, currency]) => `${currency} amount does not match the required decimal precision`,
  }),
  Object.freeze({
    pattern: /^不支援的幣別：(.+)$/,
    format: ([, currency]) => `Unsupported currency: ${translateApiErrorValue(currency)}`,
  }),
  Object.freeze({
    pattern: /^(.+)超過系統可安全處理的範圍$/,
    format: ([, field]) => `${translateApiErrorValue(field)} exceeds the system's safe range`,
  }),
  Object.freeze({
    pattern: /^(.+)超過系統可安全處理的整數範圍$/,
    format: ([, field]) => `${translateApiErrorValue(field)} exceeds the system's safe integer range`,
  }),
  Object.freeze({
    pattern: /^匯率資料缺少有效的 ([A-Z]{3}) 報價$/,
    format: ([, currency]) => `Exchange-rate data is missing a valid ${currency} quote`,
  }),
  Object.freeze({
    pattern: /^這個群組目前已使用 ([A-Z]{3})$/,
    format: ([, currency]) => `This group already uses ${currency}`,
  }),
  Object.freeze({
    pattern: /^Idempotency-Key 請求內容最多允許 (\d+) 層$/,
    format: ([, depth]) => `Idempotency-Key payload may be at most ${depth} levels deep`,
  }),
  Object.freeze({
    pattern: /^(共同付款金額|自訂分攤金額|指定分攤金額|轉帳金額|自訂匯率)：(.+)$/,
    format: ([, label, inner], translateNested) => (
      `${translateApiErrorValue(label)}: ${translateNested(inner)}`
    ),
  }),
  Object.freeze({
    pattern: /^(.+)超過可安全處理的範圍$/,
    format: ([, label]) => `${translateApiErrorValue(label)} exceeds the safe processing range`,
  }),
  Object.freeze({
    pattern: /^(.+)沒有可換算的明細$/,
    format: ([, label]) => `${translateApiErrorValue(label)} has no rows to convert`,
  }),
  Object.freeze({
    pattern: /^(.+)換算後太小，無法為每位成員保留至少一個最小單位：(.+)$/,
    format: ([, label, inner], translateNested) => (
      `${translateApiErrorValue(label)} cannot preserve one minimum unit per member after conversion: ${translateNested(inner)}`
    ),
  }),
]);

export function translateApiErrorMessage(message, language, translations = {}) {
  const source = String(message || '');
  const exact = translateKnownMessage(source, language, translations);
  if (exact !== source || normalizeLanguage(language) !== 'en') return exact;
  const translateNested = nested => translateApiErrorMessage(nested, language, translations);
  for (const {pattern, format} of API_ERROR_PATTERNS) {
    const match = source.match(pattern);
    if (match) return format(match, translateNested);
  }
  return source;
}

export function resolveBrowserLanguage(navigatorLike) {
  const declaredLanguages = Array.isArray(navigatorLike?.languages)
    ? navigatorLike.languages
    : [];
  const candidates = [...declaredLanguages, navigatorLike?.language]
    .filter(value => typeof value === 'string' && value.trim());
  const preferred = candidates.find(value => {
    const normalized = value.trim().toLowerCase();
    return normalized === 'en'
      || normalized.startsWith('en-')
      || normalized === 'zh'
      || normalized.startsWith('zh-');
  });
  return normalizeLanguage(preferred);
}

export function resolveStoredLanguage({windowLike, navigatorLike} = {}) {
  if (!windowLike) return 'zh-TW';
  try {
    const stored = windowLike.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return stored ? normalizeLanguage(stored) : resolveBrowserLanguage(navigatorLike);
  } catch {
    return resolveBrowserLanguage(navigatorLike);
  }
}

export function persistStoredLanguage(windowLike, language) {
  const normalized = normalizeLanguage(language);
  try {
    windowLike?.localStorage?.setItem(LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // 私密瀏覽、SSR 或測試環境可能無法使用儲存空間。
  }
  return normalized;
}

export function languageLocale(language) {
  return normalizeLanguage(language) === 'en' ? 'en-US' : 'zh-TW';
}
