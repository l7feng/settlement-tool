import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const core = await readFile(new URL('assets/query-core.js', webRootURL), 'utf8');
const context = vm.createContext({window: {}});
vm.runInContext(core, context);
const Q = context.window.SettlementQuery;
assert.ok(Q, '页面必须暴露 SettlementQuery（4.1 纯逻辑外移入口）');

// ── 日期归属：自然月 / 半月 ──
assert.equal(Q.periodKey('2026-10-03', 'natural'), '2026-10');
assert.equal(Q.periodKey('2026-10-16', 'half'), '2026-10下/2026-11上');
assert.equal(Q.periodKey('2026-10-15', 'half'), '2026-09下/2026-10上');
assert.equal(Q.periodKey('2026-01-10', 'half'), '2025-12下/2026-01上');
assert.equal(Q.periodKey('2026-01-20', 'half'), '2026-01下/2026-02上');
assert.equal(Q.periodKey('2026-10-03'), '2026-10', '缺省按自然月，启动期不写半月口径');
assert.equal(Q.periodLabel('2026-10', 'natural'), '2026年10月');
assert.equal(Q.periodLabel('2026-09下/2026-10上', 'half'), '2026年9月16日—2026年10月15日');
assert.equal(Q.periodLabel('乱码', 'half'), '乱码');
assert.deepEqual({...Q.periodRange('2026-02')}, {start: '2026-02-01', end: '2026-02-28'});
assert.deepEqual({...Q.periodRange('2028-02')}, {start: '2028-02-01', end: '2028-02-29'});
assert.deepEqual({...Q.periodRange('2026-12下/2027-01上')}, {start: '2026-12-16', end: '2027-01-15'});
assert.deepEqual({...Q.periodRange('2026-10-16')}, {start: '2026-10-16', end: '2026-10-16'});

// ── 集号筛选：数字区间 / EP 前缀 / 文字 ──
const proj = {name: '缩写', shortName: '缩写短', aliases: ['别名'], episodes: {'5': {episodeNo: '5', sourceFile: '05 混音工程'}}};
const rec = {epNo: '5', label: '第5集', proj, type: '正式', grade: 'C', mode: '按时长', workType: '混音', date: '2026-10-05', sec: 400, fee: 10, billable: true, needsReview: false};
assert.equal(Q.matchesEpisodeFilter(rec, ''), true);
assert.equal(Q.matchesEpisodeFilter(rec, '5'), true);
assert.equal(Q.matchesEpisodeFilter(rec, 'EP5'), true);
assert.equal(Q.matchesEpisodeFilter(rec, '3-8'), true);
assert.equal(Q.matchesEpisodeFilter(rec, '6-9'), false);
assert.equal(Q.matchesEpisodeFilter(rec, '别名'), true);
assert.equal(Q.matchesEpisodeFilter(rec, '混音工程'), true);
assert.equal(Q.matchesEpisodeFilter(rec, '不存在的词'), false);

const list = [
  rec,
  {...rec, epNo: '6', label: '第6集', date: '2026-09-20', grade: 'B', mode: '按集', billable: false, fee: 0, needsReview: true, proj: {name: '甲', episodes: {}}},
  {...rec, epNo: '7', label: '第7集', date: '2026-11-02', grade: 'C', workType: '修改', fee: 20, proj: {name: '乙', episodes: {}}}
];

// ── 筛选链：各维度单独与组合 ──
assert.equal(Q.filterList(list, {}, 'natural').length, 3);
assert.equal(Q.filterList(list, {start: '2026-10-01', end: '2026-10-31'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {month: '2026-09'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {month: '2026-09下/2026-10上'}, 'half').length, 2, '半月口径下 9/20 与 10/5 同属上期');
assert.equal(Q.filterList(list, {project: '甲'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {grade: 'C'}, 'natural').length, 2);
assert.equal(Q.filterList(list, {mode: '按集'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {query: '6-7'}, 'natural').length, 2);
assert.equal(Q.filterList(list, {type: '正式', work: '修改'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {billing: 'billable'}, 'natural').length, 2);
assert.equal(Q.filterList(list, {billing: 'excluded'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {billing: 'pending'}, 'natural').length, 1);
assert.equal(Q.filterList(list, {project: '甲', billing: 'billable'}, 'natural').length, 0);

// ── 汇总：条数/分钟/金额/计价条数/待核对 ──
const sum = Q.summarize(list);
assert.equal(sum.eps, 3);
assert.equal(sum.fee, 30);
assert.equal(sum.billed, 2);
assert.equal(sum.excluded, 1);
assert.equal(sum.pending, 1);
assert.equal(sum.min, 20);
assert.ok(sum.types.includes('混音 2条'));

// ── 是否有筛选：任一控件非空即为真 ──
assert.equal(Q.hasAnyFilter({}), false);
assert.equal(Q.hasAnyFilter({epFilter: '  '}), false);
assert.equal(Q.hasAnyFilter({dateStart: '2026-10-01'}), true);

console.log('PASS 日期归属/筛选/汇总：纯逻辑外移后口径与单测一致（4.1）');
