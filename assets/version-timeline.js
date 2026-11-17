/* 交付时间线：同一集的多个版本按版本号与日期归并，最早版本为交付、后续版本为修改；并提供重复集数识别。 */
(function (scope) {
  'use strict';
  const VERSION_RE = /(?:^|[^a-z0-9])v(\d+)(?=$|[^0-9])/i;
  const CN_VERSION_RE = /(?:第([0-9一二三四五六七八九十百零〇]+)版|版本([0-9一二三四五六七八九十百零〇]+))/;
  const CN_DIGITS = { '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function cnNumber(text) {
    if (/^\d+$/.test(text)) return Number(text);
    const parts = text.split('十');
    const digit = s => (s ? (CN_DIGITS[s] ?? 0) : 0);
    if (parts.length === 2) return (parts[0] ? digit(parts[0]) : 1) * 10 + digit(parts[1]);
    return digit(text);
  }

  // 归一集号：优先记录自带集号，其次用纯数字键；'02' 与 '2' 视为同一集。
  function episodeNumber(key, record) {
    const raw = record && record.episodeNo;
    if (raw !== undefined && raw !== null && /^\d+$/.test(String(raw))) return Number(raw);
    if (/^\d+$/.test(String(key))) return Number(key);
    return null;
  }
  function episodeIdentity(key, record) {
    const n = episodeNumber(key, record);
    if (n !== null) return 'EP' + n;
    // 版本另存的键可能是 '1-v2'、'2b' 这类“集号＋后缀”，取开头数字仍归一为同一集。
    const lead = String(key).match(/^\d+/);
    return lead ? 'EP' + Number(lead[0]) : null;
  }
  // 版本号认来源文件名里的 Vxx、第N版或版本N；没有版本号的记录视为独立一条交付。
  function versionNumber(record) {
    const name = String((record && record.sourceFile) || (record && record.sourcePath) || '').replace(/\\/g, '/').split('/').at(-1);
    const latin = name.match(VERSION_RE);
    if (latin) return Number(latin[1]);
    const cn = name.match(CN_VERSION_RE);
    return cn ? cnNumber(cn[1] || cn[2]) : 0;
  }
  function versionLabel(record) {
    const n = versionNumber(record);
    return n > 0 ? 'V' + String(n).padStart(2, '0') : '';
  }
  function workTypeOf(record) {
    return scope.SettlementBilling ? scope.SettlementBilling.workType(record) : (record && record.workType) || '混音';
  }
  // 是否会被计价（“修改”、已排除、旧版本都不计价）。
  function billableOf(record) {
    if (!record) return false;
    if (scope.SettlementBilling) return scope.SettlementBilling.isBillable(record);
    return !record.excluded && record.workType !== '修改';
  }
  // 交付时间线：key -> {identity, workType, version, label, delivery}
  function buildTimeline(project) {
    const info = new Map(), groups = new Map();
    for (const [key, record] of Object.entries((project && project.episodes) || {})) {
      const own = workTypeOf(record);
      const identity = episodeIdentity(key, record);
      const version = versionNumber(record);
      const label = versionLabel(record);
      if (identity === null || own === '修改' || version === 0) {
        info.set(key, { identity, workType: own, version, label, delivery: true });
        continue;
      }
      const groupKey = identity + '|' + own;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ key, record, identity, workType: own, version, label });
    }
    for (const items of groups.values()) {
      items.sort((a, b) => a.version - b.version
        || String(a.record.date || '').localeCompare(String(b.record.date || ''))
        || String(a.key).localeCompare(String(b.key)));
      const first = items[0];
      for (const item of items) info.set(item.key, {
        identity: item.identity, workType: item.workType, version: item.version,
        label: item.label, delivery: item.key === first.key,
      });
    }
    return info;
  }
  // 旧版本键：同集同工作类型的多条版本记录中，只保留最高版本（同版本保留最新日期），其余为过时版本。
  function supersededKeys(project) {
    const groups = new Map(), out = [];
    for (const [key, record] of Object.entries((project && project.episodes) || {})) {
      if ((record.type || project.type) === 'Demo') continue;
      const own = workTypeOf(record);
      const identity = episodeIdentity(key, record);
      const version = versionNumber(record);
      if (identity === null || own === '修改' || version === 0) continue;
      const groupKey = identity + '|' + own;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ key, record, version });
    }
    for (const items of groups.values()) {
      if (items.length < 2) continue;
      items.sort((a, b) => a.version - b.version
        || String(a.record.date || '').localeCompare(String(b.record.date || ''))
        || String(a.key).localeCompare(String(b.key)));
      for (const item of items.slice(0, -1)) out.push(item.key);
    }
    return out;
  }
  // 重复集数：同一项目内归一集号出现多条记录（不同版本或手工重复）。
  function duplicateGroups(project) {
    const groups = new Map();
    for (const [key, record] of Object.entries((project && project.episodes) || {})) {
      const identity = episodeIdentity(key, record);
      if (identity === null) continue;
      if (!groups.has(identity)) groups.set(identity, []);
      groups.get(identity).push({ key, record });
    }
    const out = [];
    // 只有同一集里存在两条及以上“会被计价”的记录才算重复；旧版本与“修改”本就不计价，不算重复。
    for (const [identity, items] of groups) {
      if (items.length < 2) continue;
      const billable = items.filter(item => billableOf(item.record));
      if (billable.length < 2) continue;
      out.push({ identity, items });
    }
    return out.sort((a, b) => a.identity.localeCompare(b.identity, undefined, { numeric: true }));
  }
  // 保留建议：优先与统一计价方式一致的记录，其次有版本号的最高版本、有来源文件的记录，最后按日期。
  function preferredRecord(project, items, preferredMode) {
    const projectMode = preferredMode || (project && project.mode) || '';
    const scored = items.map(item => ({
      ...item,
      version: versionNumber(item.record),
      hasSource: !!item.record.sourceFile || !!item.record.sourcePath,
      modeMatch: projectMode && (item.record.mode || projectMode) === projectMode ? 1 : 0,
      date: String(item.record.date || ''),
    }));
    scored.sort((a, b) => (b.modeMatch - a.modeMatch)
      || (b.version - a.version)
      || ((b.hasSource ? 1 : 0) - (a.hasSource ? 1 : 0))
      || b.date.localeCompare(a.date)
      || String(a.key).localeCompare(String(b.key)));
    return scored[0];
  }
  // 同集既有记录的键（'02' 与 '2' 视为同一集），登记时用于防重复。
  function findEpisodeKey(project, episodeNo) {
    const n = Number(episodeNo);
    if (!Number.isFinite(n)) return null;
    for (const [key, record] of Object.entries((project && project.episodes) || {})) {
      const num = episodeNumber(key, record);
      if (num !== null && num === n) return key;
    }
    return null;
  }
  scope.SettlementVersion = Object.freeze({
    episodeNumber, episodeIdentity, versionNumber, versionLabel,
    buildTimeline, supersededKeys, duplicateGroups, preferredRecord, findEpisodeKey,
  });
})(globalThis);
