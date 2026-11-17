"""Atomic desktop workspace storage; browser values remain byte-preserving strings."""
import gzip
import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
import time

KEYS = frozenset(('settlement_v1', 'settlement_recovery_v2', 'settlement-settings-v1',
    'settlement-cols-v1', 'settlement-theme', 'settlement-glass-tuner',
    'settlement-workspace-journal-v1', 'settlement-upgrade-snapshots-v1',
    # 2026-11-14 逻辑项2：账本清单（多工作台列表）此前只落在浏览器 profile，
    # 清缓存就"数据在、工作台列表没了"。纳入白名单后随 workspace.json 一起保存与迁移。
    'settlement_workbenches_v1',
    # 2026-11-17 S1-1.7：当前打开的工作台此前只在 localStorage，清缓存会静默回到
    # 「工作台1」，用户看到的是另一本账——以为数据丢了。纳入托管后随文件保存。
    'settlement_active_profile'))
LEDGER_KEY = re.compile(r'^settlement_(?:v1|recovery_v2)_profile_[A-Za-z0-9_-]{1,64}$')
# 业务键：删除等于丢账。patch 允许删设置类键，但绝不允许把这两类删空。
BUSINESS_KEY = 'settlement_v1'
UPGRADE_KEY = 'settlement-upgrade-snapshots-v1'
UPGRADE_KEEP = 3          # 升级前快照最多留 3 份（此前无上限，攒到 20 份 3.9MB）
UPGRADE_BLOB_NAME = re.compile(r'^[0-9A-Za-z._-]{1,80}\.json\.gz$')


