"""Maintenance-only: package the pinned upstream TW font into static WOFF2 shards.
Normal pnpm install/build and the production image do not need Python or fontTools.
Run with Python 3.12, fonttools==4.60.1 and brotli==1.1.0 in a disposable environment.
No user/ledger data is read; common glyphs come only from checked-in UI source.
"""
from concurrent.futures import ProcessPoolExecutor
from copy import deepcopy
from hashlib import sha1, sha256
from io import BytesIO
from pathlib import Path
import json
import logging
import time
from urllib.request import Request, urlopen
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
COMMIT = 'd347d3fffcb45e08857052433a0b432ed4f7ace8'
ORIGIN = f'https://raw.githubusercontent.com/ButTaiwan/gensen-font/{COMMIT}/'
DEST = ROOT / 'public/fonts/gensen-tw-2.1.0'
FACES = [
    ('EL', 250, '2af2ba89c3d96149f6ffee167db5e31790665883'),
    ('L', 300, '54d661a56fd976eb7150b784aaf6fa63a171bfd6'),
    ('R', 400, '186c5cc15a45676c9c6024db3189e3e413e16151'),
    ('M', 500, '17e801eb09de4f52a1c2fa1001705855435f29d2'),
    ('B', 700, '76404630bc313190aaa85b09d8d7a41abdf000de'),
    ('H', 900, '5f366c5c5377e1fb4f196821ca46f962b2a4c0a8'),
]


def download(path, expected):
    for attempt in range(3):
        try:
            with urlopen(Request(ORIGIN + path, headers={'User-Agent': 'TripTab-font-preparation'}), timeout=90) as response:
                content = response.read(32 * 1024 * 1024 + 1)
            if len(content) > 32 * 1024 * 1024:
                raise ValueError('Upstream file exceeded the size limit')
            digest = sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
            if digest != expected:
                raise ValueError(f'Upstream fingerprint mismatch: {path}')
            return content
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


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
    suffix, weight, expected, ui_points = args
    logging.getLogger('fontTools.subset').setLevel(logging.ERROR)
    content = download(f'otf/TW/GenSenRounded2TW-{suffix}.otf', expected)
    source = TTFont(BytesIO(content), recalcTimestamp=False)
    available = set(source.getBestCmap())
    assert len(available) > 30000
    latin = available.intersection(set(range(0x250)) | set(range(0x2000, 0x2070)) | set(range(0x20A0, 0x20D0)))
    common = (available & set(ui_points)) - latin
    remainder = sorted(available - latin - common)
    groups = [('latin', latin), ('ui', common)] + [(f'extra-{i//1024:02}', set(remainder[i:i+1024])) for i in range(0, len(remainder), 1024)]
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
        # Keep full coverage, while loading uncommon names only when rendered.
        restored = TTFont(BytesIO(data))
        assert set(restored.getBestCmap()) == points
        filename = f'{weight}-{label}-{sha256(data).hexdigest()[:12]}.woff2'
        (DEST / filename).write_bytes(data)
        output.append({'file': filename, 'weight': weight, 'subset': label, 'unicodeRange': unicode_ranges(points), 'glyphCount': len(points), 'bytes': len(data), 'sha256': sha256(data).hexdigest()})
    assert sum(row['glyphCount'] for row in output) == len(available)
    print(f'{weight}: {len(output)} shards, {len(available)} mapped codepoints', flush=True)
    return output


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for old in DEST.glob('*.woff2'):
        old.unlink()
    points = set()
    for path in (ROOT / 'src').rglob('*'):
        if path.suffix in {'.jsx', '.mjs', '.css'} and path.name != 'gensen-font-faces.css':
            points.update(map(ord, path.read_text()))
    with ProcessPoolExecutor(max_workers=2) as executor:
        batches = executor.map(prepare_face, [(suffix, weight, digest, sorted(points)) for suffix, weight, digest in FACES])
        assets = [asset for batch in batches for asset in batch]
    license_bytes = download('SIL_Open_Font_License_1.1.txt', '1dfc6870a1d0f927fdec9b7e3190f61e9682f8cf')
    (DEST / 'OFL.txt').write_bytes(license_bytes)
    manifest = {'family': 'GenSen Rounded TW', 'version': '2.100', 'sourceCommit': COMMIT, 'sourceRepository': 'https://github.com/ButTaiwan/gensen-font', 'license': 'SIL Open Font License 1.1', 'assets': assets}
    (DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    css = ['/* Generated from the pinned upstream GenSen Rounded TW 2.100, OFL-1.1 */']
    for asset in assets:
        css.append('@font-face {\n  font-family: "GenSen Rounded TW";\n  font-style: normal;\n  font-weight: %s;\n  font-display: swap;\n  src: url("/fonts/gensen-tw-2.1.0/%s") format("woff2");\n  unicode-range: %s;\n}' % (asset['weight'], asset['file'], asset['unicodeRange']))
    (ROOT / 'src/gensen-font-faces.css').write_text('\n'.join(css) + '\n')
    print(f'Total font assets: {sum(asset["bytes"] for asset in assets):,} bytes', flush=True)


if __name__ == '__main__':
    main()
