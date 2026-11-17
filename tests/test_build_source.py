import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import build_exe  # noqa: E402


class BuildSourceTests(unittest.TestCase):
    """S3-3.3/3.4：构建只认仓库，版本号单一来源。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'repo'
        self.copy = Path(self.tmp.name) / 'copy'
        for folder in (self.root, self.copy):
            (folder / 'assets').mkdir(parents=True, exist_ok=True)
            (folder / 'settlement-workbench.html').write_text('<html>页面</html>', encoding='utf-8')
        (self.root / 'VERSION').write_text('2.8.4\n', encoding='utf-8')
        self.original = (build_exe.WEB_ROOT, build_exe.WORK_COPY)
        build_exe.WEB_ROOT = str(self.root)
        build_exe.WORK_COPY = str(self.copy)

    def tearDown(self):
        build_exe.WEB_ROOT, build_exe.WORK_COPY = self.original

    def test_default_source_is_repo(self):
        self.assertNotIn('Tools\\Html', (ROOT / 'tools' / 'build_exe.py').read_text(encoding='utf-8').split('WEB_ROOT = ')[1].split('\n')[0])

    def test_same_page_passes(self):
        self.assertIsNone(build_exe.check_sources())

    def test_diverged_page_aborts_with_both_paths(self):
        (self.copy / 'settlement-workbench.html').write_text('<html>旧页面</html>', encoding='utf-8')
        problem = build_exe.check_sources()
        self.assertIsNotNone(problem)
        self.assertIn('不一致', problem)
        self.assertIn(str(self.root), problem)
        self.assertIn(str(self.copy), problem)

    def test_page_has_no_hardcoded_version(self):
        page = (ROOT / 'settlement-workbench.html').read_text(encoding='utf-8')
        self.assertIn('const APP_VERSION = window.SETTLEMENT_VERSION', page)
        self.assertNotIn("const APP_VERSION = '2.8.3'", page)
        self.assertIn('assets/version.js', page)

    def test_version_file_matches_js(self):
        version = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
        js = (ROOT / 'assets' / 'version.js').read_text(encoding='utf-8')
        self.assertIn("window.SETTLEMENT_VERSION = '%s'" % version, js)

    def test_npm_units_manifest_matches_files(self):
        import json
        manifest = json.loads((ROOT / 'tests' / 'suites.json').read_text(encoding='utf-8'))
        for suite in manifest['unit'] + manifest['ui']:
            self.assertTrue((ROOT / 'tests' / suite['file']).is_file(), '清单里缺文件：%s' % suite['file'])


if __name__ == '__main__':
    unittest.main()
