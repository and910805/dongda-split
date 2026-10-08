import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url));
const directory='public/fonts/gensen-tw-2.1.0/';
const manifest=JSON.parse(read(directory+'manifest.json'));

test('TW font assets retain all six upstream weights and complete non-overlapping cmap coverage',()=>{
  assert.equal(manifest.family,'GenSen Rounded TW');
  assert.equal(manifest.sourceCommit,'d347d3fffcb45e08857052433a0b432ed4f7ace8');
  assert.deepEqual([...new Set(manifest.assets.map(a=>a.weight))],[250,300,400,500,700,900]);
  const css=read('src/gensen-font-faces.css').toString();
  let previous;
  for(const weight of [250,300,400,500,700,900]){
    const points=new Set();
    for(const asset of manifest.assets.filter(a=>a.weight===weight)){
      const bytes=read(directory+asset.file);
      assert.equal(bytes.subarray(0,4).toString(),'wOF2');
      assert.equal(bytes.length,asset.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      assert.ok(css.includes(asset.file));
      for(const range of asset.unicodeRange.split(',')){
        const [low,high=low]=range.slice(2).split('-').map(value=>parseInt(value,16));
        for(let cp=low;cp<=high;cp++){assert.ok(!points.has(cp),`Overlapping range at ${weight}:${cp}`);points.add(cp);}
      }
    }
    assert.ok(points.size>30000);
    if(previous)assert.deepEqual(points,previous);
    previous=points;
  }
  assert.equal((css.match(/font-display: swap/g)||[]).length,manifest.assets.length);
  assert.doesNotMatch(css,/https?:|local\(/);
  assert.match(read(directory+'OFL.txt').toString(),/SIL OPEN FONT LICENSE/);
});

test('The global override changes only font family, not component geometry or behavior',()=>{
  const css=read('src/typography.css').toString().replace(/\/\*[\s\S]*?\*\//g,'');
  const blocks=[...css.matchAll(/\{([^{}]*)\}/g)].map(m=>m[1]).join(';');
  const properties=[...blocks.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map(m=>m[1]);
  assert.deepEqual(properties,['--font-ui','--font-revision','font-family']);
  assert.match(css,/font-family: var\(--font-ui\) !important/);
  assert.match(css,/::before/);assert.match(css,/::placeholder/);
  assert.ok(read('src/coastal-main.jsx').toString().trim().endsWith("import './typography.css';"));
  assert.doesNotMatch(read('src/style.css').toString(),/fonts\.googleapis\.com/);
  assert.doesNotMatch(css,/DFKai|Kaiti|font-size|line-height|font-weight|margin|padding/);
});
