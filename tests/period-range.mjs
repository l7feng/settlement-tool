import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('settlement-workbench.html',webRootURL),'utf8');
const match=html.match(/function periodRange\(key\) \{[\s\S]*?\n\}/);
assert.ok(match,'periodRange 必须定义在页面里（S2-2.7 导出起止日期依赖它）');
const context=vm.createContext({});
vm.runInContext(match[0]+'\nthis.periodRange=periodRange;',context);
const periodRange=context.periodRange;

// 自然月：当月首日 → 当月最后一天（含闰年 2 月）
assert.deepEqual({...periodRange('2026-10')},{start:'2026-10-01',end:'2026-10-31'});
assert.deepEqual({...periodRange('2026-02')},{start:'2026-02-01',end:'2026-02-28'});
assert.deepEqual({...periodRange('2028-02')},{start:'2028-02-01',end:'2028-02-29'});
assert.deepEqual({...periodRange('2026-04')},{start:'2026-04-01',end:'2026-04-30'});

// 半月：上月末 16 日 → 本月 15 日
assert.deepEqual({...periodRange('2026-09下/2026-10上')},{start:'2026-09-16',end:'2026-10-15'});
assert.deepEqual({...periodRange('2025-12下/2026-01上')},{start:'2025-12-16',end:'2026-01-15'});

// 未知期间名回退到空起止，不抛错
assert.deepEqual({...periodRange('乱七八糟')},{start:'',end:''});
assert.deepEqual({...periodRange('')},{start:'',end:''});

// 导出侧：明细表头必须有「期间/期间起/期间止」，且行数据用冻结的 period
assert.match(html,/['"]期间['"],['"]期间起['"],['"]期间止['"]/);
assert.match(html,/episodes\[e\.epNo\]\.period\|\|periodKey\(e\.date\)/);
// 期间与编号在 normalizeData 里第一次写入后冻结
assert.match(html,/e\.period=e\.period\|\|periodKey\(e\.date\)/);
assert.match(html,/assignDisplayNumbers\(d\)/);
assert.match(html,/p\.displayNo=Number\(p\.displayNo\)\|\|null/);

console.log('PASS 期间：起止日期换算正确，导出写起止列，期间/编号冻结不随设置改写');
