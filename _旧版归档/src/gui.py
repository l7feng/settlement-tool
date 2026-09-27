# -*- coding: utf-8 -*-
"""短剧混音结算工具 · 图形界面

双击 exe 打开。功能：
  · 顶部实时汇总：总集数 / 总时长 / 总费用
  · 项目列表一览（等级 / 类型 / 集数 / 时长 / 费用）
  · 登记新集（可选 wav 自动读时长）
  · 新增项目、修改单价
  · 一键更新 Excel（重建三表联动 xlsx）
"""
import os
import sys
import datetime
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
from wav_reader import wav_duration, t2sec  # noqa: E402

VERSION = "0.1.0"

# 配色（与 xlsx 素雅冷淡风一致）
BG = "#F8FAFA"
FG = "#2B3A3D"
MUTED = "#7A8A8C"
MAIN = "#3E5C63"
MAIN_L = "#EDF2F2"
ACCENT = "#9C6B4E"
INPUT_BG = "#FDFBF3"


class App:
    def __init__(self, root):
        self.root = root
        root.title(f"短剧混音结算工具 v{VERSION}")
        root.geometry("1080x640")
        root.minsize(900, 560)
        root.configure(bg=BG)

        self.data = core.load_data()

        self._build_style()
        self._build_header()
        self._build_tree()
        self._build_buttons()
        self.refresh()

    # ── ttk 样式 ──
    def _build_style(self):
        s = ttk.Style()
        try:
            s.theme_use("clam")
        except Exception:
            pass
        s.configure(".", font=("微软雅黑", 10), background=BG, foreground=FG)
        s.configure("TFrame", background=BG)
        s.configure("TLabel", background=BG, foreground=FG)
        s.configure("Muted.TLabel", background=BG, foreground=MUTED, font=("微软雅黑", 9))
        s.configure("Title.TLabel", background=BG, foreground=MAIN,
                    font=("微软雅黑", 16, "bold"))
        s.configure("Accent.TLabel", background=BG, foreground=ACCENT,
                    font=("微软雅黑", 14, "bold"))
        s.configure("TButton", font=("微软雅黑", 10), padding=6)
        s.configure("Accent.TButton", font=("微软雅黑", 10, "bold"))
        s.configure("Treeview", rowheight=26, font=("微软雅黑", 10))
        s.configure("Treeview.Heading", font=("微软雅黑", 10, "bold"),
                    background=MAIN_L, foreground=MAIN)
        s.map("TCombobox", fieldbackground=[("readonly", "white")])

    # ── 顶部汇总 ──
    def _build_header(self):
        top = ttk.Frame(self.root, padding=(16, 12, 16, 4))
        top.pack(fill="x")
        ttk.Label(top, text="短剧混音结算", style="Title.TLabel").pack(side="left")

        cards = ttk.Frame(self.root, padding=(16, 4, 16, 8))
        cards.pack(fill="x")
        self.card_vars = {}
        for key, label in [("eps", "总集数"), ("min", "总时长(分钟)"), ("fee", "结算总额(元)")]:
            box = tk.Frame(cards, bg=MAIN_L, padx=14, pady=10)
            box.pack(side="left", padx=(0, 12))
            tk.Label(box, text=label, bg=MAIN_L, fg=MUTED,
                     font=("微软雅黑", 9)).pack(anchor="w")
            v = tk.Label(box, text="—", bg=MAIN_L, fg=ACCENT,
                         font=("微软雅黑", 18, "bold"))
            v.pack(anchor="w")
            self.card_vars[key] = v

    # ── 项目列表 ──
    def _build_tree(self):
        wrap = ttk.Frame(self.root, padding=(16, 4, 16, 4))
        wrap.pack(fill="both", expand=True)
        cols = ("name", "grade", "type", "eps", "eplist", "mins", "fee")
        heads = {"name": "项目", "grade": "等级", "type": "类型",
                 "eps": "集数", "eplist": "集号（重混可见）",
                 "mins": "时长(分)", "fee": "费用(元)"}
        widths = {"name": 120, "grade": 50, "type": 60,
                  "eps": 55, "eplist": 260, "mins": 80, "fee": 100}
        self.tree = ttk.Treeview(wrap, columns=cols, show="headings", selectmode="browse")
        for c in cols:
            self.tree.heading(c, text=heads[c])
            anchor = "w" if c in ("name", "eplist") else "center"
            self.tree.column(c, width=widths[c], anchor=anchor)
        vsb = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")

    # ── 底部按钮 ──
    def _build_buttons(self):
        bar = ttk.Frame(self.root, padding=(16, 4, 16, 14))
        bar.pack(fill="x")
        ttk.Button(bar, text="登记新集", style="Accent.TButton",
                   command=self.dialog_add_ep).pack(side="left", padx=(0, 8))
        ttk.Button(bar, text="新增项目", command=self.dialog_add_project).pack(side="left", padx=(0, 8))
        ttk.Button(bar, text="修改单价", command=self.dialog_prices).pack(side="left", padx=(0, 8))
        ttk.Button(bar, text="更新 Excel", style="Accent.TButton",
                   command=self.do_update_xlsx).pack(side="right")

    # ── 刷新 ──
    def refresh(self):
        # 顶部卡片
        eps, mins, fee = core.calc_summary(self.data)
        self.card_vars["eps"].config(text=str(eps))
        self.card_vars["min"].config(text=f"{mins:.1f}")
        self.card_vars["fee"].config(text=f"¥{fee:,.2f}")
        # 列表
        for i in self.tree.get_children():
            self.tree.delete(i)
        prices = self.data["prices"]
        for p in self.data["projects"]:
            n_eps = len(p["episodes"])
            ep_nums = list(p["episodes"].keys())
            ep_list = core.compress_ranges(ep_nums)
            total_sec = sum(t2sec(e["duration"]) for e in p["episodes"].values())
            total_fee = 0.0
            price = prices[p["grade"]]
            mode = p.get("mode", core.M_BYMIN)
            for e in p["episodes"].values():
                if mode == core.M_BYEP:
                    total_fee += price["per_ep"]
                else:
                    total_fee += round(t2sec(e["duration"]) / 60 * price["per_min"], 2)
            self.tree.insert("", "end", values=(
                p["name"], p["grade"], p["type"], n_eps, ep_list,
                f"{total_sec/60:.1f}", f"{total_fee:,.2f}"))

    # ── 通用：保存数据 ──
    def save(self):
        core.save_data(self.data)
        self.refresh()

    # ══════════════════════════════════════════════════════════
    # 登记新集
    # ══════════════════════════════════════════════════════════
    def dialog_add_ep(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("登记新集")
        dlg.geometry("440x360")
        dlg.transient(self.root)
        dlg.grab_set()

        projects = core.get_project_names(self.data)
        if not projects:
            messagebox.showwarning("提示", "请先新增项目", parent=dlg)
            dlg.destroy()
            return

        pad = {"padx": 12, "pady": 6}
        ttk.Label(dlg, text="项目").grid(row=0, column=0, sticky="e", **pad)
        cb_proj = ttk.Combobox(dlg, values=projects, state="readonly", width=28)
        cb_proj.grid(row=0, column=1, columnspan=2, sticky="w", **pad)
        cb_proj.current(0)

        ttk.Label(dlg, text="集号").grid(row=1, column=0, sticky="e", **pad)
        ent_ep = ttk.Entry(dlg, width=30)
        ent_ep.grid(row=1, column=1, columnspan=2, sticky="w", **pad)

        ttk.Label(dlg, text="日期").grid(row=2, column=0, sticky="e", **pad)
        today = datetime.date.today().isoformat()
        ent_date = ttk.Entry(dlg, width=30)
        ent_date.insert(0, today)
        ent_date.grid(row=2, column=1, columnspan=2, sticky="w", **pad)

        ttk.Label(dlg, text="时长").grid(row=3, column=0, sticky="e", **pad)
        ent_dur = ttk.Entry(dlg, width=20)
        ent_dur.grid(row=3, column=1, sticky="w", **pad)
        ent_dur.insert(0, "00:00:00")

        def pick_wav():
            fp = filedialog.askopenfilename(
                title="选择交付 wav",
                filetypes=[("WAV 音频", "*.wav"), ("所有文件", "*.*")],
                parent=dlg)
            if not fp:
                return
            try:
                dur = wav_duration(fp)
                ent_dur.delete(0, "end")
                ent_dur.insert(0, dur)
            except ValueError as e:
                messagebox.showerror("读取失败", str(e), parent=dlg)

        ttk.Button(dlg, text="选 wav 自动读时长", command=pick_wav).grid(
            row=3, column=2, sticky="w", **pad)

        ttk.Label(dlg, text="计价方式").grid(row=4, column=0, sticky="e", **pad)
        cb_mode = ttk.Combobox(dlg, values=[core.M_BYMIN, core.M_BYEP],
                               state="readonly", width=12)
        cb_mode.grid(row=4, column=1, sticky="w", **pad)
        cb_mode.current(0)

        def on_save():
            name = cb_proj.get()
            ep_no = ent_ep.get().strip()
            date = ent_date.get().strip()
            dur = ent_dur.get().strip()
            mode = cb_mode.get()

            if not ep_no:
                messagebox.showwarning("校验", "请填集号", parent=dlg)
                return
            try:
                int(ep_no)
            except ValueError:
                messagebox.showwarning("校验", "集号必须是数字", parent=dlg)
                return
            if len(date) != 10 or date[4] != "-" or date[7] != "-":
                messagebox.showwarning("校验", "日期格式应为 YYYY-MM-DD", parent=dlg)
                return
            parts = dur.split(":")
            if len(parts) != 3 or not all(p.isdigit() for p in parts):
                messagebox.showwarning("校验", "时长格式应为 HH:MM:SS", parent=dlg)
                return

            proj = core.find_project(self.data, name)
            if ep_no in proj["episodes"]:
                if not messagebox.askyesno("确认", f"项目「{name}」已有第 {ep_no} 集，覆盖？", parent=dlg):
                    return
            proj["episodes"][ep_no] = {"date": date, "duration": dur}
            proj["mode"] = mode
            self.save()
            dlg.destroy()
            messagebox.showinfo("完成", f"已登记：{name} 第 {ep_no} 集", parent=self.root)

        btns = ttk.Frame(dlg)
        btns.grid(row=5, column=0, columnspan=3, pady=(16, 0))
        ttk.Button(btns, text="保存", style="Accent.TButton", command=on_save).pack(
            side="left", padx=8)
        ttk.Button(btns, text="取消", command=dlg.destroy).pack(side="left", padx=8)

    # ══════════════════════════════════════════════════════════
    # 新增项目
    # ══════════════════════════════════════════════════════════
    def dialog_add_project(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("新增项目")
        dlg.geometry("480x300")
        dlg.transient(self.root)
        dlg.grab_set()
        pad = {"padx": 12, "pady": 6}

        ttk.Label(dlg, text="项目名").grid(row=0, column=0, sticky="e", **pad)
        ent_name = ttk.Entry(dlg, width=30)
        ent_name.grid(row=0, column=1, columnspan=2, sticky="w", **pad)

        ttk.Label(dlg, text="等级").grid(row=1, column=0, sticky="e", **pad)
        cb_g = ttk.Combobox(dlg, values=core.GRADES, state="readonly", width=10)
        cb_g.grid(row=1, column=1, sticky="w", **pad)
        cb_g.current(2)  # 默认 C

        ttk.Label(dlg, text="类型").grid(row=2, column=0, sticky="e", **pad)
        cb_t = ttk.Combobox(dlg, values=[core.T_FORMAL, core.T_DEMO],
                            state="readonly", width=10)
        cb_t.grid(row=2, column=1, sticky="w", **pad)
        cb_t.current(0)

        ttk.Label(dlg, text="交付路径").grid(row=3, column=0, sticky="e", **pad)
        ent_path = ttk.Entry(dlg, width=36)
        ent_path.grid(row=3, column=1, sticky="w", **pad)

        def browse():
            d = filedialog.askdirectory(title="选择交付文件夹", parent=dlg)
            if d:
                ent_path.delete(0, "end")
                ent_path.insert(0, d)
        ttk.Button(dlg, text="浏览…", command=browse).grid(row=3, column=2, sticky="w", **pad)

        def on_save():
            name = ent_name.get().strip()
            if not name:
                messagebox.showwarning("校验", "请填项目名", parent=dlg)
                return
            if core.find_project(self.data, name):
                messagebox.showwarning("校验", f"项目「{name}」已存在", parent=dlg)
                return
            self.data["projects"].append({
                "name": name,
                "grade": cb_g.get(),
                "type": cb_t.get(),
                "mode": core.M_BYMIN,
                "path": ent_path.get().strip(),
                "episodes": {},
            })
            self.save()
            dlg.destroy()
            messagebox.showinfo("完成", f"已新增项目「{name}」", parent=self.root)

        btns = ttk.Frame(dlg)
        btns.grid(row=4, column=0, columnspan=3, pady=(16, 0))
        ttk.Button(btns, text="保存", style="Accent.TButton", command=on_save).pack(
            side="left", padx=8)
        ttk.Button(btns, text="取消", command=dlg.destroy).pack(side="left", padx=8)

    # ══════════════════════════════════════════════════════════
    # 修改单价
    # ══════════════════════════════════════════════════════════
    def dialog_prices(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("修改单价")
        dlg.geometry("400x280")
        dlg.transient(self.root)
        dlg.grab_set()
        pad = {"padx": 12, "pady": 6}

        ttk.Label(dlg, text="等级").grid(row=0, column=0, **pad)
        ttk.Label(dlg, text="时长单价(元/分钟)").grid(row=0, column=1, **pad)
        ttk.Label(dlg, text="集单价(元/集)").grid(row=0, column=2, **pad)

        entries = {}
        for i, g in enumerate(core.GRADES, start=1):
            ttk.Label(dlg, text=g).grid(row=i, column=0, **pad)
            e1 = ttk.Entry(dlg, width=10)
            e1.insert(0, str(self.data["prices"][g]["per_min"]))
            e1.grid(row=i, column=1, **pad)
            e2 = ttk.Entry(dlg, width=10)
            e2.insert(0, str(self.data["prices"][g]["per_ep"]))
            e2.grid(row=i, column=2, **pad)
            entries[g] = (e1, e2)

        def on_save():
            for g, (e1, e2) in entries.items():
                try:
                    self.data["prices"][g]["per_min"] = float(e1.get())
                    self.data["prices"][g]["per_ep"] = float(e2.get())
                except ValueError:
                    messagebox.showwarning("校验", f"{g} 级单价必须是数字", parent=dlg)
                    return
            self.save()
            dlg.destroy()
            messagebox.showinfo("完成", "单价已更新", parent=self.root)

        btns = ttk.Frame(dlg)
        btns.grid(row=5, column=0, columnspan=3, pady=(16, 0))
        ttk.Button(btns, text="保存", style="Accent.TButton", command=on_save).pack(
            side="left", padx=8)
        ttk.Button(btns, text="取消", command=dlg.destroy).pack(side="left", padx=8)

    # ══════════════════════════════════════════════════════════
    # 更新 Excel
    # ══════════════════════════════════════════════════════════
    def do_update_xlsx(self):
        try:
            out = core.generate_xlsx(self.data)
        except PermissionError:
            messagebox.showerror(
                "写入失败",
                "xlsx 正在被 Excel 占用，请先关闭 Excel 再点「更新 Excel」。")
            return
        except Exception as e:
            messagebox.showerror("生成失败", str(e))
            return
        eps, mins, fee = core.calc_summary(self.data)
        messagebox.showinfo(
            "已更新",
            f"Excel 已重建：\n{out}\n\n"
            f"集数 {eps} / 时长 {mins:.1f} 分钟 / ¥{fee:,.2f}",
            parent=self.root)


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
