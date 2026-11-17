"""数据目录自清洁：只清本工具自己生成的垃圾，绝不碰账本与用户文件。

现役数据目录实测 379MB，其中真正有用的是 workspace.json（账本）与 webview-data
（运行中的浏览器 profile）。剩下的是历史遗留：
  workspace.browser-before-*.json  旧版浏览器存储的一次性迁移副本，20 份 43MB
  webview-data.bak*                早年调试留下的 profile 备份，多份 50MB+
  snapshots/                       按 revision 的环形快照，超过保留份数的
  upgrade/                         升级前快照原文，索引里没有的孤儿文件
清理策略是白名单 + 保留最新 N 份，逐条写进日志，绝不按目录整个删。
"""
import os
import time
from pathlib import Path

BROWSER_BEFORE = 'workspace.browser-before-'
BROWSER_BEFORE_KEEP = 3          # 迁移副本只留最近 3 份，够回滚即可
WEBVIEW_BACKUP_GLOB = ('webview-data.bak*', 'webview-data.backup*', 'min-store*')
WEBVIEW_BACKUP_AGE = 30 * 86400  # 调试备份超过 30 天才算垃圾
CRASHPAD_KEEP = 3                # WebView 崩溃转储只留最近 3 份
CRASHPAD_AGE = 7 * 86400


def _size(path):
    try:
        if path.is_dir():
            return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())
        return path.stat().st_size
    except OSError:
        return 0


def plan(root, snapshot_keep=5, upgrade_keep=3):
    """只读扫描：返回 [(路径, 字节数, 原因)]，调用方再决定是否执行。"""
    root = Path(root)
    victims = []

    def add(paths, reason):
        for p in paths:
            victims.append((p, _size(p), reason))

    # 1) 旧版浏览器存储迁移副本：按 mtime 留最新 N 份
    candidates = [p for p in root.glob(BROWSER_BEFORE + '*.json') if p.is_file()]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    add(candidates[BROWSER_BEFORE_KEEP:], '旧浏览器存储迁移副本（只留最新 %d 份）' % BROWSER_BEFORE_KEEP)

    # 2) 早年调试留下的 webview profile 备份：目录类，超过阈值才算
    stale = []
    for pattern in WEBVIEW_BACKUP_GLOB:
        for p in root.glob(pattern):
            if not p.is_dir():
                continue
            try:
                if time.time() - p.stat().st_mtime >= WEBVIEW_BACKUP_AGE:
                    stale.append(p)
            except OSError:
                continue
    add(stale, '超期 webview profile 调试备份（>30 天）')

    # 3) snapshots/：超出保留份数的环形快照（store 正常会自清，这里兜底历史残留）
    snap_dir = root / 'snapshots'
    snaps = []
    if snap_dir.is_dir():
        for p in snap_dir.glob('workspace.r*.json'):
            stem = p.name[len('workspace.r'):-len('.json')]
            if stem.isdigit():
                snaps.append((int(stem), p))
        snaps.sort(reverse=True)
        add([p for _, p in snaps[snapshot_keep:]], '超期 revision 快照（保留最新 %d 份）' % snapshot_keep)

    # 4) upgrade/：索引里没引用的孤儿 gzip（换机器/回滚后常见）
    upgrade_dir = root / 'upgrade'
    referenced = set()
    workspace = root / 'workspace.json'
    if upgrade_dir.is_dir() and workspace.exists():
        try:
            import json
            storage = json.loads(workspace.read_text(encoding='utf-8')).get('storage') or {}
            history = json.loads(storage.get('settlement-upgrade-snapshots-v1') or '{}')
            for entry in history.get('snapshots') or []:
                name = entry.get('file') if isinstance(entry, dict) else None
                if isinstance(name, str):
                    referenced.add(name)
        except (OSError, ValueError, AttributeError):
            referenced = set()
    if upgrade_dir.is_dir() and referenced:
        orphans = [p for p in upgrade_dir.glob('*.json.gz') if p.name not in referenced]
        orphans.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        add(orphans, '索引未引用的快照原文')

    # 5) logs/：滚动日志的历史分卷
    log_dir = root / 'logs'
    if log_dir.is_dir():
        old_logs = [p for p in log_dir.glob('app.log.*') if p.is_file()
                    and time.time() - p.stat().st_mtime >= 14 * 86400]
        add(old_logs, '超过 14 天的日志分卷')

    # 6) WebView 崩溃转储：实测占 35MB，且说明程序确实崩过；只留最近几份
    crash_dir = root / 'webview-data' / 'EBWebView' / 'Crashpad' / 'reports'
    if crash_dir.is_dir():
        dumps = [p for p in crash_dir.rglob('*') if p.is_file()
                 and time.time() - p.stat().st_mtime >= CRASHPAD_AGE]
        dumps.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        add(dumps[CRASHPAD_KEEP:], 'WebView 崩溃转储（留最近 %d 份）' % CRASHPAD_KEEP)

    return victims


def apply(victims, log=None):
    """执行清理，返回 (已删文件数, 释放字节数, 失败列表)。逐条记录，不整目录删。"""
    removed = freed = 0
    failures = []
    for path, size, reason in victims:
        try:
            if path.is_dir():
                for child in sorted(path.rglob('*'), key=lambda p: p.is_file(), reverse=True):
                    child.unlink(missing_ok=True)
                # 目录从深到浅移除
                for child in sorted((p for p in path.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                    child.rmdir()
                path.rmdir()
            else:
                path.unlink()
            removed += 1
            freed += size
            if log:
                log('[clean] 删除 %s（%.1f MB，%s）' % (path.name, size / 1048576, reason))
        except OSError as error:
            failures.append('%s: %s' % (path.name, error))
            if log:
                log('[clean] 跳过 %s：%s' % (path.name, error))
    return removed, freed, failures


def run(root, log=None, dry_run=False):
    victims = plan(root)
    if dry_run:
        total = sum(size for _, size, _ in victims)
        return {'files': len(victims), 'bytes': total, 'failures': [], 'dry_run': True}
    removed, freed, failures = apply(victims, log)
    return {'files': removed, 'bytes': freed, 'failures': failures, 'dry_run': False}
