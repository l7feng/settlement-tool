"""只使用临时合成数据验证 SQLite 演练，不读用户配置。"""
import copy
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'tools' / 'sqlite_rehearsal.py'
spec = importlib.util.spec_from_file_location('sqlite_rehearsal', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def sample():
    return {'schemaVersion': 2, 'customRoot': {'中文': '完整保留'},
            'prices': {grade: {'per_min': 10, 'per_ep': 12.50} for grade in 'ABCD'},
            'projects': [{'id': 'project-alpha', 'name': '兔子新娘', 'aliases': ['兔新娘'],
                          'shortName': '兔新娘', 'customProject': ['甲', '乙'],
                          'grade': 'D', 'mode': '按时长', 'type': '正式',
                          'episodes': {
                              '1': {'recordId': 'record-alpha', 'date': '2026-10-12', 'duration': '00:01:01', 'workType': '混音', 'label': '第一集'},
                              '2': {'date': '2026-10-12', 'duration': '00:02:00', 'workType': '修改'},
                              'Demo预览': {'date': '2026-10-12', 'duration': '00:01:00', 'mode': '按集', 'type': 'Demo'},
                          }}]}


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / '来源中文.json'
        self.database = self.root / '演练.sqlite'
        self.write(sample())

    def tearDown(self):
        self.temp.cleanup()

    def write(self, data):
        self.source.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

    def preview(self):
        return module.preview(self.source, '合成来源-甲')

    def commit(self, **kwargs):
        return module.read_commit(self.source, self.database, '合成来源-甲', **kwargs)

    def test_preview_no_writes_and_money(self):
        output = self.preview()
        self.assertTrue(output['ok'])
        self.assertEqual((output['project_count'], output['record_count'], output['amount_cents']), (1, 3, 2267))
        self.assertFalse(self.database.exists())
        self.assertEqual(output['export']['projects'][0]['id'], 'project-alpha')

    def test_source_bytes_and_unknown_fields(self):
        raw = self.source.read_bytes()
        expected = self.preview()['export']
        self.commit()
        self.assertEqual(module.reexport(self.database, original=True), raw)
        self.assertEqual(module.reexport(self.database), expected)
        self.assertEqual(expected['projects'][0]['shortName'], '兔新娘')

    def test_old_identity_deterministic(self):
        data = sample()
        del data['projects'][0]['id']
        del data['projects'][0]['episodes']['1']['recordId']
        self.write(data)
        first = self.preview()['export']
        self.assertEqual(first, self.preview()['export'])
        other = module.preview(self.source, '另一个来源')['export']
        self.assertNotEqual(first['projects'][0]['id'], other['projects'][0]['id'])

    def test_backup_envelope_round_trip(self):
        self.write({'formatVersion': 2, 'app': 'settlement-workbench', 'exportedAt': '2026-10-12', 'extra': '原元数据', 'data': sample()})
        expected = self.preview()['export']
        self.commit()
        self.assertEqual(module.reexport(self.database), expected)

    def test_repeat_import_idempotent_and_read_only(self):
        self.assertFalse(self.commit()['repeated'])
        before = self.database.read_bytes()
        self.assertTrue(self.commit()['repeated'])
        self.assertEqual(before, self.database.read_bytes())
        with closing(sqlite3.connect(self.database)) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM records').fetchone()[0], 3)

    def test_different_source_refused(self):
        self.commit()
        before = self.database.read_bytes()
        with self.assertRaises(module.MigrationError):
            module.read_commit(self.source, self.database, '另一个来源')
        self.assertEqual(self.database.read_bytes(), before)

    def test_same_source_changed_content_refused(self):
        self.commit()
        data = sample()
        data['projects'][0]['name'] = '更名'
        self.write(data)
        with self.assertRaises(module.MigrationError):
            self.commit()

    def test_existing_unknown_target_never_overwritten(self):
        self.database.write_bytes(b'EXISTING')
        with self.assertRaises(module.MigrationError):
            self.commit()
        self.assertEqual(self.database.read_bytes(), b'EXISTING')

    def test_rounding_difference_prevents_commit(self):
        data = sample()
        data['prices']['A']['per_min'] = 10.005
        self.write(data)
        output = self.preview()
        self.assertFalse(output['ok'])
        self.assertEqual(output['price_differences'][0]['proposed'], '10.01')
        with self.assertRaises(module.MigrationError):
            self.commit()
        self.assertFalse(self.database.exists())

    def test_duplicate_ids_refused(self):
        data = sample()
        data['projects'][0]['episodes']['2']['recordId'] = 'record-alpha'
        self.write(data)
        with self.assertRaises(module.MigrationError):
            self.preview()

    def test_project_alias_conflict_refused(self):
        data = sample()
        other = copy.deepcopy(data['projects'][0])
        other['name'] = '第二部'
        other['id'] = 'second-project'
        data['projects'].append(other)
        self.write(data)
        with self.assertRaises(module.MigrationError):
            self.preview()

    def test_invalid_json_and_duplicate_keys(self):
        for raw in (b'{broken', b'{"prices":{},"prices":{},"projects":[]}', b'{"a":NaN}'):
            self.source.write_bytes(raw)
            with self.assertRaises(module.MigrationError):
                self.preview()

    def test_invalid_dates_and_flags(self):
        for field, value in (('date', '2026-02-30'), ('duration', '00:99:00'), ('excluded', 'false')):
            data = sample()
            data['projects'][0]['episodes']['1'][field] = value
            self.write(data)
            with self.assertRaises(module.MigrationError):
                self.preview()

    def test_transaction_failure_rolls_back(self):
        def fail(conn):
            conn.execute('INSERT INTO records VALUES(?,?,?,?,?)', ('record-alpha', 'project-alpha', 'bad', 0, '{}'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.commit(_before_commit=fail)
        with closing(sqlite3.connect(self.database)) as conn:
            self.assertEqual(conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [])
            self.assertEqual(conn.execute('PRAGMA user_version').fetchone()[0], 0)

    def test_write_failure_missing_directory(self):
        with self.assertRaises(OSError):
            module.read_commit(self.source, self.root / '不存在' / 'out.sqlite', '合成来源-甲')
        self.assertFalse((self.root / '不存在').exists())

    def test_restore_to_new_database_roundtrip(self):
        self.commit()
        self.source.write_bytes(module.reexport(self.database, original=True))
        restored = self.root / '恢复新库.sqlite'
        module.read_commit(self.source, restored, '合成来源-甲')
        self.assertEqual(module.reexport(restored), module.reexport(self.database))

    def test_schema_and_amount_tampering_detected(self):
        self.commit()
        with closing(sqlite3.connect(self.database)) as conn:
            conn.execute('UPDATE records SET amount_cents=0')
            conn.commit()
        with self.assertRaises(module.MigrationError):
            module.reexport(self.database)

    def test_cli_only_explicit_paths(self):
        result = subprocess.run([sys.executable, str(MODULE), '--preview', str(self.source), '--source-id', 'CLI来源'], capture_output=True, text=True, encoding='utf-8', timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])
        self.assertFalse(self.database.exists())

    def test_javascript_rounding_preserved(self):
        data = sample()
        data['prices']['D']['per_min'] = 60.30
        data['projects'][0]['episodes'] = {'1': {'date': '2026-10-12', 'duration': '00:00:01'}}
        self.write(data)
        # JS Math.round(1 / 60 * 60.30 * 100) 为 100；Decimal 半入为 101。
        self.assertEqual(self.preview()['amount_cents'], 100)

    def test_invalid_short_name_refused(self):
        for value in ('A', '只有一个名称太长', '兔'):
            data = sample()
            data['projects'][0]['shortName'] = value
            self.write(data)
            with self.assertRaises(module.MigrationError):
                self.preview()


if __name__ == '__main__':
    unittest.main()
