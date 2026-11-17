# -*- coding: utf-8 -*-
"""打包桌面版（pywebview 原生窗口 + 本地 HTML）为 exe（onedir，启动快）

网页版与 exe 共用同一份 settlement-workbench.html，功能天然同步。
打包只做三件事：把 html / assets / VERSION 塞进 _internal，把 pywebview 的
WebView2 互操作 dll 带上，再用 desktop_app.py 当入口（pywebview 黑屏时自动切 Edge --app）。

用法（在打包环境里跑）：
    D:\\Ai-Files\\Tools\\BuildEnv\\Scripts\\python.exe tools/build_exe.py

出口布局（扁平化）：
    <EXE_ROOT>/05-Settlement Tool（制作结算台）/settlement-tool-v<版本>/
        settlement-tool.exe   +  _internal/
"""
import datetime
import hashlib
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 构建单一真源（S3-3.3）：页面与 assets 只从仓库取。工作副本（Tools\Html\settlement-tool）
# 若存在就作为对照，两边不一致直接中止——宁可不出包，也不出一份不知道是哪天页面的包。
WEB_ROOT = os.environ.get('SETTLEMENT_WEB_ROOT', ROOT)
WORK_COPY = os.environ.get('SETTLEMENT_WORK_COPY', r'D:\Ai-Files\Tools\Html\settlement-tool')
PY = os.environ.get('SETTLEMENT_PY', r'D:\Ai-Files\Tools\BuildEnv\Scripts\python.exe')
EXE_ROOT = r'D:\Ai-Files\Tools\Exe'


