// Read-only public deployment check: no login, cookies, production API or writes.
import {readFile, writeFile, appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const origin = 'https://trip-tap.kuanlin.online';
const files = ['ledger-coast-reference-v2.webp', 'ledger-summary-drybrush-v2.webp', 'ledger-summary-note-v2.webp', 'ledger-signpost-v6.svg'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = Object.fromEntries(await Promise.all(files.map(async name => [name, sha256(await readFile(new URL(`../public/${name}`, import.meta.url)))])));
const previewFiles = ['hero-ledger-expenses-v1.webp', 'hero-ledger-expenses-v1.json'];
const expectedPreview = Object.fromEntries(await Promise.all(previewFiles.map(async name => [name, sha256(await readFile(new URL(`../public/${name}`, import.meta.url)))])));
const homePreviewRevision = 'real-expenses-1';
const avatarRevision = 'authorized-photos-1';
const layoutRevision = 'mobile-polish-2';
const fontRevision = 'taipei-sans-tc-beta-1';
const fontRoot = '/fonts/taipei-sans-tc-beta/';
const fontManifestBytes = await readFile(new URL(`../public${fontRoot}manifest.json`, import.meta.url));
const fontManifest = JSON.parse(fontManifestBytes);
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
    const html = await (await get('/')).text();
    const styles = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["']/gi)].map(match => match[1]);
    if (!styles.length) throw new Error('The public page does not expose a built stylesheet');
    const styleSources = await Promise.all(styles.map(async path => (await get(path)).text()));
    const css = styleSources.join('\n');
    if (!css.replaceAll(/\s/g, '').includes(`--home-preview-revision:${homePreviewRevision}`)) throw new Error('The published stylesheet is still missing the genuine expense preview');
    if (!css.replaceAll(/\s/g, '').includes(`--ledger-layout-revision:${layoutRevision}`)) throw new Error('The published stylesheet is still missing the mobile layout polish');
    if (!css.replaceAll(/\s/g, '').includes(`--font-revision:${fontRevision}`)) throw new Error('The published stylesheet is still missing Taipei Sans TC');
    for (const name of files) if (!css.includes(name)) throw new Error(`The published stylesheet is still missing ${name}`);
    const entry = html.match(/<script\b[^>]*src=["']([^"']+\.js(?:\?[^"']*)?)["']/i)?.[1];
    const entrySource = entry ? await (await get(entry)).text() : '';
    if (!entry || !entrySource.includes('--ledger-art-height')) throw new Error('The published app bundle is not the responsive artwork revision');
    if (!entrySource.includes('hero-ledger-expenses-v1.webp')) throw new Error('The published app still uses the old homepage phone');
    if (!entrySource.includes(avatarRevision)) throw new Error('The published app is still missing the authorized avatar photos');
    const actual = {};
    for (const name of files) {
      actual[name] = sha256(Buffer.from(await (await get(`/${name}`)).arrayBuffer()));
      if (actual[name] !== expected[name]) throw new Error(`Published asset fingerprint mismatch: ${name}`);
    }
    for (const name of previewFiles) {
      actual[name] = sha256(Buffer.from(await (await get(`/${name}`)).arrayBuffer()));
      if (actual[name] !== expectedPreview[name]) throw new Error(`Published preview fingerprint mismatch: ${name}`);
    }
    const deployedManifest = Buffer.from(await (await get(fontRoot+'manifest.json')).arrayBuffer());
    if (sha256(deployedManifest) !== sha256(fontManifestBytes)) throw new Error('The published font manifest does not match this revision');
    const fonts = {};
    // Bounded read-only concurrency, static filenames only, no rendered user text.
    for (let start = 0; start < fontManifest.assets.length; start += 6) {
      await Promise.all(fontManifest.assets.slice(start, start+6).map(async asset => {
        if (!/^[\w.-]+\.woff2$/.test(asset.file)) throw new Error('Invalid font filename');
        const bytes = Buffer.from(await (await get(fontRoot+asset.file)).arrayBuffer());
        if (bytes.subarray(0,4).toString() !== 'wOF2' || bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`Published font fingerprint mismatch: ${asset.file}`);
        fonts[asset.file] = asset.sha256;
      }));
    }
    Object.assign(report, {avatarRevision, homePreviewRevision, fontRevision, fontFamily:fontManifest.family, fontAssetCount:Object.keys(fonts).length, fontManifestSha256:sha256(deployedManifest), fonts});
    Object.assign(report, {verified: true, checkedAt: new Date().toISOString(), styles, entry, layoutRevision, bundleHashes: {styles: Object.fromEntries(styles.map((path, index) => [path, sha256(Buffer.from(styleSources[index]))])), entry: sha256(Buffer.from(entrySource))}, assets: actual});
    console.log(`VERIFIED ${origin} serves ${avatarRevision}, the app bundle and all ${Object.keys(actual).length} exact static files`);
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
