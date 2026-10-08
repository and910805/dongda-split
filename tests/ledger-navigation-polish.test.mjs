import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
test('The mobile row has one details trigger, without removing permitted edit/delete actions',()=>{
 const s=read('src/ProductApp.jsx');
 const row=s.slice(s.indexOf('function MobileExpenseRecord('),s.indexOf('function MobileLedgerSwitcher('));
 assert.equal((row.match(/<button/g)||[]).length,1);
 assert.doesNotMatch(row,/mobile-expense-record-more|actionsOpen/);
 assert.match(s,/detailExpense.createdBy===me.id\|\|group.ownerId===me.id\|\|me.isSuperuser/);
 assert.match(s,/if\(!detailExpense\|\|detailExpense.isLocked\|\|!detailCanManage\|\|deleting\)return/);
 assert.match(s,/className="expense-detail-actions"/);
 assert.match(s,/onDelete=\{detailCanManage/);
});
test('Ledger switcher reuses the shared modal and original selection handler',()=>{
 const s=read('src/ProductApp.jsx');
 const part=s.slice(s.indexOf('function MobileLedgerSwitcher('),s.indexOf('function RecordPagination('));
 assert.match(s,/onSelect=\{selectGroup\}/);
 assert.match(part,/<Modal close=\{close\} label="切換帳本"/);
 assert.match(part,/removeEventListener\('change',release\)/);
 assert.match(part,/if\(loading\)return/);
 assert.doesNotMatch(part,/<select|fetch\(|localStorage|dangerouslySetInnerHTML|。/);
});
test('Amount focus is responsive and existing UI no longer explicitly requests calligraphy',()=>{
 const css=read('src/ledger-layout-polish.css');
 assert.match(css,/mobile-polish-2/);assert.match(css,/@media \(forced-colors: active\)/);
 assert.doesNotMatch(read('src/ledger-coastal.css'),/DFKai|Kaiti|KaiTi|BiauKai/);
 assert.match(read('src/expense-single-modal.css'),/Noto Sans TC.*Microsoft JhengHei/);
 assert.match(read('scripts/verify-ledger-art-deployment.mjs'),/const layoutRevision = 'mobile-polish-2'/);
});
