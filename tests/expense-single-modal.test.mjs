import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENTRY_CATEGORIES, ENTRY_CURRENCY_NAMES, ENTRY_SPLITS, entryAmountError, entryCategoryLabel, entryPreviewError, entryServiceError, entryShare, formatEntryAmount} from '../src/expense-entry-ui.mjs';

const source = readFileSync(new URL('../src/AdvancedExpenseModal.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/expense-single-modal.css', import.meta.url), 'utf8');
const cjk = /[\u3400-\u9fff]/u;

 test('Traditional Chinese categories preserve the existing persisted values', () => {
  assert.deepEqual(ENTRY_CATEGORIES.map(item => item.value), ['\u9910\u98f2', '\u4f4f\u5bbf', '\u4ea4\u901a', '\u8cfc\u7269', '\u5176\u4ed6']);
  assert.deepEqual(ENTRY_CATEGORIES.map(item => item.label), ['餐飲', '住宿', '交通', '購物', '其他']);
  assert.equal(entryCategoryLabel('\u9910\u98f2'), '餐飲');
  assert.equal(entryCategoryLabel('legacy-category'), '其他');
});

 test('UI retains all existing split identifiers and currencies', () => {
  assert.deepEqual(ENTRY_SPLITS.map(item => item.id), ['equal', 'exact', 'hybrid', 'weights']);
  assert.deepEqual(Object.keys(ENTRY_CURRENCY_NAMES).sort(), ['CNY', 'JPY', 'KRW', 'THB', 'TWD', 'USD']);
  assert.ok(ENTRY_SPLITS.every(item => item.label && item.help));
});

 test('Money formatting preserves currency precision and refund sign', () => {
  assert.equal(formatEntryAmount(120000, 'TWD'), 'NT$ 1,200');
  assert.equal(formatEntryAmount(1234, 'USD'), 'US$ 12.34');
  assert.equal(formatEntryAmount(-120000, 'TWD'), '-NT$ 1,200');
});

 test('Unsafe validation sums cannot crash the interface', () => {
  assert.equal(formatEntryAmount(Number.MAX_SAFE_INTEGER + 1, 'TWD'), '超出範圍');
  assert.equal(formatEntryAmount(Infinity, 'USD'), '超出範圍');
  assert.equal(formatEntryAmount(NaN, 'TWD'), '超出範圍');
  assert.equal(formatEntryAmount(1, 'TWD'), '無效金額');
});

 test('Remainder preview shows a range, not a guaranteed allocation', () => {
  assert.equal(entryShare({minCents: 25000, maxCents: 25100}, 'TWD'), 'NT$ 250–251');
  assert.equal(entryShare({minCents: 30000, maxCents: 30000}, 'TWD'), 'NT$ 300');
  assert.equal(entryShare(undefined, 'TWD'), 'NT$ 0');
});

 test('Amount instructions follow existing currency decimal rules', () => {
  assert.match(entryAmountError('TWD'), /整數金額/);
  assert.match(entryAmountError('JPY'), /整數金額/);
  assert.match(entryAmountError('USD'), /2 位小數/);
});

