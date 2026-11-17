"""4.10 i18n 策略守门：英文只保证主流程；新改中文文案必须补译文。

策略（不做 key 化改造，仍以中文原文为 key）：
  - 主流程 = 登记 / 导入 / 结算 / 备份恢复 / 设置；
  - 页面里出现的静态弹窗标题、主流程关键按钮必须有英文；
  - 未翻译清单直接由本测试打印，不再靠人工翻找。
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = (ROOT / 'settlement-workbench.html').read_text(encoding='utf-8')
LOC = (ROOT / 'assets' / 'ui-localization.js').read_text(encoding='utf-8')
CJK = re.compile(r'[\u4e00-\u9fff]')

MAIN_FLOW = [
    '导出 Excel', '搜索', '导入与登记', '确认导入', '设置', '登记记录', '项目与价格',
    '备份与恢复', '关闭', '取消', '保存', '结算期：', '记录排序', '记录详情', '按项目',
    '批量登记集数', '修改单价', '重复信息审核', '结算核对', '添加工作台',
]


def dictionary_keys():
    """UI_EN 里的中文原文 key：只取「中文开头」的键，避免把 JS 其他字符串算进来。"""
    keys = set()
    for match in re.finditer(r"'((?:[^'\\]|\\.)*)'\s*:", LOC):
        text = match.group(1)
        if CJK.search(text):
            keys.add(text)
    return keys


def modal_titles():
    titles = set()
    for match in re.finditer(r'<h2>([^<{}`]{1,40})</h2>', PAGE):
        text = match.group(1).strip()
        if CJK.search(text):
            titles.add(text)
    return titles


class I18nPolicyTest(unittest.TestCase):
    def test_main_flow_strings_have_translation(self):
        keys = dictionary_keys()
        missing = [text for text in MAIN_FLOW if text not in keys]
        self.assertEqual(missing, [], '主流程文案缺英文：%s' % missing)

    def test_every_static_modal_title_translated(self):
        keys = dictionary_keys()
        missing = sorted(title for title in modal_titles() if title not in keys)
        self.assertEqual(missing, [], '这些弹窗标题没有英文译文（未翻译清单）：%s' % missing)

    def test_translations_are_latin(self):
        for text in MAIN_FLOW:
            pattern = re.escape("'" + text + "'") + r'\s*:\s*[\'"]([^\'"]*)[\'"]'
            found = re.search(pattern, LOC)
            self.assertIsNotNone(found, '找不到 %s 的译文' % text)
            self.assertIsNone(CJK.search(found.group(1)), '%s 的译文里还是中文' % text)

    def test_policy_note_documented(self):
        self.assertIn('4.10 i18n 策略', LOC)
        self.assertIn('英文只保证', LOC)


if __name__ == '__main__':
    unittest.main()
