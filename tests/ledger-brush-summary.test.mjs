import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
test('Painted summary receives the original ledger calculations and leaves controls in place',()=>{
  const app=read('src/ProductApp.jsx');
  for(const contract of ['totalLabel={groupMoney(total)}','balanceLabel={groupMoney(Math.abs(mine))}','balanceCents={mine}','isMember={currentUserIsMember}','expenseDates={availableExpenseDates}','memberCount={memberCount}','settlementCount={group.settlements.length}'])assert.ok(app.includes(contract),contract);
  assert.equal((app.match(/<LedgerBrushSummary /g)||[]).length,1);
  assert.ok(app.includes('settingsHost && createPortal('));
  assert.ok(app.includes('className="settlement-balances shortcut-balances"'));
  assert.doesNotMatch(app,/className="stat-card/);
});
test('Summary copy remains Chinese without removing punctuation from user data',()=>{
  const source=read('src/LedgerBrushSummary.jsx');
  assert.doesNotMatch(source,/。|DFKai|BiauKai|dangerouslySetInnerHTML|20,727|宜蘭/);
  assert.match(source,/消費紀錄/);
  assert.match(source,/title=\{name\}>\{name\}/);
  assert.match(source,/isMember \? balanceLabel : '非成員'/);
  assert.match(source,/lastDate !== firstDate/);
  assert.equal((source.match(/data-summary-metric=/g)||[]).length,3);
});
test('The scoped ribbon hides on mobile and its decoration has no executable content',()=>{
  const css=read('src/ledger-brush-summary.css');
  assert.match(css,/\.mobile-summary-cluster\.ledger-brush-summary/);
  assert.match(css,/@media \(max-width: 900px\)/);
  assert.match(css,/tabular-nums/);
  assert.doesNotMatch(css,/\.es-save|\.overlay|\.mobile-bottom-nav|!important|url\(['"]?https?:/);
  for(const name of ['brush','paper']){
    const asset=read(`public/ledger-summary-${name}.svg`);
    assert.ok(Buffer.byteLength(asset)<5000);
    assert.match(asset,/preserveAspectRatio="none"/);
    assert.doesNotMatch(asset,/<script|<foreignObject|onload=|<image|<text|href=/i);
  }
});
