const INTERNAL_SCALE = 100;

const definitions = [
  { code: 'TWD', name: '新台幣', englishName: 'New Taiwan Dollar', symbol: 'NT$', decimals: 0, step: '1', quantum: 100 },
  { code: 'JPY', name: '日圓', englishName: 'Japanese Yen', symbol: '¥', decimals: 0, step: '1', quantum: 100 },
  { code: 'KRW', name: '韓元', englishName: 'South Korean Won', symbol: '₩', decimals: 0, step: '1', quantum: 100 },
  { code: 'USD', name: '美元', englishName: 'US Dollar', symbol: 'US$', decimals: 2, step: '0.01', quantum: 1 },
  { code: 'CNY', name: '人民幣', englishName: 'Chinese Yuan', symbol: 'CN¥', decimals: 2, step: '0.01', quantum: 1 },
  { code: 'THB', name: '泰銖', englishName: 'Thai Baht', symbol: '฿', decimals: 2, step: '0.01', quantum: 1 },
];

export const CURRENCY_REGISTRY = Object.freeze(Object.fromEntries(
  definitions.map(definition => [definition.code, Object.freeze({ ...definition })]),
));

export const SUPPORTED_CURRENCIES = Object.freeze(definitions.map(({ code }) => code));

function normalizeCurrencyCode(currency) {
  if (typeof currency === 'object' && currency?.code) return String(currency.code).trim().toUpperCase();
  return String(currency || '').trim().toUpperCase();
}

export function isSupportedCurrency(currency) {
  return Object.hasOwn(CURRENCY_REGISTRY, normalizeCurrencyCode(currency));
}

export function getCurrency(currency = 'TWD') {
  const code = normalizeCurrencyCode(currency);
  const definition = CURRENCY_REGISTRY[code];
  if (!definition) throw new RangeError(`不支援的幣別：${code || '(空白)'}`);
  return definition;
}

export function getCurrencyName(currency = 'TWD', language = 'zh-TW') {
  const definition = getCurrency(currency);
  return String(language || '').toLowerCase().startsWith('en')
    ? definition.englishName
    : definition.name;
}

export function getCurrencyQuantum(currency = 'TWD') {
  return getCurrency(currency).quantum;
}

export function isValidAmountCents(amountCents, currency = 'TWD', {
  allowZero = true,
  allowNegative = true,
} = {}) {
  if (!Number.isSafeInteger(amountCents)) return false;
  if (!allowZero && amountCents === 0) return false;
  if (!allowNegative && amountCents < 0) return false;
  return amountCents % getCurrency(currency).quantum === 0;
}

export function assertValidAmountCents(amountCents, currency = 'TWD', options = {}) {
  if (!isValidAmountCents(amountCents, currency, options)) {
    const definition = getCurrency(currency);
    throw new RangeError(`${definition.code} 金額不符合小數位規則`);
  }
  return amountCents;
}

