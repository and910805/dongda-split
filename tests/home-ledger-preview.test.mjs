import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createHomeLedgerFixture} from './fixtures/home-ledger.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('Public demo uses synthetic people and internally consistent real allocations', () => {
  const group = createHomeLedgerFixture();
  assert.equal(group.name, '宜筆勾銷');
  assert.equal(group.currency, 'TWD');
  assert.equal(group.members.length, 15);
  assert.equal(group.expenses.length, 3);
  assert.equal(group.totalExpenseCents, 1098000);
  for (const expense of group.expenses) {
    assert.equal(expense.shares.reduce((sum, share) => sum + share.amountCents, 0), expense.amountCents);
    assert.equal(expense.payments.reduce((sum, payment) => sum + payment.amountCents, 0), expense.amountCents);
    assert.ok(expense.shares.every(share => Number.isSafeInteger(share.amountCents) && share.amountCents % 100 === 0));
    assert.equal(expense.shareCount, expense.shares.length);
  }
  assert.equal(group.expenses[0].shares[0].amountCents, 4500);
  assert.equal(group.expenses[1].shares[0].amountCents, 74600);
  assert.equal(group.balances.reduce((sum, balance) => sum + balance.balanceCents, 0), 0);
  const remaining = new Map(group.balances.map(balance => [balance.id, balance.balanceCents]));
  for (const transfer of group.settlements) {
    remaining.set(transfer.from.id, remaining.get(transfer.from.id) + transfer.amountCents);
    remaining.set(transfer.to.id, remaining.get(transfer.to.id) - transfer.amountCents);
  }
  assert.ok([...remaining.values()].every(value => value === 0));
  assert.ok(group.members.every(member => member.id.startsWith('demo-') && !member.pictureUrl && !member.bankAccount));
});

test('The homepage asset is an actual full-viewport capture with auditable source and metadata', () => {
  const image = read('public/hero-ledger-expenses-v1.webp');
  const metadata = JSON.parse(read('public/hero-ledger-expenses-v1.json'));
  const group = createHomeLedgerFixture();
  assert.equal(image.subarray(0, 4).toString(), 'RIFF');
  assert.equal(image.subarray(8, 12).toString(), 'WEBP');
  assert.ok(image.length > 10000 && image.length < 200000);
  assert.equal(hash(image), metadata.imageSha256);
  assert.equal(hash(read('src/ProductApp.jsx')), metadata.productSourceSha256);
  assert.equal(metadata.font, 'Taipei Sans TC');
  assert.deepEqual(metadata.viewport, {width: 390, height: 756, deviceScaleFactor: 2});
  assert.equal(metadata.pixelWidth, 780);
  assert.equal(metadata.pixelHeight, 1512);
  assert.equal(metadata.expenseCount, group.expenses.length);
  assert.equal(metadata.totalExpenseCents, group.totalExpenseCents);
  assert.equal(metadata.memberCount, group.members.length);
});

test('Homepage preview is inert and does not claim unrelated JPY balances or transfers', () => {
  const source = read('src/main.jsx').toString();
  const hero = source.slice(source.indexOf('function Home('), source.indexOf('<section className="proof"'));
  const preview = read('src/HeroLedgerPreview.jsx').toString();
  assert.match(hero, /<HeroLedgerPreview\/>/);
  assert.match(hero, /宜筆勾銷/);
  assert.match(hero, /15 位旅伴 · TWD/);
  assert.match(hero, /示範資料/);
  assert.doesNotMatch(hero, /TOKYO|FUJI|JPY|12,600|只需要轉帳 2 次|mini-card/);
  assert.match(preview, /靜態預覽/);
  assert.doesNotMatch(preview, /\bfetch\s*\(|<iframe|onClick=|\/api\//);
  assert.doesNotMatch(source, /import.*fixtures\/home-ledger/);
});
