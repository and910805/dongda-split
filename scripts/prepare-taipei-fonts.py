"""Maintenance only: Python 3.12, fonttools==4.60.1, brotli==1.1.0.
Normal application builds need no Python or new packages. Downloads use the
JT Foundry public files, verified against pinned fingerprints; the public
mirror is only a byte-verified fallback. No user text or account is accessed.
"""
from concurrent.futures import ProcessPoolExecutor
from copy import deepcopy
from hashlib import sha1, sha256
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
import json
import logging
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/fonts/taipei-sans-tc-beta'
MIRROR = 'ed1090ab7c0bd9b05b2bbdbb165a9d966e352302'
FACES = [
    ('Light', 300, '1QdaqR8Setf4HEulrIW79UEV_Lg_fuoWz', 'sha256', 'd69a9ea6a77f694c3a1a1fb766c764aa74cb3e2c4c69f1b532edf98b3f2bb662'),
    ('Regular', 400, '1eGAsTN1HBpJAkeVM57_C7ccp7hbgSz3_', 'sha256', '8cc967e1e428c552701c461e8169e6ae76c7a23694ea1a6a786d6746adec53c4'),
    ('Bold', 700, '1Om8izPz02Msc15onhS_ki1lrlAIf05Pd', 'git-blob', '7c6238e0fe62b715630bcef9757cdd691ef277e1'),
]


def download(face):
    suffix, weight, drive_id, algorithm, expected = face
    name = f'TaipeiSansTCBeta-{suffix}.ttf'
    mirror_host = 'raw.githubusercontent.com' if suffix == 'Bold' else 'media.githubusercontent.com/media'
    urls = [f'https://drive.usercontent.google.com/download?id={drive_id}&export=download',
            f'https://{mirror_host}/vp-tw/taipei-sans-tc/{MIRROR}/packages/core/src/{name}']
    errors = []
    for url in urls:
        try:
            with urlopen(Request(url, headers={'User-Agent': 'TripTab-font-preparation'}), timeout=45) as response:
                content = response.read(32 * 1024 * 1024 + 1)
            if len(content) > 32 * 1024 * 1024 or content[:4] != b'\x00\x01\x00\x00':
                raise ValueError('Not a supported TrueType font')
            digest = sha256(content).hexdigest() if algorithm == 'sha256' else sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
            if digest != expected:
                raise ValueError(f'Fingerprint mismatch: {name}')
            return content, url
        except Exception as error:
            errors.append(str(error))
    raise RuntimeError(f'Unable to verify {name}: {errors}')


def unicode_ranges(points):
    result = []
    start = end = None
    for point in sorted(points):
        if end is not None and point == end + 1:
            end = point
        else:
            if start is not None:
                result.append(f'U+{start:X}' if start == end else f'U+{start:X}-{end:X}')
            start = end = point
    if start is not None:
        result.append(f'U+{start:X}' if start == end else f'U+{start:X}-{end:X}')
    return ','.join(result)


def prepare_face(args):
    face, ui_points = args
    weight = face[1]
    logging.getLogger('fontTools.subset').setLevel(logging.ERROR)
    content, url = download(face)
    source = TTFont(BytesIO(content), recalcTimestamp=False)
    family = source['name'].getDebugName(1)
    if 'Taipei Sans TC' not in family:
        raise ValueError(f'Unexpected font family: {family}')
    available = set(source.getBestCmap())
    assert len(available) > 20000
    latin = available & (set(range(0x250)) | set(range(0x2000, 0x2070)) | set(range(0x20A0, 0x20D0)))
    common = (available & set(ui_points)) - latin
    rest = sorted(available - latin - common)
    groups = [('latin', latin), ('ui', common)] + [(f'extra-{i//1024:02}', set(rest[i:i+1024])) for i in range(0, len(rest), 1024)]
    output = []
    for label, points in groups:
        if not points:
            continue
        font = deepcopy(source)
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.recalc_timestamp = False
        cutter = subset.Subsetter(options=options)
        cutter.populate(unicodes=points)
        cutter.subset(font)
        font.flavor = 'woff2'
        buffer = BytesIO()
        font.save(buffer)
        data = buffer.getvalue()
        assert data[:4] == b'wOF2'
        assert set(TTFont(BytesIO(data)).getBestCmap()) == points
        filename = f'{weight}-{label}-{sha256(data).hexdigest()[:12]}.woff2'
        (DEST / filename).write_bytes(data)
        output.append({'file': filename, 'weight': weight, 'subset': label, 'unicodeRange': unicode_ranges(points), 'glyphCount': len(points), 'bytes': len(data), 'sha256': sha256(data).hexdigest()})
    assert sum(row['glyphCount'] for row in output) == len(available)
    print(f'{family} {weight}: {len(output)} shards, {len(available)} codepoints', flush=True)
    provenance = {'weight': weight, 'name': family, 'version': source['name'].getDebugName(5), 'url': url, 'sha256': sha256(content).hexdigest(), 'codepoints': len(available), 'copyright': source['name'].getDebugName(0)}
    return output, provenance


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for old in DEST.glob('*.woff2'):
        old.unlink()
    points = set()
    for path in (ROOT / 'src').rglob('*'):
        if path.suffix in {'.jsx', '.mjs', '.css'} and not path.name.endswith('font-faces.css'):
            points.update(map(ord, path.read_text()))
    with ProcessPoolExecutor(max_workers=2) as executor:
        batches = list(executor.map(prepare_face, [(face, sorted(points)) for face in FACES]))
    assets = [row for batch, _ in batches for row in batch]
    sources = [source for _, source in batches]
    license_path = DEST / 'OFL.txt'
    if not license_path.exists():
        license_text = (ROOT / 'public/fonts/gensen-tw-2.1.0/OFL.txt').read_text()
        license_body = license_text[license_text.index('SIL OPEN FONT LICENSE Version 1.1'):]
        copyrights = '\n\n'.join(dict.fromkeys(s['copyright'] for s in sources if s['copyright']))
        license_path.write_text(copyrights + '\n\nTaipei Sans TC by JT Foundry, based on Source Han Sans\nOfficial licensing: https://sites.google.com/view/jtfoundry/zh-tw/downloads\n\n' + license_body)
    manifest = {'family': 'Taipei Sans TC', 'version': 'Beta 1.000', 'sourceRepository': f'https://github.com/vp-tw/taipei-sans-tc/tree/{MIRROR}', 'officialSource': 'https://sites.google.com/view/jtfoundry/zh-tw/downloads', 'license': 'SIL Open Font License 1.1', 'sources': sources, 'assets': assets}
    (DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    css = ['/* Taipei Sans TC Beta by JT Foundry, OFL-1.1, checksum-verified public sources */']
    for asset in assets:
        css.append('@font-face {\n  font-family: "Taipei Sans TC";\n  font-style: normal;\n  font-weight: %s;\n  font-display: swap;\n  src: url("/fonts/taipei-sans-tc-beta/%s") format("woff2");\n  unicode-range: %s;\n}' % (asset['weight'], asset['file'], asset['unicodeRange']))
    (ROOT / 'src/taipei-font-faces.css').write_text('\n'.join(css) + '\n')
    print(f'Total font bytes: {sum(a["bytes"] for a in assets):,}', flush=True)


if __name__ == '__main__':
    main()
