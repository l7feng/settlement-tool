import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from workspace_store import WorkspaceStore


class PatchTests(unittest.TestCase):
    """2026-11-14 增量落账：只落变化的键 + 按 revision 的环形快照。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = WorkspaceStore(self.tmp.name)
        self.values = {'settlement_v1': '{"projects":[]}', 'settlement-theme': 'dark'}

    def test_patch_only_touches_changed_key(self):
        self.store.save(0, self.values)
        saved = self.store.patch(1, {'settlement-theme': 'warm'})
        self.assertEqual(saved['revision'], 2)
        self.assertEqual(self.store.read()['storage'], {**self.values, 'settlement-theme': 'warm'})
        self.assertEqual(self.store.read()['storage']['settlement_v1'], self.values['settlement_v1'])

    def test_patch_delete_key(self):
        self.store.save(0, self.values)
        saved = self.store.patch(1, {'settlement-theme': None})
        self.assertEqual(saved['revision'], 2)
        self.assertNotIn('settlement-theme', self.store.read()['storage'])

    def test_patch_noop_keeps_revision(self):
        self.store.save(0, self.values)
        saved = self.store.patch(1, {'settlement-theme': 'dark'})
        self.assertEqual(saved['revision'], 1)

    def test_patch_rejects_stale_revision(self):
        self.store.save(0, self.values)
        with self.assertRaisesRegex(ValueError, '另一个窗口'):
            self.store.patch(0, {'settlement-theme': 'warm'})
        self.assertEqual(self.store.read()['storage'], self.values)

    def test_stale_revision_carries_current_revision(self):
        """S2-2.8：冲突要带磁盘上的真实版本号，前端才能重载后重放这次改动。"""
        from workspace_store import RevisionConflict
        self.store.save(0, self.values)
        with self.assertRaises(RevisionConflict) as raised:
            self.store.patch(0, {'settlement-theme': 'warm'})
        self.assertEqual(raised.exception.revision, 1)
        # 重放：用新版本号提交同一份 patch，必须成功且只落这一处
        saved = self.store.patch(raised.exception.revision, {'settlement-theme': 'warm'})
        self.assertEqual(saved['revision'], 2)
        self.assertEqual(self.store.read()['storage']['settlement-theme'], 'warm')

    def test_capabilities_advertised(self):
        """S2-2.8：服务端要声明支持增量与冲突重放，前端据此不再猜 exe 版本。"""
        source = (Path(__file__).resolve().parents[1] / 'src' / 'desktop_app.py').read_text(encoding='utf-8')
        self.assertIn("CAPABILITIES = ['patch', 'revision-conflict-retry']", source)
        self.assertIn("'conflict': 'revision'", source)
        self.assertIn("saved['capabilities'] = CAPABILITIES", source)

    def test_patch_rejects_unmanaged_key(self):
        self.store.save(0, self.values)
        with self.assertRaisesRegex(ValueError, '工作区字段无效'):
            self.store.patch(1, {'evil_key': 'x'})

    def test_patch_accepts_workbench_list(self):
        self.store.save(0, self.values)
        saved = self.store.patch(1, {'settlement_workbenches_v1': '[{"id":"a"}]'})
        self.assertEqual(self.store.read()['storage']['settlement_workbenches_v1'], '[{"id":"a"}]')

    def test_previous_keeps_exact_bytes_after_business_patch(self):
        """业务账本变化时仍留一份写入前的完整副本（用于自救）。"""
        self.store.save(0, self.values)
        raw = self.store.path.read_bytes()
        self.store.patch(1, {'settlement_v1': '{"projects":[{"i":1}]}'})
        self.assertEqual((self.store.root / 'workspace.previous.json').read_bytes(), raw)

    def test_settings_patch_does_not_touch_previous(self):
        """设置类写入不再复制整份账本：省掉每次 5.8MB 的重复写。"""
        self.store.save(0, self.values)
        self.store.patch(1, {'settlement_v1': '{"projects":[{"i":1}]}'})
        previous = self.store.root / 'workspace.previous.json'
        before = previous.stat().st_mtime_ns, previous.read_bytes()
        self.store.patch(2, {'settlement-theme': 'warm'})
        self.assertEqual((previous.stat().st_mtime_ns, previous.read_bytes()), before)

    def test_previous_refresh_is_throttled_within_interval(self):
        """窗口内连续业务变更不重复刷新 previous，超过间隔才更新。"""
        self.store.save(0, self.values)
        self.store.patch(1, {'settlement_v1': '{"projects":[{"i":1}]}'})
        previous = self.store.root / 'workspace.previous.json'
        first = previous.read_bytes()
        self.store.patch(2, {'settlement_v1': '{"projects":[{"i":2}]}'})
        self.assertEqual(previous.read_bytes(), first)          # 5 分钟内不刷新
        old = time.time() - WorkspaceStore.PREVIOUS_MIN_INTERVAL - 1
        os.utime(previous, (old, old))
        self.store.patch(3, {'settlement_v1': '{"projects":[{"i":3}]}'})
        self.assertNotEqual(previous.read_bytes(), first)       # 过期后刷新

    def test_snapshot_ring_keeps_last_five(self):
        self.store.save(0, self.values)
        for i in range(1, 9):
            self.store.patch(i, {'settlement_v1': '{"projects":[{"i":%d}]}' % i})
        snaps = sorted((p for p in self.store.snapshot_dir.glob('workspace.r*.json')),
                       key=lambda p: int(p.name[len('workspace.r'):-len('.json')]))
        self.assertEqual(len(snaps), WorkspaceStore.SNAPSHOT_KEEP)
        latest = json.loads(snaps[-1].read_text(encoding='utf-8'))
        self.assertEqual(latest['revision'], self.store.read()['revision'])
        self.assertEqual(latest['storage']['settlement_v1'], '{"projects":[{"i":8}]}')

    def test_settings_only_patch_skips_snapshot(self):
        """主题/列宽这类高频设置不产生 400KB 快照，避免拖慢每次写入。"""
        self.store.save(0, self.values)
        before = len(list(self.store.snapshot_dir.glob('workspace.r*.json')))
        self.store.patch(1, {'settlement-theme': 'warm'})
        self.assertEqual(len(list(self.store.snapshot_dir.glob('workspace.r*.json'))), before)

    def test_full_save_still_snapshots(self):
        self.store.save(0, self.values)
        self.assertTrue((self.store.snapshot_dir / 'workspace.r1.json').exists())

    def test_patch_refuses_to_delete_ledger(self):
        """增量写入删不掉账本：删空等于丢账，必须报错且文件不动。"""
        self.store.save(0, self.values)
        raw = self.store.path.read_bytes()
        for key in ('settlement_v1', 'settlement_v1_profile_job'):
            with self.assertRaisesRegex(ValueError, '业务账本不允许'):
                self.store.patch(1, {key: None})
        self.assertEqual(self.store.path.read_bytes(), raw)
        self.assertEqual(self.store.read()['revision'], 1)

    def test_patch_can_delete_ledger_with_explicit_action(self):
        """删除账本是独立动作：显式声明后才允许，且只删指定的一个键。"""
        self.store.save(0, {**self.values, 'settlement_v1_profile_job': '{"projects":[]}'})
        saved = self.store.patch(1, {'settlement_v1_profile_job': None}, allow_business_delete=True)
        self.assertEqual(saved['revision'], 2)
        self.assertNotIn('settlement_v1_profile_job', self.store.read()['storage'])
        self.assertEqual(self.store.read()['storage']['settlement_v1'], self.values['settlement_v1'])

    def test_patch_still_deletes_settings_key(self):
        """设置类键仍可删除，不影响「恢复默认」这类操作。"""
        self.store.save(0, self.values)
        self.store.patch(1, {'settlement-theme': None})
        self.assertNotIn('settlement-theme', self.store.read()['storage'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
