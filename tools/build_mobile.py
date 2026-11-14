#!/usr/bin/env python3
"""Deterministic, public-only mobile release builder (stdlib only)."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

FILES = ('index.html', 'app.js', 'style.css', 'mobile.css', 'sw.js',
         'manifest.webmanifest', 'icon.svg', 'mobile-ui.mjs', 'mobile-runtime.mjs',
         'mobile-store.mjs', 'mobile-audio.mjs', 'mobile-model.mjs',
         'mobile-vault.mjs', 'mobile-vad.mjs', 'vendor/ort/ort.wasm.min.mjs',
         'vendor/ort/ort-wasm-simd-threaded.mjs',
         'vendor/ort/ort-wasm-simd-threaded.wasm', 'vendor/ort/LICENSE',
         'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs',
         'vendor/pdfjs/LICENSE', 'models/silero_vad.onnx', 'models/SILERO_LICENSE.txt')
OPTIONAL = ('icon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(source, output):
    source, output = Path(source).resolve(), Path(output).absolute()
    if output.resolve() == source or source in output.resolve().parents:
        raise ValueError('output must be outside static source')
    names = set(FILES)
    # The mobile module namespace is public; no directory recursion is allowed.
    names.update(p.name for p in source.glob('mobile-*.mjs'))
    names.update(n for n in OPTIONAL if (source / n).exists())
    assets = {}
    for name in sorted(names):
        path = source / name
        if any(p.is_symlink() for p in (path, *path.parents)):
            raise ValueError(f'symlink rejected: {name}')
        if not path.is_file() or not path.stat().st_size:
            raise ValueError(f'missing or empty required public asset: {name}')
        assets[name] = path.read_bytes()
    html = assets['index.html'].decode('utf-8')
    html, count = re.subn(r'<script\b[^>]*\bsrc=[\"\']/app\.js[\"\'][^>]*>\s*</script>',
                          '<script type="module" src="/mobile-ui.mjs"></script>', html)
    if count != 1 or '</head>' not in html:
        raise ValueError('expected one /app.js script and closing head')
    icon = next((n for n in ('apple-touch-icon.png', 'icon.png', 'icon-192.png', 'icon-512.png') if n in assets), 'icon.svg')
    tags = ('<link rel="stylesheet" href="/mobile.css">\n'
            '<link rel="manifest" href="/manifest.webmanifest">\n'
            '<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
            f'<link rel="apple-touch-icon" href="/{icon}">\n')
    assets['index.html'] = html.replace('</head>', tags + '</head>').encode()
    if b'__BUILD__' not in assets['sw.js']:
        raise ValueError('service worker missing __BUILD__ placeholder')
    source_checksums = {n: digest((source / n).read_bytes()) for n in sorted(names)}
    # Older service workers cache module URLs indefinitely. Change the entry URL
    # and every local module dependency together so a normal reload cannot mix
    # an old eight-character login UI with the new six-character server policy.
    asset_epoch = digest(json.dumps(source_checksums, sort_keys=True).encode())[:20]
    browser_code = {n for n in names if '/' not in n and n.endswith(('.mjs', '.js', '.css')) and n != 'sw.js'}
    def version_ref(match):
        quote, ref = match.groups()
        name = ref[2:] if ref.startswith('./') else ref[1:]
        return quote + ref + '?v=' + asset_epoch + quote if name in browser_code else match.group(0)
    for name in browser_code | {'index.html'}:
        assets[name] = re.sub(r'''(['"])((?:\./|/)[^'"\s?]+)\1''', version_ref, assets[name].decode()).encode()
    version = digest(json.dumps({n: digest(v) for n, v in sorted(assets.items())}, sort_keys=True).encode())
    assets['sw.js'] = assets['sw.js'].replace(b'__BUILD__', version.encode())
    # Check service-worker precache references, including future modules.
    shell = re.search(rb'const SHELL\s*=\s*(\[[^;]+\])', assets['sw.js'])
    if shell:
        for name in re.findall(rb"['\"](/[^'\"]*)['\"]", shell[1]):
            name = name.decode().lstrip('/') or 'index.html'
            if name not in assets:
                raise ValueError(f'missing service worker asset: {name}')
    manifest = {'schema': 1, 'version': version, 'source_checksums': source_checksums,
                'checksums': {n: digest(v) for n, v in sorted(assets.items())}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.mobile-', dir=output.parent) as tmp:
        stage = Path(tmp) / 'release'
        stage.mkdir()
        for name, data in assets.items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (stage / 'release.json').write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n')
        if output.is_symlink():
            raise ValueError('output symlink rejected')
        if output.exists():
            shutil.rmtree(output)
        stage.rename(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1] / 'static')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'build/mobile')
    args = parser.parse_args()
    try:
        print(build(args.source, args.output)['version'])
    except (ValueError, OSError) as exc:
        parser.exit(1, f'mobile build failed: {exc}\n')


if __name__ == '__main__':
    main()
