import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from tools.build_mobile import FILES, build


class MobileBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'static'
        self.output = self.root / 'build/mobile'
        for name in FILES:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('public fixture')
        (self.source / 'index.html').write_text('<html><head></head><body><script src="/app.js"></script></body></html>')
        (self.source / 'sw.js').write_text("const CACHE='__BUILD__'; const SHELL=['/','/mobile-ui.mjs'];")

    def test_public_boundary_and_module_html(self):
        for name in ('data/record.wav', 'keys/token', 'config.json', 'secret.py', 'test.js', 'vendor/ort/private.key'):
            p = self.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('PRIVATE')
        (self.source / 'mobile-extra.mjs').write_text('export {};')
        (self.source / 'icon.png').write_bytes(b'PNG fixture')
        manifest = build(self.source, self.output)
        html = (self.output / 'index.html').read_text()
        self.assertIn('type="module" src="/mobile-ui.mjs?v=', html)
        self.assertNotIn('src="/app.js"', html)
        for tag in ('/mobile.css', '/manifest.webmanifest', 'apple-mobile-web-app-capable', '/icon.png'):
            self.assertIn(tag, html)
        actual = {str(p.relative_to(self.output)) for p in self.output.rglob('*') if p.is_file()}
        self.assertEqual(actual, set(FILES) | {'mobile-extra.mjs', 'icon.png', 'release.json'})
        self.assertEqual(json.loads((self.output / 'release.json').read_text()), manifest)
        for name, checksum in manifest['checksums'].items():
            self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), checksum)

    def test_version_deterministic_and_changes(self):
        first = build(self.source, self.output)
        self.assertEqual(first, build(self.source, self.output))
        sw = (self.output / 'sw.js').read_text()
        self.assertIn(first['version'], sw)
        self.assertNotIn('__BUILD__', sw)
        (self.source / 'mobile-ui.mjs').write_text('changed')
        self.assertNotEqual(first['version'], build(self.source, self.output)['version'])

    def test_missing_critical_assets(self):
        for name in FILES:
            with self.subTest(name=name):
                path = self.source / name
                data = path.read_bytes()
                path.unlink()
                with self.assertRaisesRegex(ValueError, 'required public asset'):
                    build(self.source, self.output)
                path.write_bytes(data)

    def test_reload_invalidates_cached_entry_and_its_module_graph(self):
        ui = self.source / 'mobile-ui.mjs'
        ui.write_text("import {x} from './mobile-runtime.mjs'; const script='/app.js';")
        first = build(self.source, self.output)
        original_html = (self.output / 'index.html').read_text()
        self.assertIn("./mobile-runtime.mjs?v=", (self.output / 'mobile-ui.mjs').read_text())
        ui.write_text(ui.read_text() + ' // changed login')
        second = build(self.source, self.output)
        self.assertNotEqual(first['version'], second['version'])
        self.assertNotEqual(original_html, (self.output / 'index.html').read_text())

    def test_symlink_rejected(self):
        p = self.source / 'mobile-ui.mjs'
        p.unlink()
        p.symlink_to(self.source / 'app.js')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            build(self.source, self.output)


if __name__ == '__main__':
    unittest.main()
