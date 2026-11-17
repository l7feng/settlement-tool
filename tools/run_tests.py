"""一条命令跑全部测试：Python 单元 + Node 单元 + 可选 UI 回归。

为什么需要它：以前跑测试要靠记忆背三件事——python 解释器在哪、SETTLEMENT_WEB_ROOT 要指到仓库、
UI 回归还要 SETTLEMENT_TIMEOUT 放宽（93 项在默认 60s 里跑不完）。忘一样就得到假红。

用法：
    python tools/run_tests.py            # 单元测试（快，约 10 秒）
    python tools/run_tests.py --ui       # 加上 UI 回归（约 2-4 分钟）
    python tools/run_tests.py --ui-only
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIT_SUITES = [
    ('workspace-state.mjs', '工作区偏好/事务/升级快照'),
    ('workspace-ledgers.mjs', '多账本事务与升级快照'),
    ('desktop-adapter.mjs', '桌面存储适配器（合并写入/快照加载）'),
    ('billing-identity.mjs', '计价口径与按集取整'),
    ('billing-grade-coverage.mjs', '等级阶梯覆盖率'),
    ('billing-unrated.mjs', '待定级口径（S2-2.4）'),
    ('revision-parse.mjs', '版本号解析单测（S2-2.1）'),
    ('revision-consistency.mjs', '四入口版本号一致（S2-2.1）'),
    ('version-same-version-conflict.mjs', '同版本不同日期拦截（S2-2.5 D1）'),
    ('version-supersede.mjs', '旧版本置零与人工覆盖（S2-2.2/2.3）'),
    ('episode-key-worktype.mjs', '登记判重按工作类型（S2-2.6）'),
    ('rate-snapshot.mjs', '单价按记录冻结（S2-2.10）'),
    ('period-range.mjs', '结算期起止与导出列（S2-2.7）'),
    ('sync-core.mjs', '同步状态机'),
    ('project-workflow-core.mjs', '项目工作流内核'),
]
UI_SUITES = ['settlement-regression.mjs', 'name-layout.mjs']


def node_bin():
    """优先用环境变量，其次 PATH，最后常见安装位置。"""
    env = os.environ.get('SETTLEMENT_NODE')
    if env and Path(env).exists():
        return env
    for name in ('node.exe', 'node'):
        for base in os.environ.get('PATH', '').split(os.pathsep):
            candidate = Path(base) / name
            if candidate.exists():
                return str(candidate)
    raise SystemExit('找不到 node：请设置 SETTLEMENT_NODE 指向 node.exe')


def python_bin():
    env = os.environ.get('SETTLEMENT_PYTHON')
    if env and Path(env).exists():
        return env
    return sys.executable


def run(cmd, label, env=None):
    print('\n=== %s' % label)
    print('    ' + ' '.join(str(c) for c in cmd))
    proc = subprocess.run(cmd, cwd=str(ROOT), env=env)
    return proc.returncode == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ui', action='store_true', help='附加 UI 回归（需要 Playwright）')
    parser.add_argument('--ui-only', action='store_true', help='只跑 UI 回归')
    args = parser.parse_args()

    env = dict(os.environ)
    env['SETTLEMENT_WEB_ROOT'] = str(ROOT)                      # 永远测仓库，不测工作副本
    env.setdefault('SETTLEMENT_TIMEOUT', '300000')              # 93 项在 60s 内跑不完
    env.setdefault('SETTLEMENT_EVIDENCE', str(ROOT / 'build' / 'evidence'))

    results = []
    if not args.ui_only:
        results.append((run([python_bin(), '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'],
                            'Python 单元测试', env), 'python 单元'))
        node = node_bin()
        for file_name, title in UNIT_SUITES:
            ok = run([node, str(ROOT / 'tests' / file_name)], 'Node 单元：%s' % title, env)
            results.append((ok, file_name))

    if args.ui or args.ui_only:
        node = node_bin()
        for file_name in UI_SUITES:
            ok = run([node, str(ROOT / 'tests' / file_name)], 'UI 回归：%s' % file_name, env)
            results.append((ok, file_name))

    print('\n══ 汇总 ══')
    for ok, name in results:
        print('  %s  %s' % ('通过' if ok else '失败', name))
    failures = [name for ok, name in results if not ok]
    if failures:
        print('\n有 %d 项失败：%s' % (len(failures), '、'.join(failures)))
        return 1
    print('\n全部通过（%d 项）' % len(results))
    return 0


if __name__ == '__main__':
    sys.exit(main())
