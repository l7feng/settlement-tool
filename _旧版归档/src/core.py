# -*- coding: utf-8 -*-
"""短剧混音结算工具 · 核心模块

职责：
  1. 数据层：读写 data.json（项目 / 集 / 单价）
  2. 表现层：按 v4 三表联动样式重建 xlsx（全公式联动）
  3. 汇总计算：内存中算当前总额，供 GUI 顶部显示
"""
import os
import json
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import DataBarRule, CellIsRule

from wav_reader import t2sec

# ══════════════════════════════════════════════════════════════
# 路径
# ══════════════════════════════════════════════════════════════
DATA_DIR = r"D:\1-个人知识库_Vault\5-领域\01-声音后期\03-短剧混音结算"
XLSX_NAME = "01-短剧混音结算系统（settlement-system）.xlsx"
DATA_NAME = "data.json"

# ══════════════════════════════════════════════════════════════
# 常量
# ══════════════════════════════════════════════════════════════
M_BYMIN = "按时长"
M_BYEP = "按集"
T_FORMAL = "正式"
T_DEMO = "Demo"
GRADES = ["A", "B", "C", "D"]

# 首次运行的默认数据（与 v4 现有 xlsx 完全一致）
DEFAULT_DATA = {
    "prices": {
        "A": {"per_min": 78, "per_ep": 78},
        "B": {"per_min": 30, "per_ep": 30},
        "C": {"per_min": 15, "per_ep": 15},
        "D": {"per_min": 10, "per_ep": 10},
    },
    "projects": [
        {"name": "巨巫", "grade": "C", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\1-巨巫C_20260810_7F\Out",
         "episodes": {"5": {"date": "2026-08-14", "duration": "00:01:41"},
                      "6": {"date": "2026-08-14", "duration": "00:01:15"},
                      "7": {"date": "2026-08-14", "duration": "00:01:09"}}},
        {"name": "独眼", "grade": "C", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\2-独眼C_20260818_7F\交付文件",
         "episodes": {"5": {"date": "2026-08-19", "duration": "00:01:47"},
                      "6": {"date": "2026-08-19", "duration": "00:01:30"},
                      "7": {"date": "2026-08-19", "duration": "00:01:23"}}},
        {"name": "首付", "grade": "C", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\3-首付C_20260813_7f\0-归档\交付文件",
         "episodes": {"2": {"date": "2026-08-12", "duration": "00:02:38"},
                      "3": {"date": "2026-08-12", "duration": "00:01:41"},
                      "4": {"date": "2026-08-12", "duration": "00:01:54"},
                      "6": {"date": "2026-08-17", "duration": "00:01:17"},
                      "7": {"date": "2026-08-13", "duration": "00:01:00"},
                      "8": {"date": "2026-08-13", "duration": "00:01:23"},
                      "9": {"date": "2026-08-13", "duration": "00:01:04"},
                      "10": {"date": "2026-08-13", "duration": "00:01:07"},
                      "11": {"date": "2026-08-14", "duration": "00:01:32"},
                      "12": {"date": "2026-08-14", "duration": "00:01:31"},
                      "13": {"date": "2026-08-14", "duration": "00:01:32"},
                      "14": {"date": "2026-08-14", "duration": "00:01:12"},
                      "15": {"date": "2026-08-14", "duration": "00:01:16"},
                      "16": {"date": "2026-08-14", "duration": "00:01:46"},
                      "17": {"date": "2026-08-14", "duration": "00:01:29"},
                      "18": {"date": "2026-08-17", "duration": "00:01:30"},
                      "19": {"date": "2026-08-17", "duration": "00:02:00"},
                      "20": {"date": "2026-08-17", "duration": "00:01:07"}}},
        {"name": "女帝", "grade": "C", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\4-女帝C_20260825_7F\交付文件",
         "episodes": {
             "17": {"date": "2026-08-31", "duration": "00:01:16"},
             "18": {"date": "2026-08-31", "duration": "00:01:13"},
             "19": {"date": "2026-08-31", "duration": "00:01:25"},
             "20": {"date": "2026-08-31", "duration": "00:01:35"},
             "21": {"date": "2026-08-31", "duration": "00:01:21"},
             "22": {"date": "2026-08-31", "duration": "00:01:56"},
             "23": {"date": "2026-09-01", "duration": "00:01:45"},
             "24": {"date": "2026-09-01", "duration": "00:01:34"},
             "37": {"date": "2026-09-01", "duration": "00:01:08"},
             "38": {"date": "2026-09-01", "duration": "00:01:17"},
             "39": {"date": "2026-09-01", "duration": "00:01:45"},
             "40": {"date": "2026-09-01", "duration": "00:01:15"},
             "48": {"date": "2026-08-27", "duration": "00:01:48"},
             "49": {"date": "2026-08-27", "duration": "00:01:43"},
             "50": {"date": "2026-08-27", "duration": "00:01:51"},
             "51": {"date": "2026-08-27", "duration": "00:01:50"},
             "52": {"date": "2026-08-27", "duration": "00:01:29"},
             "53": {"date": "2026-08-27", "duration": "00:01:29"},
             "54": {"date": "2026-08-27", "duration": "00:01:40"},
             "55": {"date": "2026-08-27", "duration": "00:01:42"},
             "56": {"date": "2026-08-27", "duration": "00:01:29"},
             "57": {"date": "2026-08-27", "duration": "00:01:40"},
             "58": {"date": "2026-08-26", "duration": "00:01:53"},
             "59": {"date": "2026-08-26", "duration": "00:01:50"},
             "60": {"date": "2026-08-26", "duration": "00:01:40"},
             "61": {"date": "2026-08-26", "duration": "00:01:51"},
             "62": {"date": "2026-08-26", "duration": "00:01:31"},
             "63": {"date": "2026-08-26", "duration": "00:01:32"},
             "66": {"date": "2026-08-25", "duration": "00:02:11"},
             "67": {"date": "2026-08-25", "duration": "00:01:37"},
             "68": {"date": "2026-08-25", "duration": "00:02:05"},
             "69": {"date": "2026-08-25", "duration": "00:01:41"},
             "70": {"date": "2026-08-28", "duration": "00:01:33"},
             "71": {"date": "2026-08-25", "duration": "00:01:22"},
             "72": {"date": "2026-08-26", "duration": "00:01:30"},
             "73": {"date": "2026-08-26", "duration": "00:01:16"},
             "74": {"date": "2026-08-26", "duration": "00:01:59"},
             "75": {"date": "2026-08-26", "duration": "00:01:51"},
             "76": {"date": "2026-09-01", "duration": "00:01:42"},
             "77": {"date": "2026-09-01", "duration": "00:01:16"},
             "78": {"date": "2026-09-01", "duration": "00:01:17"},
             "79": {"date": "2026-09-01", "duration": "00:02:20"},
             "80": {"date": "2026-09-01", "duration": "00:02:09"}}},
        {"name": "人鱼", "grade": "D", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\5-人鱼D_20260831_7F\交付文件",
         "episodes": {"14": {"date": "2026-08-31", "duration": "00:01:43"},
                      "16": {"date": "2026-08-31", "duration": "00:01:34"},
                      "17": {"date": "2026-09-02", "duration": "00:02:07"},
                      "18": {"date": "2026-09-02", "duration": "00:02:06"},
                      "44": {"date": "2026-08-31", "duration": "00:01:10"},
                      "45": {"date": "2026-08-31", "duration": "00:01:10"},
                      "58": {"date": "2026-09-01", "duration": "00:01:52"},
                      "59": {"date": "2026-09-01", "duration": "00:01:19"},
                      "60": {"date": "2026-09-01", "duration": "00:02:09"}}},
        {"name": "抛弃", "grade": "D", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\6-抛弃D_20260901_7F\交付文件\被丈夫抛弃 （4、5集）0901 V02",
         "episodes": {"4": {"date": "2026-09-01", "duration": "00:01:54"},
                      "5": {"date": "2026-09-01", "duration": "00:01:40"}}},
        {"name": "婚宠", "grade": "D", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\7-婚宠D_20260902_7F\交付文件\归档",
         "episodes": {
             "3": {"date": "2026-09-03", "duration": "00:01:51"},
             "5": {"date": "2026-09-02", "duration": "00:01:41"},
             "6": {"date": "2026-09-02", "duration": "00:01:18"},
             "7": {"date": "2026-09-02", "duration": "00:01:43"},
             "8": {"date": "2026-09-02", "duration": "00:01:39"},
             "9": {"date": "2026-09-02", "duration": "00:01:50"},
             "10": {"date": "2026-09-02", "duration": "00:01:50"},
             "11": {"date": "2026-09-02", "duration": "00:01:51"},
             "13": {"date": "2026-09-03", "duration": "00:01:33"},
             "23": {"date": "2026-09-03", "duration": "00:01:41"},
             "24": {"date": "2026-09-03", "duration": "00:01:35"},
             "25": {"date": "2026-09-03", "duration": "00:01:43"},
             "26": {"date": "2026-09-03", "duration": "00:01:43"},
             "27": {"date": "2026-09-03", "duration": "00:01:44"},
             "28": {"date": "2026-09-03", "duration": "00:01:48"},
             "29": {"date": "2026-09-03", "duration": "00:01:53"},
             "30": {"date": "2026-09-03", "duration": "00:02:42"},
             "31": {"date": "2026-09-03", "duration": "00:02:52"},
             "32": {"date": "2026-09-04", "duration": "00:02:08"},
             "33": {"date": "2026-09-04", "duration": "00:01:31"},
             "34": {"date": "2026-09-04", "duration": "00:01:17"},
             "35": {"date": "2026-09-04", "duration": "00:01:52"},
             "36": {"date": "2026-09-04", "duration": "00:01:46"},
             "37": {"date": "2026-09-04", "duration": "00:02:22"},
             "38": {"date": "2026-09-04", "duration": "00:02:03"},
             "39": {"date": "2026-09-04", "duration": "00:01:57"},
             "40": {"date": "2026-09-04", "duration": "00:01:48"},
             "41": {"date": "2026-09-04", "duration": "00:02:08"},
             "42": {"date": "2026-09-04", "duration": "00:02:18"},
             "43": {"date": "2026-09-04", "duration": "00:01:02"},
             "44": {"date": "2026-09-04", "duration": "00:01:44"},
             "45": {"date": "2026-09-04", "duration": "00:02:21"},
             "46": {"date": "2026-09-04", "duration": "00:02:20"},
             "47": {"date": "2026-09-04", "duration": "00:01:57"},
             "48": {"date": "2026-09-04", "duration": "00:02:24"},
             "49": {"date": "2026-09-04", "duration": "00:02:06"},
             "50": {"date": "2026-09-04", "duration": "00:02:33"},
             "51": {"date": "2026-09-04", "duration": "00:02:17"},
             "52": {"date": "2026-09-04", "duration": "00:02:10"},
             "53": {"date": "2026-09-04", "duration": "00:02:18"},
             "54": {"date": "2026-09-04", "duration": "00:02:20"},
             "55": {"date": "2026-09-04", "duration": "00:02:16"}}},
        {"name": "丑鱼", "grade": "D", "type": T_FORMAL, "mode": M_BYMIN,
         "path": r"D:\Project\8-丑鱼D_20260904_7F\交付文件",
         "episodes": {"2": {"date": "2026-09-07", "duration": "00:01:55"},
                      "3": {"date": "2026-09-07", "duration": "00:01:42"},
                      "4": {"date": "2026-09-04", "duration": "00:01:19"},
                      "5": {"date": "2026-09-04", "duration": "00:01:25"},
                      "16": {"date": "2026-09-07", "duration": "00:01:46"},
                      "17": {"date": "2026-09-07", "duration": "00:01:34"},
                      "18": {"date": "2026-09-07", "duration": "00:01:27"},
                      "19": {"date": "2026-09-07", "duration": "00:01:06"},
                      "20": {"date": "2026-09-07", "duration": "00:01:11"},
                      "21": {"date": "2026-09-07", "duration": "00:01:35"}}},
        {"name": "海后", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\1-海后_20260820_7F\交付文件",
         "episodes": {"1": {"date": "2026-08-20", "duration": "00:02:09"}}},
        {"name": "篮球", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\2-篮球_20260821_7F\交付文件",
         "episodes": {"1": {"date": "2026-08-21", "duration": "00:02:59"}}},
        {"name": "497", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\3-497_20260821_7F",
         "episodes": {"1": {"date": "2026-08-21", "duration": "00:01:31"}}},
        {"name": "王权", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\4-王权_20260821_7F\交付文件",
         "episodes": {"1": {"date": "2026-08-27", "duration": "00:03:32"}}},
        {"name": "反派", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\6-反派_20260901_7F",
         "episodes": {"1": {"date": "2026-08-31", "duration": "00:01:09"}}},
        {"name": "THD", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\7-THD_20260902_7F",
         "episodes": {"1": {"date": "2026-09-02", "duration": "00:02:53"}}},
        {"name": "自驾", "grade": "A", "type": T_DEMO, "mode": M_BYMIN,
         "path": r"D:\Project\0-Demo\5-自驾_20260828_7F",
         "episodes": {"1": {"date": "2026-08-27", "duration": "00:02:29"}}},
    ],
}


