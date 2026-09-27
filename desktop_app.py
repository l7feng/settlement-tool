# -*- coding: utf-8 -*-
"""短剧混音结算工作台 · 桌面版入口

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
    D:\\My-Temporary\\pt-build-env\\Scripts\\python.exe desktop_app.py

打包：build_exe.py（onedir，html + assets + VERSION 随行进 _internal）
"""
import base64
import ctypes
import ctypes.wintypes as wt
import functools
import http.server
import os
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request

import webview

APP_NAME = '短剧混音结算工作台'
PORT_BASE = 26788
PORT_RANGE = 20          # 26788 ~ 26807
PING_PATH = '/__app_ping__'
PING_BODY = b'settlement-tool-ok'
# 像素探针阈值：整窗颜色种类少于该值＝页面没画出来（黑屏/白屏）
MIN_DISTINCT_COLORS = 64
# 双保险：客户区最主色占比超过该值＝纯底色没渲染（哪怕颜色种类侥幸过线）
MAX_TOP_RATIO = 0.97


def resource_dir():
    """html / assets / VERSION 所在目录：打包后为 sys._MEIPASS，开发时为脚本目录。"""
    return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))


def read_version():
    try:
        with open(os.path.join(resource_dir(), 'VERSION'), encoding='utf-8') as f:
            return f.read().strip()
    except Exception:
        return '0.0.0'


VERSION = read_version()


def data_dir():
    """用户数据目录（浏览器 profile / 导出默认位置），与 exe 本体分离，升级不丢数据。"""
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    d = os.path.join(base, 'SettlementTool')
    os.makedirs(d, exist_ok=True)
    return d


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

    def do_GET(self):
        if self.path.split('?')[0] == PING_PATH:
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(PING_BODY)))
            self.end_headers()
            self.wfile.write(PING_BODY)
            return
        http.server.SimpleHTTPRequestHandler.do_GET(self)


class _Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def _ping(port):
    """探测某端口上是不是本工具自己的旧实例。"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d%s' % (port, PING_PATH), timeout=1.5) as r:
            return r.read() == PING_BODY
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
            if i == 0 and _ping(port):
                print('[server] 端口 %d 上已有本工具实例，直接复用' % port)
                return None, port
            continue
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
    print('[probe] 客户区颜色种类 = %s，最主色占比 %.0f%% → %s'
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

    def app_info(self):
        return {'version': VERSION, 'dataDir': data_dir(), 'mode': 'pywebview'}

    def open_data_folder(self):
        path = data_dir()
        try:
            os.startfile(path)  # noqa: S606
        except Exception:
            subprocess.Popen(['explorer', path])
        return path

    def save_file(self, name, b64):
        """网页 Blob 下载兜底：弹原生保存对话框，失败则落到数据目录。"""
        try:
            raw = base64.b64decode(b64)
        except Exception as e:
            print('[save_file] base64 解码失败:', e)
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
            print('[save_file] 保存对话框不可用，改用数据目录:', e)

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
            print('[save_file] 写入失败:', e)
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
    webview.start(private_mode=False, storage_path=storage, gui='edgechromium')

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
        print('[失败] 未找到 Edge / Chrome，无法启动应用窗口')
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
    print('[fallback] 启动应用窗口: %s' % exe)
    p = subprocess.Popen(cmd)
    p.wait()
    return True


# ═══════════════════════════════════════════════════════
def main():
    root = resource_dir()
    html = os.path.join(root, 'settlement-workbench.html')
    if not os.path.isfile(html):
        print('[失败] 找不到页面文件: %s' % html)
        return 1

    try:
        _srv, port = start_page_server(root)
    except OSError as e:
        print('[失败] %s' % e)
        return 1
    url = page_url(port)
    print('[server] %s' % url)

    if run_pywebview(url):
        return 0

    print('[fallback] WebView2 未渲染，转 Edge --app 模式')
    return 0 if run_browser_app(url) else 1


if __name__ == '__main__':
    sys.exit(main())
