import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTranslator,
  interpolateMessage,
  languageLocale,
  normalizeLanguage,
  persistStoredLanguage,
  resolveBrowserLanguage,
  resolveStoredLanguage,
  translateApiErrorMessage,
  translateKnownMessage,
} from '../src/i18n-core.mjs';
import {apiErrorTranslations,commonMessages} from '../src/locales/common.mjs';
import {landingMessages} from '../src/locales/landing.mjs';
import {productMessages} from '../src/locales/product.mjs';
import {adminMessages} from '../src/locales/admin.mjs';
import {expenseMessages} from '../src/locales/expense.mjs';

test('語系代碼正規化為繁中或英文', () => {
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('EN'), 'en');
  assert.equal(normalizeLanguage('zh-Hant-TW'), 'zh-TW');
  assert.equal(normalizeLanguage(''), 'zh-TW');
});

test('翻譯函式支援雙語與具名參數', () => {
  const messages = {
    welcome: {
      'zh-TW': '歡迎，{name}',
      en: 'Welcome, {name}',
    },
  };
  assert.equal(createTranslator('zh-TW', messages)('welcome', {name: 'Andy'}), '歡迎，Andy');
  assert.equal(createTranslator('en', messages)('welcome', {name: 'Andy'}), 'Welcome, Andy');
  assert.equal(interpolateMessage('{count} items', {count: 3}), '3 items');
});

test('未知翻譯鍵安全回退為鍵名', () => {
  const t = createTranslator('en', commonMessages);
  assert.equal(t('missing.translation.key'), 'missing.translation.key');
});

test('英文模式會翻譯已知 API 錯誤並保留未知訊息', () => {
  assert.equal(
    translateKnownMessage('找不到群組', 'en', apiErrorTranslations),
    'Group not found',
  );
  assert.equal(
    translateKnownMessage('自訂伺服器訊息', 'en', apiErrorTranslations),
    '自訂伺服器訊息',
  );
  assert.equal(
    translateKnownMessage('找不到群組', 'zh-TW', apiErrorTranslations),
    '找不到群組',
  );
  for (const specialKey of ['toString', 'constructor', '__proto__']) {
    assert.equal(
      translateKnownMessage(specialKey, 'en', apiErrorTranslations),
      specialKey,
    );
  }
});

test('API 動態錯誤翻譯是純函式並涵蓋六種幣別精度', () => {
  const currencyDecimals = {
    TWD: 0,
    JPY: 0,
    KRW: 0,
    USD: 2,
    CNY: 2,
    THB: 2,
  };
  for (const [currency, decimals] of Object.entries(currencyDecimals)) {
    assert.equal(
      translateApiErrorMessage(
        `${currency} 最多可輸入小數點後 ${decimals} 位`,
        'en',
        apiErrorTranslations,
      ),
      `${currency} supports up to ${decimals} decimal places`,
    );
    assert.equal(
      translateApiErrorMessage(
        `${currency} 金額不符合小數位規則`,
        'en',
        apiErrorTranslations,
      ),
      `${currency} amount does not match the required decimal precision`,
    );
  }
  assert.equal(
    translateApiErrorMessage(
      '匯率資料已更新，請重新預覽後再確認',
      'en',
      apiErrorTranslations,
    ),
    'Exchange rates were updated. Preview the conversion again before confirming.',
  );
  assert.equal(
    translateApiErrorMessage(
      '匯率資料缺少有效的 JPY 報價',
      'en',
      apiErrorTranslations,
    ),
    'Exchange-rate data is missing a valid JPY quote',
  );
  assert.equal(
    translateApiErrorMessage('換算後金額超過系統可安全處理的範圍', 'en', apiErrorTranslations),
    "Converted amount exceeds the system's safe range",
  );
  assert.equal(
    translateApiErrorMessage('不支援的幣別：(空白)', 'en', apiErrorTranslations),
    'Unsupported currency: (blank)',
  );
  assert.equal(
    translateApiErrorMessage(
      '共同付款金額：USD 最多可輸入小數點後 2 位',
      'en',
      apiErrorTranslations,
    ),
    'Co-payer amount: USD supports up to 2 decimal places',
  );
  assert.equal(
    translateApiErrorMessage(
      '付款明細換算後太小，無法為每位成員保留至少一個最小單位：金額太小，無法讓每位成員至少分攤一個最小單位',
      'en',
      apiErrorTranslations,
    ),
    'Payment details cannot preserve one minimum unit per member after conversion: The amount is too small to allocate one minimum unit to each member',
  );
  assert.equal(
    translateApiErrorMessage('換算後群組支出總額超過可安全處理的範圍', 'en', apiErrorTranslations),
    'Converted group expense total exceeds the safe processing range',
  );
  assert.equal(
    translateApiErrorMessage('這個群組目前已使用 JPY', 'en', apiErrorTranslations),
    'This group already uses JPY',
  );
  assert.equal(
    translateApiErrorMessage('自訂匯率：十進位指數超過可處理範圍', 'en', apiErrorTranslations),
    'Custom rate: The decimal exponent exceeds the supported range.',
  );
});