class WorkspaceStore:
    SNAPSHOT_KEEP = 5

    def __init__(self, root):
        self.root = Path(root)
        self.path = self.root / 'workspace.json'
        self.snapshot_dir = self.root / 'snapshots'
        # 升级前快照原文落在独立目录（gzip 单文件），账本里只留索引：
        # 20 份整本副本曾占 3.91MB / 5.8MB 文件的 70%，且每次保存都要重写一遍。
        self.upgrade_dir = self.root / 'upgrade'
        self.lock = threading.RLock()

    @staticmethod
    def managed(key):
        return key in KEYS or bool(LEDGER_KEY.match(key))

    @classmethod
    def validate(cls, values):
        if not isinstance(values, dict) or any(
                not isinstance(k, str) or not cls.managed(k) or not isinstance(v, str)
                for k, v in values.items()):
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
            return self._commit(current, values)

    def patch(self, revision, changes, allow_business_delete=False):
        """只落变化的键：键→新值，None 表示删除。仍是同步写盘，返回时已落定。

        业务账本是「删了就没」的数据，默认拒绝删除；只有显式声明
        allow_business_delete（对应前端「删除当前账本」这一明确动作）才放行。
        """
        with self.lock, self._file_lock():
            if not isinstance(changes, dict):
                raise ValueError('增量写入格式无效')
            current = self.read()
            if type(revision) is not int or revision != current['revision']:
                raise ValueError('另一个窗口已更新工作区，请关闭其他窗口并重新打开')
            storage = dict(current['storage'])
            changed = False
            for key, value in changes.items():
                if not isinstance(key, str) or not self.managed(key):
                    raise ValueError('工作区字段无效')
                if value is None:
                    if not allow_business_delete and (key == BUSINESS_KEY or LEDGER_KEY.match(key)):
                        raise ValueError('业务账本不允许通过增量写入删除')
                    if key in storage:
                        del storage[key]
                        changed = True
                    continue
                if not isinstance(value, str):
                    raise ValueError('工作区字段无效')
                if storage.get(key) != value:
                    if key == UPGRADE_KEY:
                        # 前端仍内联发送整份快照历史；先归一成索引再比，避免每次启动都误判为变化。
                        probe = {UPGRADE_KEY: value}
                        self._externalize_upgrades(probe, prune=False)
                        value = probe[UPGRADE_KEY]
                        if storage.get(key) == value:
                            continue
                    storage[key] = value
                    changed = True
            if not changed:
                return current
            business = any(key == BUSINESS_KEY or LEDGER_KEY.match(key) for key in changes)
            return self._commit(current, storage, echo=False, snapshot=business)

    def _commit(self, current, storage, echo=True, snapshot=True):
        # 升级前快照的原文先搬出账本，账本里只留索引（迁移与限流都在这一步完成）。
        storage = self._externalize_upgrades(storage)
        result = {'formatVersion': 1, 'app': 'settlement-workbench',
            'revision': current['revision'] + 1,
            'updatedAt': datetime.now(timezone.utc).isoformat(), 'storage': storage}
        raw = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        # previous.json 是「上一次写入前」的整份副本，用来自救；它和快照环、升级前快照
        # 三套并存时，每次保存等于把同一本账再写一遍（5.8MB × 3）。这里改为按需：
        # 业务账本变化才留一份，且 5 分钟内不重复覆盖，设置类写入完全不碰它。
        if self.path.exists() and self._should_refresh_previous(snapshot=snapshot):
            self._atomic(self.root / 'workspace.previous.json', self.path.read_bytes())
        self._atomic(self.path, raw)
        # 只有账本类变化才留版本快照；主题/列宽这类高频设置不值得每次 fsync 一份 400KB。
        if snapshot:
            self._write_snapshot(result)
        if not echo:
            # 增量写入只回执版本号，不再把整份账本（400KB+）回传一次。
            return {k: result[k] for k in ('formatVersion', 'app', 'revision', 'updatedAt')}
        return result

    PREVIOUS_MIN_INTERVAL = 300      # 秒；同一窗口内业务变更，previous 最多每 5 分钟刷新一次

    def _should_refresh_previous(self, snapshot):
        if not snapshot:
            return False
        target = self.root / 'workspace.previous.json'
        try:
            age = time.time() - target.stat().st_mtime
        except OSError:
            return True
        return age >= self.PREVIOUS_MIN_INTERVAL

    def _write_snapshot(self, result):
        """按 revision 留最近 N 份完整快照；rolling 只用于回滚，不被读取路径依赖。"""
        try:
            self.snapshot_dir.mkdir(parents=True, exist_ok=True)
            target = self.snapshot_dir / ('workspace.r%d.json' % result['revision'])
            raw = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
            self._atomic(target, raw)
            existing = sorted((p for p in self.snapshot_dir.glob('workspace.r*.json')
                if p.name[len('workspace.r'):-len('.json')].isdigit()),
                key=lambda p: int(p.name[len('workspace.r'):-len('.json')]))
            for stale in existing[:-self.SNAPSHOT_KEEP]:
                try:
                    stale.unlink()
                except OSError:
                    pass
        except OSError:
            # 快照是附加保险，主写入成功优先，不因快照失败回滚已落盘的账目。
            pass

    # ── 升级前快照：原文外置 ────────────────────────────────────────────
    def _externalize_upgrades(self, storage, prune=True):
        """把 upgrade 历史里的 `raw` 原文搬到 upgrade/ 目录，账本只留索引。

        前端历史上把每份升级前快照的原文（≈288KB）内联在这个键里且无上限保留，
        攒到 20 份 = 3.9MB，占整个 workspace.json 的 70%，每次保存都要重写一遍。
        这里做两件事：原文 gzip 落 upgrade/<id>.json.gz；只保留最新 UPGRADE_KEEP 份。
        任何异常都不影响主写入——原样返回，宁可这次没瘦身也不能丢账。
        """
        value = storage.get(UPGRADE_KEY)
        if not isinstance(value, str) or not value:
            return storage
        try:
            history = json.loads(value)
        except ValueError:
            return storage
        if not isinstance(history, dict) or not isinstance(history.get('snapshots'), list):
            return storage
        snapshots = history['snapshots']
        if not snapshots:
            return storage
        if not any(isinstance(s, dict) and 'raw' in s for s in snapshots):
            # 已是索引形态：只需按最新份数清理多余文件（幂等，不产生新内容）。
            if prune:
                self._prune_upgrade_blobs(snapshots[:UPGRADE_KEEP])
            return storage
        changed = False
        entries = []
        try:
            self.upgrade_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            return storage
        for snapshot in snapshots:
            if not isinstance(snapshot, dict):
                continue
            if 'raw' not in snapshot:
                entries.append(snapshot)
                continue
            entry = self._write_upgrade_blob(snapshot)
            if entry is None:
                entries.append(snapshot)      # 写不成留原样，绝不丢快照
            else:
                entries.append(entry)
                changed = True
        if len(entries) > UPGRADE_KEEP:
            entries = entries[:UPGRADE_KEEP]  # 前端总是把最新一份放数组首位
            changed = True
        if not changed:
            return storage
        history['snapshots'] = entries
        if prune:
            self._prune_upgrade_blobs(entries)
        try:
            storage[UPGRADE_KEY] = json.dumps(history, ensure_ascii=False, separators=(',', ':'))
        except (TypeError, ValueError):
            return storage
        return storage

    def _write_upgrade_blob(self, snapshot):
        """写一份快照原文（gzip），返回索引条目；失败返回 None。"""
        raw = snapshot.get('raw')
        if not isinstance(raw, dict):
            return None
        payload = json.dumps(raw, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        digest = hashlib.sha256(payload).hexdigest()
        label = re.sub(r'[^0-9A-Za-z._-]', '_', str(snapshot.get('id') or ''))[:60]
        name = '%s-%s.json.gz' % (label or 'snapshot', digest[:16])
        target = self.upgrade_dir / name
        try:
            if not target.exists():
                self._atomic_gzip(target, payload)
        except OSError:
            return None
        entry = {k: snapshot[k] for k in ('id', 'appVersion', 'createdAt') if k in snapshot}
        entry.update({'file': name, 'bytes': len(payload), 'sha256': digest})
        return entry

    def _atomic_gzip(self, target, payload):
        tmp = target.with_suffix(target.suffix + '.tmp')
        with gzip.open(tmp, 'wb') as fh:
            fh.write(payload)
        os.replace(tmp, target)

    def _prune_upgrade_blobs(self, entries):
        keep = {e.get('file') for e in entries if isinstance(e, dict) and e.get('file')}
        try:
            for stale in self.upgrade_dir.glob('*.json.gz'):
                if stale.name not in keep and UPGRADE_BLOB_NAME.match(stale.name):
                    stale.unlink(missing_ok=True)
        except OSError:
            pass

    def read_upgrade_blob(self, name):
        """按索引取回快照原文；名字先过白名单，杜绝路径穿越。"""
        if not isinstance(name, str) or not UPGRADE_BLOB_NAME.match(name):
            raise ValueError('快照文件名无效')
        target = self.upgrade_dir / name
        if not target.exists():
            raise FileNotFoundError('快照文件不存在')
        with gzip.open(target, 'rb') as fh:
            return fh.read().decode('utf-8')

    def migrate_upgrades(self):
        """启动时把内联的升级快照原文搬出账本（幂等，只做一次真实的缩身）。"""
        with self.lock, self._file_lock():
            current = self.read()
            storage = dict(current['storage'])
            before = storage.get(UPGRADE_KEY)
            self._externalize_upgrades(storage)
            if storage.get(UPGRADE_KEY) == before:
                return False
            self._commit(current, storage, echo=False, snapshot=False)
            return True

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
