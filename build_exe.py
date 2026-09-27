# -*- coding: utf-8 -*-
"""打包桌面版（pywebview 原生窗口 + 本地 HTML）为 exe（onedir，启动快）

网页版与 exe 共用同一份 settlement-workbench.html，功能天然同步。
打包只做三件事：把 html / assets / VERSION 塞进 _internal，把 pywebview 的
WebView2 互操作 dll 带上，再用 desktop_app.py 当入口（pywebview 黑屏时自动切 Edge --app）。

用法（在打包环境里跑）：
    D:\\My-Temporary\\pt-build-env\\Scripts\\python.exe build_exe.py

出口布局（扁平化）：
    <EXE_ROOT>/settlement-tool-v<版本>-<日期>/
        settlement-tool.exe   +  _internal/
"""
import datetime
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PY = r'D:\My-Temporary\pt-build-env\Scripts\python.exe'
EXE_ROOT = r'D:\Ai-Files\Agent-Preset\exe'

with open(os.path.join(ROOT, 'VERSION'), encoding='utf-8') as f:
    VERSION = f.read().strip()
DATE = datetime.datetime.now().strftime('%Y%m%d')

NAME = 'settlement-tool'
DIST = os.path.join(EXE_ROOT, '%s-v%s-%s' % (NAME, VERSION, DATE))
WORK = os.path.join(ROOT, 'build', 'work')
SPEC = os.path.join(ROOT, 'build')
# staging：PyInstaller 先建到这里，再把内容整体移入 DIST（扁平化，无嵌套子目录）
STAGING = os.path.join(ROOT, 'build', 'staging')
ENTRY = os.path.join(ROOT, 'desktop_app.py')
ICON = os.path.join(ROOT, 'assets', 'app.ico')

# 打包后必须在 _internal 里存在的东西，缺一个 exe 就白屏或功能缺失
MUST_HAVE = [
    'settlement-workbench.html',
    'VERSION',
    os.path.join('assets', 'xlsx.full.min.js'),
    os.path.join('assets', 'jszip.min.js'),
    os.path.join('webview', 'lib', 'Microsoft.Web.WebView2.WinForms.dll'),
    os.path.join('webview', 'lib', 'Microsoft.Web.WebView2.Core.dll'),
]


def main():
    if not os.path.isfile(PY):
        print('[失败] 打包解释器不存在: %s' % PY)
        return 1
    if not os.path.isfile(ENTRY):
        print('[失败] 入口文件不存在: %s' % ENTRY)
        return 1

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
        '--add-data', os.path.join(ROOT, 'settlement-workbench.html') + os.pathsep + '.',
        '--add-data', os.path.join(ROOT, 'assets') + os.pathsep + 'assets',
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
        prev = DIST + '.prev-' + run_id
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
