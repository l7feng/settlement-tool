"""4.8 服务端最小断言：坏结构必须拒写，且原文件保持不动。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from workspace_store import WorkspaceStore

VALID = json.dumps({'prices': {'A': {'per_min': 78}}, 'projects': [
    {'name': '示例剧甲', 'grade': 'C', 'type': '正式', 'mode': '按时长', 'path': 'D:/示例',
     'episodes': {'5': {'date': '2026-08-14', 'duration': '00:01:41'}}}]}, ensure_ascii=False)


class LedgerValidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = WorkspaceStore(self.tmp.name)

    def test_valid_ledger_saved(self):
        saved = self.store.save(0, {'settlement_v1': VALID})
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(json.loads(self.store.read()['storage']['settlement_v1'])['projects'][0]['name'], '示例剧甲')

    def test_broken_json_rejected_and_file_untouched(self):
        self.store.save(0, {'settlement_v1': VALID})
        before = self.store.path.read_bytes()
        with self.assertRaises(ValueError) as ctx:
            self.store.save(1, {'settlement_v1': '{not json'})
        self.assertIn('合法 JSON', str(ctx.exception))
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.store.read()['revision'], 1)

    def test_projects_must_be_array(self):
        with self.assertRaises(ValueError) as ctx:
            self.store.save(0, {'settlement_v1': '{"projects":{}}'})
        self.assertIn('projects 必须是数组', str(ctx.exception))
        self.assertFalse(self.store.path.exists())

    def test_record_must_be_object(self):
        bad_record = '{"projects":[{"name":"甲","episodes":{"5":"x"}}]}'
        with self.assertRaises(ValueError) as ctx:
            self.store.save(0, {'settlement_v1': bad_record})
        self.assertIn('记录必须是对象', str(ctx.exception))
        bad_name = '{"projects":[{"name":5,"episodes":{}}]}'
        with self.assertRaises(ValueError) as ctx:
            self.store.save(0, {'settlement_v1': bad_name})
        self.assertIn('name 必须是字符串', str(ctx.exception))

    def test_record_cap(self):
        episodes = {str(i): {'date': '2026-08-14', 'duration': '00:01:00'} for i in range(WorkspaceStore.MAX_RECORDS + 1)}
        too_many = json.dumps({'projects': [{'name': '甲', 'episodes': episodes}]})
        with self.assertRaises(ValueError) as ctx:
            self.store.save(0, {'settlement_v1': too_many})
        self.assertIn('记录数超出上限', str(ctx.exception))

    def test_patch_also_validates(self):
        self.store.save(0, {'settlement_v1': VALID})
        before = self.store.path.read_bytes()
        with self.assertRaises(ValueError):
            self.store.patch(1, {'settlement_v1': '[1,2,3]'})
        self.assertEqual(self.store.path.read_bytes(), before)

    def test_profile_ledger_validated(self):
        profile = 'settlement_v1_profile_work2'
        with self.assertRaises(ValueError):
            self.store.save(0, {profile: '{"projects":"x"}'})
        self.assertFalse(self.store.path.exists())

    def test_legacy_preserve_stays_lenient(self):
        # 迁移来的旧浏览器值可能本身就是坏账本：只保证键合法，坏内容原样留存。
        legacy = {'settlement_v1': 'broken-legacy'}
        self.store.preserve_legacy(legacy)
        blobs = [p for p in Path(self.tmp.name).glob('workspace.browser-before-*.json')]
        self.assertEqual(len(blobs), 1)


if __name__ == '__main__':
    unittest.main()
