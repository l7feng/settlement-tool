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


class RevisionConflict(ValueError):
    """版本号不匹配：带上磁盘上的真实版本号，前端可以据此自动重放这次改动（S2-2.8）。"""

    def __init__(self, current):
        super().__init__('另一个窗口已更新工作区，请关闭其他窗口并重新打开')
        self.revision = int(current) if isinstance(current, int) else 0


class WorkspaceStore:
    SNAPSHOT_KEEP = 5
    # 4.9：文件头校验与每周备份
    INTEGRITY_SIDECAR = 'workspace.json.sha256'
    BACKUP_DIR = 'backup'
    WEEKLY_KEEP = 8

    def __init__(self, root):
        self.root = Path(root)
        self.path = self.root / 'workspace.json'
        self.snapshot_dir = self.root / 'snapshots'
        # 升级前快照原文落在独立目录（gzip 单文件），账本里只留索引：
        # 20 份整本副本曾占 3.91MB / 5.8MB 文件的 70%，且每次保存都要重写一遍。
        self.upgrade_dir = self.root / 'upgrade'
        self.lock = threading.RLock()

    MAX_PROJECTS = 500
    MAX_RECORDS = 20000

    @staticmethod
    def managed(key):
        return key in KEYS or bool(LEDGER_KEY.match(key))

    @classmethod
    def _validate_ledger(cls, key, value):
        """4.8：服务端最小断言。结构坏了就直接拒写，别等前端读到 Null 才炸。"""
        try:
            data = json.loads(value)
        except (TypeError, ValueError) as error:
            raise ValueError(f'业务账本不是合法 JSON（{key}）：{error}') from error
        if not isinstance(data, dict):
            raise ValueError(f'业务账本顶层必须是对象（{key}）')
        if not (key == BUSINESS_KEY or key.startswith('settlement_v1_profile_')):
            # recovery 等键的结构由前端自行约定，服务端只保证可解析、是对象。
            return
        projects = data.get('projects')
        if not isinstance(projects, list):
            raise ValueError(f'业务账本 projects 必须是数组（{key}）')
        if len(projects) > cls.MAX_PROJECTS:
            raise ValueError(f'业务账本项目数超出上限 {cls.MAX_PROJECTS}（{key}）')
        records = 0
        for index, project in enumerate(projects):
            if not isinstance(project, dict):
                raise ValueError(f'业务账本 projects[{index}] 必须是对象（{key}）')
            if 'name' in project and not isinstance(project.get('name'), str):
                raise ValueError(f'业务账本 projects[{index}].name 必须是字符串（{key}）')
            episodes = project.get('episodes', {})
            if not isinstance(episodes, dict):
                raise ValueError(f'业务账本 projects[{index}].episodes 必须是对象（{key}）')
            for episode_key, record in episodes.items():
                if not isinstance(record, dict):
                    raise ValueError(f'业务账本 projects[{index}][{episode_key}] 记录必须是对象（{key}）')
            records += len(episodes)
            if records > cls.MAX_RECORDS:
                raise ValueError(f'业务账本记录数超出上限 {cls.MAX_RECORDS}（{key}）')
        prices = data.get('prices')
        if prices is not None and not isinstance(prices, dict):
            raise ValueError(f'业务账本 prices 必须是对象（{key}）')

    @classmethod
    def validate(cls, values, strict=True):
        if not isinstance(values, dict) or any(
                not isinstance(k, str) or not cls.managed(k) or not isinstance(v, str)
                for k, v in values.items()):
            raise ValueError('工作区字段无效')
        if strict:
            for key, value in values.items():
                if key == BUSINESS_KEY or key.startswith('settlement_v1_profile_') or key.startswith('settlement_recovery_v2'):
                    cls._validate_ledger(key, value)
        return values

    def read(self):
        with self.lock:
            if not self.path.exists():
                return {'formatVersion': 1, 'app': 'settlement-workbench', 'revision': 0, 'storage': {}}
            raw = self.path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            expected = self._expected_digest()
            if expected and digest != expected:
                # 校验不一致：先看内容还能不能读。
                # 读不了＝损坏 → 隔离 + 快照恢复；能读＝外部写入（旧版本程序、手工修复）→
                # 记一笔并重新登记校验值。若一律隔离，旧版程序写过的账会被新版本当坏文件，
                # 反而丢掉最新数据。
                try:
                    value = self._parse(raw)
                    self.validate(value.get('storage'))
                except ValueError:
                    return self._recover_corrupt(digest, expected)
                print('[integrity] 文件 sha256 与侧车不一致（外部写入或篡改），内容可解析，已重新登记校验值')
                self._write_digest(raw)
                return value
            value = self._parse(raw)
            self.validate(value.get('storage'))
            return value

    def _parse(self, raw):
        value = json.loads(raw.decode('utf-8'))
        if not isinstance(value, dict) or value.get('formatVersion') != 1 or value.get('app') != 'settlement-workbench':
            raise ValueError('工作区文件格式无效，原文件已保留')
        if type(value.get('revision')) is not int or value['revision'] < 1:
            raise ValueError('工作区版本无效')
        return value

    def _expected_digest(self):
        """侧车里记的 sha256；缺失或格式不对就当没有校验（老库平滑升级）。"""
        try:
            text = (self.root / self.INTEGRITY_SIDECAR).read_text(encoding='utf-8').strip()
        except OSError:
            return None
        parts = text.split()
        return parts[0].lower() if parts and re.fullmatch(r'[0-9a-fA-F]{64}', parts[0]) else None

    def _write_digest(self, raw):
        try:
            self._atomic(self.root / self.INTEGRITY_SIDECAR,
                (hashlib.sha256(raw).hexdigest() + '  workspace.json\n').encode('utf-8'))
        except OSError:
            pass    # 校验文件写不成不能拖累主写入

    def _quarantine_corrupt(self):
        """把坏文件改名隔离（绝不覆盖），返回隔离后的路径。"""
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        target = self.root / ('workspace.corrupt-%s.json' % stamp)
        index = 1
        while target.exists():
            target = self.root / ('workspace.corrupt-%s-%d.json' % (stamp, index))
            index += 1
        try:
            os.replace(self.path, target)
        except OSError:
            return None
        return target

    def _recover_corrupt(self, digest, expected):
        """校验不一致：先隔离坏文件，再从最新可用快照恢复，避免用户看到空账。"""
        quarantined = self._quarantine_corrupt()
        for snapshot in sorted((p for p in self.snapshot_dir.glob('workspace.r*.json')
                if p.name[len('workspace.r'):-len('.json')].isdigit()),
                key=lambda p: int(p.name[len('workspace.r'):-len('.json')]), reverse=True):
            try:
                raw = snapshot.read_bytes()
                value = self._parse(raw)
                self.validate(value.get('storage'))
            except (OSError, ValueError):
                continue
            self._atomic(self.path, raw)
            self._write_digest(raw)
            self.recovered_from = str(snapshot)
            print('[integrity] 工作区校验失败（sha256 %s ≠ %s），已隔离为 %s，并从快照 %s 恢复'
                  % (digest[:12], expected[:12], quarantined or '(改名失败)', snapshot.name))
            return value
        raise ValueError('工作区文件校验失败（已隔离为 %s），且没有可用快照；请从 %s 目录的备份恢复'
                         % (quarantined.name if quarantined else '（改名失败）', self.BACKUP_DIR))

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

    def save(self, revision, values, label=None):
        with self.lock, self._file_lock():
            self.validate(values)
            current = self.read()
            if type(revision) is not int or revision != current['revision']:
                raise RevisionConflict(current['revision'])
            if current['storage'] == values and self.path.exists():
                return current
            return self._commit(current, values, label=label)

    def patch(self, revision, changes, allow_business_delete=False, label=None):
        """只落变化的键：键→新值，None 表示删除。仍是同步写盘，返回时已落定。

        业务账本是「删了就没」的数据，默认拒绝删除；只有显式声明
        allow_business_delete（对应前端「删除当前账本」这一明确动作）才放行。
        """
        with self.lock, self._file_lock():
            if not isinstance(changes, dict):
                raise ValueError('增量写入格式无效')
            current = self.read()
            if type(revision) is not int or revision != current['revision']:
                raise RevisionConflict(current['revision'])
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
                if key == BUSINESS_KEY or key.startswith('settlement_v1_profile_') or key.startswith('settlement_recovery_v2'):
                    self._validate_ledger(key, value)
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
            return self._commit(current, storage, echo=False, snapshot=business, label=label, changed_keys=list(changes))

    def _commit(self, current, storage, echo=True, snapshot=True, label=None, journal=True, changed_keys=None):
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
        self._write_digest(raw)     # 4.9：写入后立刻记录文件头 sha256，下次读取据此发现篡改
        # 只有账本类变化才留版本快照；主题/列宽这类高频设置不值得每次 fsync 一份 400KB。
        if snapshot:
            self._write_snapshot(result)
        # 变更日志（S2-2.9）：记下「刚改了什么、改到哪个版本」，重启后据此给出一次撤销机会。
        # 只写几十字节，撤销所需的上一个状态直接复用 r{rev-1} 快照，不额外复制整本账。
        if journal:
            self._write_change_journal(result, label, changed_keys)
        if not echo:
            # 增量写入只回执版本号，不再把整份账本（400KB+）回传一次。
            return {k: result[k] for k in ('formatVersion', 'app', 'revision', 'updatedAt')}
        return result

    PREVIOUS_MIN_INTERVAL = 300      # 秒；同一窗口内业务变更，previous 最多每 5 分钟刷新一次

    # ── 变更日志与「重启后一次撤销」（S2-2.9）──────────────────────────
    CHANGE_JOURNAL = 'workspace.last-change.json'

    def _write_change_journal(self, result, label=None, changed_keys=None):
        try:
            keys = [k for k in (changed_keys if changed_keys is not None else result['storage'])
                if k == BUSINESS_KEY or LEDGER_KEY.match(k)]
            payload = {'revision': result['revision'], 'updatedAt': result['updatedAt'],
                'label': label or '', 'keys': sorted(set(keys))}
            self._atomic(self.root / self.CHANGE_JOURNAL,
                (json.dumps(payload, ensure_ascii=False) + '\n').encode('utf-8'))
        except OSError:
            pass    # 日志只是附加保险，写不成不影响账目

    def last_change(self):
        try:
            value = json.loads((self.root / self.CHANGE_JOURNAL).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None
        if not isinstance(value, dict) or type(value.get('revision')) is not int:
            return None
        return value

    def consume_last_change(self):
        """用掉这次撤销机会：删掉日志，同一份状态不会被撤销第二次。"""
        try:
            (self.root / self.CHANGE_JOURNAL).unlink()
            return True
        except OSError:
            return False

    def previous_state(self):
        """上一个版本的整份内容：优先 r{rev-1} 快照（精确到一次变更），退回 previous.json。"""
        current = self.read()
        previous = current['revision'] - 1
        snapshot = self.snapshot_dir / ('workspace.r%d.json' % previous)
        for candidate in (snapshot, self.root / 'workspace.previous.json'):
            try:
                value = json.loads(candidate.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if isinstance(value, dict) and isinstance(value.get('storage'), dict):
                return {'revision': previous, 'updatedAt': value.get('updatedAt'), 'storage': value['storage']}
        return None

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
            # 迁移来的旧浏览器值可能本身就是坏账本；此处只保证键合法，坏内容原样留存备查。
            self.validate(values, strict=False)
            if not values or values == self.read()['storage']:
                return
            raw = (json.dumps({'app': 'settlement-workbench', 'storage': values}, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
            name = 'workspace.browser-before-' + hashlib.sha256(raw).hexdigest()[:16] + '.json'
            target = self.root / name
            if not target.exists():
                self._atomic(target, raw)

    # ── 每周 zip 备份（4.9）────────────────────────────────────────────
    def ensure_digest(self):
        """老库（没有校验侧车）启动时补一次：先确认能解析，再记下当前文件 sha256。"""
        if not self.path.exists() or self._expected_digest():
            return False
        try:
            raw = self.path.read_bytes()
            self._parse(raw)
        except (OSError, ValueError):
            return False
        self._write_digest(raw)
        return True

    def weekly_backup(self, now=None):
        """每周一包 zip（workspace.json + 当前快照），同一周只做一次，只留最近 N 周。

        返回新建的 zip 路径；本周已有备份或没有账本时返回 None。
        """
        now = now or datetime.now()
        if not self.path.exists():
            return None
        iso = now.isocalendar()
        name = 'workspace-%04d-W%02d.zip' % (iso[0], iso[1])
        target = self.root / self.BACKUP_DIR / name
        try:
            if target.exists():
                return None
            target.parent.mkdir(parents=True, exist_ok=True)
            import zipfile
            tmp = target.with_name(target.name + '.tmp')
            with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.write(self.path, arcname='workspace.json')
                for snapshot in sorted(self.snapshot_dir.glob('workspace.r*.json')):
                    archive.write(snapshot, arcname='snapshots/' + snapshot.name)
            os.replace(tmp, target)
            self._prune_weekly_backups()
            return target
        except OSError:
            return None

    def _prune_weekly_backups(self):
        try:
            existing = sorted((p for p in (self.root / self.BACKUP_DIR).glob('workspace-*-W*.zip')
                if re.fullmatch(r'workspace-\d{4}-W\d{2}\.zip', p.name)), key=lambda p: p.name)
        except OSError:
            return
        for stale in existing[:-self.WEEKLY_KEEP]:
            try:
                stale.unlink()
            except OSError:
                pass