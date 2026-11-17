/* 4.1 纯逻辑外移（日期归属 + 筛选 + 金额汇总）：不碰 DOM、不读全局 state，
   页面只保留取值与渲染。周期口径由调用方传 cycle，保证「期间名在记录里冻结」的语义不变。 */
(function (scope) {
  const pad = n => String(n).padStart(2, '0');
  const lastDay = (y, m) => new Date(y, m, 0).getDate();

  function periodKey(dateStr, cycle) {
    const mode = cycle || 'natural';
    const d = new Date(dateStr + 'T00:00:00');
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    if (mode === 'natural') return `${y}-${pad(m + 1)}`;
    if (day <= 15) {
      const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y;
      return `${py}-${pad(pm + 1)}下/${y}-${pad(m + 1)}上`;
    }
    const nm = m === 11 ? 0 : m + 1, ny = m === 11 ? y + 1 : y;
    return `${y}-${pad(m + 1)}下/${ny}-${pad(nm + 1)}上`;
  }

  function periodLabel(key, cycle) {
    if ((cycle || 'natural') === 'natural') {
      const [y, m] = key.split('-');
      return `${y}年${Number(m)}月`;
    }
    const m = key.match(/^(\d{4})-(\d{2})下\/(\d{4})-(\d{2})上$/);
    return m ? `${m[1]}年${Number(m[2])}月16日—${m[3]}年${Number(m[4])}月15日` : key;
  }

  function periodRange(key) {
    const natural = key.match(/^(\d{4})-(\d{2})$/);
    if (natural) {
      const y = Number(natural[1]), m = Number(natural[2]);
      return {start: y + '-' + pad(m) + '-01', end: y + '-' + pad(m) + '-' + pad(lastDay(y, m))};
    }
    const half = key.match(/^(\d{4})-(\d{2})下\/(\d{4})-(\d{2})上$/);
    if (half) return {start: half[1] + '-' + pad(Number(half[2])) + '-16', end: half[3] + '-' + pad(Number(half[4])) + '-15'};
    const ymd = String(key || '');
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(ymd);
    return {start: ok ? ymd : '', end: ok ? ymd : ''};
  }

  function matchesEpisodeFilter(record, query) {
    if (!query) return true;
    const raw = record.proj.episodes[record.epNo] || {};
    const no = raw.episodeNo || (/^\d+$/.test(record.epNo) ? record.epNo : null);
    return query.split(/[,，;；]/).some(part => {
      const token = part.trim();
      if (!token) return false;
      const m = token.match(/^(?:EP)?(\d+)(?:\s*[-~到]\s*(?:EP)?(\d+))?$/i);
      if (m) return no !== null && Number(no) >= Number(m[1]) && Number(no) <= Number(m[2] || m[1]);
      return [record.label, record.proj.name, record.proj.shortName || '', ...(record.proj.aliases || []),
        record.type, record.proj.episodes[record.epNo]?.sourceFile || '']
        .some(value => value.toLowerCase().includes(token.toLowerCase()));
    });
  }

  const FILTER_IDS = ['monthFilter', 'projFilter', 'gradeFilter', 'modeFilter', 'epFilter',
    'typeFilter', 'workFilter', 'billingFilter', 'dateStart', 'dateEnd'];

  function filterList(list, filters, cycle) {
    const f = filters || {};
    return list.filter(e =>
      (!f.start || e.date >= f.start) &&
      (!f.end || e.date <= f.end) &&
      (!f.month || periodKey(e.date, cycle) === f.month) &&
      (!f.project || e.proj.name === f.project) &&
      (!f.grade || e.grade === f.grade) &&
      (!f.mode || e.mode === f.mode) &&
      matchesEpisodeFilter(e, (f.query || '').trim()) &&
      (!f.type || e.type === f.type) &&
      (!f.work || e.workType === f.work) &&
      (!f.billing || (f.billing === 'billable' && e.billable) || (f.billing === 'excluded' && !e.billable) || (f.billing === 'pending' && e.needsReview)));
  }

  function summarize(list) {
    const billed = list.filter(e => e.billable);
    return {
      eps: list.length,
      min: Math.round(list.reduce((s, e) => s + e.sec, 0) / 60 * 10) / 10,
      fee: Math.round(list.reduce((s, e) => s + e.fee, 0) * 100) / 100,
      billed: billed.length,
      billedMin: Math.round(billed.reduce((s, e) => s + e.sec, 0) / 60 * 10) / 10,
      excluded: list.length - billed.length,
      pending: list.filter(e => e.needsReview).length,
      types: ['混音', '重混', '修改'].map(t => t + ' ' + list.filter(e => e.workType === t).length + '条').join(' · ')
    };
  }

  function hasAnyFilter(values) {
    return FILTER_IDS.some(id => String(values[id] || '').trim());
  }

  scope.SettlementQuery = {periodKey, periodLabel, periodRange, matchesEpisodeFilter, filterList, summarize, hasAnyFilter, FILTER_IDS};
})(typeof window !== 'undefined' ? window : globalThis);