test('API 動態錯誤在繁中與未知訊息時安全回退', () => {
  assert.equal(
    translateApiErrorMessage('USD 最多可輸入小數點後 2 位', 'zh-TW', apiErrorTranslations),
    'USD 最多可輸入小數點後 2 位',
  );
  assert.equal(
    translateApiErrorMessage('使用者提供的未知訊息', 'en', apiErrorTranslations),
    '使用者提供的未知訊息',
  );
  assert.equal(translateApiErrorMessage(null, 'en', apiErrorTranslations), '');
});

test('瀏覽器語言與 localStorage 在 SSR、拒絕存取及測試替身下皆安全', () => {
  assert.equal(resolveBrowserLanguage(undefined), 'zh-TW');
  assert.equal(resolveBrowserLanguage({languages: ['en-US'], language: 'zh-TW'}), 'en');
  assert.equal(resolveBrowserLanguage({languages: ['ja-JP', 'en-US'], language: 'ja-JP'}), 'en');
  assert.equal(resolveBrowserLanguage({languages: ['ja-JP', 'zh-Hant-TW'], language: 'en-US'}), 'zh-TW');
  assert.equal(resolveBrowserLanguage({languages: null, language: 'EN-gb'}), 'en');
  assert.equal(resolveStoredLanguage(), 'zh-TW');

  const englishNavigator = {languages: ['en-US'], language: 'en-US'};
  assert.equal(
    resolveStoredLanguage({
      windowLike: {localStorage: {getItem: () => 'zh-Hant-TW'}},
      navigatorLike: englishNavigator,
    }),
    'zh-TW',
  );
  assert.equal(
    resolveStoredLanguage({
      windowLike: {localStorage: {getItem: () => null}},
      navigatorLike: englishNavigator,
    }),
    'en',
  );

  const deniedWindow = {};
  Object.defineProperty(deniedWindow, 'localStorage', {
    get() {
      throw new Error('storage denied');
    },
  });
  assert.equal(
    resolveStoredLanguage({windowLike: deniedWindow, navigatorLike: englishNavigator}),
    'en',
  );

  const stored = [];
  assert.equal(
    persistStoredLanguage(
      {localStorage: {setItem: (key, value) => stored.push([key, value])}},
      'EN-us',
    ),
    'en',
  );
  assert.deepEqual(stored, [['triptab-language', 'en']]);
  assert.equal(persistStoredLanguage(undefined, 'en'), 'en');
  assert.doesNotThrow(() => persistStoredLanguage({
    localStorage: {setItem: () => { throw new Error('quota exceeded'); }},
  }, 'zh-TW'));
});

test('所有語系 registry 都有完整雙語且英文系統文案不含中文字', () => {
  const registries = {
    commonMessages,
    landingMessages,
    productMessages,
    adminMessages,
    expenseMessages,
  };
  for (const [registryName, registry] of Object.entries(registries)) {
    assert.ok(
      Object.keys(registry).length > 0,
      `${registryName} 不可為空，否則雙語完整性檢查會失效`,
    );
    for (const [key, entry] of Object.entries(registry)) {
      assert.equal(
        typeof entry?.['zh-TW'],
        'string',
        `${registryName}.${key} 缺少 zh-TW`,
      );
      assert.ok(entry['zh-TW'].trim(), `${registryName}.${key} 的 zh-TW 不可為空`);
      assert.equal(typeof entry.en, 'string', `${registryName}.${key} 缺少 en`);
      assert.ok(entry.en.trim(), `${registryName}.${key} 的 en 不可為空`);
      assert.doesNotMatch(
        entry.en,
        /\p{Script=Han}/u,
        `${registryName}.${key} 的英文系統文案仍含中文字`,
      );
    }
  }
  for (const [source, translation] of Object.entries(apiErrorTranslations)) {
    assert.equal(typeof translation, 'string', `API 錯誤「${source}」缺少英文翻譯`);
    assert.doesNotMatch(
      translation,
      /\p{Script=Han}/u,
      `API 錯誤「${source}」的英文翻譯仍含中文字`,
    );
  }
});

test('日期格式語系與目前語言一致', () => {
  assert.equal(languageLocale('en'), 'en-US');
  assert.equal(languageLocale('zh-TW'), 'zh-TW');
});
