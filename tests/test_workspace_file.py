import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from workspace_store import WorkspaceStore

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store=WorkspaceStore(self.tmp.name)
        self.values={'settlement_v1':' {"projects": [{"name": "合成项目"}]} ','settlement-theme':'dark'}
    def test_initial_and_restart(self):
        self.assertEqual(self.store.read()['revision'],0)
        self.store.save(0,self.values)
        self.assertEqual(WorkspaceStore(self.tmp.name).read()['storage'],self.values)
    def test_previous_preserves_exact_bytes(self):
        self.store.save(0,self.values);raw=self.store.path.read_bytes()
        self.store.save(1,{**self.values,'settlement-theme':'warm'})
        self.assertEqual((self.store.root/'workspace.previous.json').read_bytes(),raw)
    def test_conflict(self):
        self.store.save(0,self.values)
        with self.assertRaisesRegex(ValueError,'另一个窗口'):self.store.save(0,{})
        self.assertEqual(self.store.read()['storage'],self.values)
    def test_bad_file_preserved(self):
        self.store.path.write_bytes(b'bad original')
        with self.assertRaises(ValueError):self.store.save(0,self.values)
        self.assertEqual(self.store.path.read_bytes(),b'bad original')
    def test_failed_replace_preserves_file(self):
        self.store.save(0,self.values);raw=self.store.path.read_bytes()
        real=os.replace
        def replace(source,target):
            if Path(target)==self.store.path:raise OSError('simulated disk failure')
            return real(source,target)
        with patch('workspace_store.os.replace',side_effect=replace):
            with self.assertRaises(OSError):self.store.save(1,{})
        self.assertEqual(self.store.path.read_bytes(),raw)
        self.assertFalse((self.store.root/'workspace.json.tmp').exists())
    def test_reject_unknown_and_nonstring(self):
        for values in [{'secret':'x'},{'settlement_v1':{}}]:
            with self.assertRaises(ValueError):self.store.save(0,values)
        self.assertFalse(self.store.path.exists())
    def test_ledger_keys(self):
        values={**self.values,'settlement_v1_profile_job':'{"projects": []}'}
        self.store.save(0,values)
        self.assertEqual(self.store.read()['storage'],values)
        for bad in ('settlement_v1_profile_','settlement_v1_profile_a/b',
                    'settlement_v1_profile_'+'a'*65,'settlement_v1_profile_job.old'):
            with self.assertRaises(ValueError):self.store.validate({bad:'{}'})
    def test_different_browser_preserved_once(self):
        self.store.save(0,self.values)
        old={'settlement_v1':'old raw'}
        self.store.preserve_legacy(old);self.store.preserve_legacy(old)
        files=list(self.store.root.glob('workspace.browser-before-*.json'))
        self.assertEqual(len(files),1)
        self.assertEqual(json.loads(files[0].read_text(encoding='utf-8'))['storage'],old)
    def test_interrupted_journal_roundtrip(self):
        values={**self.values,'settlement-workspace-journal-v1':'{"before":{"settlement_v1":"old raw"}}'}
        self.store.save(0,values)
        self.assertEqual(self.store.read()['storage'],values)
    def test_noop_does_not_increment(self):
        self.store.save(0,self.values)
        self.assertEqual(self.store.save(1,self.values)['revision'],1)
    def test_two_independent_stores_cannot_commit_same_revision(self):
        self.store.save(0,self.values)
        barrier=threading.Barrier(2);out=[]
        def save(theme):
            store=WorkspaceStore(self.tmp.name)
            barrier.wait()
            try:store.save(1,{**self.values,'settlement-theme':theme});out.append('saved')
            except ValueError:out.append('conflict')
        threads=[threading.Thread(target=save,args=(theme,)) for theme in ('warm','ocean')]
        for thread in threads:thread.start()
        for thread in threads:thread.join()
        self.assertEqual(sorted(out),['conflict','saved'])

if __name__=='__main__':unittest.main(verbosity=2)