def _digest(path):
    with open(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def check_sources():
    """返回错误文本；None 表示可以继续打包。"""
    repo_html = os.path.join(WEB_ROOT, 'settlement-workbench.html')
    if not os.path.isfile(repo_html):
        return '找不到页面文件: %s' % repo_html
    if os.path.normcase(WEB_ROOT) != os.path.normcase(ROOT) and not os.path.isfile(os.path.join(WEB_ROOT, 'VERSION')):
        return 'SETTLEMENT_WEB_ROOT 指向的不是完整真源（缺 VERSION）: %s' % WEB_ROOT
    copy_html = os.path.join(WORK_COPY, 'settlement-workbench.html')
    if os.path.normcase(WEB_ROOT) != os.path.normcase(WORK_COPY) and os.path.isfile(copy_html):
        if _digest(copy_html) != _digest(repo_html):
            newer = '工作副本较新' if os.path.getmtime(copy_html) > os.path.getmtime(repo_html) else '仓库较新'
            return ('仓库页面与工作副本不一致（%s）：\n  仓库  %s\n  副本  %s\n'
                    '先同步两边（把仓库页面复制到工作副本，或反过来确认后覆盖），再打包。'
                    % (newer, repo_html, copy_html))
    version_py = os.path.join(WEB_ROOT, 'tools', 'sync_version.py')
    if os.path.isfile(version_py):
        code = subprocess.run([PY, version_py, '--check'], cwd=WEB_ROOT, capture_output=True, text=True)
        if code.returncode != 0:
            return (code.stdout or code.stderr or '').strip() or '版本号校验失败'
    return None


with open(os.path.join(ROOT, 'VERSION'), encoding='utf-8') as f:
    VERSION = f.read().strip()
DATE = datetime.datetime.now().strftime('%Y%m%d')

NAME = 'settlement-tool'
DIST = os.path.join(EXE_ROOT, '05-Settlement Tool（制作结算台）', 'settlement-tool-v%s' % VERSION)
WORK = os.path.join(ROOT, 'build', 'work')
SPEC = os.path.join(ROOT, 'build')
# staging：PyInstaller 先建到这里，再把内容整体移入 DIST（扁平化，无嵌套子目录）
STAGING = os.path.join(ROOT, 'build', 'staging')
ENTRY = os.path.join(ROOT, 'src', 'desktop_app.py')
ICON = os.path.join(WEB_ROOT, 'assets', 'icons', 'app.ico')

# 打包后必须在 _internal 里存在的东西，缺一个 exe 就白屏或功能缺失
MUST_HAVE = [
    'settlement-workbench.html',
    'VERSION',
    os.path.join('assets', 'xlsx.full.min.js'),
    os.path.join('webview', 'lib', 'Microsoft.Web.WebView2.WinForms.dll'),
    os.path.join('webview', 'lib', 'Microsoft.Web.WebView2.Core.dll'),
]


def main():
    if not os.path.isfile(PY):
        print('[失败] 打包解释器不存在: %s（可用 SETTLEMENT_PY 指定）' % PY)
        return 1
    if not os.path.isfile(ENTRY):
        print('[失败] 入口文件不存在: %s' % ENTRY)
        return 1
    problem = check_sources()
    if problem:
        print('[失败] 真源校验未通过：\n%s' % problem)
        return 1
    print('[校验] 真源 = %s（%s）' % (WEB_ROOT, '仓库' if os.path.normcase(WEB_ROOT) == os.path.normcase(ROOT) else '自定义'))
    # 打包排除手工备份件（S3-3.5）：.bak 只该留在本机，不该进包
    for stale in os.listdir(os.path.join(WEB_ROOT, 'assets', 'icons')):
        if '.bak' in stale:
            print('[提示] 图标目录有备份件（不进包）: %s' % stale)

    # 清理 staging
    shutil.rmtree(STAGING, ignore_errors=True)
    os.makedirs(STAGING, exist_ok=True)

    # 旧 work 目录改名让路（不硬删：PyInstaller --clean 清几十个文件会撞
    # 沙箱「50+ 文件批量删除」拦截导致退出码 1；改名安全且可追溯）
    if os.path.isdir(WORK):
        os.rename(WORK, WORK + '.old-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))

    cmd = [
        PY, '-m', 'PyInstaller',
        '--noconfirm', '--clean',
        '--onedir', '--windowed',
        '--name', NAME,
        '--icon', ICON,
        # 网页本体与离线依赖
        '--add-data', os.path.join(WEB_ROOT, 'settlement-workbench.html') + os.pathsep + '.',
        '--add-data', os.path.join(WEB_ROOT, 'assets') + os.pathsep + 'assets',
        '--add-data', os.path.join(ROOT, 'VERSION') + os.pathsep + '.',
        # pywebview：lib/*.dll（WebView2 互操作）+ js 注入脚本
        '--collect-data', 'webview',
        '--collect-submodules', 'webview',
        # pythonnet（clr）：自带 _pyinstaller hook，靠 hidden-import 触发
        '--hidden-import', 'clr',
        '--hidden-import', 'clr_loader',
        '--distpath', STAGING,
        '--workpath', WORK,
        '--specpath', SPEC,
        ENTRY,
    ]
    print('打包命令:\n  %s\n' % ' '.join(cmd))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        print('\n[失败] PyInstaller 退出码 %d' % r.returncode)
        return r.returncode

    built = os.path.join(STAGING, NAME)
    if not os.path.isfile(os.path.join(built, NAME + '.exe')):
        print('\n[失败] 未产出 exe: %s' % built)
        return 1

    # 落地校验：html / 依赖 / WebView2 dll 是否都在
    internal = os.path.join(built, '_internal')
    missing = [m for m in MUST_HAVE if not os.path.isfile(os.path.join(internal, m))]
    if missing:
        print('\n[失败] _internal 缺少必要文件:')
        for m in missing:
            print('   - %s' % m)
        return 1
    print('\n[校验] _internal 必要文件齐全（%d 项）' % len(MUST_HAVE))

    # 旧产物改名保留（不删除）
    if os.path.isdir(DIST):
        run_id = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        archive = os.path.join(EXE_ROOT, '00-Archive（归档）')
        os.makedirs(archive, exist_ok=True)
        prev = os.path.join(archive, os.path.basename(DIST) + '-重建前-' + run_id + '-' + datetime.datetime.now().strftime('%f'))
        os.rename(DIST, prev)
        print('[keep] 旧产物已改名保留: %s' % prev)

    # 把 staging 产物内容移入 DIST（扁平化：exe 与 _internal 直接在 DIST 根下）
    os.makedirs(DIST, exist_ok=True)
    for item in os.listdir(built):
        shutil.move(os.path.join(built, item), os.path.join(DIST, item))

    exe = os.path.join(DIST, NAME + '.exe')
    print('\n完成: %s' % exe)
    print('存在: %s' % os.path.isfile(exe))

    # 清理 staging
    shutil.rmtree(STAGING, ignore_errors=True)
    return 0 if os.path.isfile(exe) else 1


if __name__ == '__main__':
    sys.exit(main())
