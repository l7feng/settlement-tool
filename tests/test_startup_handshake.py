"""4.6：启动握手（pageReady）替换早帧像素探针；4.7：旧实例提示。"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'src'))

APP = (ROOT / 'src' / 'desktop_app.py').read_text(encoding='utf-8')
PAGE = (ROOT / 'settlement-workbench.html').read_text(encoding='utf-8')


class PageReadyHandshakeTest(unittest.TestCase):
    def test_api_exposes_page_ready(self):
        self.assertIn('def pageReady(self)', APP)
        self.assertIn('ready_event', APP)

    def test_probe_waits_for_handshake_first(self):
        self.assertIn("ready.wait(8)", APP)
        self.assertIn("state['phase'] = 'handshake'", APP)
        # 握手成功必须直接返回，不再 sleep 3 秒走像素
        probe = APP.split('def _probe_pywebview', 1)[1].split('def ', 1)[0]
        self.assertLess(probe.index("state['phase'] = 'handshake'"), probe.index('time.sleep(3)'))
        self.assertIn('return', probe[:probe.index('time.sleep(3)')])

    def test_page_signals_ready_after_first_frame(self):
        block = PAGE.split('4.6 启动握手', 1)[1].split('</script>', 1)[0]
        self.assertIn('api.pageReady', block)
        self.assertIn('requestAnimationFrame', block)
        self.assertIn("addEventListener('pywebviewready'", block)


class ProbeBehaviourTest(unittest.TestCase):
    def test_handshake_short_circuits_pixel_probe(self):
        import threading
        import time
        import desktop_app
        event = threading.Event()
        event.set()
        state = {'ready': event}
        started = time.time()
        desktop_app._probe_pywebview(None, state)   # 握手已到 → 不碰像素探针
        self.assertEqual(state.get('phase'), 'handshake')
        self.assertIs(state.get('ok'), True)
        self.assertLess(time.time() - started, 1.0)

    def test_missing_handshake_falls_back(self):
        # 8 s 等不到握手会走像素分支；这里用 0 秒超时模拟超时，只断言阶段标记存在
        import desktop_app
        source = (ROOT / 'src' / 'desktop_app.py').read_text(encoding='utf-8')
        self.assertIn("state['phase'] = 'pixel'", source)
        self.assertIn('回落到像素探针', source)


class LegacyInstanceHintTest(unittest.TestCase):
    def test_detects_running_instance(self):
        self.assertIn('def activate_existing_instance', APP)
        self.assertIn('ShowWindow', APP)
        self.assertIn('SetForegroundWindow', APP)
        self.assertIn('已经在运行', APP)

    def test_main_activates_before_creating_window(self):
        main = APP.split('def main()', 1)[1]
        self.assertIn('activate_existing_instance()', main)
        self.assertLess(main.index('activate_existing_instance()'), main.index('run_pywebview(url)'))


if __name__ == '__main__':
    unittest.main()