# ══════════════════════════════════════════════════════════════
# 配色 —— 素雅冷淡风（与 v4 一致）
# ══════════════════════════════════════════════════════════════
C_MAIN = "3E5C63"
C_MAIN_L = "EDF2F2"
C_BAND = "F8FAFA"
C_WHITE = "FFFFFF"
C_SUM_BG = "EFF4F3"
C_TOTAL_BG = "3E5C63"
C_INPUT = "FDFBF3"
C_LINE = "DAE2E2"
C_TEXT = "2B3A3D"
C_MUTED = "7A8A8C"
C_ACCENT = "9C6B4E"
C_SECTION = "F2F6F5"

F_TITLE = Font(name="微软雅黑", size=15, bold=True, color=C_MAIN)
F_SEC = Font(name="微软雅黑", size=11, bold=True, color=C_MAIN)
F_HEAD = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
F_DATA = Font(name="微软雅黑", size=10, color=C_TEXT)
F_BOLD = Font(name="微软雅黑", size=10, bold=True, color=C_MAIN)
F_PATH = Font(name="微软雅黑", size=9, color=C_MUTED)
F_MONEY = Font(name="微软雅黑", size=10, bold=True, color=C_ACCENT)
F_NOTE = Font(name="微软雅黑", size=9, color=C_MUTED)
F_INPUT = Font(name="微软雅黑", size=11, bold=True, color=C_TEXT)
F_WHITE = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
F_SMALL = Font(name="微软雅黑", size=9, color=C_MUTED)

