import importlib.util
import sys
import unittest
from pathlib import Path

# 直接加载 desktop_app 会 import webview；这里只测纯函数，用轻量替身避开窗口依赖。
sys.modules.setdefault('webview', type(sys)('webview'))

repo = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo / 'src'))


def load_desktop_app():
    spec = importlib.util.spec_from_file_location('desktop_app_export', repo / 'src' / 'desktop_app.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExportNameTests(unittest.TestCase):
    """save_file 只接受「纯文件名 + 白名单扩展名」，防止被当成任意写盘入口。"""

    @classmethod
    def setUpClass(cls):
        cls.app = load_desktop_app()

    def test_keeps_normal_name(self):
        self.assertEqual(self.app.Api.safe_export_name('结算备份-20261117.json'), '结算备份-20261117.json')

    def test_strips_directory_parts(self):
        for raw in (r'..\..\evil.json', '../../evil.json', r'C:\Windows\evil.json', '/tmp/evil.json'):
            self.assertEqual(self.app.Api.safe_export_name(raw), 'evil.json')

    def test_rejects_unknown_extension(self):
        for raw in ('evil.exe', 'evil.bat', 'evil.ps1', 'evil.json.exe'):
            with self.assertRaisesRegex(ValueError, '不支持的导出文件类型'):
                self.app.Api.safe_export_name(raw)

    def test_rejects_empty_and_control_chars(self):
        for raw in ('', '   ', '...', 'noext', '\x00.json', 'a\x01b.json'):
            with self.assertRaisesRegex(ValueError, '导出文件名无效'):
                self.app.Api.safe_export_name(raw)

    def test_truncates_long_name_but_keeps_extension(self):
        name = self.app.Api.safe_export_name('长' * 200 + '.json')
        self.assertTrue(name.endswith('.json'))
        self.assertLessEqual(len(name), 120)


if __name__ == '__main__':
    unittest.main(verbosity=2)
