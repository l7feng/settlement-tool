"""4.4 / 4.5 的静态守门：xlsx 懒加载、示例数据脱敏外移。"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "settlement-workbench.html"
FIXTURE = ROOT / "assets" / "demo-fixture.js"

REAL_NAMES = ["巨巫", "独眼", "首付", "女帝", "人鱼", "抛弃", "婚宠", "丑鱼", "海后", "篮球", "王权", "反派", "自驾", "誓言"]
REAL_PATHS = [r"D:\Project\1-巨巫", r"D:\Project\2-独眼", r"D:\DAW-Project\10-誓言"]


class DemoFixtureTest(unittest.TestCase):
    def test_fixture_file_exists_and_exports(self):
        self.assertTrue(FIXTURE.exists(), "assets/demo-fixture.js 缺失")
        text = FIXTURE.read_text(encoding="utf-8")
        self.assertIn("window.SETTLEMENT_DEMO_FIXTURE", text)
        self.assertIn('"prices"', text)
        self.assertIn('"projects"', text)

    def test_page_has_no_real_project_names_or_paths(self):
        page = PAGE.read_text(encoding="utf-8")
        for name in REAL_NAMES:
            self.assertNotIn(name, page, f"页面仍残留真实项目名：{name}")
        for path in REAL_PATHS:
            self.assertNotIn(path, page, f"页面仍残留真实路径：{path}")

    def test_page_reads_fixture_instead_of_inline_literal(self):
        page = PAGE.read_text(encoding="utf-8")
        self.assertIn("const DEFAULT_DATA = window.SETTLEMENT_DEMO_FIXTURE;", page)
        self.assertNotIn('"per_min":78,"per_ep":78', page, "页面仍有内联价格/示例数据字面量")

    def test_xlsx_is_lazy_not_startup_script(self):
        page = PAGE.read_text(encoding="utf-8")
        self.assertNotRegex(page, r'<script src="assets/xlsx\.full\.min\.js"', "xlsx 仍在启动即加载")
        self.assertNotIn("document.write", page, "仍在用 document.write 注入 CDN")
        self.assertNotIn("cdn.jsdelivr.net", page, "仍有 CDN 兜底")
        self.assertIn("function ensureXlsx", page)
        self.assertIn("script.src = 'assets/xlsx.full.min.js'", page)


if __name__ == "__main__":
    unittest.main()
