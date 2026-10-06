import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Desktop settings has one header host between invite and add, without travel copy',()=>{
 const source=readFileSync(new URL('../src/ProductApp.jsx',import.meta.url),'utf8');
 const start=source.indexOf('<div className="real-header-actions">');
 const end=source.indexOf('</header>',start);
 const header=source.slice(start,end);
 assert.ok(header.indexOf('className="header-secondary"')<header.indexOf('className="header-ledger-settings"'));
 assert.ok(header.indexOf('className="header-ledger-settings"')<header.indexOf('className="primary header-primary"'));
 assert.equal((source.match(/className="group-admin-menu"/g)||[]).length,1);
 assert.match(source,/settingsHost && createPortal\(/);
 assert.match(source,/settingsHost=\{headerSettingsHost\}/);
 assert.doesNotMatch(source,/className="group-overview-side"|className="ledger-travel-note"/);
 assert.ok(!source.includes('山海相伴，旅途的每一刻，都值得被好好記錄'));
 assert.match(source,/className="mobile-group-settings"/);
 const css=readFileSync(new URL('../src/ledger-header.css',import.meta.url),'utf8');
 assert.match(css,/@media \(max-width: 900px\)/);
 assert.match(css,/\.real-app \.header-ledger-settings \{ display: none; \}/);
});
