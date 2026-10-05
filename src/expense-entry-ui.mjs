import {formatCurrencyAmount, getCurrency} from '../currency.mjs';

// Labels are English; persisted category values remain backward-compatible.
export const ENTRY_CATEGORIES = Object.freeze([
  {value: '\u9910\u98f2', label: 'Food'},
  {value: '\u4f4f\u5bbf', label: 'Stay'},
  {value: '\u4ea4\u901a', label: 'Transport'},
  {value: '\u8cfc\u7269', label: 'Shopping'},
  {value: '\u5176\u4ed6', label: 'Other'},
]);
export const ENTRY_CURRENCY_NAMES = Object.freeze({
  TWD: 'NT dollar', JPY: 'Yen', KRW: 'Won',
  USD: 'US dollar', CNY: 'Yuan', THB: 'Baht',
});
export const ENTRY_SPLITS = Object.freeze([
  {id: 'equal', label: 'Split equally', icon: 'equal', help: 'Split between selected people. Tap a name to include or exclude them.'},
  {id: 'exact', label: 'Exact amounts', icon: 'coins', help: 'Enter what each person owes. The amounts must add up to the total.'},
  {id: 'hybrid', label: 'Fixed + equal', icon: 'split', help: 'Set a fixed amount for some people. Everyone else splits the remainder.'},
  {id: 'weights', label: 'By shares', icon: 'ratio', help: 'Enter shares, such as 2 for an adult and 1 for a child. Costs follow that ratio.'},
]);

export function entryCategoryLabel(value) {
  return ENTRY_CATEGORIES.find(item => item.value === value)?.label || 'Other';
}

// Validation totals can overflow even when each individual input is valid.
// This formatter never repairs or submits a value; the server remains authoritative.
export function formatEntryAmount(cents, currency) {
  if (!Number.isSafeInteger(cents)) return 'Out of range';
  try { return formatCurrencyAmount(cents, currency); }
  catch { return 'Invalid amount'; }
}

export function entryShare(row, currency) {
  if (!row) return formatEntryAmount(0, currency);
  const lower = formatEntryAmount(row.minCents, currency);
  return row.minCents === row.maxCents ? lower : `${lower}–${formatCurrencyAmount(row.maxCents, currency, {includeSymbol: false})}`;
}

export function entryAmountError(currency) {
  const {decimals} = getCurrency(currency);
  return decimals ? `Enter a valid ${currency} amount with up to ${decimals} decimal places.` : `Enter a valid ${currency} amount in whole units.`;
}

// Keep service codes and stored content unchanged. Do not expose raw database
// errors or untranslated service messages in this English-only entry surface.
export function entryServiceError(error) {
  const code = error?.data?.code;
  const known = {
    ACCOUNT_CHANGED: 'Your account has changed. Switch back to the original account to check this save.',
    LEDGER_VERSION_CHANGED: 'This ledger has changed. Close the editor, refresh the ledger, and review before saving again.',
    IDEMPOTENCY_KEY_REUSED: 'This request key is already in use. Check the original save before creating another entry.',
    IDEMPOTENT_RESOURCE_DELETED: 'This entry was saved and later deleted. Checking it will not recreate it.',
  };
  if (Object.hasOwn(known, code)) return known[code];
  if (error?.status === 401) return 'Your session has expired. Sign in again before checking this save.';
  if (error?.status === 403) return 'You no longer have permission to update this ledger.';
  if (error?.status === 404) return 'This ledger or entry is no longer available.';
  if (error?.status === 409) return 'This entry has changed. Refresh the ledger and review the latest version.';
  if (error?.status === 429) return 'Too many requests. Wait a moment before trying again.';
  return 'The request could not be completed. Your input has been kept. Review the entry and try again.';
}

export function entryPreviewError(preview, {totalCents, currency, selectedCount, mode}) {
  if (!preview.error) return '';
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return 'Enter an amount to see each person’s share.';
  if (!selectedCount) return 'Select at least one person.';
  if (mode === 'exact') return 'Enter a positive amount for each selected person. The sum must match the total.';
  if (mode === 'hybrid') return 'Keep at least one person sharing the remainder. Fixed amounts must leave enough for them.';
  if (mode === 'weights') return 'Use positive shares and a total large enough for everyone to receive one minimum unit.';
  return `The total is too small to give everyone one minimum ${currency} unit.`;
}
