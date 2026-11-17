# -*- coding: utf-8 -*-
"""制作结算台 · 桌面版入口

窗口壳两级回退（2026-09-28 裁决：两个都做，内置回退）：
  1. pywebview（WebView2 内嵌窗口）—— 首选。部分机器上 WebView2 会整块黑屏
     （本机实测：窗口正常、内容全黑），所以启动后自动做一次「像素探针」：
     截自己窗口数颜色，颜色过少＝没渲染出来 → 销毁窗口，转方案 2。
  2. Edge --app（系统 Edge 的应用窗口模式）—— 兜底。独立窗口、无地址栏无工具栏，
     本机实测渲染正常；数据落在独立 profile 目录，浏览器原生下载可用。

两种方案共用同一个内置 http://127.0.0.1:<固定端口> 页面服务：
  - 用 http 源而不是 file:// —— file:// 是不透明源，WebView2 下 localStorage 可能
    被当临时存储，一关就清空；http 源行为确定。
  - 用固定端口（26788 起）而不是随机端口 —— localStorage 按「源」隔离，
    源变了数据就没了；固定端口保证跨次启动数据不丢。

用法（开发态）：
    D:\\Ai-Files\\Tools\\BuildEnv\\Scripts\\python.exe src/desktop_app.py

打包：tools/build_exe.py（onedir，html + assets + VERSION 随行进 _internal）
"""
import base64
import ctypes
import ctypes.wintypes as wt
import functools
import hashlib
import json
import logging
import logging.handlers
import secrets
from workspace_store import WorkspaceStore
import http.server
import os
import socketserver
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

import webview

APP_NAME = '制作结算台'
PORT_BASE = 26788
PORT_RANGE = 20          # 26788 ~ 26807
PING_PATH = '/__app_ping__'
PING_BODY = b'settlement-tool-workspace-v1'
WORKSPACE_TOKEN = secrets.token_urlsafe(32)
# 像素探针阈值：整窗颜色种类少于该值＝页面没画出来（黑屏/白屏）
MIN_DISTINCT_COLORS = 64
# 双保险：客户区最主色占比超过该值＝纯底色没渲染（哪怕颜色种类侥幸过线）
MAX_TOP_RATIO = 0.97


def resource_dir():
    """html / assets / VERSION 所在目录：打包后为 sys._MEIPASS，开发时为脚本目录。"""
    return getattr(sys, '_MEIPASS', os.environ.get('SETTLEMENT_WEB_ROOT', r'D:\Ai-Files\Tools\Html\settlement-tool'))


def read_version():
    try:
        version_root = resource_dir() if getattr(sys, 'frozen', False) else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(version_root, 'VERSION'), encoding='utf-8') as f:
            return f.read().strip()
    except Exception:
        return '0.0.0'


VERSION = read_version()


def data_dir():
    """用户数据目录（浏览器 profile / 导出默认位置），与 exe 本体分离，升级不丢数据。"""
    override = os.environ.get('SETTLEMENT_DATA_ROOT')
    if override:
        os.makedirs(override, exist_ok=True)
        return override
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    d = os.path.join(base, 'SettlementTool')
    os.makedirs(d, exist_ok=True)
    return d


# ═══════════════════════════════════════════════════════
# 文件日志：exe 是窗口程序，没有控制台；出问题只能靠数据目录里的日志
# ═══════════════════════════════════════════════════════
LOGGER = logging.getLogger('settlement')


