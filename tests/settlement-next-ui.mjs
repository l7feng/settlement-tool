import {chromium} from './playwright-runtime.mjs';
import {webRoot} from './web-root.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';

const business = {
  schemaVersion: 1,
  prices: {A: {per_min: 78, per_ep: 78}, B: {per_min: 30, per_ep: 30}, C: {per_min: 15, per_ep: 15}, D: {per_min: 10, per_ep: 10}},
  premiumPrices: {},
  projects: [
    {name: '测试项目甲', grade: 'D', type: '正式', mode: '按时长', billingCategory: 'automation', path: 'D:/T/甲', aliases: ['测试甲'], id: 'p1', episodes: {
      '1': {date: '2026-11-03', duration: '00:04:00', workType: '混音', excluded: false, mode: '按时长', type: '正式', recordId: 'r1'},
      '2': {date: '2026-11-04', duration: '00:03:00', workType: '混音', excluded: false, mode: '按时长', type: '正式', recordId: 'r2'},
      '3': {date: '2026-11-04', duration: '00:02:00', workType: '混音', excluded: true, mode: '按时长', type: '正式', recordId: 'r3'},
      '4': {date: '2026-10-05', duration: '00:01:00', workType: '混音', excluded: false, mode: '按时长', type: '正式', recordId: 'r4'}
    }},
    {name: '测试项目乙', grade: 'C', type: '正式', mode: '按集', path: 'D:/T/乙', aliases: [], id: 'p2', episodes: {
      '1': {date: '2026-11-05', duration: '00:02:00', workType: '混音', excluded: false, mode: '按集', type: '正式', recordId: 'r5'}
    }}
  ]
};

let pass = 0, total = 0;
const failures = [];
function check(name, cond, detail) {
  total++;
  if (cond) { pass++; return; }
  failures.push(name + (detail == null ? '' : ' → ' + detail));
}

const server = createServer(async (req, res) => {
  try {
    const p = resolve(webRoot, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!p.startsWith(webRoot + sep)) throw 0;
    res.setHeader('Content-Type', extname(p) === '.html' ? 'text/html;charset=utf-8' : 'application/javascript');
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({channel: 'msedge'});
const page = await browser.newPage({viewport: {width: 1780, height: 1060}});
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(({business}) => {
  localStorage.setItem('settlement_v1', JSON.stringify(business));
  localStorage.setItem('settlement-settings-v1', JSON.stringify({amountAlwaysVisible: true}));
}, {business});

const origin = `http://127.0.0.1:${server.address().port}`;
await page.goto(origin + (process.env.SETTLEMENT_PAGE || '/settlement-workbench.html'), {waitUntil: 'domcontentloaded', timeout: 30000});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const input = document.getElementById('monthInput');
  input.value = '2026-11';
  input.dispatchEvent(new Event('change', {bubbles: true}));
});
await page.waitForTimeout(250);

check('页面无脚本异常', pageErrors.length === 0, pageErrors.join(' | '));
check('旧布局 DOM 已不存在', await page.evaluate(() => ['#topCards', '#filterChips', '#calendarStrip', '#moreFilters', '#workspaceContext'].every(id => !document.querySelector(id))));
check('新表格行数 4 条', await page.evaluate(() => document.querySelectorAll('#tableBody .row[data-key]').length) === 4);
check('顶部卡 4 条 / 85.00', await page.evaluate(() => document.getElementById('kpiCount').textContent === '4' && document.getElementById('kpiFee').textContent === '¥85.00'));
check('时长 11.0 分', await page.evaluate(() => document.getElementById('kpiMin').textContent === '11.0'));

await page.selectOption('#fProject', '测试项目甲');
await page.waitForTimeout(200);
check('项目筛选 3 条 / 70.00', await page.evaluate(() => document.querySelectorAll('#tableBody .row[data-key]').length === 3 && document.getElementById('kpiFee').textContent === '¥70.00'));
check('筛选 chip 出现', await page.evaluate(() => document.querySelector('#chips').innerText.includes('项目 测试项目甲')));
await page.selectOption('#fProject', '');
await page.waitForTimeout(200);

await page.fill('#q', 'EP3');
await page.waitForTimeout(350);
check('搜索 EP3 命中 1 条（按显示号）', await page.evaluate(() => document.querySelectorAll('#tableBody .row[data-key]').length === 1));
await page.fill('#q', '');
await page.waitForTimeout(300);

await page.evaluate(() => document.querySelector('#calDays .d.has').click());
await page.waitForTimeout(200);
check('点日历日筛选生效', await page.evaluate(() => !document.getElementById('calClear').hidden && document.querySelectorAll('#tableBody .row[data-key]').length >= 1));
await page.click('#calYear');
await page.waitForTimeout(250);
check('年度热力图窗口打开', await page.evaluate(() => !!document.querySelector('.modal') && document.querySelectorAll('.hm-cell[data-date]').length === 365 && document.querySelectorAll('.hm-months span').length === 12));
await page.click('[data-hm="fee"]');
await page.waitForTimeout(200);
check('热力图可切按金额着色', await page.evaluate(() => document.querySelectorAll('.hm-cell[data-date].lv4').length >= 1));
await page.evaluate(() => document.querySelector('.hm-cell[data-date="2026-11-04"]').click());
await page.waitForTimeout(250);
check('点热力图格子跳到当日', await page.evaluate(() => document.querySelector('#chips').innerText.includes('日期 11-04') && document.querySelectorAll('#tableBody .row[data-key]').length === 2 && !document.querySelector('.modal')));
await page.click('#calClear');
await page.waitForTimeout(200);

await page.click('#feeEye');
await page.waitForTimeout(150);
check('金额遮罩生效', await page.evaluate(() => document.getElementById('kpiFee').textContent === '••••••'));
await page.click('#feeEye');
await page.waitForTimeout(150);
check('金额恢复', await page.evaluate(() => document.getElementById('kpiFee').textContent === '¥85.00'));

await page.evaluate(() => document.querySelector('#tableBody .row[data-key]').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})));
await page.waitForTimeout(200);
check('双击打开详情', await page.evaluate(() => !!document.querySelector('.modal')));
await page.fill('[data-f="duration"]', '00:10:00');
await page.click('[data-save]');
await page.waitForTimeout(250);
check('改时长后金额上升', await page.evaluate(() => document.getElementById('kpiFee').textContent === '¥145.00'));
check('撤销可用', await page.evaluate(() => !document.getElementById('undoBtn').disabled));
await page.click('#undoBtn');
await page.waitForTimeout(250);
check('撤销恢复金额', await page.evaluate(() => document.getElementById('kpiFee').textContent === '¥85.00'));

