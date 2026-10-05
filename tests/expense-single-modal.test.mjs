import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENTRY_CATEGORIES, ENTRY_CURRENCY_NAMES, ENTRY_SPLITS, entryAmountError, entryCategoryLabel, entryPreviewError, entryServiceError, entryShare, formatEntryAmount} from '../src/expense-entry-ui.mjs';

const source = readFileSync(new URL('../src/AdvancedExpenseModal.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/expense-single-modal.css', import.meta.url), 'utf8');
const cjk = /[\u3400-\u9fff]/u;

 test('English categories preserve the existing persisted values', () => {
  assert.deepEqual(ENTRY_CATEGORIES.map(item => item.value), ['\u9910\u98f2', '\u4f4f\u5bbf', '\u4ea4\u901a', '\u8cfc\u7269', '\u5176\u4ed6']);
  assert.deepEqual(ENTRY_CATEGORIES.map(item => item.label), ['Food', 'Stay', 'Transport', 'Shopping', 'Other']);
  assert.equal(entryCategoryLabel('\u9910\u98f2'), 'Food');
  assert.equal(entryCategoryLabel('legacy-category'), 'Other');
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
  assert.equal(formatEntryAmount(Number.MAX_SAFE_INTEGER + 1, 'TWD'), 'Out of range');
  assert.equal(formatEntryAmount(Infinity, 'USD'), 'Out of range');
  assert.equal(formatEntryAmount(NaN, 'TWD'), 'Out of range');
  assert.equal(formatEntryAmount(1, 'TWD'), 'Invalid amount');
});

 test('Remainder preview shows a range, not a guaranteed allocation', () => {
  assert.equal(entryShare({minCents: 25000, maxCents: 25100}, 'TWD'), 'NT$ 250–251');
  assert.equal(entryShare({minCents: 30000, maxCents: 30000}, 'TWD'), 'NT$ 300');
  assert.equal(entryShare(undefined, 'TWD'), 'NT$ 0');
});

 test('Amount instructions follow existing currency decimal rules', () => {
  assert.match(entryAmountError('TWD'), /whole units/);
  assert.match(entryAmountError('JPY'), /whole units/);
  assert.match(entryAmountError('USD'), /2 decimal places/);
});

for (const [status, message] of [[401, /expired/], [403, /permission/], [404, /available/], [409, /changed/], [429, /Too many/]]) {
  test(`Service status ${status} produces English guidance`, () => {
    const result = entryServiceError({status, message: '\u932f\u8aa4'});
    assert.match(result, message);
    assert.ok(!cjk.test(result));
  });
}

 test('Service codes preserve actionable concurrency and idempotency meaning', () => {
  assert.match(entryServiceError({data: {code: 'LEDGER_VERSION_CHANGED'}}), /ledger has changed/);
  assert.match(entryServiceError({data: {code: 'ACCOUNT_CHANGED'}}), /original account/);
  assert.match(entryServiceError({data: {code: 'IDEMPOTENCY_KEY_REUSED'}}), /original save/);
  assert.match(entryServiceError({data: {code: 'IDEMPOTENT_RESOURCE_DELETED'}}), /will not recreate/);
});

 test('Unknown backend errors are not leaked into the UI', () => {
  const result = entryServiceError({status: 400, message: 'secret database details', data: {error: '\u8cc7\u6599\u5eab'}});
  assert.ok(!result.includes('secret'));
  assert.ok(!cjk.test(result));
  assert.match(result, /input has been kept/);
});

 test('Preview validation is translated without changing allocations', () => {
  const preview = {error: '\u91d1\u984d\u932f\u8aa4', rows: []};
  assert.match(entryPreviewError(preview, {totalCents: null, currency: 'TWD', selectedCount: 1, mode: 'equal'}), /Enter an amount/);
  assert.match(entryPreviewError(preview, {totalCents: 10000, currency: 'TWD', selectedCount: 0, mode: 'equal'}), /Select at least/);
  for (const mode of ['equal', 'exact', 'hybrid', 'weights']) {
    const result = entryPreviewError(preview, {totalCents: 10000, currency: 'TWD', selectedCount: 4, mode});
    assert.ok(result && !cjk.test(result));
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

 test('New system copy contains no literal Chinese text', () => {
  for (const file of ['AdvancedExpenseModal.jsx', 'ExpenseEntryParts.jsx', 'expense-entry-ui.mjs']) {
    assert.ok(!cjk.test(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')), file);
  }
});

 test('Styles keep one internal scroller and an in-modal save dock', () => {
  assert.match(css, /\.expense-single-modal \.es-scroll \{[^}]*overflow-y: auto/);
  assert.match(css, /\.expense-single-modal \.es-save-dock \{[^}]*flex: none/);
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(!css.includes('.es-save-dock { position: fixed'));
});
