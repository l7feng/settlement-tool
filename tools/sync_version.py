# -*- coding: utf-8 -*-
"""版本号唯一来源（S3-3.4）：VERSION 文件 → assets/version.js。

页面不再写死版本号，打包前强制 --check；两处不一致就让构建失败，而不是等用户
在界面上看到「v2.8.3」而文件名是 v2.8.4。

用法：
    python tools/sync_version.py            # 按 VERSION 重写 assets/version.js
    python tools/sync_version.py --check     # 只检查，不一致返回 1
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, 'assets', 'version.js')
PATTERN = re.compile(r"window\.SETTLEMENT_VERSION\s*=\s*'([^']*)'")


def read_version():
    with open(os.path.join(ROOT, 'VERSION'), encoding='utf-8') as handle:
        return handle.read().strip()


def current():
    try:
        with open(TARGET, encoding='utf-8') as handle:
            match = PATTERN.search(handle.read())
            return match.group(1) if match else None
    except OSError:
        return None


def render(version):
    return ("// 版本号唯一来源（S3-3.4）：由 tools/sync_version.py 从仓库根 VERSION 生成，勿手改。\n"
            "window.SETTLEMENT_VERSION = '%s';\n" % version)


def main(argv):
    version = read_version()
    if '--check' in argv:
        found = current()
        if found != version:
            print('[失败] assets/version.js 是 %s，VERSION 是 %s；先跑 python tools/sync_version.py' % (found, version))
            return 1
        print('[校验] 版本号一致：%s' % version)
        return 0
    with open(TARGET, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(render(version))
    print('[写入] assets/version.js = %s' % version)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
