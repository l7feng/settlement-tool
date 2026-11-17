/* 不计价（置零）的唯一语义（S2-2.2，按 D3）。
   现状问题是「一个 excluded 布尔 + 一段自由文本 excludeReason」被人工与自动规则混用：
   自动规则（旧版本不计费）覆盖人工判断时看不出是谁改的，人工再勾回来又会被下一次自动重算悄悄回弹。
   D3 裁决：人工排除 = 自动置零，两者等权、都可以覆盖对方。
   所以只保留一个字段 excluded 决定「计不计钱」，另加两个只读说明字段：
     excludeSource —— 'manual'（人工）| 'auto'（规则自动）
     excludeReason —— 具体原因文本
   谁最后改谁生效；界面按 excludeSource 显示「人工置零 / 自动置零」并给出原因。
   自动规则只清自己置的零（source 为 auto），不替人工改主意；人工可以覆盖任何置零。 */
(function (scope) {
  'use strict';
  const MANUAL = 'manual';
  const AUTO = 'auto';

  function setExclusion(record, excluded, source, reason) {
    if (!record) return record;
    record.excluded = !!excluded;
    if (excluded) {
      record.excludeSource = source === AUTO ? AUTO : MANUAL;
      record.excludeReason = String(reason || '');
    } else {
      delete record.excludeSource;
      record.excludeReason = '';
    }
    return record;
  }

  /** 人工置零 / 取消置零（勾选框、批量改工作类型、编辑面板都走这里）。
      人工一旦表过态，就记 excludeManual，自动规则不再替它改主意（避免「取消了又被自动回弹」）。 */
  function setManual(record, excluded, reason) {
    if (record) record.excludeManual = true;
    return setExclusion(record, excluded, MANUAL, reason);
  }

  /** 规则置零（旧交付版本、Demo 旧版本、成片替换）。 */
  function setAuto(record, excluded, reason) {
    return setExclusion(record, excluded, AUTO, reason);
  }

  /** 规则撤销自己置的零：只对 source 为 auto 的记录生效，人工置零保持不动。 */
  function clearAuto(record) {
    if (record && record.excludeSource === AUTO) setExclusion(record, false, AUTO, '');
    return record;
  }

  /** 'manual' | 'auto' | null（历史数据没有来源字段时按人工处理，避免把旧账归到规则名下）。 */
  function sourceOf(record) {
    if (!record || !record.excluded) return null;
    return record.excludeSource === AUTO ? AUTO : MANUAL;
  }

  /** 历史数据迁移：只有 excluded 没有来源的旧记录，按原因文本判断是谁置的零。
      旧版只自动置零「旧版本 / 成片替换」，其余（手动排除、修改不计价）算人工。 */
  function normalize(record) {
    if (!record || !record.excluded || record.excludeSource) return record;
    const reason = String(record.excludeReason || '');
    record.excludeSource = /版本|成片|替换/.test(reason) ? AUTO : MANUAL;
    if (record.excludeSource === MANUAL) record.excludeManual = true;
    return record;
  }

  function label(record) {
    const source = sourceOf(record);
    if (!source) return '';
    return source === AUTO ? '自动置零' : '人工置零';
  }

  scope.SettlementExclusion = Object.freeze({ MANUAL, AUTO, setExclusion, setManual, setAuto, clearAuto, sourceOf, label, normalize });
})(globalThis);