function safeBigIntToNumber(value, label = '金額') {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label}超過系統可安全處理的範圍`);
  }
  return Number(value);
}

/**
 * 將使用者輸入的幣別金額精確轉成既有 amount_cents（幣別的百分之一單位）。
 * 不接受千分位或科學記號，避免瀏覽器與伺服器產生不同解析結果。
 */
export function parseCurrencyAmount(input, currency = 'TWD', {
  allowZero = false,
  allowNegative = true,
} = {}) {
  const definition = getCurrency(currency);
  const raw = typeof input === 'string' ? input.trim() : String(input ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new TypeError('請輸入有效金額');

  const [, signToken, wholeToken, fractionToken = ''] = match;
  if (fractionToken.length > definition.decimals) {
    throw new RangeError(`${definition.code} 最多可輸入小數點後 ${definition.decimals} 位`);
  }
  if (definition.decimals === 0 && fractionToken) {
    throw new RangeError(`${definition.code} 不支援小數金額`);
  }

  const whole = BigInt(wholeToken);
  const fraction = fractionToken ? BigInt(fractionToken.padEnd(2, '0')) : 0n;
  let amount = whole * BigInt(INTERNAL_SCALE) + fraction;
  if (signToken === '-') amount = -amount;
  const amountCents = safeBigIntToNumber(amount);

  return assertValidAmountCents(amountCents, definition, { allowZero, allowNegative });
}

export const parseAmountToCents = parseCurrencyAmount;

export function amountCentsToInputValue(amountCents, currency = 'TWD') {
  const definition = getCurrency(currency);
  assertValidAmountCents(amountCents, definition);
  const negative = amountCents < 0;
  const absolute = BigInt(Math.abs(amountCents));
  const whole = absolute / BigInt(INTERNAL_SCALE);
  const fraction = absolute % BigInt(INTERNAL_SCALE);
  const suffix = definition.decimals
    ? `.${fraction.toString().padStart(2, '0')}`
    : '';
  return `${negative ? '-' : ''}${whole}${suffix}`;
}

function addThousandsSeparators(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCurrencyAmount(amountCents, currency = 'TWD', {
  includeCode = false,
  includeSymbol = true,
} = {}) {
  const definition = getCurrency(currency);
  const raw = amountCentsToInputValue(amountCents, definition);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction] = unsigned.split('.');
  const numeric = `${addThousandsSeparators(whole)}${fraction === undefined ? '' : `.${fraction}`}`;
  const prefix = includeSymbol ? `${definition.symbol} ` : '';
  const suffix = includeCode ? ` ${definition.code}` : '';
  return `${negative ? '-' : ''}${prefix}${numeric}${suffix}`;
}

export const formatMoney = formatCurrencyAmount;

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function normalizeFraction(numerator, denominator) {
  if (denominator === 0n) throw new RangeError('分母不可為零');
  const direction = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor * direction,
    denominator: denominator / divisor * direction,
  };
}

/**
 * 將十進位字串（包含科學記號）轉成不可失真的 BigInt 分數。
 * Number 也會先轉為其標準十進位字串，不進行任何浮點乘除。
 */
export function decimalToFraction(value) {
  if (typeof value === 'bigint') return { numerator: value, denominator: 1n };
  if (value && typeof value === 'object') {
    const numeratorValue = value.numerator ?? value.ratioNumerator;
    const denominatorValue = value.denominator ?? value.ratioDenominator;
    if (numeratorValue !== undefined && denominatorValue !== undefined) {
      try {
        return normalizeFraction(BigInt(numeratorValue), BigInt(denominatorValue));
      } catch {
        throw new TypeError('無效的匯率分數');
      }
    }
  }
  const raw = String(value ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new TypeError(`無效的十進位數值：${raw || '(空白)'}`);

  const [, signToken, wholeToken, fractionToken = '', exponentToken = '0'] = match;
  const digits = `${wholeToken}${fractionToken}`.replace(/^0+(?=\d)/, '');
  const exponent = Number(exponentToken) - fractionToken.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new RangeError('十進位指數超過可處理範圍');
  }

  let numerator = BigInt(digits || '0');
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  if (signToken === '-') numerator = -numerator;
  return normalizeFraction(numerator, denominator);
}

function roundFractionToQuantum(numerator, denominator, quantum) {
  if (!Number.isSafeInteger(quantum) || quantum <= 0) throw new RangeError('最小單位必須是正整數');
  const sign = numerator < 0n ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const unitDenominator = denominator * BigInt(quantum);
  let units = absoluteNumerator / unitDenominator;
  const remainder = absoluteNumerator % unitDenominator;
  if (remainder * 2n >= unitDenominator) units += 1n;
  return units * BigInt(quantum) * sign;
}

export function convertAmountCentsDetailed(amountCents, rate, targetCurrency, {
  sourceCurrency,
} = {}) {
  if (!Number.isSafeInteger(amountCents)) throw new TypeError('amount_cents 必須是安全整數');
  if (sourceCurrency) assertValidAmountCents(amountCents, sourceCurrency);
  const target = getCurrency(targetCurrency);
  const fraction = decimalToFraction(rate);
  if (fraction.numerator <= 0n) throw new RangeError('匯率必須大於零');

  const exactNumerator = BigInt(amountCents) * fraction.numerator;
  const rounded = roundFractionToQuantum(exactNumerator, fraction.denominator, target.quantum);
  const convertedAmountCents = safeBigIntToNumber(rounded, '換算後金額');
  const roundingDeltaNumerator = rounded * fraction.denominator - exactNumerator;

  return {
    amountCents: convertedAmountCents,
    exactNumerator: exactNumerator.toString(),
    exactDenominator: fraction.denominator.toString(),
    roundingDeltaNumerator: roundingDeltaNumerator.toString(),
    roundingDeltaDenominator: fraction.denominator.toString(),
    targetCurrency: target.code,
    quantum: target.quantum,
  };
}

export function convertAmountCents(amountCents, rate, targetCurrency, options = {}) {
  return convertAmountCentsDetailed(amountCents, rate, targetCurrency, options).amountCents;
}

function compareRemainders(left, right) {
  const comparison = left.remainderNumerator * right.remainderDenominator
    - right.remainderNumerator * left.remainderDenominator;
  if (comparison !== 0n) return comparison > 0n ? -1 : 1;
  return left.tieKey.localeCompare(right.tieKey);
}

/**
 * 以 Hamilton / largest-remainder 法按權重分配，總和必定等於 totalCents。
 * 權重可傳十進位字串，整個計算過程不使用浮點數。
 */
export function allocateLargestRemainder(totalCents, items, {
  currency,
  quantum = currency ? getCurrencyQuantum(currency) : 1,
  amountKey = 'amountCents',
  requirePositive = false,
} = {}) {
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(quantum) || quantum <= 0 || totalCents % quantum !== 0) {
    throw new RangeError('分配總額不符合最小單位');
  }
  if (!Array.isArray(items) || !items.length) throw new TypeError('至少需要一個分配項目');

  const parsed = items.map((item, index) => {
    const weight = decimalToFraction(item.weight);
    if (weight.numerator <= 0n) throw new RangeError('分配權重必須大於零');
    return {
      item,
      index,
      weight,
      tieKey: String(item.userId ?? item.id ?? index),
    };
  });

  let totalWeight = { numerator: 0n, denominator: 1n };
  for (const { weight } of parsed) {
    totalWeight = normalizeFraction(
      totalWeight.numerator * weight.denominator + weight.numerator * totalWeight.denominator,
      totalWeight.denominator * weight.denominator,
    );
  }

  const sign = totalCents < 0 ? -1n : 1n;
  const totalUnits = BigInt(Math.abs(totalCents) / quantum);
  const allocations = parsed.map(entry => {
    const rawNumerator = totalUnits * entry.weight.numerator * totalWeight.denominator;
    const rawDenominator = entry.weight.denominator * totalWeight.numerator;
    const floorUnits = rawNumerator / rawDenominator;
    return {
      ...entry,
      units: floorUnits,
      remainderNumerator: rawNumerator % rawDenominator,
      remainderDenominator: rawDenominator,
    };
  });

  let remaining = totalUnits - allocations.reduce((sum, entry) => sum + entry.units, 0n);
  const priority = [...allocations].sort(compareRemainders);
  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) {
    priority[index % priority.length].units += 1n;
  }

  allocations.sort((left, right) => left.index - right.index);
  if (requirePositive && allocations.some(entry => entry.units === 0n)) {
    throw new RangeError('總額太小，無法讓每個項目至少分配一個最小單位');
  }

  return allocations.map(({ item, units }) => ({
    ...item,
    [amountKey]: safeBigIntToNumber(units * BigInt(quantum) * sign, '分配金額'),
  }));
}
