"""Atomic desktop workspace storage; browser values remain byte-preserving strings."""
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
import time

KEYS = frozenset(('settlement_v1', 'settlement_recovery_v2', 'settlement-settings-v1',
    'settlement-cols-v1', 'settlement-theme', 'settlement-glass-tuner',
    'settlement-workspace-journal-v1', 'settlement-upgrade-snapshots-v1'))


class WorkspaceStore:
    def __init__(self, root):
        self.root = Path(root)
        self.path = self.root / 'workspace.json'
        self.lock = threading.RLock()

    @staticmethod
    def validate(values):
        if not isinstance(values, dict) or any(k not in KEYS or not isinstance(v, str) for k, v in values.items()):
            raise ValueError('工作区字段无效')
        # Business validation and schema migration remain in the existing UI layer.
        return values

    def read(self):
        with self.lock:
            if not self.path.exists():
                return {'formatVersion': 1, 'app': 'settlement-workbench', 'revision': 0, 'storage': {}}
            value = json.loads(self.path.read_text(encoding='utf-8'))
            if not isinstance(value, dict) or value.get('formatVersion') != 1 or value.get('app') != 'settlement-workbench':
                raise ValueError('工作区文件格式无效，原文件已保留')
            if type(value.get('revision')) is not int or value['revision'] < 1:
                raise ValueError('工作区版本无效')
            self.validate(value.get('storage'))
            return value

    def _atomic(self, target, raw):
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.tmp')
        try:
            with temporary.open('wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()

    @contextmanager
    def _file_lock(self):
        """Serialize revisions even when two desktop processes use different ports."""
        import msvcrt
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / 'workspace.lock').open('a+b') as stream:
            if stream.seek(0, 2) == 0:
                stream.write(b'0');stream.flush()
            deadline = time.monotonic() + 5
            while True:
                stream.seek(0)
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise OSError('另一个窗口正在保存工作区，请稍后重新打开')
                    time.sleep(.02)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)

    def save(self, revision, values):
        with self.lock, self._file_lock():
            self.validate(values)
            current = self.read()
            if type(revision) is not int or revision != current['revision']:
                raise ValueError('另一个窗口已更新工作区，请关闭其他窗口并重新打开')
            if current['storage'] == values and self.path.exists():
                return current
            result = {'formatVersion': 1, 'app': 'settlement-workbench',
                'revision': revision + 1, 'updatedAt': datetime.now(timezone.utc).isoformat(), 'storage': values}
            raw = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
            if self.path.exists():
                self._atomic(self.root / 'workspace.previous.json', self.path.read_bytes())
            self._atomic(self.path, raw)
            return result

    def preserve_legacy(self, values):
        with self.lock, self._file_lock():
            self.validate(values)
            if not values or values == self.read()['storage']:
                return
            raw = (json.dumps({'app': 'settlement-workbench', 'storage': values}, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
            name = 'workspace.browser-before-' + hashlib.sha256(raw).hexdigest()[:16] + '.json'
            target = self.root / name
            if not target.exists():
                self._atomic(target, raw)
