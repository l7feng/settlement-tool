# 变更记录

> 2026-11-09 建立。按时间倒序记录提交；当前版本 `2.8.4`（见 `VERSION`），标签以 `git tag` 为准。建立前的逐版说明未单独保留，回溯以 `git log` 为唯一来源。

| 日期 | 提交 | 说明 |
| 2026-11-17 | s1(1.1) | **升级前快照原文搬出账本**：`settlement-upgrade-snapshots-v1` 里每份快照内联 288KB 原文且无上限（实测 20 份 = 3.91MB，占 5.96MB 账本的 70%）；改为原文 gzip 落 `<数据目录>/upgrade/<id>-<sha16>.json.gz`，账本只留 `{id,appVersion,createdAt,file,bytes,sha256}` 索引，保留份数收紧到 **3**（`UPGRADE_KEEP`）。新增 `POST /__upgrade_blob__` 按名取回、`WorkspaceStore.migrate_upgrades()` 启动时幂等迁移（异常一律跳过，绝不丢快照）；前端 `workspace-state.js` 兼容「内联 raw / 文件索引」两种形态，独立网页版无后端仍走内联。真实账本副本实测 **5,962,245 B → 494,713 B（-91.7%）**，设置类保存 P50 **59.6 ms → 6.6 ms**；导出快照仍还原 40 个项目 + 2 份账本。`tests/test_upgrade_blobs.py` 9/9 |
| 2026-11-17 | s1(1.2) | `workspace.previous.json` 从「每次写入都复制整份」改为按需：仅业务账本变化才刷新，且 `PREVIOUS_MIN_INTERVAL=300` 秒内不重复覆盖，设置类写入完全不碰。单次业务保存省掉一次 5.96MB 复制 |
| 2026-11-17 | s1(1.3) | 设置类写入合并（`desktop-workspace.js`）：「主题 / 列宽 / 玻璃参数 / 偏好」先在内存生效、200ms 内合并成一次 patch，`pagehide` / 切后台补落；**业务账本与工作台清单仍同步落盘**，失败照旧当场抛出。新增 `tests/desktop-adapter.mjs` 7 组断言 |
| 2026-11-17 | s1(1.4) | 文件日志：`<数据目录>/logs/app.log`，1MB × 3 份滚动；`desktop_app` 的 `print` 全量改 `log()`，安装 `sys.excepthook` / `threading.excepthook` 记录未捕获异常（窗口程序没有控制台，日志是唯一现场）。`tests/test_logging.py` 4/4 |
| 2026-11-17 | s1(1.5) | 数据目录自清洁 `src/data_hygiene.py`：白名单式清理——旧浏览器存储迁移副本留最新 3 份、`webview-data.bak*`/`min-store*` 超 30 天、`snapshots/` 超保留份数、`upgrade/` 索引未引用孤儿、`logs/` 超 14 天分卷、崩溃转储留最新 3 份；账本 / 导出文件 / 用户文档一律不在清单内。真实目录 **379.1 MB → 233.8 MB**（85 MB 历史垃圾先隔离到 `D:\Ai-Files\Backups\SettlementTool\cleanup-20261117` 再删）。`tests/test_data_hygiene.py` 9/9 |
| 2026-11-17 | s1(1.6) | 三处小修：`billing-core` 新增 `round2()`（`toFixed(6)` 中介，修正 `1.005` 进不到 `1.01`），按集/按分钟两条分支都收敛到分；`Api.safe_export_name()` 白名单扩展名 + 路径剥离 + 控制字符拒收，`..\..\evil.json`、`C:\Windows\evil.json` 都只剩 `evil.json`，`evil.exe/.bat/.ps1/.json.exe` 被拒；业务键禁删——`patch()` 默认拒绝删除 `settlement_v1` 与账本键，仅 `action=delete-ledger` 显式放行 |
| 2026-11-17 | s1(1.7) | 当前工作台键 `settlement_active_profile` 纳入托管（`KEYS` + adapter `keys` 两处同步）；顺带修真 bug：`readWorkbenchList`/`writeWorkbenchList` 虽用托管键却读写 `localStorage`，导致工作台清单从未进 `workspace.json` |
| 2026-11-17 | s1(1.8) | 测试护栏：新增 `tests/playwright-runtime.mjs` 统一解析 Playwright 与浏览器可执行文件，**29 个 UI 测试里写死的三套机器路径全部清除**（换机即红的老问题）；Playwright 包自带浏览器版本与本地安装不一致时自动改注入系统 Edge；`tests/web-root.mjs` 默认改为仓库自身（此前默认指向工作副本，改完仓库再跑测试测的是旧副本）；新增 `tools/run_tests.py` 一条命令跑全部（自动设 `SETTLEMENT_WEB_ROOT` 与 300s 超时）。**UI 回归恢复可跑：58/93**，与 2026-11-14 记录的基线完全一致，35 项仍是用例与界面漂移（`openTopLayout` 移除、按钮文案、玻璃材质断言、缺 FinalMix 夹具），归 S3-3.2 统一修 |
| 2026-11-17 | s1(1.9) | S1 出口验收：`python -m unittest` **79 项全绿**；Node 单元 7 套全绿（`workspace-state` 29/29、`workspace-ledgers`、`desktop-adapter` 7/7、`billing-identity`、`billing-grade-coverage`、`sync-core` 31/31、`project-workflow-core`）；UI 回归 58/93 = 基线。修正 `project-workflow-core.mjs` 一条过时断言（2.8.4 精品剧改「区间优先 + 默认等级兜底」后，记录级 D 不再报错；保留 `Demo + D` 仍拒绝的用例） |
| 2026-11-16 | release(2.8.4) | 精品剧价格规则修正：默认阶梯由 `1=A,2-10=B` 补全为 **`1=A,2-10=B,11-999=C`**（项目没填阶梯时第 11 集起按 C 计，不再整套漏算）；项目自定义区间仍未覆盖的记录，按项目「默认等级」兜底计价（默认等级非法时按 C），`grade()` 不再返回 null、`price()` 不再报错、`fee()` 不再静默计 0，汇总行提示由「暂不计价」改为「已按默认等级兜底，建议补全区间」；新增 `rangeLevel` / `fallbackLevel` 两个导出。`tests/billing-grade-coverage.mjs` **14/14**。真实账本 2026-10：¥4,183.65 → **¥6,813.65**（心剑 ¥628.00→¥1,877.50，流放崖州 ¥0.00→¥1,380.50） |
| 2026-11-14 | io(4/5) | 增量落账：`WorkspaceStore.patch()` 只落变化的键（`None`=删除）、仍同步写盘；`/__workspace__` 支持 `patch` 且只回执 revision，不再回传 400KB 全文；前端 adapter 改为发补丁，旧版 exe 自动回退整份提交。实测请求体 **415,889 B → 52 B（约 8000×）**，单次写入 18–20ms（含 fsync） |
| 2026-11-14 | io(5) | 版本快照环：每次业务账本变化写 `snapshots/workspace.rN.json`，保留最近 5 份并自动清理；主题/列宽类高频设置不写快照以免拖慢；`workspace.previous.json` 逐字节保留不变。新增 `tests/test_workspace_patch.py`（10/10） |
| 2026-11-14 | verify | 端到端（真壳 + 370 条账本副本）：`getItem` 回读一致、revision 16→17、只有 `settlement-theme` 变化、快照 `r17` 生成、无页面错误；真实账本未被触碰（revision 仍 16、无 snapshots 目录） |
| 2026-11-14 | align | 三处真源对齐：工作真源 / 仓库 / 现役包 HTML 同为 `C05331BD`（319,699 B）；仓库补齐 `assets/` 整目录；现役包补 `assets/icons/app.ico` 使 favicon 路径可解析；`git init` + 基线 tag `v2.8.2` |
| 2026-11-14 | logic1 | 阶梯区间未命中不再静默按 C 级计价：`grade()` 返回 null、`fee()` 计 0、`price()` 报错，汇总行提示补区间；新增 `tests/billing-grade-coverage.mjs`（13/13） |
| 2026-11-14 | logic2 | `settlement_workbenches_v1`（账本清单）纳入白名单：`assets/desktop-workspace.js` keys + `src/workspace_store.py` KEYS，清 profile 不再丢工作台列表；修正 `tests/test_desktop_reuse.py` 硬编码旧仓库路径（6/6） |
| 2026-11-14 | logic3 | 不计价原因收敛为单一谓词：`billing-core` 新增 `exclusionReason` / `EXCLUSION_REASONS`，`isBillable` 复用同一判断；明细“计价”列 tooltip 显示具体原因（修改 / 手动排除 / 标记不计价 / Demo旧版 / 旧版本 / 成片替换） |
| 2026-11-14 | test | 回归基线：`node tests/settlement-regression.mjs` = **58/93**；35 项失败均为用例与当前界面漂移（按钮文案、`openTopLayout` 已移除、玻璃材质断言过时、缺 FinalMix 夹具），非本轮业务改动；`tests/test_workspace_file.py` 11/11、`tests/test_desktop_reuse.py` 6/6 |
| --- | --- | --- |
| 2026-10-05 | `e21418b` | chore: 璺�寰勬敼鍙ｅ�归綈 D:/Ai-Files 鏂扮粨鏋勶紙椤圭洰39澶嶇洏锛� |
| 2026-09-30 | `4b2b984` | ui: 涓冧富棰樼幓鐠冨弬閲�+data-style鐜荤拑杞�(榛樿��glass淇濆畧妗�)+glass-tuner鍘绘ˉ鐗�+paper瀵归綈7F榛樿�や富棰�; 澶嶇洏淇�澶�: bootTheme涓嶅啀鍚炴樉寮忕┖涓婚��(鏅ㄦ洣闈�), 8澶勫脊绐楀渾瑙抰oken鍖�, 鎵撳寘瑙ｉ噴鍣ㄨ矾寰勬洿鏂�; 绉婚櫎杩囨椂涓存椂鏂囨。 |
| 2026-09-28 | `633c0cc` | 淇�澶嶅儚绱犳帰閽堟紡鍒わ細鍙�缁熻�″�㈡埛鍖� + 鏈�涓昏壊鍗犳瘮鍙屾潯浠� |
| 2026-09-28 | `2559852` | v2.0.0 鐭�鍓ф贩闊崇粨绠楀伐浣滃彴锛氱綉椤电増鍏ㄥ姛鑳� + 妗岄潰鐗堝弻澹冲洖閫�锛坧ywebview 鍍忕礌鎺㈤拡鈫扙dge --app 鍏滃簳锛� |
