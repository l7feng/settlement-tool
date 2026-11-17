"""4.9 数据完整性三件套：sha256 校验、坏文件隔离 + 快照恢复、每周 zip 备份。"""
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from workspace_store import WorkspaceStore

LEDGER = json.dumps({'prices': {}, 'projects': [{'name': '示例剧甲', 'episodes': {}}]}, ensure_ascii=False)


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = WorkspaceStore(self.tmp.name)

    def test_digest_written_after_save(self):
        self.store.save(0, {'settlement_v1': LEDGER})
        sidecar = Path(self.tmp.name) / WorkspaceStore.INTEGRITY_SIDECAR
        self.assertTrue(sidecar.exists())
        digest = sidecar.read_text(encoding='utf-8').split()[0]
        self.assertEqual(digest, hashlib.sha256(self.store.path.read_bytes()).hexdigest())

    def test_truncated_file_is_quarantined_and_recovered(self):
        self.store.save(0, {'settlement_v1': LEDGER})
        self.store.save(1, {'settlement_v1': LEDGER, 'settlement-theme': 'dark'})
        raw = self.store.path.read_bytes()
        self.store.path.write_bytes(raw[:len(raw) // 2])      # 截断＝结构损坏
        value = self.store.read()
        self.assertEqual(value['storage']['settlement-theme'], 'dark')
        self.assertTrue(any(Path(self.tmp.name).glob('workspace.corrupt-*.json')), '坏文件没有被隔离')

    def test_external_write_is_redetected_and_restamped(self):
        # 旧版本程序不会更新侧车；内容仍可解析时必须接受并重新登记，不能当坏文件隔离。
        self.store.save(0, {'settlement_v1': LEDGER})
        value = self.store.read()
        value['revision'] += 1
        value['storage']['settlement-theme'] = 'external'
        raw = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        self.store.path.write_bytes(raw)
        self.assertEqual(self.store.read()['storage']['settlement-theme'], 'external')
        digest = (Path(self.tmp.name) / WorkspaceStore.INTEGRITY_SIDECAR).read_text(encoding='utf-8').split()[0]
        self.assertEqual(digest, hashlib.sha256(raw).hexdigest())
        self.assertFalse(any(Path(self.tmp.name).glob('workspace.corrupt-*.json')))

    def test_missing_snapshots_raises_with_hint(self):
        self.store.save(0, {'settlement_v1': LEDGER})
        for snapshot in (Path(self.tmp.name) / 'snapshots').glob('workspace.r*.json'):
            snapshot.unlink()
        self.store.path.write_bytes(self.store.path.read_bytes()[:40])   # 截断且无快照可退
        with self.assertRaises(ValueError) as ctx:
            self.store.read()
        self.assertIn('校验失败', str(ctx.exception))
        self.assertIn('备份恢复', str(ctx.exception))

    def test_legacy_library_without_sidecar_reads_and_backfills(self):
        # 手工造一份「老库」：有账本无侧车
        raw = (json.dumps({'formatVersion': 1, 'app': 'settlement-workbench', 'revision': 3,
                           'storage': {'settlement_v1': LEDGER}}, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        self.store.path.write_bytes(raw)
        self.assertEqual(self.store.read()['revision'], 3)
        self.assertTrue(self.store.ensure_digest())
        self.assertTrue((Path(self.tmp.name) / WorkspaceStore.INTEGRITY_SIDECAR).exists())

    def test_weekly_backup_once_per_week_and_prune(self):
        self.store.save(0, {'settlement_v1': LEDGER})
        first = self.store.weekly_backup(now=datetime(2026, 11, 16))
        self.assertIsNotNone(first)
        self.assertIsNone(self.store.weekly_backup(now=datetime(2026, 11, 17)), '同一周重复备份')
        for week in range(10):
            self.store.weekly_backup(now=datetime(2026, 1, 5) + timedelta(weeks=week))
        zips = sorted((Path(self.tmp.name) / WorkspaceStore.BACKUP_DIR).glob('workspace-*-W*.zip'))
        self.assertLessEqual(len(zips), WorkspaceStore.WEEKLY_KEEP)

    def test_backup_zip_contains_ledger(self):
        import zipfile
        self.store.save(0, {'settlement_v1': LEDGER})
        target = self.store.weekly_backup(now=datetime(2026, 11, 16))
        with zipfile.ZipFile(target) as archive:
            self.assertIn('workspace.json', archive.namelist())
            self.assertIn('示例剧甲', archive.read('workspace.json').decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
