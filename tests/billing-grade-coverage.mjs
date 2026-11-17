// 计价逻辑回归（纯函数，不启浏览器）
// 覆盖 2.8.4 精品剧价格规则：默认阶梯补到 11-999=C，区间未覆盖按项目默认等级兜底，
// 既不再静默计 0，也不把缺口藏起来（unmatched 仍可用于汇总行提示）。
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const webRoot = resolve(process.env.SETTLEMENT_WEB_ROOT || 'D:/Ai-Files/Tools/Html/settlement-tool');
const sandbox = {globalThis: {}, console};
vm.createContext(sandbox);
vm.runInContext(readFileSync(resolve(webRoot, 'assets/billing-core.js'), 'utf8'), sandbox, {filename: 'billing-core.js'});
const B = sandbox.globalThis.SettlementBilling;
assert.ok(B, 'billing-core.js 未导出 SettlementBilling');

const prices = {A: {per_ep: 78, per_min: 78}, B: {per_ep: 30, per_min: 30}, C: {per_ep: 15, per_min: 15}, D: {per_ep: 10, per_min: 10}};
const premium = {A: {per_ep: 90, per_min: 90}, B: {per_ep: 60, per_min: 60}, C: {per_ep: 30, per_min: 30}};

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.error('FAIL ' + name + '\n' + (e && e.stack || e)); fail++; }
};

// 夹具：阶梯项目，区间只覆盖 1-10，默认等级 C
const staircase = {name: '阶梯剧', billingCategory: 'premium', type: '正式', mode: '按集', grade: 'C', gradeRanges: '1=A,2-10=B', episodes: {}};

check('阶梯命中区间按区间等级', () => {
  assert.equal(B.grade(staircase, {episodeNo: '1', type: '正式'}), 'A');
  assert.equal(B.grade(staircase, {episodeNo: '7', type: '正式'}), 'B');
});

check('区间未覆盖按项目默认等级兜底，并可识别为需补区间', () => {
  assert.equal(B.rangeLevel(staircase, {episodeNo: '11', type: '正式'}), null);
  assert.equal(B.grade(staircase, {episodeNo: '11', type: '正式'}), 'C');
  assert.equal(B.grade(staircase, {episodeNo: '999', type: '正式'}), 'C');
  assert.equal(B.unmatched(staircase, {episodeNo: '11', type: '正式'}), true);
});

check('兜底记录照常计价（不再计 0）', () => {
  const rec = {episodeNo: '11', type: '正式', date: '2026-11-01', duration: '00:45:00'};
  assert.equal(B.unmatched(staircase, rec), true);
  assert.equal(B.fee(prices, staircase, rec, premium), 30); // 按集：C 级 30 元/集
  assert.equal(B.fee(prices, staircase, {...rec, mode: '按时长'}, premium), 1350); // 按时长：45 分钟 × 30 元/分
});

check('兜底记录取价不再报错', () => {
  const rec = {episodeNo: '11', type: '正式'};
  assert.deepEqual(B.price(prices, staircase, rec, premium), premium.C);
});

check('区间内记录金额保持原规则（A=90 每集）', () => {
  const rec = {episodeNo: '1', type: '正式', duration: '00:50:00'};
  assert.equal(B.fee(prices, staircase, rec, premium), 90);
  assert.equal(B.fee(prices, staircase, {...rec, mode: '按时长'}, premium), 4500); // 50分钟 × 90元/分
});

check('默认阶梯已补到 11-999=C，缺配置的项目第 11 集起按 C', () => {
  assert.equal(B.defaultRanges, '1=A,2-10=B,11-999=C');
  const bare = {name: '没填阶梯', billingCategory: 'premium', type: '正式', mode: '按时长', grade: 'C'};
  assert.equal(B.grade(bare, {episodeNo: '1'}), 'A');
  assert.equal(B.grade(bare, {episodeNo: '5'}), 'B');
  assert.equal(B.grade(bare, {episodeNo: '11'}), 'C');
  assert.equal(B.grade(bare, {episodeNo: '47'}), 'C');
  assert.equal(B.unmatched(bare, {episodeNo: '11'}), false);
  assert.equal(B.fee(premium && prices, bare, {episodeNo: '11', duration: '00:02:00', type: '正式'}, premium), 60);
});

