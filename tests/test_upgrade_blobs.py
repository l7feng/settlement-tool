"""升级前快照原文外置：账本只留索引，原文 gzip 落 upgrade/ 目录。

背景：现役账本 5.96MB 里 3.91MB（70%）是 20 份内联的升级前快照原文，
每次保存都要整份重写一遍。这里验证搬出后账本缩身、原文可取回、份数受控。
"""
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from workspace_store import WorkspaceStore, UPGRADE_KEY, UPGRADE_KEEP


def history(count, size=4000):
    """造一份与前端同构的升级快照历史：数组首位是最新一份。"""
    snapshots = []
    for i in range(count):
        version = '2.%d.0' % (count - i)
        snapshots.append({
            'id': '%s-2026-11-%02dT00:00:00.000Z' % (version, i + 1),
            'appVersion': version,
            'createdAt': '2026-11-%02dT00:00:00.000Z' % (i + 1),
            'raw': {'settlement_v1': '{"projects":[]}' + 'x' * size,
                    'settlement-theme': 'paper',
                    'settlement_v1_profile_job': 'null'},
        })
    return {'formatVersion': 1, 'currentVersion': '2.%d.0' % count, 'snapshots': snapshots}


class UpgradeBlobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = WorkspaceStore(self.root)
        self.store.save(0, {'settlement_v1': '{"projects":[]}', 'settlement-theme': 'dark'})

    def tearDown(self):
        self.tmp.cleanup()

    def _seed(self, count, size=4000):
        self.store.patch(1, {UPGRADE_KEY: json.dumps(history(count, size), ensure_ascii=False)})
        return json.loads(self.store.read()['storage'][UPGRADE_KEY])

    def test_inline_raw_moves_to_gzip_files_and_shrinks_ledger(self):
        index = self._seed(6)
        self.assertEqual(len(index['snapshots']), UPGRADE_KEEP)
        for entry in index['snapshots']:
            self.assertNotIn('raw', entry)
            self.assertRegex(entry['file'], r'\.json\.gz$')
            self.assertTrue((self.root / 'upgrade' / entry['file']).exists())
        # 账本里不再有 4000 字符的原文，体积必然小于一份原文。
        ledger = self.store.read()['storage'][UPGRADE_KEY]
        self.assertLess(len(ledger), 4000)

    def test_blob_round_trip_keeps_exact_bytes(self):
        index = self._seed(2)
        entry = index['snapshots'][0]
        text = self.store.read_upgrade_blob(entry['file'])
        self.assertEqual(hashlib.sha256(text.encode('utf-8')).hexdigest(), entry['sha256'])
        self.assertEqual(len(text.encode('utf-8')), entry['bytes'])
        self.assertIn('settlement_v1_profile_job', json.loads(text))

    def test_pruned_blobs_are_deleted_from_disk(self):
        self._seed(6)
        kept = {p.name for p in (self.root / 'upgrade').glob('*.json.gz')}
        self.assertEqual(len(kept), UPGRADE_KEEP)
        index = json.loads(self.store.read()['storage'][UPGRADE_KEY])
        self.assertEqual({e['file'] for e in index['snapshots']}, kept)

    def test_repeat_write_is_idempotent(self):
        self._seed(3)
        before = self.store.read()['storage'][UPGRADE_KEY]
        # 前端仍内联发送整份历史：再落一次不应产生新 revision 之外的变化。
        self.store.patch(self.store.read()['revision'], {UPGRADE_KEY: json.dumps(history(3), ensure_ascii=False)})
        after = self.store.read()['storage'][UPGRADE_KEY]
        self.assertEqual(json.loads(before)['snapshots'], json.loads(after)['snapshots'])

    def test_blob_name_whitelist_blocks_traversal(self):
        self._seed(1)
        for name in ('../workspace.json', 'C:/Windows/x.json.gz', 'x.txt', ''):
            with self.assertRaises(ValueError):
                self.store.read_upgrade_blob(name)

    def test_missing_blob_reports_not_found(self):
        with self.assertRaises(FileNotFoundError):
            self.store.read_upgrade_blob('nothing-abcdef0123456789.json.gz')

    def test_corrupt_history_is_left_untouched(self):
        self.store.patch(1, {UPGRADE_KEY: '{not json'})
        self.assertEqual(self.store.read()['storage'][UPGRADE_KEY], '{not json')

    def test_migrate_upgrades_is_idempotent_and_keeps_ledger(self):
        self._seed(4)
        self.assertFalse(self.store.migrate_upgrades())          # 已外置，无需再动
        self.assertEqual(self.store.read()['storage']['settlement_v1'], '{"projects":[]}')
        self.assertEqual(len(list((self.root / 'upgrade').glob('*.json.gz'))), UPGRADE_KEEP)

    def test_migrate_upgrades_converts_legacy_inline_file(self):
        # 模拟旧版直接写在文件里的内联历史（不经过 patch 归一）。
        raw = self.store.read()
        raw['storage'][UPGRADE_KEY] = json.dumps(history(5), ensure_ascii=False)
        (self.root / 'workspace.json').write_text(json.dumps(raw, ensure_ascii=False, indent=2) + '\n',
                                                 encoding='utf-8')
        self.assertTrue(self.store.migrate_upgrades())
        index = json.loads(self.store.read()['storage'][UPGRADE_KEY])
        self.assertEqual(len(index['snapshots']), UPGRADE_KEEP)
        self.assertNotIn('raw', index['snapshots'][0])
        gz = self.root / 'upgrade' / index['snapshots'][0]['file']
        self.assertTrue(gz.exists())
        with gzip.open(gz, 'rb') as fh:
            self.assertIn('settlement_v1', json.loads(fh.read().decode('utf-8')))


if __name__ == '__main__':
    unittest.main()
