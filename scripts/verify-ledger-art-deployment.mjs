// Read-only public deployment check: no login, cookies, production API or writes.
import {readFile, writeFile, appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const origin = 'https://trip-tap.kuanlin.online';
const files = ['ledger-coast-reference-v2.webp', 'ledger-summary-drybrush-v2.webp', 'ledger-summary-note-v2.webp'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = Object.fromEntries(await Promise.all(files.map(async name => [name, sha256(await readFile(new URL(`../public/${name}`, import.meta.url)))])));
const layoutRevision = 'mobile-polish-2';
const revision = process.env.GITHUB_SHA || 'local';
const report = {origin, revision, verified: false, checkedAt: '', attempts: []};

async function get(path) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('Refusing a cross-origin deployment resource');
  url.searchParams.set('art-check', revision);
  const res = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(10000), headers: {'cache-control': 'no-cache', 'pragma': 'no-cache'}});
  if (!res.ok) throw new Error(`${url.pathname}: HTTP ${res.status}`);
  return res;
}

for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const htmlResponse = await get('/');
    const html = await htmlResponse.text();
    const styles = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["']/gi)].map(match => match[1]);
    if (!styles.length) throw new Error('The public page does not expose a built stylesheet');
    const styleSources = await Promise.all(styles.map(async path => (await get(path)).text()));
    const css = styleSources.join('\n');
    if (!css.replaceAll(/\s/g, '').includes('--site-font-revision:gensen-tw-1') || !css.includes('GenSenRoundedTW')) throw new Error('The published stylesheet is not the rounded TW font revision');
    const policy = htmlResponse.headers.get('content-security-policy') || '';
    for (const directive of ['font-src', 'style-src']) if (!policy.split(';').some(part => part.trim().startsWith(directive+' ') && part.includes('https://font.emtech.cc'))) throw new Error('Published CSP has not enabled the font origin');
    const fontDelivery = {};
    for (const weight of [400,500,700,900]) {
      const url = `https://font.emtech.cc/css/GenSenRoundedTW/${weight}`;
      if (!html.includes(url)) throw new Error(`Published HTML is missing TW font weight ${weight}`);
      const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(`Font CSS ${weight}: HTTP ${response.status}`);
      const source = await response.text();
      if (!source.includes('GenSenRoundedTW') || !source.includes('font-display: swap') || !source.includes('unicode-range:')) throw new Error(`Invalid font stylesheet for ${weight}`);
      const file = source.match(/src:\s*url\(['"](https:\/\/font\.emtech\.cc\/file\/[^'"]+\.woff2)['"]\)/)?.[1];
      if (!file) throw new Error(`No WOFF2 subset for ${weight}`);
      const subset = await fetch(file, {redirect:'error', signal:AbortSignal.timeout(15000)});
      const bytes = Buffer.from(await subset.arrayBuffer());
      if (!subset.ok || bytes.subarray(0,4).toString() !== 'wOF2') throw new Error(`Font file ${weight} is not available`);
      fontDelivery[weight] = {css:url, sample:file, sha256:sha256(bytes)};
    }
    Object.assign(report, {fontRevision:'gensen-tw-1', fontDelivery});
    if (!css.replaceAll(/\s/g, '').includes(`--ledger-layout-revision:${layoutRevision}`)) throw new Error('The published stylesheet is still missing the mobile layout polish');
    for (const name of files) if (!css.includes(name)) throw new Error(`The published stylesheet is still missing ${name}`);
    const entry = html.match(/<script\b[^>]*src=["']([^"']+\.js(?:\?[^"']*)?)["']/i)?.[1];
    const entrySource = entry ? await (await get(entry)).text() : '';
    if (!entry || !entrySource.includes('--ledger-art-height')) throw new Error('The published app bundle is not the responsive artwork revision');
    const actual = {};
    for (const name of files) {
      actual[name] = sha256(Buffer.from(await (await get(`/${name}`)).arrayBuffer()));
      if (actual[name] !== expected[name]) throw new Error(`Published asset fingerprint mismatch: ${name}`);
    }
    Object.assign(report, {verified: true, checkedAt: new Date().toISOString(), styles, entry, layoutRevision, bundleHashes: {styles: Object.fromEntries(styles.map((path, index) => [path, sha256(Buffer.from(styleSources[index]))])), entry: sha256(Buffer.from(entrySource))}, assets: actual});
    console.log(`VERIFIED ${origin} serves ${layoutRevision}, the app bundle and all three exact artwork files`);
    break;
  } catch (error) {
    const detail = error.cause?.code || error.message;
    report.attempts.push({attempt, at: new Date().toISOString(), detail});
    console.log(`Attempt ${attempt}/12: ${detail}`);
    if (attempt < 12) await delay(20000);
  }
}
await writeFile('ledger-deployment-report.json', JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Ledger artwork deployment\n\n${report.verified ? 'VERIFIED: the public website serves the new app, CSS and matching artwork fingerprints' : 'NOT VERIFIED: inspect ledger-deployment-report.json for the last public HTTP check'}\n\nRevision: \`${revision}\`\n`);
if (!report.verified) process.exitCode = 1;