BORDER = Border(*[Side(style="thin", color=C_LINE)] * 4)
AL_C = Alignment(horizontal="center", vertical="center")
AL_L = Alignment(horizontal="left", vertical="center", wrap_text=True)
AL_R = Alignment(horizontal="right", vertical="center")

FILL = lambda c: PatternFill("solid", fgColor=c)
NUM_MONEY = '#,##0.00'
NUM_MIN = '0.0'
NUM_INT = '0'


def style(cell, font=None, fill=None, align=None, border=True):
    if border:
        cell.border = BORDER
    if font:
        cell.font = font
    if fill:
        cell.fill = FILL(fill)
    if align:
        cell.alignment = align


# ══════════════════════════════════════════════════════════════
# 数据层
# ══════════════════════════════════════════════════════════════
def data_path():
    return os.path.join(DATA_DIR, DATA_NAME)


def xlsx_path():
    return os.path.join(DATA_DIR, XLSX_NAME)


def load_data():
    """读取 data.json；不存在则用默认数据创建。"""
    p = data_path()
    if not os.path.isfile(p):
        save_data(DEFAULT_DATA)
        return json.loads(json.dumps(DEFAULT_DATA))  # deep copy
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_data(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(data_path(), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_project_names(data):
    return [p["name"] for p in data["projects"]]


def find_project(data, name):
    for p in data["projects"]:
        if p["name"] == name:
            return p
    return None


def calc_summary(data):
    """内存汇总，供 GUI 顶部显示。返回 (集数, 总分钟, 总费用)。"""
    total_eps = 0
    total_sec = 0
    total_fee = 0.0
    for p in data["projects"]:
        price = data["prices"][p["grade"]]
        for ep_no, ep in p["episodes"].items():
            total_eps += 1
            sec = t2sec(ep["duration"])
            total_sec += sec
            mode = p.get("mode", M_BYMIN)
            if mode == M_BYEP:
                total_fee += round(price["per_ep"], 2)
            else:
                total_fee += round(sec / 60 * price["per_min"], 2)
    return total_eps, round(total_sec / 60, 1), round(total_fee, 2)


def _fmt_range(a, b):
    """单个区间的字符串：单点直接显示，连续区间用 '-' 连接。"""
    return str(a) if a == b else f"{a}-{b}"


def compress_ranges(numbers):
    """把集号列表压缩成区间字符串。

    [1, 3, 5, 6, 7, 9, 22, 23] → "1，3，5-7，9，22-23"

    用中文全角逗号“，”分隔各段，连续集号合并成 “起-止”。去重并按数值排序，
    非整数或无法转换的项忽略。空列表返回空串。
    """
    nums = []
    for n in numbers:
        try:
            nums.append(int(n))
        except (TypeError, ValueError):
            continue
    nums = sorted(set(nums))
    if not nums:
        return ""
    groups = []
    start = prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
            continue
        groups.append(_fmt_range(start, prev))
        start = prev = n
    groups.append(_fmt_range(start, prev))
    return "，".join(groups)


# ══════════════════════════════════════════════════════════════
# XLSX 生成（复用 v4 样式与公式）
# ══════════════════════════════════════════════════════════════
def generate_xlsx(data, out_path=None):
    """按 data 重建整张 xlsx，返回输出路径。"""
    if out_path is None:
        out_path = xlsx_path()
    prices = data["prices"]
    projects = data["projects"]

    wb = openpyxl.Workbook()

    # ── Sheet 1: 单价配置 ──
    ws_p = wb.active
    ws_p.title = "单价配置"
    ws_p.sheet_properties.tabColor = C_MAIN
    ws_p.merge_cells("A1:D1")
    c = ws_p.cell(row=1, column=1, value="单价配置")
    c.font = F_TITLE; c.alignment = AL_C
    ws_p.row_dimensions[1].height = 34
    ws_p.merge_cells("A2:D2")
    c = ws_p.cell(row=2, column=1,
                  value="每种等级有两套单价：「时长单价」用于按时长结算，「集单价」用于按集结算。修改即时重算。")
    c.font = F_NOTE; c.alignment = Alignment(horizontal="left", vertical="center")
    ws_p.row_dimensions[2].height = 20
    for i, h in enumerate(["等级", "时长单价 (元/分钟)", "集单价 (元/集)", "说明"], 1):
        style(ws_p.cell(row=3, column=i, value=h), F_HEAD, C_MAIN, AL_C)
    ws_p.row_dimensions[3].height = 26
    desc = {"A": "A 级项目（含 Demo）", "B": "B 级项目", "C": "C 级项目", "D": "D 级项目"}
    r = 4
    for g in GRADES:
        style(ws_p.cell(row=r, column=1, value=g), F_BOLD, C_MAIN_L, AL_C)
        pc = ws_p.cell(row=r, column=2, value=prices[g]["per_min"])
        style(pc, F_INPUT, C_INPUT, AL_C); pc.number_format = NUM_MONEY
        ec = ws_p.cell(row=r, column=3, value=prices[g]["per_ep"])
        style(ec, F_INPUT, C_INPUT, AL_C); ec.number_format = NUM_MONEY
        style(ws_p.cell(row=r, column=4, value=desc[g]), F_DATA, None, AL_L)
        ws_p.row_dimensions[r].height = 24
        r += 1
    r += 1
    ws_p.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    c = ws_p.cell(row=r, column=1, value="使用说明"); c.font = F_SEC; c.alignment = AL_L
    notes = [
        "1. 浅米色单元格为输入区，可直接改数。",
        "2. 「按时长结算」小计 = 时长(分钟) × 时长单价；「按集结算」小计 = 1 集 × 集单价。",
        "3. 每一集的计价方式在「项目明细」的『计价方式』列用下拉独立选择。",
        "4. Demo 项目与 A 级同价，已并入「项目明细」并以「类型」列区分。",
    ]
    for i, n in enumerate(notes):
        rr = r + 1 + i
        ws_p.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=4)
        c = ws_p.cell(row=rr, column=1, value=n); c.font = F_NOTE
        c.alignment = AL_L
    ws_p.column_dimensions['A'].width = 12
    ws_p.column_dimensions['B'].width = 20
    ws_p.column_dimensions['C'].width = 18
    ws_p.column_dimensions['D'].width = 34
    ws_p.freeze_panes = "A4"

    # ── Sheet 2: 项目明细 ──
    ws_d = wb.create_sheet("项目明细")
    ws_d.sheet_properties.tabColor = C_MAIN
    ws_d.merge_cells("A1:M1")
    c = ws_d.cell(row=1, column=1, value="项目明细")
    c.font = F_TITLE; c.alignment = AL_C
    ws_d.row_dimensions[1].height = 32
    detail_heads = ["序号", "等级", "类型", "项目", "集数", "日期", "时长", "时长(分钟)",
                    "计价方式", "单价", "小计", "交付路径", "备注"]
    for i, h in enumerate(detail_heads, 1):
        style(ws_d.cell(row=2, column=i, value=h), F_HEAD, C_MAIN, AL_C)
    ws_d.row_dimensions[2].height = 28
    detail_w = {1: 6, 2: 7, 3: 8, 4: 10, 5: 7, 6: 12, 7: 10, 8: 11,
                9: 11, 10: 13, 11: 12, 12: 44, 13: 14}
    for k, v in detail_w.items():
        ws_d.column_dimensions[get_column_letter(k)].width = v

    row = 3
    seq = 0
    for proj in projects:
        seq += 1
        start = row
        mode = proj.get("mode", M_BYMIN)
        eps = proj["episodes"]
        for ep in sorted(eps.keys(), key=lambda x: int(x)):
            info = eps[ep]
            ws_d.cell(row=row, column=1, value=seq)
            ws_d.cell(row=row, column=2, value=proj["grade"])
            ws_d.cell(row=row, column=3, value=proj["type"])
            ws_d.cell(row=row, column=4, value=proj["name"])
            ws_d.cell(row=row, column=5, value=int(ep))
            ws_d.cell(row=row, column=6, value=info["date"])
            ws_d.cell(row=row, column=7, value=info["duration"])
            ws_d.cell(row=row, column=8,
                      value=f'=ROUND((HOUR(TIMEVALUE(G{row}))*3600+MINUTE(TIMEVALUE(G{row}))*60+SECOND(TIMEVALUE(G{row})))/60,2)')
            ws_d.cell(row=row, column=9, value=mode)
            ws_d.cell(row=row, column=10,
                      value=(f'=IFERROR(IF(I{row}="按集",'
                             f'VLOOKUP(B{row},单价配置!$A$4:$C$7,3,FALSE),'
                             f'VLOOKUP(B{row},单价配置!$A$4:$C$7,2,FALSE)),0)'))
            ws_d.cell(row=row, column=11,
                      value=(f'=IF(I{row}="按集",ROUND(J{row},2),'
                             f'ROUND((HOUR(TIMEVALUE(G{row}))*3600+MINUTE(TIMEVALUE(G{row}))*60+SECOND(TIMEVALUE(G{row})))/60*J{row},2))'))
            ws_d.cell(row=row, column=12, value=proj.get("path", ""))
            ws_d.cell(row=row, column=13, value="")
            for col in range(1, 14):
                cell = ws_d.cell(row=row, column=col)
                if col in (4, 12, 13):
                    cell.alignment = AL_L
                elif col in (8, 10, 11):
                    cell.alignment = AL_R
                else:
                    cell.alignment = AL_C
                cell.font = F_DATA
                cell.fill = FILL(C_BAND if (row - start) % 2 == 1 else C_WHITE)
                if col == 12:
                    cell.font = F_PATH
                if col == 11:
                    cell.font = F_MONEY
                if col in (3, 9):
                    cell.font = F_SMALL
                if col == 8:
                    cell.number_format = NUM_MIN
                if col in (10, 11):
                    cell.number_format = NUM_MONEY
                cell.border = BORDER
            row += 1
        end = row - 1
        ws_d.cell(row=row, column=4, value=f"{proj['name']} 小计")
        ws_d.cell(row=row, column=5, value=f'=COUNT(E{start}:E{end})')
        ws_d.cell(row=row, column=8, value=f'=ROUND(SUM(H{start}:H{end}),1)')
        ws_d.cell(row=row, column=11, value=f'=ROUND(SUM(K{start}:K{end}),2)')
        for col in range(1, 14):
            cell = ws_d.cell(row=row, column=col)
            cell.font = F_BOLD; cell.fill = FILL(C_SUM_BG); cell.border = BORDER
            if col in (4, 12, 13):
                cell.alignment = AL_L
            elif col in (8, 11):
                cell.alignment = AL_R
            else:
                cell.alignment = AL_C
        ws_d.cell(row=row, column=5).number_format = NUM_INT
        ws_d.cell(row=row, column=8).number_format = NUM_MIN
        ws_d.cell(row=row, column=11).number_format = NUM_MONEY
        row += 1

    data_first = 3
    data_last = row - 1
    DETMASK = f'ISNUMBER(E{data_first}:E{data_last})'
    ws_d.cell(row=row, column=4, value="全部总计")
    ws_d.cell(row=row, column=5, value=f'=SUMPRODUCT({DETMASK})')
    ws_d.cell(row=row, column=8, value=f'=ROUND(SUMPRODUCT({DETMASK},H{data_first}:H{data_last}),1)')
    ws_d.cell(row=row, column=11, value=f'=ROUND(SUMPRODUCT({DETMASK},K{data_first}:K{data_last}),2)')
    for col in range(1, 14):
        cell = ws_d.cell(row=row, column=col)
        cell.font = F_WHITE; cell.fill = FILL(C_TOTAL_BG); cell.border = BORDER
        if col in (4, 12, 13):
            cell.alignment = AL_L
        elif col in (8, 11):
            cell.alignment = AL_R
        else:
            cell.alignment = AL_C
    ws_d.cell(row=row, column=5).number_format = NUM_INT
    ws_d.cell(row=row, column=8).number_format = NUM_MIN
    ws_d.cell(row=row, column=11).number_format = NUM_MONEY
    ws_d.row_dimensions[row].height = 26

    ws_d.freeze_panes = "A3"
    ws_d.auto_filter.ref = f"A2:M{data_last}"
    dv_grade = DataValidation(type="list", formula1='"A,B,C,D"', allow_blank=True)
    ws_d.add_data_validation(dv_grade); dv_grade.add(f"B{data_first}:B{data_last}")
    dv_type = DataValidation(type="list", formula1=f'"{T_FORMAL},{T_DEMO}"', allow_blank=True)
    ws_d.add_data_validation(dv_type); dv_type.add(f"C{data_first}:C{data_last}")
    dv_mode = DataValidation(type="list", formula1=f'"{M_BYMIN},{M_BYEP}"', allow_blank=True)
    ws_d.add_data_validation(dv_mode); dv_mode.add(f"I{data_first}:I{data_last}")
    ws_d.conditional_formatting.add(
        f"K{data_first}:K{data_last}",
        DataBarRule(start_type="num", start_value=0, end_type="max",
                    color="8FAFB5", showValue=True, minLength=None, maxLength=None))

    # ── Sheet 3: 汇总看板 ──
    ws_s = wb.create_sheet("汇总看板")
    ws_s.sheet_properties.tabColor = "8FAFB5"
    for col, w in {1: 15, 2: 11, 3: 12, 4: 16, 5: 14, 6: 15, 7: 12}.items():
        ws_s.column_dimensions[get_column_letter(col)].width = w
    ws_s.merge_cells("A1:G1")
    c = ws_s.cell(row=1, column=1, value="汇总看板")
    c.font = Font(name="微软雅黑", size=16, bold=True, color="FFFFFF")
    c.fill = FILL(C_MAIN); c.alignment = AL_C
    ws_s.row_dimensions[1].height = 42

    DET = "项目明细"
    BCOL = f'{DET}!$B$3:$B${data_last}'
    CCOL = f'{DET}!$C$3:$C${data_last}'
    DCOL = f'{DET}!$D$3:$D${data_last}'
    ECOL = f'{DET}!$E$3:$E${data_last}'
    FCOL = f'{DET}!$F$3:$F${data_last}'
    HCOL = f'{DET}!$H$3:$H${data_last}'
    ICOL = f'{DET}!$I$3:$I${data_last}'
    KCOL = f'{DET}!$K$3:$K${data_last}'
    MASK = f'ISNUMBER({ECOL})'

    def section(ws, r, text, width=7):
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=width)
        c = ws.cell(row=r, column=1, value=text)
        c.font = F_SEC; c.fill = FILL(C_SECTION)
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[r].height = 26

    def head_row(ws, r, heads):
        for i, h in enumerate(heads, 1):
            style(ws.cell(row=r, column=i, value=h), F_HEAD, C_MAIN, AL_C)
        ws.row_dimensions[r].height = 24

    def zrow(ws, r, shade):
        for col in range(1, 8):
            cell = ws.cell(row=r, column=col)
            cell.font = F_DATA; cell.fill = FILL(C_BAND if shade else C_WHITE)
            cell.border = BORDER
            cell.alignment = AL_R if col in (3, 4, 5, 6, 7) else AL_C

    # 概览
    section(ws_s, 3, "概览")
    r = 5
    head_row(ws_s, r, ["指标", "数值", "说明", "", "", "", ""])
    r += 1
    overviews = [
        ("总集数", f'=SUMPRODUCT({MASK})', NUM_INT, "全部项目（正式 + Demo）剧集数"),
        ("总时长", f'=ROUND(SUMPRODUCT({MASK},{HCOL}),1)', NUM_MIN, "全部项目总时长（分钟）"),
        ("结算总额", f'=ROUND(SUMPRODUCT({MASK},{KCOL}),2)', NUM_MONEY, "全部项目费用合计（元）"),
    ]
    for i, (label, formula, fmt, note) in enumerate(overviews):
        ws_s.cell(row=r, column=1, value=label)
        ws_s.cell(row=r, column=2, value=formula)
        ws_s.cell(row=r, column=2).number_format = fmt
        ws_s.merge_cells(start_row=r, start_column=3, end_row=r, end_column=7)
        ws_s.cell(row=r, column=3, value=note)
        for col in range(1, 8):
            cell = ws_s.cell(row=r, column=col)
            cell.font = F_BOLD if col == 1 else F_DATA
            cell.fill = FILL(C_BAND if i % 2 else C_WHITE)
            cell.border = BORDER
            cell.alignment = AL_R if col == 2 else (AL_L if col >= 3 else AL_C)
        ws_s.cell(row=r, column=2).font = Font(name="微软雅黑", size=12, bold=True, color=C_ACCENT)
        ws_s.row_dimensions[r].height = 28
        r += 1

    # 按计价方式
    r += 1
    section(ws_s, r, "按计价方式汇总")
    r += 2
    head_row(ws_s, r, ["计价方式", "集数", "总时长(分钟)", "总费用(元)", "", "", ""])
    mode_head = r; r += 1
    for i, m in enumerate([M_BYMIN, M_BYEP]):
        ws_s.cell(row=r, column=1, value=m)
        ws_s.cell(row=r, column=2, value=f'=SUMPRODUCT(({ICOL}="{m}")*{MASK})')
        ws_s.cell(row=r, column=3, value=f'=ROUND(SUMPRODUCT(({ICOL}="{m}")*{MASK},{HCOL}),1)')
        ws_s.cell(row=r, column=4, value=f'=ROUND(SUMPRODUCT(({ICOL}="{m}")*{MASK},{KCOL}),2)')
        zrow(ws_s, r, i % 2 == 1)
        ws_s.cell(row=r, column=3).number_format = NUM_MIN
        ws_s.cell(row=r, column=4).number_format = NUM_MONEY
        r += 1
    mode_last = r - 1
    ws_s.cell(row=r, column=1, value="合计")
    ws_s.cell(row=r, column=2, value=f'=SUM(B{mode_head+1}:B{mode_last})')
    ws_s.cell(row=r, column=3, value=f'=ROUND(SUM(C{mode_head+1}:C{mode_last}),1)')
    ws_s.cell(row=r, column=4, value=f'=ROUND(SUM(D{mode_head+1}:D{mode_last}),2)')
    for col in range(1, 8):
        cell = ws_s.cell(row=r, column=col)
        cell.font = F_BOLD; cell.fill = FILL(C_SUM_BG); cell.border = BORDER
        cell.alignment = AL_R if col in (3, 4) else AL_C
    ws_s.cell(row=r, column=3).number_format = NUM_MIN
    ws_s.cell(row=r, column=4).number_format = NUM_MONEY

    # 按等级
    r += 3
    section(ws_s, r, "按等级汇总")
    r += 2
    head_row(ws_s, r, ["等级", "项目数", "集数", "总时长(分钟)", "时长单价", "集单价", "总费用(元)"])
    r += 1; lv_first = r
    for i, g in enumerate(GRADES):
        cnt = sum(1 for p in projects if p["grade"] == g)
        ws_s.cell(row=r, column=1, value=g)
        ws_s.cell(row=r, column=2, value=cnt)
        ws_s.cell(row=r, column=3, value=f'=SUMPRODUCT(({BCOL}="{g}")*{MASK})')
        ws_s.cell(row=r, column=4, value=f'=ROUND(SUMPRODUCT(({BCOL}="{g}")*{MASK},{HCOL}),1)')
        ws_s.cell(row=r, column=5, value=f'=IFERROR(VLOOKUP(A{r},单价配置!$A$4:$C$7,2,FALSE),0)')
        ws_s.cell(row=r, column=6, value=f'=IFERROR(VLOOKUP(A{r},单价配置!$A$4:$C$7,3,FALSE),0)')
        ws_s.cell(row=r, column=7, value=f'=ROUND(SUMPRODUCT(({BCOL}="{g}")*{MASK},{KCOL}),2)')
        zrow(ws_s, r, i % 2 == 1)
        ws_s.cell(row=r, column=4).number_format = NUM_MIN
        for col in (5, 6, 7):
            ws_s.cell(row=r, column=col).number_format = NUM_MONEY
        r += 1
    lv_last = r - 1
    ws_s.cell(row=r, column=1, value="合计")
    ws_s.cell(row=r, column=2, value=f'=SUM(B{lv_first}:B{lv_last})')
    ws_s.cell(row=r, column=3, value=f'=SUM(C{lv_first}:C{lv_last})')
    ws_s.cell(row=r, column=4, value=f'=ROUND(SUM(D{lv_first}:D{lv_last}),1)')
    ws_s.cell(row=r, column=5, value="—")
    ws_s.cell(row=r, column=6, value="—")
    ws_s.cell(row=r, column=7, value=f'=ROUND(SUM(G{lv_first}:G{lv_last}),2)')
    for col in range(1, 8):
        cell = ws_s.cell(row=r, column=col)
        cell.font = F_BOLD; cell.fill = FILL(C_SUM_BG); cell.border = BORDER
        cell.alignment = AL_R if col in (4, 5, 6, 7) else AL_C
    ws_s.cell(row=r, column=4).number_format = NUM_MIN
    ws_s.cell(row=r, column=7).number_format = NUM_MONEY

    # 按项目
    r += 3
    section(ws_s, r, "按项目汇总")
    r += 2
    head_row(ws_s, r, ["项目", "等级", "类型", "集数", "总时长(分钟)", "总费用(元)", "平均(元/集)"])
    r += 1; pj_first = r
    for i, proj in enumerate(projects):
        ws_s.cell(row=r, column=1, value=proj["name"])
        ws_s.cell(row=r, column=2, value=proj["grade"])
        ws_s.cell(row=r, column=3, value=proj["type"])
        ws_s.cell(row=r, column=4, value=f'=SUMPRODUCT(({DCOL}=A{r})*{MASK})')
        ws_s.cell(row=r, column=5, value=f'=ROUND(SUMPRODUCT(({DCOL}=A{r})*{MASK},{HCOL}),1)')
        ws_s.cell(row=r, column=6, value=f'=ROUND(SUMPRODUCT(({DCOL}=A{r})*{MASK},{KCOL}),2)')
        ws_s.cell(row=r, column=7, value=f'=IFERROR(ROUND(F{r}/D{r},2),0)')
        zrow(ws_s, r, i % 2 == 1)
        ws_s.cell(row=r, column=5).number_format = NUM_MIN
        ws_s.cell(row=r, column=6).number_format = NUM_MONEY
        ws_s.cell(row=r, column=7).number_format = NUM_MONEY
        ws_s.cell(row=r, column=3).font = F_SMALL
        r += 1
    pj_last = r - 1
    ws_s.cell(row=r, column=1, value="合计")
    ws_s.cell(row=r, column=4, value=f'=SUM(D{pj_first}:D{pj_last})')
    ws_s.cell(row=r, column=5, value=f'=ROUND(SUM(E{pj_first}:E{pj_last}),1)')
    ws_s.cell(row=r, column=6, value=f'=ROUND(SUM(F{pj_first}:F{pj_last}),2)')
    ws_s.cell(row=r, column=7, value=f'=IFERROR(ROUND(F{r}/D{r},2),0)')
    for col in range(1, 8):
        cell = ws_s.cell(row=r, column=col)
        cell.font = F_BOLD; cell.fill = FILL(C_SUM_BG); cell.border = BORDER
        cell.alignment = AL_R if col in (5, 6, 7) else AL_C
    ws_s.cell(row=r, column=5).number_format = NUM_MIN
    for col in (6, 7):
        ws_s.cell(row=r, column=col).number_format = NUM_MONEY

    # 按月度（自动识别所有出现的年月）
    r += 3
    section(ws_s, r, "按月度汇总")
    r += 2
    head_row(ws_s, r, ["月份", "集数", "总时长(分钟)", "总费用(元)", "累计费用(元)", "", ""])
    r += 1; mon_first = r
    months = sorted({ep["date"][:7] for p in projects for ep in p["episodes"].values()})
    for i, ym in enumerate(months):
        y, m = ym.split("-")
        label = f"{y}年{int(m)}月"
        cond = f'TEXT({FCOL},"yyyy-m")="{ym}"'
        ws_s.cell(row=r, column=1, value=label)
        ws_s.cell(row=r, column=2, value=f'=SUMPRODUCT(({cond})*{MASK})')
        ws_s.cell(row=r, column=3, value=f'=ROUND(SUMPRODUCT(({cond})*{MASK},{HCOL}),1)')
        ws_s.cell(row=r, column=4, value=f'=ROUND(SUMPRODUCT(({cond})*{MASK},{KCOL}),2)')
        ws_s.cell(row=r, column=5, value=f'=ROUND(SUM($D${mon_first}:D{r}),2)')
        zrow(ws_s, r, i % 2 == 1)
        ws_s.cell(row=r, column=3).number_format = NUM_MIN
        for col in (4, 5):
            ws_s.cell(row=r, column=col).number_format = NUM_MONEY
        r += 1
    mon_last = r - 1
    ws_s.cell(row=r, column=1, value="合计")
    ws_s.cell(row=r, column=2, value=f'=SUM(B{mon_first}:B{mon_last})')
    ws_s.cell(row=r, column=3, value=f'=ROUND(SUM(C{mon_first}:C{mon_last}),1)')
    ws_s.cell(row=r, column=4, value=f'=ROUND(SUM(D{mon_first}:D{mon_last}),2)')
    ws_s.cell(row=r, column=5, value="—")
    for col in range(1, 8):
        cell = ws_s.cell(row=r, column=col)
        cell.font = F_BOLD; cell.fill = FILL(C_SUM_BG); cell.border = BORDER
        cell.alignment = AL_R if col in (2, 3, 4, 5) else AL_C
    ws_s.cell(row=r, column=3).number_format = NUM_MIN
    ws_s.cell(row=r, column=4).number_format = NUM_MONEY
    r += 2
    ws_s.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7)
    c = ws_s.cell(row=r, column=1,
                  value="本看板全部由公式自动计算，请勿手工修改；数据入口为本工具。")
    c.font = F_NOTE; c.alignment = AL_L
    ws_s.freeze_panes = "A2"

    # ── Sheet 4: 日历清单（按项目压缩显示集号）──
    ws_cal = wb.create_sheet("日历清单")
    ws_cal.sheet_properties.tabColor = "9C6B4E"
    cal_widths = {1: 6, 2: 12, 3: 7, 4: 8, 5: 7, 6: 62, 7: 13, 8: 13}
    for k, w in cal_widths.items():
        ws_cal.column_dimensions[get_column_letter(k)].width = w
    ws_cal.merge_cells("A1:H1")
    c = ws_cal.cell(row=1, column=1, value="日历清单")
    c.font = F_TITLE; c.alignment = AL_C
    ws_cal.row_dimensions[1].height = 34
    ws_cal.merge_cells("A2:H2")
    c = ws_cal.cell(
        row=2, column=1,
        value="按项目列出已登记集号：连续集号合并为区间（如 5-9），各段用“，”分隔；集号缺段即可看出重混范围。")
    c.font = F_NOTE
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws_cal.row_dimensions[2].height = 20
    cal_heads = ["序号", "项目", "等级", "类型", "集数", "集号清单", "最早日期", "最晚日期"]
    for i, h in enumerate(cal_heads, 1):
        style(ws_cal.cell(row=3, column=i, value=h), F_HEAD, C_MAIN, AL_C)
    ws_cal.row_dimensions[3].height = 26

    crow = 4
    for idx, proj in enumerate(projects, start=1):
        ep_keys = list(proj["episodes"].keys())
        ep_nums = []
        for k in ep_keys:
            try:
                ep_nums.append(int(k))
            except (TypeError, ValueError):
                pass
        dates = sorted(proj["episodes"][k]["date"] for k in ep_keys)
        ranges = compress_ranges(ep_keys)
        vals = [
            idx, proj["name"], proj["grade"], proj["type"], len(ep_nums),
            ranges, dates[0] if dates else "", dates[-1] if dates else "",
        ]
        for col, v in enumerate(vals, start=1):
            cell = ws_cal.cell(row=crow, column=col, value=v)
            cell.font = F_DATA
            cell.border = BORDER
            if col in (2, 6):
                cell.alignment = AL_L
            else:
                cell.alignment = AL_C
            cell.fill = FILL(C_BAND if idx % 2 == 0 else C_WHITE)
        ws_cal.row_dimensions[crow].height = 24
        crow += 1
    ws_cal.freeze_panes = "A4"

    # ── Sheet 5: 说明 ──
    ws_i = wb.create_sheet("说明")
    ws_i.sheet_properties.tabColor = "B7C4C1"
    ws_i.column_dimensions['A'].width = 100
    info = [
        ("title", "短剧混音结算系统 · 说明"),
        ("gap", ""),
        ("sec", "一、系统结构"),
        ("txt", "本系统由 settlement-tool 自动生成，用于 AI 短剧混音工作的交付登记与费用结算。"),
        ("txt", "    单价配置    —  维护 A/B/C/D 四级的「时长单价」与「集单价」（Demo 与 A 级同价）"),
        ("txt", "    项目明细    —  全部项目（正式 + Demo）逐集登记，每集可独立选择计价方式"),
        ("txt", "    汇总看板    —  概览 / 按计价方式 / 按等级 / 按项目 / 按月度 五个维度"),
        ("txt", "    日历清单    —  按项目压缩显示集号（连续集号合并为区间，重混范围一目了然）"),
        ("gap", ""),
        ("sec", "二、两种计价方式"),
        ("txt", "① 按时长结算：小计 = 时长(分钟) × 时长单价(元/分钟)"),
        ("txt", "② 按集结算  ：小计 = 1 × 集单价(元/集)"),
        ("gap", ""),
        ("sec", "三、维护方式"),
        ("txt", "日常新增集数 / 项目 / 改单价，请使用 settlement-tool.exe 操作，然后点「更新 Excel」。"),
        ("txt", "不要直接改本表结构；本表由工具每次全量重建。"),
    ]
    ir = 1
    for kind, val in info:
        if kind == "gap":
            ws_i.row_dimensions[ir].height = 8; ir += 1; continue
        if kind == "title":
            c = ws_i.cell(row=ir, column=1, value=val)
            c.font = F_TITLE; c.alignment = Alignment(horizontal="left", vertical="center")
            ws_i.row_dimensions[ir].height = 34
        elif kind == "sec":
            c = ws_i.cell(row=ir, column=1, value=val)
            c.font = F_SEC; c.fill = FILL(C_SECTION)
            c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws_i.row_dimensions[ir].height = 26
        else:
            c = ws_i.cell(row=ir, column=1, value=val)
            c.font = F_DATA; c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            ws_i.row_dimensions[ir].height = 20
        ir += 1

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    wb.save(out_path)
    return out_path