def setup_logging():
    """写 <数据目录>/logs/app.log，单文件 1MB × 3 份滚动。失败不影响启动。"""
    try:
        handler = logging.handlers.RotatingFileHandler(
            os.path.join(log_dir(), 'app.log'), maxBytes=1_000_000, backupCount=3, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        LOGGER.addHandler(handler)
        LOGGER.setLevel(logging.INFO)
        LOGGER.propagate = False
    except Exception as error:                       # 日志本身不能挡住启动
        print('[log] 日志初始化失败:', error)


def log_dir():
    d = os.path.join(data_dir(), 'logs')
    os.makedirs(d, exist_ok=True)
    return d


def log(*parts, level=logging.INFO):
    """进日志文件；同时在有控制台时回显（窗口程序没有控制台，文件是唯一线索）。"""
    text = ' '.join(str(p) for p in parts)
    try:
        LOGGER.log(level, text)
    except Exception:
        pass
    if os.environ.get('SETTLEMENT_LOG_ECHO', 'auto') != '0':
        try:
            if sys.stdout and (os.environ.get('SETTLEMENT_LOG_ECHO') == '1' or sys.stdout.isatty()):
                print(text)
        except Exception:
            pass


# ═══════════════════════════════════════════════════════
# 内置页面服务（http://127.0.0.1:固定端口）
# ═══════════════════════════════════════════════════════
class _Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        # 禁缓存：exe 升级后必须立刻用新页面，不能用旧缓存
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def _authorized(self):
        host = '127.0.0.1:%d' % self.server.server_address[1]
        origin = self.headers.get('Origin')
        return (self.headers.get('Host') == host and
                (not origin or origin == 'http://' + host) and
                secrets.compare_digest(self.headers.get('X-Settlement-Workspace', ''), WORKSPACE_TOKEN))

    def _json(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        route = self.path.split('?')[0]
        if route not in ('/__workspace__', '/__workspace_legacy__') or not self._authorized():
            return self._json(403, {'error': '工作区请求未授权'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > 64 * 1024 * 1024:
                raise ValueError('工作区文件过大或请求为空')
            value = json.loads(self.rfile.read(length))
            if route == '/__workspace_legacy__':
                self.server.workspace.preserve_legacy(value['storage'])
                return self._json(200, {'ok': True})
            if 'storage' in value:
                saved = self.server.workspace.save(value['revision'], value['storage'])
            elif value.get('action') == 'delete-ledger':
                # 删除账本是一个独立动作：只接受「恰好一个业务键」的删除请求，
                # 避免普通增量写入顺手把账本删空。
                changes = value.get('patch')
                if not isinstance(changes, dict) or len(changes) != 1:
                    raise ValueError('删除账本请求无效')
                saved = self.server.workspace.patch(value['revision'], changes, allow_business_delete=True)
            else:
                saved = self.server.workspace.patch(value['revision'], value['patch'])
            return self._json(200, saved)
        except Exception as error:
            return self._json(409, {'error': str(error)})

    def do_GET(self):
        route = self.path.split('?')[0]
        if route == '/__workspace__':
            if not self._authorized():
                return self._json(403, {'error': '工作区请求未授权'})
            try:
                saved = self.server.workspace.read()
                saved['path'] = str(self.server.workspace.path)
                return self._json(200, saved)
            except Exception as error:
                return self._json(409, {'error': str(error)})
        if route == '/__upgrade_blob__':
            # 升级前快照原文搬出账本后，导出时按索引名取回（名字过白名单，杜绝路径穿越）。
            if not self._authorized():
                return self._json(403, {'error': '工作区请求未授权'})
            try:
                params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                text = self.server.workspace.read_upgrade_blob((params.get('file') or [''])[0])
                body = text.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as error:
                return self._json(404, {'error': str(error)})
            return
        if route == '/assets/desktop-workspace.js':
            raw = ("window.__settlementWorkspaceToken=" + json.dumps(WORKSPACE_TOKEN) + ";\n").encode('utf-8')
            with open(os.path.join(self.directory, 'assets', 'desktop-workspace.js'), 'rb') as stream:
                raw += stream.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if self.path.split('?')[0] == PING_PATH:
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(PING_BODY)))
            self.send_header('X-Settlement-Version', VERSION)
            self.send_header('X-Settlement-Workspace-Root', workspace_root_id())
            self.end_headers()
            self.wfile.write(PING_BODY)
            return
        http.server.SimpleHTTPRequestHandler.do_GET(self)


class _Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        # Windows SO_REUSEADDR permits two live listeners on one address.
        # Use exclusive binding so the version/root probe can actually run.
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def workspace_root_id():
    # Do not reuse another version or an isolated test's data server.
    normalized = os.path.normcase(os.path.realpath(data_dir()))
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def _ping(port):
    """探测某端口上是不是本工具自己的旧实例。"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d%s' % (port, PING_PATH), timeout=1.5) as r:
            return (r.read() == PING_BODY and
                    r.headers.get('X-Settlement-Version') == VERSION and
                    r.headers.get('X-Settlement-Workspace-Root') == workspace_root_id())
    except Exception:
        return False


def start_page_server(root):
    """起页面服务。返回 (server 或 None, port)。None 表示复用了已在运行的实例。"""
    handler = functools.partial(_Handler, directory=root)
    for i in range(PORT_RANGE):
        port = PORT_BASE + i
        try:
            srv = _Server(('127.0.0.1', port), handler)
        except OSError:
            if _ping(port):
                log('[server] 端口 %d 上已有本工具实例，直接复用' % port)
                return None, port
            continue
        srv.workspace = WorkspaceStore(data_dir())
        # 启动时把升级前快照原文搬出账本（幂等）：现役账本 5.96MB 里有 3.91MB 是 20 份内联快照。
        try:
            if srv.workspace.migrate_upgrades():
                log('[server] 已把升级前快照原文搬到 upgrade/ 目录')
        except Exception as error:
            log('[server] 快照外置跳过：%s' % error)
        # 数据目录自清洁（白名单+保留最新 N 份，逐条写日志）
        try:
            import data_hygiene
            result = data_hygiene.run(data_dir(), log=log)
            if result['files']:
                log('[clean] 本次清理 %d 项，释放 %.1f MB' % (result['files'], result['bytes'] / 1048576))
        except Exception as error:
            log('[clean] 清理跳过：%s' % error)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv, port
    raise OSError('端口 %d~%d 全被占用，无法启动页面服务' % (PORT_BASE, PORT_BASE + PORT_RANGE - 1))


def page_url(port):
    return 'http://127.0.0.1:%d/settlement-workbench.html' % port


# ═══════════════════════════════════════════════════════
# 像素探针：判断 pywebview 窗口是否真的渲染出来了
# ═══════════════════════════════════════════════════════
class _BMIH(ctypes.Structure):
    _fields_ = [('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32),
                ('biHeight', ctypes.c_int32), ('biPlanes', ctypes.c_uint16),
                ('biBitCount', ctypes.c_uint16), ('biCompression', ctypes.c_uint32),
                ('biSizeImage', ctypes.c_uint32), ('biXPelsPerMeter', ctypes.c_int32),
                ('biYPelsPerMeter', ctypes.c_int32), ('biClrUsed', ctypes.c_uint32),
                ('biClrImportant', ctypes.c_uint32)]


def find_visible_window(title_sub):
    """按标题片段找可见顶层窗口，返回 hwnd 或 0。"""
    user32 = ctypes.windll.user32
    hits = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, l):
        n = user32.GetWindowTextLengthW(h)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(h, buf, n + 1)
            if title_sub in buf.value and user32.IsWindowVisible(h):
                hits.append(h)
        return True

    user32.EnumWindows(cb, 0)
    return hits[0] if hits else 0


def distinct_colors(title_sub):
    """PrintWindow 截窗口，**裁到客户区**后统计颜色多样性。

    返回 (颜色种类数, 最主色占比)；找不到窗口返回 (-1, 1.0)。
    为什么只看客户区：标题栏文字/边框的抗锯齿颜色会把「空窗口」误抬到上百色
    （2026-09-28 实测：未渲染空窗整窗 110 色 > 64 阈值，探针漏判，兜底永不触发）。
    客户区没渲染＝纯底色（约 1 种颜色）；正常 UI＝几百上千种。
    """
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    PW_RENDERFULLCONTENT = 0x00000002

    hwnd = find_visible_window(title_sub)
    if not hwnd:
        return -1, 1.0
    wr = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(wr))
    w, h = wr.right - wr.left, wr.bottom - wr.top
    if w <= 0 or h <= 0:
        return -1, 1.0

    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    old = gdi32.SelectObject(mem, bmp)
    ok = user32.PrintWindow(hwnd, mem, PW_RENDERFULLCONTENT)

    bmi = _BMIH(ctypes.sizeof(_BMIH), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    got = gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0) if ok else 0
    gdi32.SelectObject(mem, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    if not got:
        return -1, 1.0
    raw = buf.raw

    # 客户区在窗口位图中的位置：客户区屏幕坐标 - 窗口左上角屏幕坐标
    cr = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(cr))
    pt = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    ox = max(0, pt.x - wr.left)
    oy = max(0, pt.y - wr.top)
    cw = min(cr.right, w - ox)
    ch = min(cr.bottom, h - oy)
    if cw <= 0 or ch <= 0:
        return -1, 1.0

    colors = {}
    total = 0
    row_bytes = w * 4
    for y in range(oy, oy + ch, 3):              # 每 3 行取 1 行
        base = y * row_bytes + ox * 4
        for i in range(base, base + cw * 4 - 3, 12):   # 每 3 像素取 1 个
            px = raw[i:i + 3]
            colors[px] = colors.get(px, 0) + 1
            total += 1
    if not total:
        return -1, 1.0
    top_ratio = max(colors.values()) / float(total)
    return len(colors), top_ratio


def _probe_pywebview(window, state):
    """子线程：等页面加载完再探针，失败就销毁窗口（webview.start 会随之返回）。"""
    try:
        window.events.loaded.wait(15)
    except Exception:
        pass
    time.sleep(3)                  # 给首帧渲染留时间
    n, ratio = distinct_colors(APP_NAME)
    state['colors'] = n
    state['ok'] = (n >= MIN_DISTINCT_COLORS) and (ratio <= MAX_TOP_RATIO)
    log('[probe] 客户区颜色种类 = %s，最主色占比 %.0f%% → %s'
          % (n, ratio * 100, '正常' if state['ok'] else '未渲染（黑屏/白屏/纯底色）'))
    if not state['ok']:
        try:
            window.destroy()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════
# 方案 1：pywebview（WebView2 内嵌）
# ═══════════════════════════════════════════════════════
class Api(object):
    """暴露给网页的原生能力（window.pywebview.api.*，仅方案 1 存在）"""

    # 网页只允许导出这几类文件；不在白名单内的名字直接拒绝，避免被当成任意写盘入口。
    EXPORT_EXTENSIONS = frozenset(('.json', '.csv', '.xlsx', '.xls', '.txt', '.md', '.zip'))
    MAX_EXPORT_BYTES = 256 * 1024 * 1024

    def app_info(self):
        return {'version': VERSION, 'dataDir': data_dir(), 'mode': 'pywebview'}

    def open_data_folder(self):
        path = data_dir()
        try:
            os.startfile(path)  # noqa: S606
        except Exception:
            subprocess.Popen(['explorer', path])
        return path

    @classmethod
    def safe_export_name(cls, name):
        """只取文件名部分并校验扩展名；拒绝路径分隔符、盘符、控制字符与空名。"""
        text = name if isinstance(name, str) else ''
        text = text.replace('\\', '/').split('/')[-1]          # 去掉任何目录部分
        if any(ch < ' ' or ch == '\x7f' for ch in text):
            raise ValueError('导出文件名无效')
        text = text.strip()
        stem, ext = os.path.splitext(text)
        if not stem.strip(' .') or not ext:
            raise ValueError('导出文件名无效')
        if ext.lower() not in cls.EXPORT_EXTENSIONS:
            raise ValueError('不支持的导出文件类型：%s' % ext)
        if len(text) > 120:
            text = stem[:120 - len(ext)] + ext
        return text

    def save_file(self, name, b64):
        """网页 Blob 下载兜底：弹原生保存对话框，失败则落到数据目录。"""
        try:
            raw = base64.b64decode(b64)
        except Exception as e:
            log('[save_file] base64 解码失败:', e)
            return ''
        if len(raw) > self.MAX_EXPORT_BYTES:
            log('[save_file] 文件过大，已拒绝:', len(raw))
            return ''
        try:
            name = self.safe_export_name(name)
        except ValueError as e:
            log('[save_file] 文件名被拒绝:', e)
            return ''

        path = ''
        try:
            win = webview.active_window()
            res = win.create_file_dialog(
                webview.SAVE_DIALOG,
                directory=data_dir(),
                save_filename=name,
            )
            if isinstance(res, (list, tuple)):
                res = res[0] if res else ''
            if res:
                path = str(res)
        except Exception as e:
            log('[save_file] 保存对话框不可用，改用数据目录:', e)

        if not path:
            path = os.path.join(data_dir(), name)
            root_, ext = os.path.splitext(path)
            i = 1
            while os.path.exists(path):
                path = '%s (%d)%s' % (root_, i, ext)
                i += 1

        try:
            with open(path, 'wb') as f:
                f.write(raw)
        except Exception as e:
            log('[save_file] 写入失败:', e)
            return ''
        return path


def run_pywebview(url):
    """跑 pywebview；返回 True＝用户正常使用（渲染通过或窗口被手动关闭）。"""
    api = Api()
    window = webview.create_window(
        '%s  v%s' % (APP_NAME, VERSION),
        url=url,
        js_api=api,
        width=1440,
        height=900,
        min_size=(1100, 680),
        background_color='#EDF2F2',
        text_select=True,
    )
    state = {}
    threading.Thread(target=_probe_pywebview, args=(window, state), daemon=True).start()

    storage = os.path.join(data_dir(), 'webview-data')
    os.makedirs(storage, exist_ok=True)
    webview.start(private_mode=False, storage_path=storage, gui='edgechromium',
                  icon=os.path.join(resource_dir(), 'assets', 'icons', 'app.ico'))

    if 'ok' not in state:          # 探针还没跑完用户就关了窗 → 当作正常使用
        return True
    return bool(state['ok'])


# ═══════════════════════════════════════════════════════
# 方案 2：Edge --app（系统 Edge 的应用窗口）
# ═══════════════════════════════════════════════════════
def find_edge():
    for p in (r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
              r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'):
        if os.path.isfile(p):
            return p
    return None


def find_chrome():
    for p in (r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
        if os.path.isfile(p):
            return p
    return None


def run_browser_app(url):
    """Edge --app 模式。阻塞到浏览器窗口关闭为止。返回是否成功启动。"""
    exe = find_edge() or find_chrome()
    if not exe:
        log('[失败] 未找到 Edge / Chrome，无法启动应用窗口')
        return False
    profile = os.path.join(data_dir(), 'edge-profile')
    os.makedirs(profile, exist_ok=True)
    cmd = [
        exe,
        '--app=' + url,
        '--user-data-dir=' + profile,
        '--window-size=1440,940',
        '--no-first-run',
        '--no-default-browser-check',
    ]
    log('[fallback] 启动应用窗口: %s' % exe)
    p = subprocess.Popen(cmd)
    p.wait()
    return True


# ═══════════════════════════════════════════════════════
def main():
    setup_logging()
    # 未捕获异常也要落盘：窗口程序闪退时没有控制台，日志是唯一证据。
    def _hook(kind, value, tb):
        try:
            LOGGER.error('未捕获异常（%s）', kind, exc_info=(type(value), value, tb))
            log('[崩溃] %s: %s' % (kind, value), level=logging.ERROR)
        except Exception:
            pass
    sys.excepthook = lambda kind, value, tb: _hook('excepthook', value, tb)
    try:
        threading.excepthook = lambda arg: _hook('threading', arg.exc_value, arg.exc_traceback)
    except Exception:
        pass
    log('[启动] 版本 %s，数据目录 %s' % (VERSION, data_dir()))
    root = resource_dir()
    html = os.path.join(root, 'settlement-workbench.html')
    if not os.path.isfile(html):
        log('[失败] 找不到页面文件: %s' % html)
        return 1

    try:
        _srv, port = start_page_server(root)
    except OSError as e:
        log('[失败] %s' % e)
        return 1
    url = page_url(port)
    log('[server] %s' % url)

    if run_pywebview(url):
        return 0

    log('[fallback] WebView2 未渲染，转 Edge --app 模式')
    return 0 if run_browser_app(url) else 1


if __name__ == '__main__':
    sys.exit(main())

