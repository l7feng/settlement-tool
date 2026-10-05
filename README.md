# settlement-tool · 短剧混音结算工作台

一套「登记 → 统计 → 导出」的短剧混音结算工具。**网页版与桌面 exe 共用同一份 `settlement-workbench.html`**，
功能永远同步，改一次两边都生效。

## 两种用法

| 用法 | 怎么跑 | 适合 |
|---|---|---|
| 桌面版（推荐） | `settlement-tool.exe`，或开发态 `python desktop_app.py` | 日常登记、离线使用 |
| 网页版 | 双击 `settlement-workbench.html`（`assets/` 需同目录） | 临时在别的机器上用、拷走就跑 |

数据存浏览器 localStorage：网页版跟浏览器走，桌面版固定在
`%LOCALAPPDATA%\SettlementTool\`（升级 exe 不丢）。

### 桌面版窗口壳（两级回退）

1. **pywebview（WebView2 内嵌窗口）**——首选；启动后自动做一次「像素探针」，
   **客户区**颜色种类过少或最主色占比过高＝WebView2 没渲染出来（部分机器会黑屏 /
   空白底色）→ 自动转 2。只看客户区不看标题栏：标题栏文字的抗锯齿杂色会把
   空窗口误抬到上百色（2026-09-28 实测踩坑）；
2. **Edge `--app` 模式**——系统 Edge 的应用窗口（独立窗口、无地址栏无工具栏），兜底。

两种方案共用同一个内置 `http://127.0.0.1:26788` 页面服务：
http 源（而非 file://）+ 固定端口，保证 localStorage 按稳定「源」持久保存。

## 功能

### 数据
- **登记新集**：选项目 → 填集号 / 日期 / 时长；支持「选 wav 自动读时长」与「批量生成区间集号」
- **新增项目**：项目名 / 等级(A-D) / 类型(正式·Demo) / 交付路径
- **修改单价**：A/B/C/D 四级的时长单价 + 集单价
- **编辑已登记的集**、**删除**（单条 / 勾选批量）、**撤销上一步删除**
- **备份 / 恢复 JSON**

### 视图
- **月度明细**（按集）：按月倒序 → 项目按最新交付日倒序 → 集按日期倒序；项目头部的集号压缩成 `1，3，5-9`
- **按项目**：项目卡片汇总小计 + 展开明细，支持筛选与「隐藏 0 集项目」
- **日历**：按交付日期排布，格内项目自动换行，集数 / 金额贴格底；点某天看当日明细
- 顶部实时汇总：总集数 / 总时长 / 结算总额

### 交互
- **列管理**（设置里）：列可显示/隐藏、可上下移动顺序
- **选择 / 删除双模式**：默认是勾选（可批量删），点状态栏切到删除模式 → 删除按钮变醒目红色
- **7 套主题**：晨曦青 / 米纸暖 / 深夜青 / 暖夜棕 / 深海蓝 / 墨林绿 / 雅紫
- **导出 Excel 冻结窗格**：可设冻结行数 / 列数（SheetJS 写不了冻结窗格，导出后用 JSZip 注入 `<pane>` 实现）

## 目录

```
settlement-workbench.html   # 唯一真源：网页版 + exe 共用
webview_app.py              # 桌面版入口（pywebview 原生窗口 + 原生保存对话框）
build_exe.py                # 打包脚本
VERSION                     # 版本号
assets/
  xlsx.full.min.js          # SheetJS（离线依赖）
  jszip.min.js              # JSZip（导出 xlsx 注入冻结窗格用）
  app.ico                   # exe 图标
_旧版归档/src/              # v0.1.0 的 tkinter 版本，仅留档
_shots/                     # 界面截图
```

> html 里两个 `<script src="assets/...">` 是本地依赖；若本地文件不在，会自动回退到 CDN。

## 打包

```
D:\Ai-Files\Tools\BuildEnv\Scripts\python.exe build_exe.py
```

输出到 `D:\Ai-Files\Tools\Exe\settlement-tool-v<ver>-<date>\`。
打包依赖：`pywebview`、`pythonnet`（打包环境已装）。
运行依赖：Windows 自带 WebView2 Runtime（Win11 均有）。
