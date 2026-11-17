import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from workspace_store import WorkspaceStore


class ChangeJournalTests(unittest.TestCase):
    """S2-2.9：变更日志 + 重启后一次撤销（用 r(rev-1) 快照，不额外复制整本账）。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = WorkspaceStore(self.tmp.name)
        self.store.save(0, {'settlement_v1': '{"projects":[]}', 'settlement-theme': 'dark'})

    def test_journal_records_last_change(self):
        self.store.patch(1, {'settlement_v1': '{"projects":[{"name":"A"}]}'}, label='登记')
        journal = self.store.last_change()
        self.assertEqual(journal['revision'], self.store.read()['revision'])
        self.assertEqual(journal['label'], '登记')
        self.assertIn('settlement_v1', journal['keys'])
        # 设置类写入也要过一遍日志，但不该出现在业务键清单里
        self.store.patch(self.store.read()['revision'], {'settlement-theme': 'warm'}, label='换主题')
        self.assertEqual(self.store.last_change()['keys'], [])

    def test_previous_state_matches_state_before_last_change(self):
        before = {'settlement_v1': '{"projects":[]}', 'settlement-theme': 'dark'}
        self.store.patch(1, {'settlement_v1': '{"projects":[{"name":"A"}]}'})
        previous = self.store.previous_state()
        self.assertEqual(previous['storage'], before, '撤销要拿到的就是这次变更前的整份内容')

    def test_journal_is_one_shot(self):
        self.store.patch(1, {'settlement_v1': '{"projects":[{"name":"B"}]}'}, label='导入')
        self.assertTrue(self.store.consume_last_change())
        self.assertIsNone(self.store.last_change(), '用掉之后不能再撤销第二次')
        self.assertFalse(self.store.consume_last_change())

    def test_snapshot_keeps_recovery_ledgers(self):
        """快照含 recovery / 成片恢复键，回滚时才不会把这些数据漏掉。"""
        values = {'settlement_v1': '{"projects":[]}', 'settlement_recovery_v2': '{"finalCuts":[]}',
                  'settlement-theme': 'dark'}
        self.store.save(1, values)
        saved = self.store.patch(2, {'settlement_v1': '{"projects":[{"name":"C"}]}'})
        snapshot = json.loads((self.store.snapshot_dir / ('workspace.r%d.json' % saved['revision'])).read_text(encoding='utf-8'))
        self.assertEqual(snapshot['storage']['settlement_recovery_v2'], '{"finalCuts":[]}')

    def test_previous_state_survives_without_snapshot(self):
        """上一个版本只是设置类写入（没留快照）时，退回 previous.json，仍然能撤销。"""
        revision = self.store.read()['revision']
        self.store.patch(revision, {'settlement-theme': 'warm'})
        previous = self.store.previous_state()
        self.assertIsNotNone(previous)
        self.assertIn('settlement_v1', previous['storage'])


class CapabilityPayloadTests(unittest.TestCase):
    """S2-2.8/2.9：接口要声明能力，并回执 lastChange 让前端知道能不能撤销。"""

    def test_desktop_app_exposes_undo_payload(self):
        source = (Path(__file__).resolve().parents[1] / 'src' / 'desktop_app.py').read_text(encoding='utf-8')
        self.assertIn("saved['lastChange'] = last", source)
        self.assertIn("'consume-last-change'", source)
        self.assertIn('/__workspace_previous__', source)


if __name__ == '__main__':
    unittest.main()
