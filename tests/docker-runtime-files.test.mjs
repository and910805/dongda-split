import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('Docker 正式映像包含 server.js 的所有本地 runtime imports',async()=>{
  const [serverSource,dockerfile]=await Promise.all([
    readFile(new URL('../server.js',import.meta.url),'utf8'),
    readFile(new URL('../Dockerfile',import.meta.url),'utf8')
  ]);
  const runtimeCopy=dockerfile
    .split(/\r?\n/)
    .find(line=>line.startsWith('COPY server.js '));
  assert.ok(runtimeCopy,'Dockerfile 必須明確複製 server.js 與 runtime 模組');

  const copiedFiles=new Set(runtimeCopy
    .replace(/^COPY\s+/,'')
    .replace(/\s+\.\/\s*$/,'')
    .trim()
    .split(/\s+/));
  const localImports=[...serverSource.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)]
    .map(match=>match[1]);

  assert.deepEqual(
    localImports.filter(file=>!copiedFiles.has(file)),
    [],
    'Docker runtime COPY 遺漏 server.js 使用的本地模組'
  );
});
