import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('Every explicit UI font stack starts with the selected TW rounded face',()=>{
  for(const name of readdirSync(new URL('../src',import.meta.url)).filter(n=>n.endsWith('.css'))){
    const source=read(`src/${name}`);
    for(const match of source.matchAll(/font-family\s*:\s*([^;}]+)/g)){
      assert.ok(match[1]==='inherit'||match[1].startsWith("'GenSenRoundedTW'"),`${name}: ${match[0]}`);
    }
    for(const match of source.matchAll(/(?<![\w-])font\s*:\s*([^;}]+)/g)){
      assert.ok(match[1]==='inherit'||match[1].includes("'GenSenRoundedTW'"),`${name}: ${match[0]}`);
    }
    assert.doesNotMatch(source,/DFKai|Kaiti TC|AR PL UKai|fonts\.googleapis/);
  }
  assert.match(read('src/style.css'),/:where\(input, textarea, select, optgroup, option, pre, code, kbd, samp\) \{ font-family: inherit; \}/);
});

test('Font CSS is declarative, loads actual webfonts and keeps a narrow CSP',()=>{
  const html=read('index.html');
  for(const weight of [400,500,700,900])assert.ok(html.includes(`href="https://font.emtech.cc/css/GenSenRoundedTW/${weight}" referrerpolicy="no-referrer"`));
  assert.equal((html.match(/<script\b/g)||[]).length,1,'No third-party JavaScript font loader');
  const server=read('server.js');
  assert.match(server,/fontSrc:\["'self'",'https:\/\/font\.emtech\.cc','data:'\]/);
  assert.match(server,/styleSrc:\["'self'","'unsafe-inline'",'https:\/\/font\.emtech\.cc'\]/);
  assert.match(server,/scriptSrc:\["'self'"\]/);
  assert.match(server,/connectSrc:\["'self'"\]/);
  assert.doesNotMatch(html,/words=|emfont\.js|font\.emtech\.cc\/css\/GenSenRoundedTC/);
});
