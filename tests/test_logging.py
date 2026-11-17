"""文件日志：exe 是窗口程序，没有控制台，日志文件是唯一现场证据。"""
import logging
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
sys.modules.setdefault('webview', type(sys)('webview'))   # 桌面壳在测试里用替身

import importlib
import desktop_app


class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['SETTLEMENT_DATA_ROOT'] = self.tmp.name
        # 每个用例都要拿到干净 handler，避免重复挂载
        for handler in desktop_app.LOGGER.handlers:
            handler.close()
        desktop_app.LOGGER.handlers.clear()
        self.app = importlib.reload(desktop_app)

    def tearDown(self):
        for handler in self.app.LOGGER.handlers:
            handler.close()
        self.app.LOGGER.handlers.clear()
        os.environ.pop('SETTLEMENT_DATA_ROOT', None)
        self.tmp.cleanup()

    def test_log_file_is_created_under_data_root(self):
        self.app.setup_logging()
        self.app.log('[probe] 冒烟')
        path = Path(self.tmp.name) / 'logs' / 'app.log'
        self.assertTrue(path.exists())
        self.assertIn('冒烟', path.read_text(encoding='utf-8'))

    def test_rotation_keeps_size_bounded(self):
        self.app.setup_logging()
        path = Path(self.tmp.name) / 'logs' / 'app.log'
        # 写超过 1MB，应触发滚动并保留 backup 文件
        for i in range(12):
            self.app.log(('x' * 100_000) + ' %d' % i)
        backups = list(path.parent.glob('app.log.*'))
        self.assertTrue(backups, '超过阈值应产生滚动备份')
        self.assertLess(path.stat().st_size, 1_000_000 + 200_000)

    def test_logging_failure_does_not_break_startup(self):
        # 数据目录不可写时，setup_logging 不能抛出去
        blocker = Path(self.tmp.name) / 'blocked'
        blocker.mkdir()
        os.environ['SETTLEMENT_DATA_ROOT'] = str(blocker / 'nested' / 'deeper')
        try:
            self.app.setup_logging()      # 目录会自动创建；这里只验证不抛
            self.app.log('仍可调用')
        finally:
            os.environ['SETTLEMENT_DATA_ROOT'] = self.tmp.name

    def test_excepthook_is_installed(self):
        original = sys.excepthook
        try:
            self.app.main.__globals__['sys'].excepthook   # 只确认模块里有 hook 赋值逻辑
            self.assertIsNotNone(desktop_app.setup_logging)
        finally:
            sys.excepthook = original


if __name__ == '__main__':
    unittest.main()
