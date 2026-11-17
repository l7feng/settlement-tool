/* 版本号解析的唯一实现（S2-2.1）。
   历史上四处各写一套正则：version-reconciliation 的 formalSourceVersion、version-timeline 的
   versionNumber、demo-latest-workflow 的 demoSourceMeta、HTML 的 recordVersionLabel。差异导致
   同一份文件在不同入口算出不同版本号（尤其「第十三版」这类中文数字：只有 timeline 认，
   其余两处直接回落成 1）。
   统一口径：
     version —— 文件名里的 V01 / V-1 / v1_final / 第2版 / 版本三 等，未识别为 0（不是 1）；
     take    —— Demo 的「大版本」（一 / 二 / 十二），未识别为 0，由调用方决定默认为 1。
   只做解析、不改数据、不依赖其它模块，可单独测试。 */
(function (scope) {
  'use strict';
  const LATIN = /(?:^|[^a-z0-9])v-?(\d+)(?=$|[^0-9])/i;
  const CN = /第\s*([0-9零〇一二三四五六七八九十百两]+)\s*版|版本\s*([0-9零〇一二三四五六七八九十百两]+)/;
  const TAKE_TAIL = /(?:^|[^a-z0-9])([一二三四五六七八九十]{1,3})\s*$/;

  const DIGITS = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const UNITS = { '十': 10, '百': 100 };

  /** 中文数字转整数：一~九十九、一百、一百二十三 这类常见写法；无法解析返回 0。 */
  function cnNumber(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw);
    if (!/^[零〇一二三四五六七八九十百两]+$/.test(raw)) return 0;
    let total = 0, current = 0;
    for (const ch of raw) {
      if (DIGITS[ch] !== undefined) {
        current = DIGITS[ch];
      } else if (UNITS[ch]) {
        // 「十」前面没有数字时按 1 计（十 = 10，十二 = 12）
        total += (current || 1) * UNITS[ch];
        current = 0;
      }
    }
    return total + current;
  }

  function baseName(path) {
    return String(path ?? '').replace(/\\/g, '/').split('/').at(-1) || '';
  }

  /** 解析来源文件名/路径：{version, take}。version 未识别为 0。 */
  function parseRevision(path) {
    const name = baseName(path);
    if (!name) return { version: 0, take: 0 };
    const latin = name.match(LATIN);
    let version = latin ? Number(latin[1]) : 0;
    if (!version) {
      const cn = name.match(CN);
      if (cn) version = cnNumber(cn[1] || cn[2]);
    }
    if (!Number.isFinite(version) || version < 0) version = 0;
    const stem = name.replace(/\.(wav|mp4|flac|aiff?|mov|mxf|mkv)$/i, '');
    const tail = stem.match(TAKE_TAIL);
    const take = tail ? cnNumber(tail[1]) : 0;
    return { version, take };
  }

  /** 只要版本号，未识别返回 0。 */
  function versionOf(path) {
    return parseRevision(path).version;
  }

  /** 只要 Demo 大版本，未识别返回 0。 */
  function takeOf(path) {
    return parseRevision(path).take;
  }

  scope.SettlementRevision = Object.freeze({ parseRevision, versionOf, takeOf, cnNumber, baseName });
})(globalThis);
