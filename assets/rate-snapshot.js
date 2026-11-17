/* 单价按记录冻结（S2-2.10，按 D2「改单价不要动历史」）。
   现状：fee() 每次实时读 state.data.prices，改一次单价，历史 730 条的金额就跟着一起变——
   已交付的账算成了新价。
   做法：落账/导入那一刻把当次单价写进记录：
     rateSnapshot = {level, per_min, per_ep}   —— 该记录计价时用的等级与单价
     rateSource   = 'snapshot'（落账时冻结）| 'legacy'（迁移回填）
   之后金额一律取记录内快照；改单价只写 prices / premiumPrices 并记下生效时间，不动任何记录。
   记录等级被人工纠正时（快照等级与当前等级不一致）才回到现价重算——改等级是改这条记录本身，
   不是改单价，两者必须分开。 */
(function (scope) {
  'use strict';
  const billing = () => scope.SettlementBilling;

  /** 用当前单价表给一条记录拍快照；等级定不出来或单价表缺该等级时不动记录。 */
  function stamp(project, record, prices, premiumPrices, source) {
    if (!project || !record) return record;
    const b = billing();
    const level = b.grade(project, record);
    if (level == null) return record;
    let rate = null;
    try { rate = b.price(prices || {}, project, record, premiumPrices); } catch (error) { return record; }
    if (!rate || !Number.isFinite(rate.per_min) || !Number.isFinite(rate.per_ep)) return record;
    record.rateSnapshot = { level, per_min: rate.per_min, per_ep: rate.per_ep };
    record.rateSource = source || 'snapshot';
    return record;
  }

  /** 迁移：所有还没有快照的记录，按「当前单价」回填并标 legacy。
      回填用的就是此刻的单价，所以迁移前后金额逐条不变；从下一次改单价起历史才被保护住。 */
  function ensure(data) {
    if (!data) return data;
    const prices = data.prices || {};
    const premiumPrices = data.premiumPrices || {};
    for (const p of data.projects || []) {
      for (const r of Object.values((p && p.episodes) || {})) {
        if (!r || r.rateSnapshot) continue;
        stamp(p, r, prices, premiumPrices, 'legacy');
      }
    }
    return data;
  }

  /** 当前记录生效的单价（供界面显示「这条用的是哪档价」）。 */
  function rateOf(project, record, prices, premiumPrices) {
    const b = billing();
    const level = b.grade(project, record);
    if (level == null) return null;
    const snap = record && record.rateSnapshot;
    if (snap && snap.level === level && Number.isFinite(snap.per_min) && Number.isFinite(snap.per_ep)) {
      return { per_min: snap.per_min, per_ep: snap.per_ep, level, frozen: true };
    }
    const live = b.price(prices || {}, project, record, premiumPrices);
    return live ? { per_min: live.per_min, per_ep: live.per_ep, level, frozen: false } : null;
  }

  scope.SettlementRates = Object.freeze({ stamp, ensure, rateOf });
})(globalThis);
