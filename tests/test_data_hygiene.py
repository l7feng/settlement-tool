"""数据目录自清洁：只清本工具自己的垃圾（迁移副本 / 调试 profile / 过期快照 / 孤儿 blob / 旧日志）。"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import data_hygiene


def older(path, seconds):
    stamp = time.time() - seconds
    os.utime(path, (stamp, stamp))


class HygieneTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _migrate_copies(self, count):
        made = []
        for i in range(count):
            p = self.root / ('workspace.browser-before-%016x.json' % i)
            p.write_text('{"storage":{}}', encoding='utf-8')
            older(p, (count - i) * 3600)          # i 越大越老
            made.append(p)
        return made

    def test_keeps_newest_three_migration_copies(self):
        made = self._migrate_copies(6)           # 下标越大越老 → 最新三份是末尾三个
        victims = data_hygiene.plan(self.root)
        removed = {str(p) for p, _, _ in victims}
        keep = {str(p) for p in made[-3:]}
        self.assertTrue(keep.isdisjoint(removed), '最新 3 份必须保留')
        self.assertEqual(len(removed), 3)
        n, freed, failures = data_hygiene.apply(victims)
        self.assertEqual((n, failures), (3, []))
        self.assertGreater(freed, 0)
        for p in made[:3]:
            self.assertFalse(p.exists())
        for p in made[-3:]:
            self.assertTrue(p.exists())

    def test_stale_webview_profile_dirs_are_removed_only_when_old(self):
        fresh = self.root / 'webview-data.bak-test-new'
        fresh.mkdir()
        (fresh / 'x.bin').write_text('x' * 100, encoding='utf-8')
        old = self.root / 'webview-data.bak-test-old'
        old.mkdir()
        (old / 'x.bin').write_text('y' * 200, encoding='utf-8')
        older(old, 40 * 86400)
        live = self.root / 'webview-data'
        live.mkdir()
        (live / 'x.bin').write_text('z', encoding='utf-8')

        victims = data_hygiene.plan(self.root)
        names = {p.name for p, _, _ in victims}
        self.assertIn('webview-data.bak-test-old', names)
        self.assertNotIn('webview-data.bak-test-new', names)
        self.assertNotIn('webview-data', names, '正在使用的 profile 绝不能被清')
        data_hygiene.apply(victims)
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())
        self.assertTrue(live.exists())

    def test_snapshot_ring_keeps_newest(self):
        snap_dir = self.root / 'snapshots'
        snap_dir.mkdir()
        for rev in (1, 2, 3, 7, 9):
            p = snap_dir / ('workspace.r%d.json' % rev)
            p.write_text('{}', encoding='utf-8')
            older(p, (9 - rev) * 3600)
        victims = data_hygiene.plan(self.root, snapshot_keep=2)
        removed = [p.name for p, _, _ in victims]
        self.assertEqual(set(removed), {'workspace.r1.json', 'workspace.r2.json', 'workspace.r3.json'})

    def test_orphan_upgrade_blobs_removed_referenced_kept(self):
        upgrade = self.root / 'upgrade'
        upgrade.mkdir()
        referenced = upgrade / 'ref-aaaa.json.gz'
        orphan = upgrade / 'orph-bbbb.json.gz'
        for p in (referenced, orphan):
            p.write_bytes(b'x')
        (self.root / 'workspace.json').write_text(json.dumps({
            'formatVersion': 1, 'app': 'settlement-workbench', 'revision': 3,
            'storage': {'settlement-upgrade-snapshots-v1': json.dumps({
                'formatVersion': 1, 'snapshots': [{'id': 'a', 'appVersion': '2.8.3',
                 'createdAt': '2026-11-16T00:00:00.000Z', 'file': 'ref-aaaa.json.gz'}]})},
        }), encoding='utf-8')
        victims = data_hygiene.plan(self.root)
        self.assertEqual([p.name for p, _, _ in victims], ['orph-bbbb.json.gz'])
        data_hygiene.apply(victims)
        self.assertTrue(referenced.exists())
        self.assertFalse(orphan.exists())

    def test_ledger_and_user_files_are_never_touched(self):
        (self.root / 'workspace.json').write_text('{"storage":{}}', encoding='utf-8')
        (self.root / 'workspace.previous.json').write_text('{}', encoding='utf-8')
        (self.root / '短剧混音结算.xlsx').write_bytes(b'user data')
        (self.root / 'settlement-workspace-2026-10-28.json').write_text('{}', encoding='utf-8')
        victims = data_hygiene.plan(self.root)
        self.assertEqual(victims, [], '账本、导出文件、用户文档都不在清理范围内')

    def test_dry_run_does_not_delete(self):
        made = self._migrate_copies(5)
        result = data_hygiene.run(self.root, dry_run=True)
        self.assertTrue(result['dry_run'])
        self.assertEqual(result['files'], 2)
        for p in made:
            self.assertTrue(p.exists(), 'dry_run 不得删除任何文件')

    def test_old_log_volumes_removed_recent_kept(self):
        logs = self.root / 'logs'
        logs.mkdir()
        old_log = logs / 'app.log.1'
        old_log.write_text('old', encoding='utf-8')
        older(old_log, 20 * 86400)
        new_log = logs / 'app.log.2'
        new_log.write_text('new', encoding='utf-8')
        current = logs / 'app.log'
        current.write_text('cur', encoding='utf-8')
        victims = data_hygiene.plan(self.root)
        self.assertEqual([p.name for p, _, _ in victims], ['app.log.1'])
        data_hygiene.apply(victims)
        self.assertTrue(new_log.exists() and current.exists())

    def test_crash_dumps_trimmed_to_newest(self):
        crash = self.root / 'webview-data' / 'EBWebView' / 'Crashpad' / 'reports'
        crash.mkdir(parents=True)
        made = []
        for i in range(6):
            p = crash / ('crash-%d.dmp' % i)
            p.write_bytes(b'd' * 1000)
            older(p, (i + 1) * 10 * 86400)   # i 越大越老，且全部超过 7 天阈值
            made.append(p)
        victims = data_hygiene.plan(self.root)
        self.assertEqual(len(victims), 3, '6 份里只留最近 3 份')
        data_hygiene.apply(victims)
        for p in made[:3]:
            self.assertTrue(p.exists(), '最近 3 份必须保留')
        for p in made[3:]:
            self.assertFalse(p.exists())

    def test_fresh_crash_dump_is_kept_even_if_over_count(self):
        crash = self.root / 'webview-data' / 'EBWebView' / 'Crashpad' / 'reports'
        crash.mkdir(parents=True)
        fresh = crash / 'crash-new.dmp'
        fresh.write_bytes(b'd')
        victims = data_hygiene.plan(self.root)
        self.assertEqual(victims, [], '7 天内的崩溃转储先留着，便于排查')


if __name__ == '__main__':
    unittest.main()