for (const [status, message] of [[401, /逾期/], [403, /權限/], [404, /無法存取/], [409, /已變更/], [429, /過於頻繁/]]) {
  test(`Service status ${status} produces Traditional Chinese guidance`, () => {
    const result = entryServiceError({status, message: '\u932f\u8aa4'});
    assert.match(result, message);
    assert.ok(cjk.test(result));
  });
}

 test('Service codes preserve actionable concurrency and idempotency meaning', () => {
  assert.match(entryServiceError({data: {code: 'LEDGER_VERSION_CHANGED'}}), /帳本已變更/);
  assert.match(entryServiceError({data: {code: 'ACCOUNT_CHANGED'}}), /原帳號/);
  assert.match(entryServiceError({data: {code: 'IDEMPOTENCY_KEY_REUSED'}}), /原始儲存結果/);
  assert.match(entryServiceError({data: {code: 'IDEMPOTENT_RESOURCE_DELETED'}}), /不會重新建立/);
});

 test('Unknown backend errors are not leaked into the UI', () => {
  const result = entryServiceError({status: 400, message: 'secret database details', data: {error: '\u8cc7\u6599\u5eab'}});
  assert.ok(!result.includes('secret'));
  assert.ok(cjk.test(result));
  assert.match(result, /輸入內容已保留/);
});

 test('Preview validation is translated without changing allocations', () => {
  const preview = {error: '\u91d1\u984d\u932f\u8aa4', rows: []};
  assert.match(entryPreviewError(preview, {totalCents: null, currency: 'TWD', selectedCount: 1, mode: 'equal'}), /填入金額/);
  assert.match(entryPreviewError(preview, {totalCents: 10000, currency: 'TWD', selectedCount: 0, mode: 'equal'}), /至少選擇/);
  for (const mode of ['equal', 'exact', 'hybrid', 'weights']) {
    const result = entryPreviewError(preview, {totalCents: 10000, currency: 'TWD', selectedCount: 4, mode});
    assert.ok(result && cjk.test(result));
  }
  assert.deepEqual(preview.rows, []);
  assert.equal(entryPreviewError({error: ''}, {}), '');
});

 test('Expense entry has one modal and an inline details region', () => {
  assert.equal((source.match(/\srole="dialog"\s/g) || []).length, 1);
  assert.ok(!source.includes('role="alertdialog"'));
  assert.ok(!source.includes('<dialog'));
  assert.match(source, /<section hidden=\{!detailsOpen\} id="es-details"/);
  assert.match(source, /aria-expanded=\{detailsOpen\}/);
  assert.ok(!source.includes('setStep('));
});

 test('Single-page entry preserves pending submission and wire contracts', () => {
  for (const token of ['ledgerVersion:group.ledgerVersion', 'expectedUserId:currentUserId', 'participantIds:selected', 'payload.fixedShares=', 'payload.weights=', 'pendingExpenseRequestOptions(record)', 'if(savingRef.current)return;', 'canRetryPendingExpense(record)', 'reconcileExpenseSubmission(record,latest)']) {
    assert.ok(source.includes(token), `Missing preserved contract: ${token}`);
  }
  assert.ok(!source.includes('localStorage'));
});

 test('Automatic rate loading does not create a false dirty draft', () => {
  assert.match(source, /exchangeRate: exchangeRateMode === 'manual' \? exchangeRate : ''/);
});

 test('System copy stays in Traditional Chinese without full stops', () => {
  for (const file of ['AdvancedExpenseModal.jsx', 'ExpenseEntryParts.jsx', 'expense-entry-ui.mjs']) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(cjk.test(text), file);
    assert.ok(!text.includes('\u3002'), `Chinese full stop in system copy: ${file}`);
  }
  const messages = [
    ...ENTRY_SPLITS.flatMap(item => [item.label, item.help]),
    ...Object.values(ENTRY_CURRENCY_NAMES),
    ...[401, 403, 404, 409, 429, 500].map(status => entryServiceError({status})),
    ...['TWD', 'USD'].map(entryAmountError),
    ...['equal', 'exact', 'hybrid', 'weights'].map(mode => entryPreviewError({error: 'invalid'}, {totalCents: 10000, currency: 'TWD', selectedCount: 4, mode})),
  ];
  for (const message of messages) {
    assert.ok(cjk.test(message), message);
    assert.ok(!message.includes('\u3002'), message);
  }
});

 test('Styles keep one internal scroller and an in-modal save dock', () => {
  assert.match(css, /\.expense-single-modal \.es-scroll \{[^}]*overflow-y: auto/);
  assert.match(css, /\.expense-single-modal \.es-save-dock \{[^}]*flex: none/);
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(!css.includes('.es-save-dock { position: fixed'));
});


test('Expense modal uses the shared body portal and background lock', () => {
  assert.match(source, /import \{createPortal\} from 'react-dom'/);
  assert.match(source, /import \{acquireModalEnvironment\} from '\.\/modal-environment\.mjs'/);
  assert.match(source, /return createPortal\(<div ref=\{overlayRef\}/);
  assert.match(source, /<\/div>, document\.body\)/);
  assert.match(source, /acquireModalEnvironment\(overlay\)/);
  assert.match(source, /releaseEnvironment\(\)/);
  assert.ok(!source.includes('const previousOverflow'));
  assert.match(source, /dialog\.closest\('\[inert\]'\)/);
});

test('Expense overlay cannot override the shared layer below mobile navigation', () => {
  const rule = css.match(/\.overlay\.expense-single-overlay\s*\{([^}]+)\}/)[1];
  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /z-index:\s*var\(--z-overlay,\s*60\)/);
  assert.doesNotMatch(rule, /z-index:\s*40/);
});

test('Traditional Chinese copy keeps accessible labels and user-provided text intact', () => {
  assert.match(source, /lang="zh-TW"/);
  for (const label of ['關閉記帳視窗', '跳至記帳區塊', '尚未儲存的變更', '紀錄類型', '快速選擇分攤成員', '分攤方式']) {
    assert.ok(source.includes(`aria-label="${label}"`), label);
  }
  for (const label of ['儲存支出', '儲存退款', '儲存修改', '確認儲存結果', '查看明細', '收起明細', '繼續編輯', '放棄並關閉']) {
    assert.ok(source.includes(label), label);
  }
  for (const label of ['Save expense', 'View details', 'Close expense editor', 'Check save result']) {
    assert.ok(!source.includes(label), label);
  }
  assert.ok(source.includes('{group.name}'));
  assert.ok(source.includes("person.displayName || '成員'"));
  assert.ok(ENTRY_SPLITS.every(item => cjk.test(item.label + item.help)));
  assert.ok(Object.values(ENTRY_CURRENCY_NAMES).every(label => cjk.test(label)));
  assert.deepEqual(ENTRY_SPLITS.map(item => item.label), ['平均分攤', '各分多少', '先指定，再均分', '按份數']);
});
