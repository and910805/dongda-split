import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expenseDateOptions,filterExpensesByDate,filterExpenses} from '../src/expense-sort.mjs';
const rows = Object.freeze([
 Object.freeze({id:1,title:'晚餐',payerName:'Andy',expenseDate:'2026-07-26',amountCents:10000}),
 Object.freeze({id:2,title:'早餐',payerName:'Mia',expenseDate:'2026-07-25',amountCents:12000}),
 Object.freeze({id:3,title:'午餐',payerName:'Andy',expenseDate:'2026-07-26',amountCents:13000}),
 Object.freeze({id:4,title:'舊資料',createdAt:'2026-07-24T12:00:00Z',amountCents:5000}),
 Object.freeze({id:5,title:'無日期',createdAt:'invalid',amountCents:5000}),
]);
test('Calendar date options are unique, descending and non-mutating',()=>{
 assert.deepEqual(expenseDateOptions(rows),['2026-07-26','2026-07-25','2026-07-24']);
 assert.deepEqual(expenseDateOptions(null),[]);
 assert.equal(rows[0].id,1);
});
test('Date filters compose with search and never change totals or input records',()=>{
 assert.deepEqual(filterExpensesByDate(rows,'2026-07-26').map(row=>row.id),[1,3]);
 assert.deepEqual(filterExpenses(filterExpensesByDate(rows,'2026-07-26'),'午餐').map(row=>row.id),[3]);
 assert.deepEqual(filterExpensesByDate(rows,'all'),rows);
 assert.notEqual(filterExpensesByDate(rows,'all'),rows);
 assert.deepEqual(filterExpensesByDate(rows,'missing'),[]);
 assert.deepEqual(filterExpensesByDate(undefined),[]);
 assert.equal(rows.reduce((sum,row)=>sum+row.amountCents,0),45000);
});
test('Reference A actions use one settlement balance entry and a non-modal row menu',()=>{
 const source=readFileSync(new URL('../src/ProductApp.jsx',import.meta.url),'utf8');
 assert.equal((source.match(/className="settlement-balances shortcut-balances"/g)||[]).length,1);
 assert.ok(!source.includes('className={`mobile-shortcuts'));
 assert.ok(source.includes('expenseMembers.slice(0,12)'));
 assert.ok(source.includes('expenseMembers.length-12'));
 const menu=readFileSync(new URL('../src/LedgerExpenseActions.jsx',import.meta.url),'utf8');
 assert.match(menu,/canManage && !expense.isLocked/);
 assert.match(menu,/createPortal/);
 assert.match(menu,/aria-haspopup="menu"/);
 assert.doesNotMatch(menu,/[。]/u);
 assert.ok(source.includes('setExpenseDateFilter(\'all\')'));
});
test('Mobile keeps short action labels intact and separates the selected view',()=>{
 const css=readFileSync(new URL('../src/ledger-reference-a.css',import.meta.url),'utf8');
 assert.match(css,/\.es-reset \{ white-space: nowrap; min-width: 64px; max-width: none;/);
 assert.match(css,/data-mobile-view="overview"/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/\.expense-date-filter \{ grid-column: 1; grid-row: 2;/);
 assert.match(css,/\.expense-member-filter \{ grid-column: 2; grid-row: 2;/);
});