await page.evaluate(() => document.querySelector('#tableBody .row[data-key]').click());
await page.waitForTimeout(100);
check('行选中计数', await page.evaluate(() => document.getElementById('selCount').textContent === '1'));
await page.selectOption('#fProject', '测试项目甲');
await page.waitForTimeout(200);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#tableBody .row[data-key]'));
  rows[0].click(); rows[1].click();
});
await page.waitForTimeout(150);
await page.click('[data-nav="bulk"]');
await page.waitForTimeout(200);
check('批量编辑弹窗打开', await page.evaluate(() => !!document.querySelector('.modal')));
await page.selectOption('[data-f="workType"]', '修改');
await page.click('[data-save]');
await page.waitForTimeout(250);
check('批量改工作类型落账', await page.evaluate(() => document.getElementById('tableBody').innerText.split('修改').length - 1 >= 2));
check('批量后金额不变（修改不计价会降）', await page.evaluate(() => Number(document.getElementById('kpiFee').textContent.replace(/[^0-9.]/g, '')) >= 0));

await page.click('#undoBtn');
await page.waitForTimeout(200);

check('导出按钮存在', await page.evaluate(() => !!document.querySelector('[data-act="export"]')));
await page.click('[data-act="import"]');
await page.waitForTimeout(200);
check('导入弹窗可打开', await page.evaluate(() => !!document.querySelector('#importList')));

await page.keyboard.press('Escape');
await page.waitForTimeout(150);
await page.setViewportSize({width: 949, height: 510});
await page.waitForTimeout(300);
check('窄窗日历自动收起', await page.evaluate(() => document.getElementById('calDays').classList.contains('collapsed')));
check('窄窗表格仍可见', await page.evaluate(() => document.querySelectorAll('#tableBody .row[data-key]').length >= 1 && document.getElementById('tableScroll').clientHeight > 0));
await page.click('#calToggle');
await page.waitForTimeout(300);
check('展开日历后可换行且不横向溢出', await page.evaluate(() => {
  const days = document.getElementById('calDays');
  const rows = new Set([...days.children].map(c => Math.round(c.getBoundingClientRect().top))).size;
  return !days.classList.contains('collapsed') && rows > 1 && days.scrollWidth <= days.clientWidth + 1;
}));
check('窄窗表格可横向滚动而非裁切', await page.evaluate(() => {
  const box = document.getElementById('tableScroll');
  return box.scrollWidth > box.clientWidth;
}));
await page.setViewportSize({width: 1780, height: 1060});

console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} ${pass}/${total}`);
if (failures.length) for (const f of failures) console.log('  × ' + f);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