check('Demo 记录沿用自身等级，不受阶梯约束', () => {
  const demo = {episodeNo: '11', type: 'Demo', grade: 'B'};
  assert.equal(B.grade(staircase, demo), 'B');
  assert.equal(B.unmatched(staircase, demo), false);
  assert.equal(B.fee(prices, staircase, {...demo, duration: '00:10:00'}, premium), 60);
});

check('非阶梯项目等级与金额不变', () => {
  const formal = {name: '普通剧', type: '正式', grade: 'B', mode: '按集'};
  const rec = {episodeNo: '5', duration: '00:40:00'};
  assert.equal(B.grade(formal, rec), 'B');
  assert.equal(B.unmatched(formal, rec), false);
  assert.equal(B.fee(prices, formal, rec, premium), 30);
});

check('自动化项目只允许 D', () => {
  const auto = {name: '自动化', billingCategory: 'automation', type: '正式', grade: 'D', mode: '按集'};
  const rec = {episodeNo: '3', duration: '00:20:00'};
  assert.equal(B.fee(prices, auto, rec, premium), 10);
  assert.throws(() => B.fee(prices, auto, {...rec, grade: 'A'}, premium), /自动化只允许D/);
});

check('精品剧默认等级非法时兜底为 C，不抛错打断汇总', () => {
  const bad = {name: '坏等级', billingCategory: 'premium', type: '正式', grade: 'E', gradeRanges: '1=A'};
  assert.equal(B.fallbackLevel(bad), 'C');
  assert.equal(B.grade(bad, {episodeNo: '5'}), 'C');
  assert.equal(B.fee(prices, bad, {episodeNo: '5', duration: '00:10:00'}, premium), 300);
});

check('修改与排除记录恒为零', () => {
  const rec = {episodeNo: '1', workType: '修改', duration: '00:30:00'};
  assert.equal(B.fee(prices, staircase, rec, premium), 0);
  assert.equal(B.fee(prices, staircase, {...rec, workType: '混音', excluded: true}, premium), 0);
});

check('区间解析支持多种分隔符与单集写法', () => {
  const p = {...staircase, gradeRanges: '1=A；3=B,5-8:B'};
  assert.equal(B.grade(p, {episodeNo: '1'}), 'A');
  assert.equal(B.grade(p, {episodeNo: '3'}), 'B');
  assert.equal(B.grade(p, {episodeNo: '5'}), 'B');
  assert.equal(B.rangeLevel(p, {episodeNo: '2'}), null);
  assert.equal(B.grade(p, {episodeNo: '2'}), 'C'); // 空隙按默认等级兜底
});

check('不计价原因收敛为单一枚举', () => {
  assert.equal(B.exclusionReason({workType: '混音'}), null);
  assert.equal(B.exclusionReason({workType: '修改'}), 'modify');
  assert.equal(B.exclusionReason({workType: '混音', excluded: true}), 'excluded');
  assert.equal(B.exclusionReason({workType: '混音', billable: false}), 'optOut');
  assert.equal(B.exclusionReason({workType: '混音', demoSuperseded: true}), 'demo');
  assert.equal(B.exclusionReason({workType: '混音', versionSuperseded: true}), 'version');
  assert.equal(B.exclusionReason({workType: '混音', finalCutSuperseded: true}), 'finalcut');
  // 优先级：修改 > 手动排除 > 标记不计价 > 三类被替换
  assert.equal(B.exclusionReason({workType: '修改', excluded: true}), 'modify');
  assert.equal(B.exclusionReason({workType: '混音', excluded: true, versionSuperseded: true}), 'excluded');
  assert.equal(B.EXCLUSION_REASONS.version, '旧版本不计价');
});

check('isBillable 与 exclusionReason 同源', () => {
  const cases = [{}, {workType: '修改'}, {excluded: true}, {billable: false}, {demoSuperseded: true}, {versionSuperseded: true}, {finalCutSuperseded: true}];
  for (const c of cases) {
    const rec = {workType: '混音', ...c};
    assert.equal(B.isBillable(rec), B.exclusionReason(rec) === null, JSON.stringify(c));
  }
});

console.log(`RESULT ${pass}/${pass + fail} passed`);
if (fail) process.exitCode = 1;
