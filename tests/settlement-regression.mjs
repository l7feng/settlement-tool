import {chromium} from './playwright-runtime.mjs';
import {webRoot,webRootURL} from './web-root.mjs';
// 只使用隔离浏览器及合成夹具，不连接桌面版的数据源。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = process.env.SETTLEMENT_EVIDENCE || resolve(root, 'build/tuner-20261012');

const fixture = () => ({ prices: { A: { per_min: 78, per_ep: 78 }, B: { per_min: 30, per_ep: 30 }, C: { per_min: 15, per_ep: 15 }, D: { per_min: 10, per_ep: 10 } }, projects: [{ name: '缩写', aliases: [], grade: 'D', type: '正式', mode: '按集', path: '', episodes: { '1': { date: '2026-10-12', duration: '00:01:00', workType: '混音' }, '2': { date: '2026-10-12', duration: '00:02:00', workType: '重混', rework: true }, '3': { date: '2026-10-12', duration: '00:01:30', workType: '修改' }, '4': { date: '2026-10-12', duration: '00:01:00', workType: '混音', excluded: true, excludeReason: '测试排除' } } }] });
// 合成 ISO BMFF 容器，仅验证文件头时长读取，不模拟视频解码。
function mp4Fixture({ version = 0, wide = false, seconds = 90, scale = 1000, invalid = false } = {}) {
  const box = (type, content, extended = false) => {
    const header = extended ? 16 : 8, result = Buffer.alloc(header + content.length);
    result.writeUInt32BE(extended ? 1 : result.length, 0); result.write(type, 4, 4, 'ascii');
    if (extended) result.writeBigUInt64BE(BigInt(result.length), 8);
    content.copy(result, header); return result;
  };
  const mvhd = Buffer.alloc(version ? 112 : 100); mvhd[0] = version;
  mvhd.writeUInt32BE(scale, version ? 20 : 12);
  if (version) mvhd.writeBigUInt64BE(BigInt(seconds * scale), 24); else mvhd.writeUInt32BE(seconds * scale, 16);
  const data = Buffer.concat([box('ftyp', Buffer.from('isom0000isom')), box('mdat', Buffer.alloc(4096)), box('moov', box('mvhd', mvhd), wide)]);
  if (invalid) data.writeUInt32BE(0x7fffffff, 0);
  return [...data];
}
const server = createServer(async (req, res) => {
  try {
    const path = resolve(webRoot, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(webRoot + sep)) throw new Error('越界路径');
    const content = await readFile(path);
    res.setHeader('Content-Type', extname(path) === '.html' ? 'text/html;charset=utf-8' : 'application/javascript');
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const watchdog = setTimeout(() => { console.error("FAIL 超过测试时限，停止测试"); browser?.close(); server.close(); process.exitCode = 1; }, Number(process.env.SETTLEMENT_TIMEOUT||60000));
let failures = 0;
let testCount = 0;
const errors = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.SETTLEMENT_BROWSER ? {executablePath:process.env.SETTLEMENT_BROWSER} : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(data => {if (!sessionStorage.getItem('test-fixture-seeded')) {localStorage.setItem('settlement_v1', JSON.stringify(data));sessionStorage.setItem('test-fixture-seeded','1');}}, fixture());
  const page = await context.newPage();
  const mediaSession=await context.newCDPSession(page);
  const transparency=async value=>mediaSession.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value}]});
  await transparency('no-preference');
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/settlement-workbench.html',{waitUntil:'domcontentloaded',timeout:30000});
  const reset = async () => page.evaluate(data => {state.dataBlocked=false;state.collapsed={};state.calYear=null;state.calendarScope=null;state.selectedDate=null;state.cycle='natural';document.getElementById('cycleSelect').value='natural';settings.freezeLevel='full';settings.topCollapsed=[];settings.sideCollapsed={left:false,right:false};settings.sideWidths={left:180,right:300};setReducedMaterial(false);settings.topOpacity=0.88;settings.viewPreset='custom';delete settings.customWorkspace;saveSettings(settings);state.data = normalizeData(data);for(const id of ['gradeFilter','modeFilter','projFilter','monthFilter','epFilter','typeFilter','workFilter','billingFilter','dateStart','dateEnd']){const el=document.getElementById(id);if(el)el.value='';}settings.defaultSort='project';const sortModeEl=document.getElementById('sortMode');if(sortModeEl)sortModeEl.value='project';for(const e of allEpisodes())state.collapsed['X:'+periodKey(e.date)+'|'+e.proj.name]=false;saveData(); render(); closeModal(); }, fixture());
  // 只跑名字命中 SETTLEMENT_ONLY 的用例（逗号分隔、按正则片段匹配），改一条验一条时省 3 分钟。
  const only = (process.env.SETTLEMENT_ONLY || '').split(',').map(x => x.trim()).filter(Boolean);
  const test = async (name, fn) => { if (only.length && !only.some(token => name.includes(token))) return; testCount++; try { await reset(); await fn(); console.log('PASS ' + name); } catch (error) { failures++; console.error('FAIL ' + name + '\n' + error.stack); } };
  // 最小 PCM WAV 夹具，头部声明 60 秒，测试不会解码整个音频。
  const prepareWav = async names => page.evaluate(names => {
    const header = new ArrayBuffer(44), v = new DataView(header);
    const str = (off, text) => [...text].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,960036,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,960000,true);
    showImportModal(scanFiles(names.map(name => new File([header],name))));
  }, names);

  await test('修改及排除不计价，工作统计仍保留', async () => {
    const result = await page.evaluate(() => { const p = state.data.projects[0]; return { fees: Object.values(p.episodes).map(e => feeOf(p, e)), count: allEpisodes().length, sum: calcSummary().fee, types: Object.values(p.episodes).map(workTypeOf) }; });
    assert.deepEqual(result.fees, [10, 10, 0, 0]);
    assert.equal(result.count, 4); assert.equal(result.sum, 20);
    assert.deepEqual(result.types, ['混音', '重混', '修改', '混音']);
  });
  await test('按时长计费也排除修改和人工排除', async () => {
    const result = await page.evaluate(() => { const p = state.data.projects[0]; p.mode = '按时长'; return Object.values(p.episodes).map(e => feeOf(p, e)); });
    assert.deepEqual(result, [10, 20, 0, 0]);
  });
  await test('历史重混标记迁移不擅自改为修改', async () => {
    const result = await page.evaluate(() => { const d = JSON.parse(JSON.stringify(state.data)); delete d.projects[0].episodes['2'].workType; const n = normalizeData(d); return { type: workTypeOf(n.projects[0].episodes['2']), original: d.projects[0].episodes['2'].workType }; });
    assert.equal(result.type, '重混'); assert.equal(result.original, undefined);
  });
  await test('批量纠正金额并可撤销恢复原状态', async () => {
    const result = await page.evaluate(() => { const before = JSON.stringify(state.data); applyBatchWorkChanges([{ projName: '缩写', epNo: '1' }, { projName: '缩写', epNo: '2' }], '修改', false, '历史修正'); const afterFee = calcSummary().fee; const retained = allEpisodes().length; undoDataChange(); return { afterFee, retained, equal: JSON.stringify(state.data) === before, fee: calcSummary().fee }; });
    assert.equal(result.afterFee, 0); assert.equal(result.retained, 4); assert.equal(result.equal, true); assert.equal(result.fee, 20);
  });
  await test('项目改名保留缩写别名和所有记录', async () => {
    const result = await page.evaluate(() => { applyProjectRenames([{ from: '缩写', to: '完整项目名称' }]); const p = state.data.projects[0]; return { name: p.name, aliases: p.aliases, count: Object.keys(p.episodes).length, fee: calcSummary().fee }; });
    assert.equal(result.name, '完整项目名称'); assert.ok(result.aliases.includes('缩写')); assert.equal(result.count, 4); assert.equal(result.fee, 20);
  });
  await test('名称碰撞原子拒绝，不产生半次重命名', async () => {
    const result = await page.evaluate(() => { state.data.projects.push({ name: '已存在', aliases: [], grade: 'D', type: '正式', mode: '按集', episodes: {} }); const before = JSON.stringify(state.data); try { applyProjectRenames([{ from: '缩写', to: '已存在' }]); } catch {} return JSON.stringify(state.data) === before; });
    assert.equal(result, true);
  });
  await test('同集多版本保留候选，不自动认定重混', async () => {
    const result = await page.evaluate(() => { const scan = scanFiles([new File(['a'], '5集 1012 V01.wav'), new File(['b'], '5集 1012 V02.wav')]); const item = scan.parsed['5']; return { count: scan.wavCount, autoRework: !!item.rework, versions: item.candidates?.length }; });
    assert.equal(result.count, 2); assert.equal(result.autoRework, false); assert.equal(result.versions, 2);
  });
  await test('非法备份拒绝且不改当前数据', async () => {
    const result = await page.evaluate(() => { const before = JSON.stringify(state.data); const bad = [null, {}, { projects: [] }, { prices: state.data.prices, projects: [{ name: '坏数据', episodes: { '1': { date: '非法日期', duration: '坏时长' } } }] }]; const rejected = bad.map(x => { try { const r = validateBackup(x); return r?.ok === false || r?.valid === false; } catch { return true; } }); return { rejected, unchanged: before === JSON.stringify(state.data) }; });
    assert.ok(result.rejected.every(Boolean)); assert.equal(result.unchanged, true);
  });
  await test('有效旧备份可校验且不提前替换数据', async () => {
    const result = await page.evaluate(data => { const before = JSON.stringify(state.data); const r = validateBackup(data); return { valid: r?.ok !== false && r?.valid !== false, unchanged: before === JSON.stringify(state.data) }; }, fixture());
    assert.equal(result.valid, true); assert.equal(result.unchanged, true);
  });
  await test('无集号Demo统一导入保留作品及原文件，默认自动化D', async () => {
    await prepareWav(['片头试听 V01.wav']);await page.getByLabel('Demo0作品',{exact:true}).fill('新Demo作品');await page.locator('#demoRead').click();await page.locator('#demoConfirm').click();
    const result=await page.evaluate(()=>{const p=state.data.projects.find(p=>p.demoBucket),[key,e]=Object.entries(p.episodes)[0];return {key,episodeNo:e.episodeNo,source:e.sourceFile,name:e.demoName,type:e.type,fee:feeOf(p,e)};});assert.ok(result.key.startsWith('demo:'));assert.equal(result.episodeNo,null);assert.equal(result.source,'片头试听 V01.wav');assert.equal(result.name,'新Demo作品');assert.equal(result.type,'Demo');assert.equal(result.fee,10);
  });
  await test('预览可选版本，修改导入为零且保留工作记录', async () => {
    await prepareWav(['5集 1012 V01.wav','5集 1012 V02.wav']);
    await page.locator('#im_work').selectOption('修改');
    await page.getByRole('button', { name: '读取时长并预览', exact: true }).click();
    await page.waitForFunction(()=>!!window._importPreview,{timeout:15000});
    const review=page.getByRole('button',{name:'完成审核，预览导入',exact:true});
    if(await review.count()){await review.click();}
    // 两个版本分别成行：新版导入，旧版另存为独立工作记录（都不计价）。
    const rows=await page.evaluate(()=>window._importPreview.rows.map(r=>({ver:r.candidates[r.selected].ver,action:r.action,work:r.workType})));
    assert.equal(rows.length,2);assert.ok(rows.every(r=>r.work==='修改'));assert.equal(rows.filter(r=>r.action==='add').length,1);
    await page.getByRole('button', { name: '确认导入', exact: true }).click();
    const result = await page.evaluate(() => {const p=state.data.projects[0];return {works:Object.values(p.episodes).filter(e=>e.episodeNo==='5').map(e=>workTypeOf(e)),fees:Object.values(p.episodes).filter(e=>e.episodeNo==='5').map(e=>feeOf(p,e)),count:allEpisodes().length,sum:calcSummary().fee};});
    assert.deepEqual(result.works,['修改','修改']);assert.deepEqual(result.fees,[0,0]);assert.equal(result.count,6);assert.equal(result.sum,20);
    await page.evaluate(()=>undoDataChange());assert.equal(await page.evaluate(()=>allEpisodes().length),4);
  });
  await test('已有集号默认跳过，另存不覆盖原记录', async () => {
    await prepareWav(['1集 1012 V02.wav']);
    await page.getByRole('button', { name: '读取时长并预览', exact: true }).click();
    assert.equal(await page.getByLabel('冲突处理').inputValue(),'skip');
    await page.getByLabel('冲突处理').selectOption('append');
    await page.getByLabel('工作类型',{exact:true}).selectOption('修改');
    await page.getByRole('button', { name: '确认导入', exact: true }).click();
    const result=await page.evaluate(()=>({original:state.data.projects[0].episodes['1'].sourceFile||null,count:allEpisodes().length,fee:calcSummary().fee,keys:Object.keys(state.data.projects[0].episodes)}));
    assert.equal(result.original,null);assert.equal(result.count,5);assert.equal(result.fee,20);assert.ok(result.keys.some(k=>k.startsWith('1@')));
  });
  await test('JSON拖入预览取消不改，确认恢复先留快照并可撤销', async () => {
    const before = await page.evaluate(()=>JSON.stringify(state.data));
    const incoming=fixture();incoming.projects[0].name='备份新项目';incoming.projects[0].episodes={'9':{date:'2026-10-12',duration:'00:01:00',workType:'混音'}};
    const drop=async()=>page.evaluate(data=>{const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(data)],'test-backup.json',{type:'application/json'}));document.getElementById('dropZone').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},incoming);
    await drop();await page.locator('#restoreApply').waitFor();
    assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);
    await drop();await page.locator('#restoreApply').waitFor();await page.locator('#restoreMode').selectOption('replace');
    page.once('dialog',dialog=>dialog.accept());await page.locator('#restoreApply').click();
    const after=await page.evaluate(()=>({name:state.data.projects[0].name,count:allEpisodes().length,backup:!!localStorage.getItem('settlement_recovery_v2')}));
    assert.equal(after.name,'备份新项目');assert.equal(after.count,1);assert.equal(after.backup,true);
    await page.evaluate(()=>undoDataChange());assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);
  });
  await test('实际生成Excel的修改小计为零，计价明细仅含计价记录', async () => {
    const result=await page.evaluate(async()=>{const original=downloadBlob;let capture;try{downloadBlob=async(blob)=>{capture=blob;};settings.freezeRows=1;settings.freezeCols=1;await exportXlsx();if(!capture)throw Error('没有生成Excel文件');const book=XLSX.read(await capture.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json(book.Sheets['项目明细']);const bills=XLSX.utils.sheet_to_json(book.Sheets['计价明细']);return {rows,bills};}finally{downloadBlob=original;}});
    assert.equal(result.rows.length,4);assert.equal(result.rows.find(r=>r['工作类型']==='修改')['小计'],0);assert.equal(result.bills.length,2);assert.equal(result.bills.reduce((sum,r)=>sum+r['金额'],0),20);assert.ok(result.bills.every(r=>r['工作类型']!=='修改'));
  });
  await test('Demo字符串记录可编辑、删除撤销，刷新保持类型', async () => {
    await page.evaluate(()=>{const p=state.data.projects[0];p.episodes['demo:试听']={date:'2026-10-12',duration:'00:01:00',type:'Demo',workType:'混音',episodeNo:null,label:'试听',sourceFile:'试听.wav'};saveData();render();openEditEp('缩写','demo:试听');});
    await page.locator('#e_work').selectOption('修改');await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.reload();
    assert.equal(await page.evaluate(()=>workTypeOf(state.data.projects[0].episodes['demo:试听'])),'修改');
    const result=await page.evaluate(()=>{settings.confirmDel=false;delEp('缩写','demo:试听');const missing=!state.data.projects[0].episodes['demo:试听'];undoDataChange();const e=state.data.projects[0].episodes['demo:试听'];return {missing,type:e.type,work:workTypeOf(e),fee:feeOf(state.data.projects[0],e)};});
    assert.equal(result.missing,true);assert.equal(result.type,'Demo');assert.equal(result.work,'修改');assert.equal(result.fee,0);
  });
  await test('包含引号和尖括号的项目名称正常呈现并可编辑', async () => {
    const name='项目"<试用> & 测试';
    await page.evaluate(name=>{state.data.projects[0].name=name;saveData();render();openEditEp(name,'1');},name);
    assert.ok((await page.locator('#modalBox h2').textContent()).includes(name));
    await page.locator('#e_dur').fill('00:03:00');await page.getByRole('button',{name:'保存',exact:true}).click();
    assert.equal(await page.evaluate(()=>state.data.projects[0].episodes['1'].duration),'00:03:00');
  });
  await test('逐条计价方式与Excel明细金额一致', async () => {
    const result=await page.evaluate(async()=>{const p=state.data.projects[0];p.episodes['1'].mode='按集';p.episodes['2'].mode='按时长';const original=downloadBlob;let capture;try{downloadBlob=async b=>{capture=b;};settings.freezeRows=1;await exportXlsx();const book=XLSX.read(await capture.arrayBuffer(),{type:'array'});return {fees:allEpisodes().map(e=>e.fee),rows:XLSX.utils.sheet_to_json(book.Sheets['项目明细']),sum:calcSummary().fee};}finally{downloadBlob=original;}});
    assert.equal(result.sum,30);assert.deepEqual(result.fees,[10,20,0,0]);assert.equal(result.rows.find(r=>r['工作类型']==='重混')['小计'],20);assert.equal(result.rows.find(r=>r['工作类型']==='重混')['计价方式'],'按时长');
  });
  await test('阶梯等级覆盖正确，重叠范围拒绝预览', async () => {
    await prepareWav(['1集 1012 V01.wav','2集 1012 V01.wav','3集 1012 V01.wav','5集 1012 V01.wav']);
    await page.locator('#im_ranges').fill('1-2=A,3-5=C');await page.evaluate(()=>prepareImportPreview());
    assert.deepEqual(await page.evaluate(()=>window._importPreview.rows.map(r=>r.grade)),['A','A','C','C']);
    await page.evaluate(()=>{window._importPreview=null;showImportModal(window._importScan);});await page.locator('#im_ranges').fill('1-3=A,3-5=C');await page.evaluate(()=>prepareImportPreview());
    assert.equal(await page.evaluate(()=>window._importPreview),null);assert.ok((await page.locator('#toast').textContent()).includes('不能重叠'));
  });
  await test('Demo与正式项目分开存放且备份有效，原项目不改', async () => {
    const before=await page.evaluate(()=>JSON.stringify(state.data.projects[0]));await prepareWav(['试听音乐 V01.wav']);await page.locator('#demoRead').click();await page.locator('#demoConfirm').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(state.data.projects[0])),before);assert.equal(await page.evaluate(()=>validateBackup(backupEnvelope(state.data)).ok),true);assert.equal(await page.evaluate(()=>state.data.projects.find(p=>p.demoBucket).type),'Demo');
  });
  await test('跳过与更新的预计金额变化正确', async () => {
    await prepareWav(['1集 1012 V01.wav']);await page.locator('#im_work').selectOption('修改');await page.evaluate(()=>prepareImportPreview());
    // 已有记录默认跳过：先确认不导入时总额不变；再改成「更新已有」验证扣回旧金额。
    assert.ok((await page.evaluate(()=>window._importPreview.rows.map(r=>r.action))).every(a=>a==='skip'));
    assert.match(await page.locator('#importDelta').textContent(),/¥0\.00/);
    await page.evaluate(()=>{const i=window._importPreview.rows.findIndex(r=>r.action==='skip');updateImportRow(i,'action','update');});
    assert.match(await page.locator('#importDelta').textContent(),/(?:-¥|¥-)10\.00/);
    await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.equal(await page.evaluate(()=>calcSummary().fee),10);
  });
  await test('存储失败事务保留原state与原撤销栈', async () => {
    const result=await page.evaluate(()=>{const before=JSON.stringify(state.data),undo=dataUndoStack.length,original=Storage.prototype.setItem;try{Storage.prototype.setItem=function(){throw new DOMException('测试空间不足','QuotaExceededError');};const committed=applyBatchWorkChanges([{projName:'缩写',epNo:'1'}],'修改',true,'测试');return {committed,unchanged:before===JSON.stringify(state.data),undoUnchanged:undo===dataUndoStack.length};}finally{Storage.prototype.setItem=original;}});
    assert.equal(result.committed,false);assert.equal(result.unchanged,true);assert.equal(result.undoUnchanged,true);
  });
  await test('同最高版本候选选择稳定且完整保留', async () => {
    const result=await page.evaluate(()=>{const files=[new File(['a'],'5集 1012 V02 第一份.wav'),new File(['b'],'5集 1012 V02 第二份.wav'),new File(['c'],'5集 1012 V01.wav')];const group=scanFiles(files).parsed['5'];return {name:group.file.name,count:group.candidates.length,rework:group.rework};});
    assert.equal(result.name,'5集 1012 V02 第一份.wav');assert.equal(result.count,3);assert.equal(result.rework,false);
  });
  await test('撇号和字面实体名称折叠编辑正常，constructor可渲染日历', async () => {
    const name="O'Brien &quot; 字面实体";
    await page.evaluate(name=>{state.data.projects[0].name=name;saveData();render();},name);
    const header=page.locator('#view-detail .month-header').filter({hasText:name});assert.equal(await header.getAttribute('aria-expanded'),'false');await header.click();
    await page.locator('#view-detail .btn-edit[title="编辑该集"]').first().evaluate(el=>el.click());assert.ok((await page.locator('#modalBox h2').textContent()).includes(name));await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.evaluate(()=>{state.data.projects[0].name='constructor';saveData();render();});await page.evaluate(()=>{settings.showCalendar=true;render();});
    assert.ok((await page.locator('#view-detail').textContent()).includes('constructor'));
  });
  await test('项目视图与明细视图按逐记录等级和方式筛选', async () => {
    await page.evaluate(()=>{state.data.projects[0].episodes['2'].grade='A';state.data.projects[0].episodes['2'].mode='按时长';render();});
    await page.locator('#gradeFilter').selectOption('A');await page.locator('#modeFilter').selectOption('按时长');
    const result=await page.evaluate(()=>({detail:getFilteredList().map(e=>e.epNo),project:projEpsFiltered(state.data.projects[0]).map(([key])=>key)}));
    assert.deepEqual(result.detail,['2']);assert.deepEqual(result.project,['2']);
  });
  await test('损坏原始存储恢复前快照与撤销均保留原文', async () => {
    const raw='{ broken json 用户原文';
    await page.evaluate(raw=>localStorage.setItem(STORE_KEY,raw),raw);await page.reload();assert.equal(await page.evaluate(()=>state.dataBlocked),true);
    await page.evaluate(async data=>previewJSONFile(new File([JSON.stringify(data)],'合法备份.json',{type:'application/json'})),fixture());assert.equal(await page.locator('#restoreMode').inputValue(),'replace');
    await page.locator('#restoreMode').selectOption('merge');assert.equal(await page.locator('#restoreApply').isDisabled(),true);
    await page.locator('#restoreMode').selectOption('replace');page.once('dialog',dialog=>dialog.accept());await page.locator('#restoreApply').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem(RECOVERY_BACKUP_KEY)),raw);assert.equal(await page.evaluate(()=>state.dataBlocked),false);
    await page.evaluate(()=>undoDataChange());assert.equal(await page.evaluate(()=>localStorage.getItem(STORE_KEY)),raw);assert.equal(await page.evaluate(()=>state.dataBlocked),true);
  });
  await test('损坏状态备份导出原文而非示例', async () => {
    await page.evaluate(()=>localStorage.setItem(STORE_KEY,'{ broken json 用户原文'));await page.reload();
    const result=await page.evaluate(async()=>{const original=downloadBlob;let text;downloadBlob=async blob=>{text=await blob.text();};try{await exportJSON();return {text,raw:localStorage.getItem(STORE_KEY)};}finally{downloadBlob=original;}});assert.equal(result.text,result.raw);assert.ok(result.text.includes('broken json'));
  });
  await test('存储读取权限拒绝不二次读取或写示例', async () => {
    const result=await page.evaluate(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;let reads=0,writes=0;Storage.prototype.getItem=function(key){if(key===STORE_KEY){reads++;throw new Error('SecurityError');}return get.call(this,key);};Storage.prototype.setItem=function(key,value){if(key===STORE_KEY)writes++;return set.call(this,key,value);};try{loadData();return {reads,writes,blocked:state.dataBlocked,raw:state.blockedRaw};}finally{Storage.prototype.getItem=get;Storage.prototype.setItem=set;}});assert.deepEqual(result,{reads:1,writes:0,blocked:true,raw:null});await page.reload();
  });
  await test('未知schemaVersion拒绝且不修改数据', async () => {
    const result=await page.evaluate(data=>{data.schemaVersion=999;const before=JSON.stringify(state.data),check=validateBackup(data);return {ok:check.ok,unchanged:JSON.stringify(state.data)===before};},fixture());
    assert.equal(result.ok,false);assert.equal(result.unchanged,true);
  });
  await test('六字段组合筛选一致并支持范围Demo搜索及清除', async () => {
    await page.evaluate(()=>{const p=state.data.projects[0];p.episodes['3'].grade='A';p.episodes['3'].type='Demo';p.episodes['3'].needsReview=true;p.episodes['demo:片头试听']={date:'2026-10-12',duration:'00:01:00',label:'片头试听',type:'Demo',workType:'修改',excluded:true};render();});
    await page.locator('#epFilter').fill('1,3-5');await page.locator('#projFilter').selectOption('缩写');await page.locator('#gradeFilter').selectOption('A');await page.locator('#typeFilter').selectOption('Demo');await page.locator('#workFilter').selectOption('修改');await page.locator('#billingFilter').selectOption('excluded');
    const filtered=await page.evaluate(()=>({detail:getFilteredList().map(e=>e.epNo),project:projEpsFiltered(state.data.projects[0]).map(([k])=>k),gradeCounts:[...document.querySelectorAll('#view-byGrade [data-grade-count]')].map(el=>Number(el.dataset.gradeCount))}));assert.deepEqual(filtered.detail,['3']);assert.deepEqual(filtered.project,['3']);assert.deepEqual(filtered.gradeCounts,[1,0,0,0]);
    await page.evaluate(()=>clearRecordFilters());await page.locator('#epFilter').fill('片头试听');assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['demo:片头试听']);
    await page.evaluate(()=>clearRecordFilters());await page.locator('#billingFilter').selectOption('pending');assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['3']);await page.evaluate(()=>clearRecordFilters());assert.equal(await page.evaluate(()=>getFilteredList().length),5);
    const text=await page.evaluate(()=>epCellHtml(allEpisodes().find(e=>e.epNo==='4'),'billing'));assert.ok(text.includes('不计价'));assert.ok(!text.includes('不计价 ·'));assert.ok(text.includes('测试排除'));
  });
  await test('顶部整块固定且明细独立滚动，关闭恢复自然页面', async () => {
    await page.evaluate(()=>{const p=state.data.projects[0];for(let i=5;i<=60;i++)p.episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};settings.freezeLevel='full';render();applyTopPanelFreeze();});
    const measure=async scroll=>page.evaluate(async scroll=>{applyTopPanelFreeze();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const content=scrollArea();content.scrollTop=scroll?180:0;await new Promise(r=>requestAnimationFrame(r));const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,height:r.height};};return {top:['.topbar','.cards','.toolbar','#filterBar','#filteredTotal'].map(sel=>rect(document.querySelector(sel))),row:rect(document.querySelector('#view-detail tbody tr')),scroll:content.scrollTop,wrappers:document.querySelectorAll('.table-viewport').length,sticky:[...document.querySelectorAll('#view-detail th,#view-detail td')].some(el=>getComputedStyle(el).position==='sticky')};},scroll);
    const before=await measure(false),after=await measure(true);assert.ok(after.scroll>0);assert.deepEqual(after.top,before.top);assert.ok(after.row.top<before.row.top-100);assert.equal(after.wrappers,0);assert.equal(after.sticky,false);
    await page.evaluate(()=>{settings.freezeLevel='none';applyTopPanelFreeze();scrollArea().scrollTop=0;});
    const off=await page.evaluate(async()=>{window.scrollTo(0,180);await new Promise(r=>requestAnimationFrame(r));return {classOn:document.body.classList.contains('freeze-top'),windowScroll:window.scrollY,contentOverflow:getComputedStyle(document.querySelector('.content')).overflowY};});assert.equal(off.classOn,false);assert.ok(off.windowScroll>0);assert.notEqual(off.contentOverflow,'auto');await page.evaluate(()=>{window.scrollTo(0,0);settings.freezeLevel='full';applyTopPanelFreeze();});
  });
  await test('顶部设置迁移去掉旧行列字段并尊重关闭，Excel无冻结pane', async () => {
    await page.evaluate(()=>localStorage.setItem(SET_KEY,JSON.stringify({freezeRows:0,freezeCols:0,uiFreezeRows:0,uiFreezeCols:0})));await page.reload();const first=await page.evaluate(()=>({on:settings.freezeTopPanel,old:['freezeRows','freezeCols','uiFreezeRows','uiFreezeCols'].some(k=>k in settings)}));assert.deepEqual(first,{on:true,old:false});
    await page.evaluate(()=>{settings.freezeLevel='none';saveSettings(settings);});await page.reload();assert.equal(await page.evaluate(()=>settings.freezeTopPanel),false);assert.equal(await page.evaluate(()=>document.body.classList.contains('freeze-top')),false);
    // ZIP解析库仅供测试读取导出内容，不随应用分发。
    await page.addScriptTag({path:fileURLToPath(new URL('./fixtures/jszip.min.js',import.meta.url))});
    const result=await page.evaluate(async()=>{settings.freezeLevel='full';applyTopPanelFreeze();const original=downloadBlob;let capture;try{downloadBlob=async b=>{capture=b;};await exportXlsx();if(!capture)throw Error('无ExcelBlob');const zip=await JSZip.loadAsync(await capture.arrayBuffer());const worksheets=Object.keys(zip.files).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k));const xml=await Promise.all(worksheets.map(k=>zip.file(k).async('string')));return {count:xml.length,pane:xml.some(s=>/<pane(?:\s|>)/.test(s))};}finally{downloadBlob=original;}});assert.ok(result.count>0);assert.equal(result.pane,false);
  });
  await test('筛选等级与控件同胶囊且720高窗口保留明细空间', async () => {
    await page.setViewportSize({width:1440,height:720});
    try{const result=await page.evaluate(async()=>{settings.freezeLevel='full';render();applyTopPanelFreeze();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const grade=document.getElementById('gradeFilter'),field=grade.closest('.filter-field'),content=document.querySelector('.content');return {sameParent:!!field&&field.textContent.includes('等级'),background:field&&getComputedStyle(field).backgroundColor,fieldHeight:field?.getBoundingClientRect().height,contentHeight:content.getBoundingClientRect().height,contentTop:content.getBoundingClientRect().top,bodyHeight:innerHeight};});assert.equal(result.sameParent,true);assert.ok(result.fieldHeight>20);assert.ok(result.contentHeight>=140);assert.ok(result.contentTop<result.bodyHeight-140);}finally{await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>applyTopPanelFreeze());}
  });
  await test('设置弹窗覆盖顶部且实际开关保存刷新生效', async () => {
    await page.evaluate(()=>{settings.freezeLevel='full';applyTopPanelFreeze();openSettings();});
    const covered=await page.evaluate(()=>{const top=document.querySelector('.topbar').getBoundingClientRect(),point=document.elementFromPoint(top.left+10,top.top+10);return !!point?.closest('#modalMask');});assert.equal(covered,true);
    await page.locator('#setFreezeLevel').selectOption('none');await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>!document.body.classList.contains('freeze-top'));assert.equal(await page.evaluate(()=>document.body.classList.contains('freeze-top')),false);await page.reload();assert.equal(await page.evaluate(()=>settings.freezeTopPanel),false);
    await page.evaluate(()=>openSettings());await page.locator('#setFreezeLevel').selectOption('full');await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>document.body.classList.contains('freeze-top'));assert.equal(await page.evaluate(()=>document.body.classList.contains('freeze-top')),true);
  });
  await test('筛选连续输入保留焦点并正确匹配范围', async () => {
    await page.locator('#epFilter').pressSequentially('1,3-5',{delay:20});assert.equal(await page.locator('#epFilter').inputValue(),'1,3-5');assert.equal(await page.evaluate(()=>document.activeElement.id),'epFilter');assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['1','3','4']);
  });
  await test('五档冻结范围正确且未固定模块随明细滚动', async () => {
    await page.evaluate(()=>{for(let i=5;i<=60;i++)state.data.projects[0].episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};render();});
    // 当前顶部只有五块（标题 / 统计卡片 / 拖入区 / 视图标签 / 筛选）；视图与筛选常驻两侧栏，
    // 所以只有前三块在 workspaceTop 与 scrollTopSections 之间移动。
    const levels=[['header',1],['overview',2],['actions',3],['full',3]];
    for(const [level,count] of levels){const result=await page.evaluate(async({level,count})=>{settings.freezeLevel=level;settings.topCollapsed=[];applyTopPanelFreeze();const content=scrollArea();content.scrollTop=0;await new Promise(r=>requestAnimationFrame(r));const ids=TOP_SECTIONS.map(x=>x.id).filter(id=>['topHeader','topCards','dropZone'].includes(id));const before=ids.map(id=>document.getElementById(id).getBoundingClientRect().top);content.scrollTop=160;await new Promise(r=>requestAnimationFrame(r));const after=ids.map(id=>document.getElementById(id).getBoundingClientRect().top);return {fixed:ids.slice(0,count).every(id=>document.getElementById('workspaceTop').contains(document.getElementById(id))),moving:ids.slice(count).every(id=>document.getElementById('scrollTopSections').contains(document.getElementById(id))),stable:before.slice(0,count).every((v,i)=>Math.abs(v-after[i])<1),scroll:content.scrollTop,freezeClass:document.body.classList.contains('freeze-top'),delta:before.slice(count).map((v,i)=>v-after[count+i])};},{level,count});assert.equal(result.fixed,true,level);assert.equal(result.moving,true,level);assert.equal(result.stable,true,level);assert.equal(result.freezeClass,level!=='none',level);assert.ok(result.scroll>0,level);assert.ok(result.delta.every(d=>d>100),level);}
    await page.evaluate(()=>{settings.freezeLevel='none';applyTopPanelFreeze();});assert.equal(await page.evaluate(()=>document.body.classList.contains('freeze-top')),false);
  });
  await test('顶部布局收起选择持久化且恢复不丢记录', async () => {
    const before=await page.evaluate(()=>JSON.stringify(state.data));await page.evaluate(()=>openSettings());await page.locator('#setFreezeLevel').selectOption('overview');for(const key of ['cards','import','filters'])await page.locator('#setHide_'+key).check();await page.getByRole('button',{name:'保存',exact:true}).click();
    const check=()=>page.evaluate(()=>({level:settings.freezeLevel,collapsed:settings.topCollapsed,hidden:['topCards','dropZone','filterBar'].map(id=>document.getElementById(id).hidden),header:!document.getElementById('topHeader').hidden,data:JSON.stringify(state.data)}));const first=await check();assert.equal(first.level,'overview');assert.deepEqual(first.collapsed.slice().sort(),['cards','filters','import']);assert.deepEqual(first.hidden,[true,true,true]);assert.equal(first.header,true);assert.equal(first.data,before);await page.reload();await page.waitForFunction(()=>['topCards','dropZone','filterBar'].every(id=>document.getElementById(id).hidden));assert.deepEqual(await check(),first);
    await page.evaluate(()=>openSettings());for(const key of ['cards','import','filters'])await page.locator('#setHide_'+key).uncheck();await page.locator('#setFreezeLevel').selectOption('full');await page.getByRole('button',{name:'保存',exact:true}).click();assert.deepEqual((await check()).hidden,[false,false,false]);assert.equal((await check()).data,before);
  });
  await test('旧顶部布尔设置迁移为冻结档位且尊重关闭', async () => {
    for(const [old,level] of [[false,'none'],[true,'full']]){await page.evaluate(old=>localStorage.setItem(SET_KEY,JSON.stringify({freezeTopPanel:old})),old);await page.reload();assert.equal(await page.evaluate(()=>settings.freezeLevel),level);}
  });
  await test('设置按主题折叠且列调整保留打开组和未保存字段', async () => {
    await page.evaluate(()=>openSettings());const initial=await page.locator('details.settings-group').evaluateAll(els=>els.map(el=>({open:el.open,top:!!el.querySelector('#setFreezeLevel')})));assert.ok(initial.length>=3);assert.equal(initial.filter(g=>g.open).length,1);assert.equal(initial.find(g=>g.top)?.open,true);
    await page.locator('#setFreezeLevel').selectOption('overview');await page.locator('#setHide_import').check();
    const columns=page.locator('details.settings-group').filter({has:page.locator('[onchange*="setCol"]')});
    const count=await columns.count();assert.ok(count>0,'列设置需位于折叠组');await columns.first().locator('summary').click();
    const toggle=columns.first().locator('[onchange*="setCol"]').first();await toggle.click();
    assert.equal(await page.locator('#setFreezeLevel').inputValue(),'overview');assert.equal(await page.locator('#setHide_import').isChecked(),true);assert.equal(await columns.first().getAttribute('open')!==null,true);assert.equal(await page.evaluate(()=>settings.freezeLevel),'full');await page.evaluate(()=>{closeModal();localStorage.removeItem(COL_KEY);});
  });
  await test('三栏归属及左右折叠扩大明细并保持状态', async () => {
    const structure=await page.evaluate(()=>({layout:getComputedStyle(document.getElementById('workArea')).display,left:document.getElementById('leftNavBody').contains(document.getElementById('topViews')),right:document.getElementById('rightFilterBody').contains(document.getElementById('filterBar'))}));assert.deepEqual(structure,{layout:'grid',left:true,right:true});
    await page.evaluate(()=>{settings.sideCollapsed={left:false,right:false};const wa=document.getElementById('workArea');wa.classList.remove('left-collapsed','right-collapsed');for(const side of ['left','right']){document.getElementById(side+'Panel').classList.remove('gui-open');}saveSettings(settings);if(typeof applySidePanels==='function')applySidePanels();});
    const initial=await page.locator('.content').boundingBox();await page.evaluate(()=>toggleSidePanel('left'));const leftOff=await page.locator('.content').boundingBox();assert.ok(leftOff.width>initial.width+70,JSON.stringify({initial,leftOff}));assert.equal(await page.evaluate(()=>document.getElementById('workArea').classList.contains('left-collapsed')),true);await page.evaluate(()=>toggleSidePanel('right'));const bothOff=await page.locator('.content').boundingBox();assert.ok(bothOff.width>=leftOff.width,JSON.stringify({leftOff, bothOff}));assert.equal(await page.evaluate(()=>document.getElementById('workArea').classList.contains('right-collapsed')),true);await page.reload();assert.deepEqual(await page.evaluate(()=>settings.sideCollapsed),{left:true,right:true});
    await page.evaluate(()=>{toggleSidePanel('left');toggleSidePanel('right');});assert.equal(await page.evaluate(()=>document.getElementById('workArea').classList.contains('right-collapsed')),false);
  });
  await test('左导航切换视图右筛选Demo及详情安全显示', async () => {
    await page.locator('#leftNavBody [data-view="byProject"]').click();assert.equal(await page.locator('#view-byProject').isVisible(),true);await page.locator('#leftNavBody [data-view="detail"]').click();
    await page.evaluate(()=>{state.data.projects[0].episodes['1'].type='Demo';render();});await page.locator('#typeFilter').selectOption('Demo');assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['1']);
    const name='项目<img src=x onerror="window.testInjection=1">';await page.evaluate(name=>{const p=state.data.projects[0];p.name=name;p.episodes['1'].label='<b>试听</b>';render();showRecordDetails(name,'1');},name);assert.equal(await page.evaluate(()=>document.getElementById('rightPanel').classList.contains('gui-open')),true);const details=await page.locator('#recordDetails').textContent();assert.ok(details.includes(name));assert.ok(details.includes('Demo'));assert.ok(details.includes('混音'));assert.ok(details.includes('00:01:00'));assert.equal(await page.locator('#recordDetails img,#recordDetails script').count(),0);assert.equal(await page.evaluate(()=>window.testInjection),undefined);
  });
  await test('概览材质滚动时保持文字清晰，透明程度保存刷新', async () => {
    await page.evaluate(()=>{for(let i=5;i<=60;i++)state.data.projects[0].episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};render();scrollArea().scrollTop=0;});
    const inspect=()=>page.evaluate(()=>{const bg=getComputedStyle(document.querySelector('#topCards')).backgroundColor;const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,1,1);const alpha=ctx.getImageData(0,0,1,1).data[3];return {alpha,scrolled:document.body.classList.contains('has-workspace-scroll'),bg,textOpacity:getComputedStyle(document.querySelector('#topCards')).opacity};});await page.waitForFunction(()=>!document.body.classList.contains('has-workspace-scroll'));const before=await inspect();assert.equal(before.scrolled,false);assert.ok(before.alpha>0&&before.alpha<255);
    await page.evaluate(()=>{scrollArea().scrollTop=160;});await page.waitForFunction(()=>document.body.classList.contains('has-workspace-scroll'));const after=await inspect();assert.equal(after.scrolled,true);assert.ok(after.alpha<255&&after.alpha>0);assert.equal(after.textOpacity,'1');
    await page.evaluate(()=>openSettings());await page.locator('#setTopOpacity').fill('0.65');await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();assert.equal(await page.evaluate(()=>settings.topOpacity),0.65);
  });
  await test('窄屏侧栏展开为抽屉保持明细宽度', async () => {
    await page.setViewportSize({width:800,height:720});try{await page.evaluate(()=>{settings.sideCollapsed={left:true,right:true};applyTopPanelFreeze();});const before=await page.locator('.content').boundingBox();await page.evaluate(()=>toggleSidePanel('left'));const after=await page.locator('.content').boundingBox();assert.ok(after.width>=before.width-5);assert.ok(after.width>500);await page.evaluate(()=>toggleSidePanel('right'));const right=await page.locator('.content').boundingBox();assert.ok(right.width>=before.width-5);}finally{await page.setViewportSize({width:1440,height:1000});}
  });
  await test('结算周期15和16边界及跨年标签准确', async () => {
    const result=await page.evaluate(()=>{state.cycle='custom';return {keys:['2026-12-15','2026-12-16','2027-01-15','2027-01-16'].map(periodKey),label:periodLabel(periodKey('2026-12-16'))};});assert.deepEqual(result.keys,['2026-11下/2026-12上','2026-12下/2027-01上','2026-12下/2027-01上','2027-01下/2027-02上']);assert.ok(result.label.includes('2026'));assert.ok(result.label.includes('2027'));assert.ok(result.label.includes('16'));assert.ok(result.label.includes('15'));
  });
  await test('顶部结算期右月份联动且金额卡片按周期不受其他筛选影响', async () => {
    await page.evaluate(()=>{guiShowAmount('always');const p=state.data.projects[0];p.episodes=Object.fromEntries(['2026-12-15','2026-12-16','2027-01-15','2027-01-16'].map((date,i)=>[String(i+1),{date,duration:'00:01:00',workType:'混音'}]));render();});assert.equal(await page.evaluate(()=>calcSummary().fee),40);await page.locator('#settlementPeriod').selectOption('2026-12');assert.equal(await page.locator('#monthFilter').inputValue(),'2026-12');assert.equal(await page.evaluate(()=>calcSummary().fee),20);assert.match(await page.locator('#cardFee').textContent(),/20\.00/);await page.locator('#gradeFilter').selectOption('A');assert.equal(await page.evaluate(()=>getFilteredList().length),0);assert.equal(await page.evaluate(()=>calcSummary().fee),20);await page.locator('#gradeFilter').selectOption('');await page.locator('#monthFilter').selectOption('2027-01');assert.equal(await page.locator('#settlementPeriod').inputValue(),'2027-01');
    await page.locator('#monthFilter').selectOption('2026-12');const cycleOption=await page.locator('#cycleSelect option').evaluateAll(els=>els.map(el=>el.value).find(v=>v!=='natural'));await page.locator('#cycleSelect').selectOption(cycleOption);assert.equal(await page.locator('#settlementPeriod').inputValue(),'2026-12下/2027-01上');assert.equal(await page.locator('#monthFilter').inputValue(),'2026-12下/2027-01上');assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['2','3']);
  });
  await test('主操作入口合并且周期选项文本具可读对比度', async()=>{
const result=await page.evaluate(()=>{const style=getComputedStyle(document.querySelector('#cycleSelect option'));return {legacy:document.querySelector('.group-review'),editing:document.getElementById('batchCorrectBtn').hidden,bg:style.backgroundColor,color:style.color};});assert.equal(result.legacy,null);assert.equal(result.editing,true);assert.notEqual(result.bg,result.color);assert.notEqual(result.bg,'rgba(0, 0, 0, 0)');
});
  await test('外观统一入口主题即时应用且多个收藏保存刷新', async () => {
    assert.equal(await page.locator('#appearanceBtn').count(),1);await page.locator('#appearanceBtn').click();assert.equal(await page.locator('#gtPanel.embedded').count(),1);assert.equal(await page.locator('#glassSettingsHost #gtPanel').count(),1);await page.evaluate(()=>chooseAppearanceTheme('dark'));assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.equal(await page.locator('#setTheme').inputValue(),'dark');
    for(const key of ['dark','claude'])await page.locator('[data-favorite-theme="'+key+'"]').check();await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();const favorites=await page.evaluate(()=>settings.favoriteThemes);assert.ok(favorites.includes('dark')&&favorites.includes('claude'));assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await page.evaluate(()=>openAppearanceSettings());assert.equal(await page.locator('[data-favorite-theme="dark"]').isChecked(),true);assert.equal(await page.locator('[data-favorite-theme="claude"]').isChecked(),true);
  });
  await test('玻璃参数嵌入设置且记忆关闭重开刷新不丢', async () => {
    await page.evaluate(()=>openAppearanceSettings());const value=await page.locator('#rBlur').evaluate(el=>{const min=Number(el.min)||0,max=Number(el.max)||40,step=Number(el.step)||1,v=Math.min(max,min+step*3);el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));return el.value;});await page.locator('#gtRemember').click();await page.evaluate(()=>closeModal());await page.evaluate(()=>openAppearanceSettings());assert.equal(await page.locator('#glassSettingsHost #gtPanel').count(),1);assert.equal(await page.locator('#rBlur').inputValue(),value);await page.reload();await page.evaluate(()=>openAppearanceSettings());assert.equal(await page.locator('#rBlur').inputValue(),value);assert.equal(await page.locator('#gtPanel').count(),1);
  });
  await test('统一工作区替代旧预设且不改数据与列配置',async()=>{
const before=await page.evaluate(()=>({data:JSON.stringify(state.data),cols:JSON.stringify(loadColCfg())}));await page.evaluate(()=>{settings.viewPreset='entry';saveSettings(settings);});await page.reload();assert.equal(await page.evaluate(()=>settings.viewPreset),'custom');assert.equal(await page.locator('button[data-preset]').count(),0);assert.deepEqual(await page.evaluate(()=>({data:JSON.stringify(state.data),cols:JSON.stringify(loadColCfg())})),before);
});
  await test('自定义布局快照及原始列配置在预设往返后恢复', async () => {
    const before=await page.evaluate(()=>{settings.freezeLevel='actions';settings.sideCollapsed={left:true,right:false};settings.topCollapsed=['cards'];const cfg=loadColCfg();cfg.hidden.epNo=true;cfg.order=['date',...cfg.order.filter(k=>k!=='date')];saveColCfg(cfg);applyTopPanelFreeze();return {level:settings.freezeLevel,side:JSON.stringify(settings.sideCollapsed),hidden:JSON.stringify(settings.topCollapsed),cols:JSON.stringify(loadColCfg()),data:JSON.stringify(state.data)};});await page.evaluate(()=>{applyViewPreset('entry');applyViewPreset('review');applyViewPreset('custom');});const after=await page.evaluate(()=>({level:settings.freezeLevel,side:JSON.stringify(settings.sideCollapsed),hidden:JSON.stringify(settings.topCollapsed),cols:JSON.stringify(loadColCfg()),data:JSON.stringify(state.data)}));assert.deepEqual(after,before);await page.evaluate(()=>localStorage.removeItem(COL_KEY));
  });
  await test('预设中单条编辑及批量金额预览纠正可用', async () => {
    for(const preset of ['entry','review','settlement']){await page.evaluate(preset=>{applyViewPreset(preset);openEditEp('缩写','1');},preset);await page.locator('#e_dur').fill('00:03:00');await page.getByRole('button',{name:'保存',exact:true}).click();assert.equal(await page.evaluate(()=>state.data.projects[0].episodes['1'].duration),'00:03:00');await page.evaluate(()=>{openBatchCorrection([{projName:'缩写',epNo:'1'}]);document.getElementById('bc_work').value='修改';previewCorrection();});assert.equal(await page.evaluate(()=>document.getElementById('correctionConfirm').disabled),false);await page.evaluate(()=>confirmCorrection());assert.equal(await page.evaluate(()=>feeOf(state.data.projects[0],state.data.projects[0].episodes['1'])),0);await page.evaluate(()=>undoDataChange());}
  });
  await test('上下及横向滚动后明细上下文保持可见', async () => {
    await page.evaluate(()=>{for(let i=5;i<=90;i++)state.data.projects[0].episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};applyViewPreset('review');render();const detail=document.getElementById('view-detail');if(detail)detail.style.minWidth='1800px';});const measure=async scroll=>page.evaluate(async scroll=>{const content=scrollArea(),ctx=document.getElementById('workspaceContext');content.scrollTop=scroll?240:0;content.scrollLeft=scroll?180:0;await new Promise(r=>requestAnimationFrame(r));const cr=content.getBoundingClientRect(),r=ctx.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,areaLeft:cr.left,areaTop:cr.top,padTop:parseFloat(getComputedStyle(content).paddingTop)||0,scroll:content.scrollTop,hScroll:content.scrollLeft,scope:document.getElementById('activeScope').textContent};},scroll);const before=await measure(false),after=await measure(true);assert.ok(after.scroll>0);assert.ok(Math.abs(after.top-(after.areaTop+after.padTop))<4,JSON.stringify({before,after}));assert.ok(after.left>=after.areaLeft&&after.left+after.width>=after.areaLeft+200,JSON.stringify({before,after}));assert.equal(after.scope,before.scope);await mkdir(resolve(evidenceDir,'upgrade'),{recursive:true});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.getElementById('toast').style.display='none';});await page.screenshot({path:resolve(evidenceDir,'upgrade/preview-preset-scroll-boundary-dark.png'),fullPage:true});await page.evaluate(()=>{scrollArea().scrollTop=0;scrollArea().scrollLeft=0;});
  });
  await test('冻结及预设切换保持可视记录和筛选焦点', async () => {
    await page.evaluate(()=>{for(let i=5;i<=90;i++)state.data.projects[0].episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};applyViewPreset('entry');render();scrollArea().scrollTop=360;});await page.locator('#epFilter').focus();
    const anchor=()=>page.evaluate(()=>{const ctx=document.getElementById('workspaceContext').getBoundingClientRect(),content=document.querySelector('.content').getBoundingClientRect();const rows=[...document.querySelectorAll('#view-detail tbody tr')].filter(r=>r.querySelector('.epchk'));const row=rows.find(r=>{const rect=r.getBoundingClientRect();return rect.top>=Math.max(content.top,ctx.bottom)&&rect.top<content.bottom;});if(!row)throw Error('无可见记录');return {key:row.querySelector('.epchk').dataset.e,top:row.getBoundingClientRect().top,focus:document.activeElement.id};});const before=await anchor();await page.evaluate(()=>{settings.freezeLevel='overview';applyTopPanelFreeze();});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const after=await anchor();assert.equal(after.key,before.key);assert.ok(Math.abs(after.top-before.top)<=40);assert.equal(after.focus,'epFilter');await page.evaluate(()=>applyViewPreset('review'));assert.equal(await page.evaluate(()=>document.activeElement.id),'epFilter');assert.ok(await page.evaluate(()=>scrollArea().scrollTop>0));
  });
  await test('预设中修改列切换自定义并保留原始列设置', async () => {
    await page.evaluate(()=>applyViewPreset('review'));await page.evaluate(()=>openSettings());const columns=page.locator('details.settings-group').filter({has:page.locator('[onchange*="setCol"]')}).first();if(await columns.getAttribute('open')===null)await columns.locator('summary').click();const control=columns.locator('[onchange*="setCol"]').first();const was=await control.isChecked();await control.click();assert.equal(await page.evaluate(()=>settings.viewPreset),'custom');assert.equal(await control.isChecked(),!was);const cfg=await page.evaluate(()=>JSON.stringify(loadColCfg()));await page.evaluate(()=>{closeModal();applyViewPreset('entry');applyViewPreset('custom');});assert.equal(await page.evaluate(()=>JSON.stringify(loadColCfg())),cfg);await page.evaluate(()=>localStorage.removeItem(COL_KEY));
  });
  await test('两千条深滚后普通渲染不逐行强制测量布局', async () => {
    const result=await page.evaluate(async()=>{const p=state.data.projects[0];for(let i=5;i<=2000;i++)p.episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};applyViewPreset('entry');render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));scrollArea().scrollTop=40000;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const original=Element.prototype.getBoundingClientRect;let rows=0,total=0;Element.prototype.getBoundingClientRect=function(){total++;if(this.tagName==='TR')rows++;return original.call(this);};try{render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {rows,total,count:allEpisodes().length,scroll:scrollArea().scrollTop};}finally{Element.prototype.getBoundingClientRect=original;}});assert.equal(result.count,2000);assert.ok(result.scroll>1000);assert.ok(result.rows<=80,JSON.stringify(result));console.log('METRIC 深滚渲染 '+JSON.stringify(result));
  });
  await test('同帧高频滚动合并更新且状态未变不重复写样式', async () => {
    const result=await page.evaluate(async()=>{const p=state.data.projects[0];for(let i=5;i<=90;i++)p.episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};applyViewPreset('review');render();scrollArea().scrollTop=200;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const toggle=DOMTokenList.prototype.toggle,set=CSSStyleDeclaration.prototype.setProperty;let classes=0,opacity=0;DOMTokenList.prototype.toggle=function(...args){if(this===document.body.classList&&args[0]==='has-workspace-scroll')classes++;return toggle.apply(this,args);};CSSStyleDeclaration.prototype.setProperty=function(...args){if(this===document.documentElement.style&&args[0]==='--top-opacity')opacity++;return set.apply(this,args);};try{for(let i=0;i<50;i++)scrollArea().dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {classes,opacity,scrolled:document.body.classList.contains('has-workspace-scroll')};}finally{DOMTokenList.prototype.toggle=toggle;CSSStyleDeclaration.prototype.setProperty=set;}});assert.equal(result.scrolled,true);assert.ok(result.classes<=2,JSON.stringify(result));assert.ok(result.opacity<=1,JSON.stringify(result));console.log('METRIC 合帧滚动 '+JSON.stringify(result));
  });
  await test('滚动上下文侧栏保持实色且摘要与滚动条边界留白', async () => {
    await page.mouse.move(0,0);await page.evaluate(()=>{for(let i=5;i<=90;i++)state.data.projects[0].episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};settings.topOpacity=0.65;applyViewPreset('review');render();scrollArea().scrollTop=200;});await page.waitForFunction(()=>document.body.classList.contains('has-workspace-scroll'));
    const result=await page.evaluate(()=>{const alpha=el=>{const bg=getComputedStyle(el).backgroundColor,canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,1,1);return {bg,a:ctx.getImageData(0,0,1,1).data[3],text:getComputedStyle(el).opacity,blur:getComputedStyle(el).backdropFilter};};const content=document.querySelector('.content'),scope=document.getElementById('activeScope');return {materials:['workspaceContext','leftPanel','rightPanel'].map(id=>alpha(document.getElementById(id))),gap:content.getBoundingClientRect().right-scope.getBoundingClientRect().right,client:content.clientWidth,width:content.getBoundingClientRect().width};});assert.ok(result.materials.every(x=>x.a>=20&&x.a<=255),JSON.stringify(result));assert.ok(result.materials.every(x=>x.text==='1'));assert.ok(result.materials.every(x=>x.blur==='none'||Number(x.blur.match(/blur\(([0-9.]+)px\)/)?.[1])<=10),JSON.stringify(result.materials));assert.ok(result.gap>=10,JSON.stringify(result));await mkdir(resolve(evidenceDir,'upgrade'),{recursive:true});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.getElementById('toast').style.display='none';});await page.screenshot({path:resolve(evidenceDir,'upgrade/preview-scroll-material-spacing-dark.png'),fullPage:true});
  });
  await test('设置面板实色无模糊且内部采用中性灰背景', async () => {
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark';openSettings();});const result=await page.locator('#modalBox').evaluate(el=>{const style=getComputedStyle(el),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,1,1);const rgba=[...ctx.getImageData(0,0,1,1).data];const blur=style.backdropFilter==='none'?0:Number(style.backdropFilter.match(/blur\(([0-9.]+)px\)/)?.[1]||0);return {rgba,blur,filter:style.backdropFilter};});assert.ok(result.rgba[3]>=229,JSON.stringify(result));assert.ok(Math.max(...result.rgba.slice(0,3))-Math.min(...result.rgba.slice(0,3))<=25,JSON.stringify(result));assert.ok(result.blur<=8,JSON.stringify(result));await mkdir(resolve(evidenceDir,'upgrade'),{recursive:true});await page.screenshot({path:resolve(evidenceDir,'upgrade/preview-neutral-settings-dark.png'),fullPage:true});
  });
  await test('深色筛选日期导入与设置控件采用深底浅字且浅色保持', async () => {
    const inspect=async selector=>page.locator(selector).first().evaluate(el=>{const style=getComputedStyle(el);const color=value=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};return {bg:color(style.backgroundColor),fg:color(style.color)};});
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark';settings.theme='dark';});const results=[];for(const selector of ['#epFilter','#typeFilter','#typeFilter option'])results.push(await inspect(selector));await page.evaluate(()=>openEditEp('缩写','1'));results.push(await inspect('#e_date'));await page.evaluate(()=>closeModal());await prepareWav(['5集 1012 V01.wav']);results.push(await inspect('#im_date'));await page.evaluate(()=>{closeModal();openSettings();});results.push(await inspect('#setTheme'));assert.ok(results.every(x=>x.bg.slice(0,3).reduce((a,b)=>a+b,0)/3<110),JSON.stringify(results));assert.ok(results.every(x=>x.fg.slice(0,3).reduce((a,b)=>a+b,0)/3>150),JSON.stringify(results));assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
    await page.evaluate(()=>{closeModal();document.documentElement.dataset.theme='claude';settings.theme='claude';});const light=await inspect('#typeFilter');assert.ok(light.bg.slice(0,3).reduce((a,b)=>a+b,0)/3>150,JSON.stringify(light));assert.notEqual(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
  });
  await test('旧主题迁移且收藏去重仅保留有效新主题', async () => {
    for(const [old,current] of [['','dark'],['forest','dark'],['violet','dark'],['paper','claude']]){await page.evaluate(old=>localStorage.setItem(SET_KEY,JSON.stringify({...settings,theme:old,favoriteThemes:['','forest','violet','paper','dark','claude','warm','ocean','无效','paper']})),old);await page.reload();const result=await page.evaluate(()=>({theme:settings.theme,body:document.documentElement.dataset.theme,favorites:settings.favoriteThemes,allowed:THEMES.map(t=>t.v),saved:JSON.parse(localStorage.getItem(SET_KEY)).theme}));assert.equal(result.theme,current);assert.equal(result.body,current);assert.equal(result.saved,current);assert.equal(new Set(result.favorites).size,result.favorites.length);assert.ok(result.favorites.every(v=>result.allowed.includes(v)));assert.ok(result.favorites.includes('dark')&&result.favorites.includes('claude'));assert.deepEqual(result.allowed.slice().sort(),['claude','dark','ocean','warm']);}
  });
  await test('制作结算台名称字体与常用交互圆角生效', async () => {
    const result=await page.evaluate(()=>{const selectors=['#leftPanel','#rightPanel','#epFilter','#typeFilter','#calendarToggle','.epchk'];return {title:document.title,header:document.getElementById('topHeader').textContent,font:getComputedStyle(document.body).fontFamily,metrics:['body','#calendarToggle','#epFilter','#activeScope'].map(sel=>{const el=document.querySelector(sel);if(!el)return {sel,missing:true};const st=getComputedStyle(el);return {sel,size:parseFloat(st.fontSize),weight:Number(st.fontWeight)};}),radii:selectors.map(selector=>{const el=document.querySelector(selector);if(!el)return {selector,missing:true};const st=getComputedStyle(el);return {selector,value:Math.max(...[st.borderTopLeftRadius,st.borderTopRightRadius,st.borderBottomLeftRadius,st.borderBottomRightRadius].map(parseFloat))};})};});assert.ok(result.title.includes('制作结算台'));assert.ok(result.header.includes('制作结算台'));assert.ok(result.font.includes('Segoe UI Variable Text'));assert.ok(result.font.includes('Microsoft YaHei UI'));assert.ok(result.radii.every(x=>!x.missing&&x.value>0),JSON.stringify(result.radii));assert.ok(result.metrics.every(x=>!x.missing&&x.size>=13),JSON.stringify(result.metrics));assert.ok(result.metrics.find(x=>x.sel==='body').weight>=400,JSON.stringify(result.metrics));console.log('METRIC 字号字重 '+JSON.stringify(result.metrics));
  });
  await test('Codex深色与Claude浅色主题各自颜色模式及输入背景正确', async () => {
    for(const [theme,dark] of [['dark',true],['claude',false],['warm',true],['ocean',true]]){const result=await page.evaluate(theme=>{chooseAppearanceTheme(theme);const el=document.getElementById('typeFilter'),st=getComputedStyle(el),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=st.backgroundColor;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3);return {theme:settings.theme,mode:getComputedStyle(document.documentElement).colorScheme,light:rgb.reduce((a,b)=>a+b,0)/3};},theme);assert.equal(result.theme,theme);assert.equal(result.mode,dark?'dark':'light');assert.ok(dark?result.light<110:result.light>150,JSON.stringify(result));}
  });
  await test('旧首次制作备份转混音且修改继续零计价', async () => {
    const result=await page.evaluate(()=>{const data=JSON.parse(JSON.stringify(state.data));data.projects[0].episodes['1'].workType='首次制作';const checked=validateBackup(data);if(!checked.ok)throw Error(checked.error);const p=checked.data.projects[0];return {work:p.episodes['1'].workType,alias:workTypeOf({workType:'首次制作'}),fee:feeOf(p,p.episodes['1']),modify:feeOf(p,p.episodes['3'])};});assert.deepEqual(result,{work:'混音',alias:'混音',fee:10,modify:0});
  });
  await test('旧像素样式迁移统一玻璃且移除风格选择器', async () => {
    await page.evaluate(()=>localStorage.setItem(SET_KEY,JSON.stringify({...settings,style:'pixel'})));await page.reload();assert.equal(await page.evaluate(()=>settings.style),'glass');assert.equal(await page.evaluate(()=>document.documentElement.dataset.style),'glass');await page.evaluate(()=>openSettings());assert.equal(await page.locator('#setStyle').count(),0);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(SET_KEY)).style),'glass');
  });
  await test('弹窗真实拖动移动且重新打开恢复默认位置', async () => {
    await page.evaluate(()=>openEditEp('缩写','1'));const before=await page.locator('#modalBox').boundingBox(),title=await page.locator('#modalBox > h2').boundingBox();await page.mouse.move(title.x+30,title.y+title.height/2);await page.mouse.down();await page.mouse.move(title.x+110,title.y+title.height/2+45,{steps:8});await page.mouse.up();const after=await page.locator('#modalBox').boundingBox();assert.ok(after.x-before.x>50);assert.ok(after.y-before.y>25);await page.evaluate(()=>{closeModal();openEditEp('缩写','1');});const reopened=await page.locator('#modalBox').boundingBox();assert.ok(Math.abs(reopened.x-before.x)<2);assert.ok(Math.abs(reopened.y-before.y)<2);
  });
  await test('左右栏真实拖动持久化且折叠保留宽度窄屏隐藏手柄', async () => {
    // V2.9 起左右栏由 gui-docking 固定列宽（180 / 300），手柄在停靠布局中不出现；
    // 因此这里验证「列宽来自设置、折叠后明细变宽、窄屏不收窄明细」三条真实契约。
    const handles=await page.evaluate(()=>['#leftPanel','#rightPanel'].map(side=>{const el=document.querySelector(side+' .side-resize');return {side,display:el?getComputedStyle(el).display:'missing'};}));
    assert.ok(handles.every(x=>x.display==='missing'||x.display==='none'),JSON.stringify(handles));
    const widths=await page.evaluate(()=>({state:JSON.stringify(settings.sideWidths||null),left:document.getElementById('leftPanel').getBoundingClientRect().width,right:document.getElementById('rightPanel').getBoundingClientRect().width}));
    assert.ok(widths.left>=170&&widths.right>=280,JSON.stringify(widths));
    const widthBefore=await page.evaluate(()=>{scrollArea().scrollTop=0;scrollArea().scrollLeft=0;return document.querySelector('.content').getBoundingClientRect().width;});
    await page.evaluate(()=>toggleSidePanel('left'));assert.equal(await page.evaluate(()=>document.getElementById('workArea').classList.contains('left-collapsed')),true);
    const widthLeft=await page.evaluate(()=>document.querySelector('.content').getBoundingClientRect().width);assert.ok(widthLeft>widthBefore+70,JSON.stringify({widthBefore,widthLeft}));
    await page.evaluate(()=>toggleSidePanel('left'));assert.equal(await page.evaluate(()=>document.getElementById('workArea').classList.contains('left-collapsed')),false);
    await page.evaluate(()=>toggleSidePanel('right'));assert.equal(await page.evaluate(()=>document.getElementById('workArea').classList.contains('right-collapsed')),true);
    const widthRight=await page.evaluate(()=>document.querySelector('.content').getBoundingClientRect().width);assert.ok(widthRight>widthBefore+60,JSON.stringify({widthBefore,widthLeft,widthRight}));
    await page.evaluate(()=>toggleSidePanel('right'));
    await page.setViewportSize({width:800,height:720});try{assert.equal(await page.locator('#leftPanel .side-resize').count(),0);assert.equal(await page.locator('#rightPanel .side-resize').count(),0);}finally{await page.setViewportSize({width:1440,height:1000});}
  });
  await test('深浅主题切换后正文及选中按钮对比度足够', async () => {
    for(const theme of ['dark','claude']){await page.evaluate(theme=>chooseAppearanceTheme(theme),theme);await page.waitForTimeout(300);const result=await page.evaluate(()=>{const color=v=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=v;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);const ratio=(a,b)=>{const l1=luminance(a),l2=luminance(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};const background=el=>{const layers=[];for(let x=el;x;x=x.parentElement)layers.push(color(getComputedStyle(x).backgroundColor));let rgb=[255,255,255];for(const layer of layers.reverse()){const a=layer[3]/255;rgb=rgb.map((v,i)=>layer[i]*a+v*(1-a));}return rgb;};const td=document.querySelector('#view-detail tbody td'),table=td.closest('table'),button=document.querySelector('#topActions > button.btn');return {text:ratio(color(getComputedStyle(td).color),background(td)),button:ratio(color(getComputedStyle(button).color),color(getComputedStyle(button).backgroundColor)),body:color(getComputedStyle(document.body).backgroundColor)};});assert.ok(result.text>=4.5,JSON.stringify({theme,...result}));assert.ok(result.button>=4.5,JSON.stringify({theme,...result}));if(theme==='claude')assert.ok(result.body.slice(0,3).reduce((a,b)=>a+b,0)/3>150,JSON.stringify(result));}
  });
  await test('液态材质轻量模糊限幅且B方案表格透明无重复模糊并保持字号', async () => {
    const result=await page.evaluate(()=>{const selectors=['#topCards','#dropZone','#workspaceContext'],materials=selectors.map(sel=>{const style=getComputedStyle(document.querySelector(sel));return {sel,blur:style.backdropFilter,opacity:style.opacity};});const scope=document.getElementById('activeScope');return {materials,support:CSS.supports('backdrop-filter','blur(1px)'),size:parseFloat(getComputedStyle(scope).fontSize),weight:Number(getComputedStyle(scope).fontWeight)};});const amounts=result.materials.map(x=>x.blur==='none'?0:Number(x.blur.match(/blur\(([0-9.]+)px\)/)?.[1]));assert.ok(amounts.every(v=>Number.isFinite(v)&&v<=10),JSON.stringify(result));if(result.support)assert.ok(amounts.some(v=>v>0),JSON.stringify(result));assert.ok(result.materials.every(x=>x.opacity==='1'));assert.ok(result.size>=12,JSON.stringify(result));
  });
  await test('减少透明度开关持久化并恢复液态材质', async () => {
    await page.evaluate(()=>openAppearanceSettings());await page.locator('#setReduceMaterial').check();await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();assert.equal(await page.evaluate(()=>settings.materialReduced),true);
    const inspect=()=>page.evaluate(()=>['#topCards','#dropZone','#workspaceContext'].map(sel=>{const s=getComputedStyle(document.querySelector(sel)),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=s.backgroundColor;ctx.fillRect(0,0,1,1);return {sel,blur:s.backdropFilter,a:ctx.getImageData(0,0,1,1).data[3]};}));const reduced=await inspect();assert.ok(reduced.every(x=>x.blur==='none'&&x.a===255),JSON.stringify(reduced));await page.evaluate(()=>openAppearanceSettings());assert.equal(await page.locator('#setReduceMaterial').isChecked(),true);await page.locator('#setReduceMaterial').uncheck();await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();assert.equal(await page.evaluate(()=>settings.materialReduced),false);await transparency('reduce');await page.evaluate(()=>{const stored=JSON.parse(localStorage.getItem(SET_KEY));delete stored.materialReduced;localStorage.setItem(SET_KEY,JSON.stringify(stored));});await page.reload();assert.equal(await page.evaluate(()=>settings.materialReduced),true);const systemReduced=await inspect();assert.ok(systemReduced.every(x=>x.blur==='none'&&x.a===255),JSON.stringify(systemReduced));await page.evaluate(()=>openAppearanceSettings());assert.equal(await page.locator('#setReduceMaterial').isChecked(),true);await page.locator('#setReduceMaterial').uncheck();await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();assert.equal(await page.evaluate(()=>settings.materialReduced),false);const restored=await inspect();assert.ok(restored.some(x=>x.blur!=='none'&&x.a<255),JSON.stringify(restored));await transparency('no-preference');
  });
  await test('玻璃微调入口和参数真实改变材质并在刷新主题切换后保留', async () => {
    await page.mouse.move(700,20);await page.evaluate(()=>{scrollArea().scrollTop=0;});await page.waitForFunction(()=>!document.body.classList.contains('has-workspace-scroll'));
    await page.locator('#appearanceBtn').click();
    assert.equal(await page.locator('#glassSettingsHost #gtPanel').count(),1);
    const range=async(id,value)=>page.locator(id).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    const inspect=()=>page.evaluate(()=>{const el=document.querySelector('#topCards'),style=getComputedStyle(el),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,1,1);return {alpha:ctx.getImageData(0,0,1,1).data[3],blur:style.backdropFilter,radius:parseFloat(style.borderTopLeftRadius),shadow:style.boxShadow};});
    const cardBefore=await page.locator('#topCards').evaluate(el=>getComputedStyle(el).backgroundColor);await range('#rAlpha',0.55);await range('#rBlur',0);await range('#rRadius',16);const first=await inspect();
    await range('#rAlpha',0.98);await range('#rBlur',8);await range('#rRadius',28);const second=await inspect();
    assert.ok(second.alpha>first.alpha+50,JSON.stringify({first,second}));assert.match(second.blur,/blur\(8px\)/);assert.ok(first.blur==='none'||first.blur.includes('blur(0px)'));assert.equal(first.radius,16);assert.equal(second.radius,28);
    assert.notEqual(await page.locator('#topCards').evaluate(el=>getComputedStyle(el).backgroundColor),cardBefore);
    const cssVar=name=>page.evaluate(name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim(),name);
    await range('#rBlob',0);const dim=await cssVar('--blob-opacity');await range('#rBlob',2);const vivid=await cssVar('--blob-opacity');assert.notEqual(dim,vivid,JSON.stringify({dim,vivid}));
    const highlight=()=>page.evaluate(()=>{const root=getComputedStyle(document.documentElement),s=getComputedStyle(document.getElementById('topCards'));return {shine:root.getPropertyValue('--material-shine').trim(),edge:s.borderTopColor,bg:s.backgroundImage};});await page.locator('#cHl').uncheck();const plain=await highlight();await page.locator('#cHl').check();const lit=await highlight();assert.notEqual(plain.shine,lit.shine,JSON.stringify({plain,lit}));assert.notEqual(plain.edge,lit.edge,JSON.stringify({plain,lit}));
    const topShadow=()=>page.locator('#topCards').evaluate(el=>getComputedStyle(el).boxShadow);await page.locator('#cShadow').uncheck();assert.equal(await topShadow(),'none');await page.locator('#cShadow').check();assert.notEqual(await topShadow(),'none');
    const top=()=>page.locator('#topCards').evaluate(el=>{const s=getComputedStyle(el);return {blur:s.backdropFilter,bg:s.backgroundColor};});await page.locator('#cBars').uncheck();assert.equal(await page.evaluate(()=>document.body.classList.contains('glass-solid-header')),true);const solid=await top();assert.equal(solid.blur,'none');await page.locator('#cBars').check();assert.equal(await page.evaluate(()=>document.body.classList.contains('glass-solid-header')),false);const glass=await top();assert.match(glass.blur,/blur\(8px\)/);assert.notEqual(glass.bg,solid.bg);
    await page.locator('#gtRemember').click();await page.reload();await page.locator('#appearanceBtn').click();assert.equal(await page.locator('#rBlur').inputValue(),'8');assert.equal(await page.locator('#rRadius').inputValue(),'28');assert.equal(await page.locator('#rAlpha').inputValue(),'0.98');
    const initialTheme=await page.evaluate(()=>document.documentElement.dataset.theme);await page.evaluate(theme=>chooseAppearanceTheme(theme==='claude'?'dark':'claude'),initialTheme);await range('#rAlpha',0.65);await page.locator('#gtRemember').click();await page.evaluate(theme=>chooseAppearanceTheme(theme),initialTheme);assert.equal(await page.locator('#rAlpha').inputValue(),'0.98');await page.evaluate(theme=>chooseAppearanceTheme(theme==='claude'?'dark':'claude'),initialTheme);assert.equal(await page.locator('#rAlpha').inputValue(),'0.65');
    await mkdir(evidenceDir,{recursive:true});await page.screenshot({path:resolve(evidenceDir,'glass-tuning.png'),fullPage:true});
  });
  await test('低透明状态说明可见且调节不会擅自关闭，一键开启玻璃可预览', async () => {
    await page.evaluate(()=>setReducedMaterial(true));await page.locator('#appearanceBtn').click();assert.match(await page.locator('#gtStatus').textContent(),/降低透明/);assert.equal(await page.locator('#gtEnableMaterial').isVisible(),true);
    await page.locator('#rBlur').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.evaluate(()=>settings.materialReduced),true);assert.equal(await page.locator('#topCards').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
    await page.locator('#gtEnableMaterial').click();assert.equal(await page.evaluate(()=>settings.materialReduced),false);assert.equal(await page.locator('#setReduceMaterial').isChecked(),false);assert.equal(await page.locator('#gtEnableMaterial').isVisible(),false);assert.match(await page.locator('#topCards').evaluate(el=>getComputedStyle(el).backdropFilter),/blur\(5px\)/);
    await page.reload();assert.equal(await page.evaluate(()=>settings.materialReduced),false);
  });
  await test('中央滚动区域维持固定圆角，概览圆角旋钮不影响且可滚动', async () => {
    await page.locator('#appearanceBtn').click();await page.locator('#rRadius').evaluate(el=>{el.value='26';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.evaluate(()=>{closeModal();for(let i=5;i<=90;i++)state.data.projects[0].episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};render();scrollArea().scrollTop=180;});
    const result=await page.locator('.content').evaluate(el=>{const s=getComputedStyle(el);const area=document.getElementById('workArea'),as=getComputedStyle(area);return {radius:parseFloat(s.borderTopLeftRadius),clip:s.clipPath,scroll:area.scrollTop,overflow:as.overflowY};});assert.equal(result.radius,22);assert.ok(result.clip.includes('round 22px'),JSON.stringify(result));assert.ok(result.scroll>0);assert.equal(result.overflow,'auto');await page.screenshot({path:resolve(evidenceDir,'rounded-scroll-boundary.png'),fullPage:true});
  });
  await test('减少动态效果时控件动画与过渡关闭', async () => {
    await page.emulateMedia({reducedMotion:'reduce'});try{const durations=await page.evaluate(()=>['.btn','#calendarToggle','#leftPanel'].map(sel=>{const s=getComputedStyle(document.querySelector(sel));return {sel,transition:s.transitionDuration,animation:s.animationDuration};}));assert.ok(durations.every(x=>[...x.transition.split(','),...x.animation.split(',')].every(v=>parseFloat(v)<=0.01)),JSON.stringify(durations));}finally{await page.emulateMedia({reducedMotion:'no-preference'});}
  });
  await test('批量纠正多字段预览金额准确并撤销', async () => {
    await page.evaluate(()=>openBatchCorrection([{projName:'缩写',epNo:'1'},{projName:'缩写',epNo:'2'}]));
    assert.equal(await page.evaluate(()=>document.getElementById('bc_work').value),'');
    await page.evaluate(()=>{for(const [id,value] of [['bc_type','Demo'],['bc_grade','A'],['bc_mode','按时长'],['bc_duration','00:02:00'],['bc_date','2026-10-11']])document.getElementById(id).value=value;});
    const before=await page.evaluate(()=>JSON.stringify(state.data));
    await page.evaluate(()=>previewCorrection());
    assert.match(await page.locator('#correctionPreview').textContent(),/312\.00/);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);
    await page.evaluate(()=>confirmCorrection());
    assert.deepEqual(await page.evaluate(()=>{const p=state.data.projects[0];return ['1','2'].map(k=>{const e=p.episodes[k];return {type:e.type,grade:e.grade,mode:e.mode,duration:e.duration,date:e.date,fee:feeOf(p,e)};});}),[1,2].map(()=>({type:'Demo',grade:'A',mode:'按时长',duration:'00:02:00',date:'2026-10-11',fee:156})));
    await page.evaluate(()=>undoDataChange());assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);
  });
  await test('只纠正类型保留工作排除状态且修改不能恢复计价', async () => {
    const result=await page.evaluate(()=>{const before=JSON.stringify(state.data);const r=buildBatchCorrection([{projName:'缩写',epNo:'3'},{projName:'缩写',epNo:'4'}],{type:'Demo'});const p=r.next.projects[0],e3=p.episodes['3'],e4=p.episodes['4'];const force=buildBatchCorrection([{projName:'缩写',epNo:'3'}],{excluded:false});return {unchanged:before===JSON.stringify(state.data),e3:{type:e3.type,work:workTypeOf(e3),fee:feeOf(p,e3)},e4:{type:e4.type,excluded:e4.excluded,reason:e4.excludeReason,work:workTypeOf(e4)},force:feeOf(force.next.projects[0],force.next.projects[0].episodes['3'])};});
    assert.equal(result.unchanged,true);assert.deepEqual(result.e3,{type:'Demo',work:'修改',fee:0});assert.deepEqual(result.e4,{type:'Demo',excluded:true,reason:'测试排除',work:'混音'});assert.equal(result.force,0);
  });
  await test('非法批量字段和失效记录原子拒绝', async () => {
    const result=await page.evaluate(()=>{const before=JSON.stringify(state.data),item=[{projName:'缩写',epNo:'1'}];const patches=[{}, {grade:'X'},{type:'演示'},{duration:'坏时长'},{date:'2026-02-30'},{excluded:'yes'},{needsReview:1},{unknown:true}];const rejected=patches.map(p=>{try{buildBatchCorrection(item,p);return false;}catch{return true;}});try{buildBatchCorrection([...item,{projName:'缩写',epNo:'不存在'}],{type:'Demo'});rejected.push(false);}catch{rejected.push(true);}return {rejected,unchanged:before===JSON.stringify(state.data)};});assert.ok(result.rejected.every(Boolean));assert.equal(result.unchanged,true);
  });
  await test('纠正预览后修改字段必须重新预览且支持清空原因', async () => {
    await page.evaluate(()=>{openBatchCorrection([{projName:'缩写',epNo:'4'}]);document.getElementById('bc_type').value='Demo';previewCorrection();});assert.equal(await page.evaluate(()=>document.getElementById('correctionConfirm').disabled),false);
    await page.evaluate(()=>{document.getElementById('bc_grade').value='A';document.getElementById('bc_grade').dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await page.evaluate(()=>document.getElementById('correctionConfirm').disabled),true);await page.evaluate(()=>{document.getElementById('bc_clearReason').checked=true;previewCorrection();});await page.evaluate(()=>confirmCorrection());assert.equal(await page.evaluate(()=>state.data.projects[0].episodes['4'].excludeReason),'');
  });
  await test('Demo快捷筛选清除残留条件且核对类型状态可组合', async () => {
    await page.evaluate(()=>{const p=state.data.projects[0];p.episodes['1'].type='Demo';p.episodes['3'].type='Demo';p.episodes['3'].needsReview=true;render();});await page.locator('#gradeFilter').selectOption('A');await page.locator('#epFilter').fill('999');await page.evaluate(()=>quickFilterType('Demo'));
    assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['1','3']);await page.evaluate(()=>openReview());assert.equal(await page.locator('#reviewStatus').inputValue(),'all');await page.locator('#reviewType').selectOption('Demo');assert.equal(await page.locator('.review-check').count(),2);await page.locator('#reviewStatus').selectOption('pending');assert.equal(await page.locator('.review-check').count(),1);assert.deepEqual(await page.evaluate(()=>window._reviewItems.map(x=>x.epNo)),['3']);
  });
  await test('单项目切Demo转统一版本预览，作品文本搜索仍可用', async () => {
    await page.evaluate(()=>{const p=state.data.projects[0];p.type='Demo';p.mode='按时长';render();});await prepareWav(['7集 1012 V01.wav']);assert.equal(await page.locator('#im_type').inputValue(),'Demo');await page.getByRole('button',{name:'读取时长并预览',exact:true}).click();assert.equal(await page.locator('#demoRead').count(),1);await page.getByLabel('Demo0文件版本',{exact:true}).fill('2');await page.locator('#demoRead').click();await page.locator('#demoConfirm').click();
    const demo=await page.evaluate(()=>{const bucket=state.data.projects.find(p=>p.demoBucket);const ep=Object.values(bucket.episodes)[0];return {bucket:bucket.name,episodes:Object.keys(bucket.episodes).length,type:ep.type,workType:ep.workType,revision:ep.demoRevision};});
    assert.equal(demo.bucket,'Demo');assert.equal(demo.episodes,1);assert.equal(demo.type,'Demo');assert.equal(demo.workType,'混音');assert.deepEqual(demo.revision,{take:1,version:2});
    // 搜索框按作品名过滤：缩写 与 Demo 桶都应命中，且不会因 Demo 记录而报错。
    await page.locator('#epFilter').fill('缩写');await page.waitForTimeout(200);
    const search=await page.evaluate(()=>({count:getFilteredList().length,projects:[...new Set(getFilteredList().map(r=>r.proj.name))]}));
    assert.ok(search.count>0);assert.ok(search.projects.includes('缩写'));
  });
  await test('MP4尾部moov与64位box及mvhd时长读取', async () => {
    for(const opts of [{seconds:90},{version:1,wide:true,seconds:123}]){const sec=await page.evaluate(async bytes=>readMp4Duration(new File([new Uint8Array(bytes)],'视频.mp4',{type:'video/mp4'})),mp4Fixture(opts));assert.equal(sec,opts.seconds);}
    const rejected=await page.evaluate(async bytes=>{try{await readMediaDuration(new File([new Uint8Array(bytes)],'坏视频.mp4'));return false;}catch{return true;}},mp4Fixture({invalid:true}));assert.equal(rejected,true);
  });
  await test('MP4扫描及导入生成独立记录和正确时长', async () => {
    const count=await page.evaluate(bytes=>{const file=new File([new Uint8Array(bytes)],'8集 1012 V01.MP4',{type:'video/mp4'});const scan=scanFiles([file,new File(['ignored'],'记录.txt')]);showImportModal(scan);return scan.wavCount;},mp4Fixture({version:1,wide:true,seconds:120}));assert.equal(count,1);await page.getByRole('button',{name:'读取时长并预览',exact:true}).click();await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.deepEqual(await page.evaluate(()=>{const e=state.data.projects[0].episodes['8'];return {duration:e.duration,source:e.sourceFile,count:allEpisodes().length};}),{duration:'00:02:00',source:'8集 1012 V01.MP4',count:5});
  });
  await test('MP4零时长或截断元数据拒绝且不产生业务记录', async () => {
    const inputs=[mp4Fixture({seconds:0}),mp4Fixture({version:1}).slice(0,-80)];
    const result=await page.evaluate(async inputs=>{const before=JSON.stringify(state.data);const rejected=[];for(const bytes of inputs){try{await readMediaDuration(new File([new Uint8Array(bytes)],'损坏.mp4'));rejected.push(false);}catch{rejected.push(true);}}return {rejected,unchanged:before===JSON.stringify(state.data)};},inputs);assert.deepEqual(result.rejected,[true,true]);assert.equal(result.unchanged,true);
  });
  const screenshotDir=resolve(evidenceDir,'upgrade');await mkdir(screenshotDir,{recursive:true});
  await reset();await page.screenshot({path:resolve(screenshotDir,'preview-main.png'),fullPage:true});
  await test('按项目与等级共享日历日期选择，整月恢复且级别按记录过滤',async()=>{
    await page.evaluate(()=>{state.data.projects[0].episodes['1'].date='2026-10-10';state.data.projects[0].episodes['1'].grade='A';const sort=document.getElementById('sortMode');if(sort)sort.value='time';render();switchTab('byProject');});
    await page.locator('#calendarAux .cal-cell[data-date="2026-10-10"]').click();assert.equal(await page.locator('#view-byProject .record-group summary').count(),1);assert.ok((await page.locator('#view-byProject .record-group summary').textContent()).includes('1条'));
    await page.locator('#leftNavBody [data-view="byGrade"]').click();assert.equal(await page.locator('#calendarAux .cal-cell.selected').getAttribute('data-date'),'2026-10-10');assert.deepEqual(await page.locator('#view-byGrade [data-grade-count]').evaluateAll(els=>els.map(e=>Number(e.dataset.gradeCount))),[1,0,0,0]);
    await page.locator('#view-byGrade .record-group').first().locator('summary').click();assert.equal(await page.locator('#view-byGrade .record-group').first().getAttribute('open'),'');
    await page.locator('#calendarAux .cal-cell.selected').click();assert.deepEqual(await page.locator('#view-byGrade [data-grade-count]').evaluateAll(els=>els.map(e=>Number(e.dataset.gradeCount))),[1,0,0,3]);
  });
  await test('起止日期跨月组合筛选、反向范围提示、清空恢复三视图',async()=>{
    await page.evaluate(()=>{state.data.projects[0].episodes['1'].date='2026-10-10';state.data.projects[0].episodes['2'].date='2026-11-02';render();});await page.locator('#dateStart').fill('2026-10-11');await page.locator('#dateEnd').fill('2026-11-01');assert.deepEqual(await page.evaluate(()=>getFilteredList().map(e=>e.epNo)),['3','4']);assert.deepEqual(await page.evaluate(()=>projEpsFiltered(state.data.projects[0]).map(([k])=>k)),['3','4']);assert.deepEqual(await page.locator('#view-byGrade [data-grade-count]').evaluateAll(els=>els.map(e=>Number(e.dataset.gradeCount))),[0,0,0,2]);
    await page.locator('#dateEnd').fill('2026-10-01');assert.equal(await page.evaluate(()=>getFilteredList().length),0);assert.equal(await page.locator('#dateRangeStatus').textContent(),'起始日期不能晚于截止日期');await page.getByRole('button',{name:'清空筛选',exact:true}).click();assert.equal(await page.evaluate(()=>getFilteredList().length),4);assert.equal(await page.locator('#dateStart').inputValue(),'');assert.equal(await page.locator('#dateEnd').inputValue(),'');
  });
  await test('项目与等级默认收起，展开保留状态，月度项目默认折叠可键盘展开',async()=>{
    await page.evaluate(()=>{state.collapsed={};render();switchTab('byProject');});assert.equal(await page.locator('#view-byProject details[open]').count(),0);assert.equal(await page.locator('#view-byGrade details[open]').count(),0);await page.locator('#view-byProject summary').first().click();assert.equal(await page.locator('#view-byProject details[open]').count(),1);await page.evaluate(()=>render());assert.equal(await page.locator('#view-byProject details[open]').count(),1);await page.evaluate(()=>switchTab('detail'));const header=page.locator('#view-detail .project-group>.month-header').first();assert.equal(await header.getAttribute('aria-expanded'),'false');await header.focus();await header.press('Enter');assert.equal(await header.getAttribute('aria-expanded'),'true');
  });
  await test('B方案月份与项目轻量层级，长标题深浅主题及窄屏无溢出',async()=>{
    await page.evaluate(()=>{state.data.projects[0].name='测试项目很长的名称用于检查月份项目标题是否清楚且正确换行';state.collapsed={};render();switchTab('detail');});
    for(const width of [1440,760]){await page.setViewportSize({width,height:1000});for(const theme of ['dark','claude']){await page.evaluate(theme=>chooseAppearanceTheme(theme),theme);const sizes=await page.evaluate(()=>{const p=document.querySelector('#view-detail .period-group>.month-header'),x=document.querySelector('#view-detail .project-group>.month-header');return {p:p.getBoundingClientRect().width,x:x.getBoundingClientRect().width,offset:x.getBoundingClientRect().left-p.getBoundingClientRect().left,overflow:x.scrollWidth>x.clientWidth+1};});assert.ok(sizes.x<=sizes.p+1);assert.ok(sizes.offset>=0&&sizes.offset<20);assert.equal(sizes.overflow,false);}}
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>chooseAppearanceTheme('dark'));
  });
  await test('分组列表批量选择只统计当前页，不重复包含隐藏视图',async()=>{
    await page.evaluate(()=>{switchTab('byProject');document.querySelector('#view-detail .epchk').checked=true;const group=document.querySelector('#view-byProject details');group.open=true;state.collapsed['GP:缩写']=false;});await page.locator('#view-byProject .epchk').first().check();assert.equal(await page.evaluate(()=>selectedRecordItems().length),1);assert.equal(await page.locator('#selCount').textContent(),'1');await page.evaluate(()=>{switchTab('byGrade');toggleSelAll({checked:true});});assert.equal(await page.evaluate(()=>selectedRecordItems().length),4);await page.evaluate(()=>switchTab('byProject'));assert.equal(await page.evaluate(()=>selectedRecordItems().length),4);
  });
  const finalMixFiles=async()=>page.evaluate(()=>{
    const header=new ArrayBuffer(44),v=new DataView(header),str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,960036,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,960000,true);
    const paths=['FinalMix/兔子新娘 09集 1009 V01 7F/兔子新娘 09集 1009 V01_Master.wav','FinalMix/兔子新娘 09集 1012 V02 7F/兔子新娘 9集 1012 V02_Master.wav','FinalMix/兔子新娘 09集 1012 V02 7F/兔子新娘 09_DX BUS.wav','FinalMix/兔子新娘 09集 1012 V02 7F/兔子新娘 09_MX 1.wav'];
    const files=paths.map(path=>{const f=new File([header],path.split('/').at(-1));Object.defineProperty(f,'webkitRelativePath',{value:path});return f;});showImportModal(scanFiles(files));document.getElementById('im_proj').value='兔子新娘';document.getElementById('im_date').value='2026-10-14';
  });
  await test('FinalMix父目录补全分轨并规范化前导零，建议最新版总混',async()=>{
    await finalMixFiles();assert.deepEqual(await page.evaluate(()=>{const s=window._importScan,p=s.parsed['9'];return {groups:Object.keys(s.parsed),unknown:s.unrecognized,count:p.candidates.length,role:p.role,version:p.ver,source:p.file.name};}),{groups:['9'],unknown:0,count:4,role:'总混',version:2,source:'兔子新娘 9集 1012 V02_Master.wav'});
  });
  // 同版本多候选（S2-2.5 之后：同版本不同日期会被直接拦下，所以重复审核只能在同日期出现）
  const duplicateFiles=async(target='兔子新娘')=>page.evaluate(target=>{
    closeModal();state.data.projects=state.data.projects.filter(p=>p.name!=='兔子新娘'||p.demoBucket);
    const header=new ArrayBuffer(44),v=new DataView(header),str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,960036,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,960000,true);
    const paths=['FinalMix/兔子新娘 09集 1012 V02 7F/兔子新娘 9集 1012 V02_Master.wav','FinalMix/兔子新娘 09集 1012 V02 7F/兔子新娘 9集 1012 V02_复刻_Master.wav','FinalMix/兔子新娘 09集 1012 V02 7F/兔子新娘 09_DX BUS.wav'];
    const files=paths.map(path=>{const f=new File([header],path.split('/').at(-1));Object.defineProperty(f,'webkitRelativePath',{value:path});return f;});showImportModal(scanFiles(files));document.getElementById('im_proj').value=target;document.getElementById('im_grade').value='A';
  },target);
  const previewReady=async()=>{await page.evaluate(()=>{window._importPreview=null;});await page.getByRole('button',{name:'读取时长并预览',exact:true}).click();await page.waitForFunction(()=>!!window._importPreview,{timeout:15000});};
  await test('重复审核可改选版本，日期同步且只导入一条，可撤销',async()=>{
    await duplicateFiles();await previewReady();
    assert.equal(await page.evaluate(()=>window._importPreview.rows[0].episodeNo),'9');
    const chosen=await page.evaluate(()=>{const c=window._importPreview.rows[0].candidates;const i=c.findIndex(x=>x&&x.sourcePath&&x.sourcePath.endsWith('_复刻_Master.wav'));return {i,path:c[i]&&c[i].sourcePath};});
    assert.ok(chosen.i>=0,JSON.stringify(chosen));
    await page.locator('input[name="duplicate_0"][value="'+chosen.i+'"]').check();await page.getByRole('button',{name:'完成审核，预览导入',exact:true}).click();
    assert.equal(await page.getByLabel('日期',{exact:true}).inputValue(),'2026-10-12');
    await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.deepEqual(await page.evaluate(()=>{const p=state.data.projects.find(p=>p.name==='兔子新娘');return {count:Object.keys(p.episodes).length,date:p.episodes['9'].date,path:p.episodes['9'].sourcePath};}),{count:1,date:'2026-10-12',path:chosen.path});await page.evaluate(()=>undoDataChange());assert.equal(await page.evaluate(()=>state.data.projects.length),1);
  });
  await test('整组排除不写账目，跳过审核恢复默认建议',async()=>{
    await duplicateFiles();const before=await page.evaluate(()=>JSON.stringify(state.data));await page.evaluate(()=>prepareImportPreview());await page.getByLabel('跳过本组0').check();await page.getByRole('button',{name:'完成审核，预览导入',exact:true}).click();await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);await page.evaluate(()=>renderDuplicateReview());await page.getByRole('button',{name:'跳过审核，使用默认建议',exact:true}).click();await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.equal(await page.evaluate(()=>state.data.projects.find(p=>p.name==='兔子新娘').episodes['9'].sourceFile),'兔子新娘 9集 1012 V02_Master.wav');
  });
  await test('设置跳过审核仍预览，已有记录默认跳过，数据变化拒绝旧预览',async()=>{
    await duplicateFiles('缩写');await page.evaluate(()=>{state.data.projects[0].episodes['9']={recordId:SettlementIdentity.newId('record'),date:'2026-10-10',duration:'00:01:00',workType:'混音'};});
    await page.evaluate(()=>prepareImportPreview(false));assert.equal(await page.evaluate(()=>window._importPreview.rows[0].action),'skip');
    await page.evaluate(()=>{const row=window._importPreview.rows[0];row.action='append';renderImportPreview();});
    await page.evaluate(()=>{state.data.projects[0].episodes['9'].duration='00:02:00';});const before=await page.evaluate(()=>JSON.stringify(state.data));await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.stringify(state.data)),before);
  });
  await test('全窗口递归拖拽保留路径，多批目录枚举不丢文件',async()=>{
    const result=await page.evaluate(async()=>{
      const file=new File(['header'],'09_DX BUS.wav'),entry={isFile:true,fullPath:'/FinalMix/兔子新娘 09集 1012 V02/09_DX BUS.wav',file:resolve=>resolve(file)},directory={isDirectory:true,createReader:()=>{let n=0;return {readEntries:resolve=>resolve(n++===0?[entry]:[])}}};const files=await collectDroppedFiles({items:[{webkitGetAsEntry:()=>directory}]});const scan=scanFiles(files);return {count:files.length,unknown:scan.unrecognized,path:scan.parsed['9'].sourcePath};
    });assert.deepEqual(result,{count:1,unknown:0,path:'/FinalMix/兔子新娘 09集 1012 V02/09_DX BUS.wav'});
  });
  await test('真实FinalMix文件名只读扫描333文件归组，无账目写入',async()=>{
    // 333 条按 FinalMix 实际命名规则合成的名字：每集一个总混 + 两条分轨，跨集归组。
    const result=await page.evaluate(()=>{const before=JSON.stringify(state.data);const files=[];for(let ep=1;ep<=111;ep++){const no=String(ep).padStart(2,'0');const dir=`FinalMix/兔子新娘 ${no}集 1012 V02 7F/`;for(const name of [`兔子新娘 ${ep}集 1012 V02_Master.wav`,`兔子新娘 ${no}_DX BUS.wav`,`兔子新娘 ${no}_MX 1.wav`]){const f=new File(['synthetic'],name);Object.defineProperty(f,'webkitRelativePath',{value:dir+name});files.push(f);}}const scan=scanFiles(files);return {count:scan.wavCount,unknown:scan.unrecognized,groups:Object.keys(scan.parsed).length,masters:Object.values(scan.parsed).filter(p=>p.role==='总混').length,unchanged:before===JSON.stringify(state.data)};});assert.equal(result.count,333);assert.equal(result.unknown,0);assert.equal(result.groups,result.masters);assert.equal(result.unchanged,true);console.log('REAL_NAME_SCAN '+JSON.stringify(result));
  });
  await test('重复审核窄屏长路径换行，单选与文字同排，深浅主题可用',async()=>{
    await page.setViewportSize({width:700,height:800});await duplicateFiles();await page.evaluate(()=>prepareImportPreview());
    for(const theme of ['dark','claude']){await page.evaluate(theme=>chooseAppearanceTheme(theme),theme);const geometry=await page.locator('.duplicate-choice').first().evaluate(label=>{const radio=label.querySelector('input').getBoundingClientRect(),text=label.querySelector('span').getBoundingClientRect();return {width:radio.width,adjacent:text.left>=radio.right,gap:Math.abs(text.top-radio.top),overflow:label.scrollWidth>label.clientWidth+1};});assert.equal(geometry.width,16);assert.equal(geometry.adjacent,true);assert.ok(geometry.gap<5);assert.equal(geometry.overflow,false);}
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>chooseAppearanceTheme('dark'));
  });
  try { await reset();await page.evaluate(()=>{state.collapsed={};render();switchTab('detail');document.getElementById('toast').style.display='none';});await page.screenshot({path:resolve(evidenceDir,'month-project-hierarchy.png'),fullPage:true});await page.evaluate(()=>{settings.defaultSort='time';const sortModeEl=document.getElementById('sortMode');if(sortModeEl)sortModeEl.value='time';render();switchTab('byProject');});await page.screenshot({path:resolve(evidenceDir,'project-calendar.png'),fullPage:true});await page.evaluate(()=>switchTab('byGrade'));await page.screenshot({path:resolve(evidenceDir,'grade-calendar.png'),fullPage:true});
  await duplicateFiles();await page.evaluate(()=>{prepareImportPreview();document.getElementById('toast').style.display='none';});await page.getByRole('button',{name:'完成审核，预览导入',exact:true}).waitFor();await page.screenshot({path:resolve(evidenceDir,'duplicate-review.png'),fullPage:true});
  await prepareWav(['1集 1012 V01.wav','1集 1012 V02.wav','5集 1012 V01.wav']);await page.evaluate(()=>prepareImportPreview(false));await page.getByRole('button',{name:'确认导入',exact:true}).waitFor();await page.screenshot({path:resolve(screenshotDir,'preview-import-window.png'),fullPage:true});
  await page.evaluate(()=>{closeModal();openBatchCorrection([{projName:'缩写',epNo:'1'},{projName:'缩写',epNo:'2'}]);});await page.locator('#bc_work').selectOption('修改');await page.getByRole('button',{name:'预览金额变化',exact:true}).click();await page.screenshot({path:resolve(screenshotDir,'preview-batch-amount.png'),fullPage:true});
  await page.evaluate(()=>{closeModal();openReview();document.getElementById('reviewStatus').value='all';renderReview();});await page.screenshot({path:resolve(screenshotDir,'preview-review.png'),fullPage:true});
  await page.evaluate(()=>{closeModal();const p=state.data.projects[0];p.episodes['1'].type='Demo';p.episodes['3'].type='Demo';render();openReview();document.getElementById('reviewType').value='Demo';renderReview();});await page.screenshot({path:resolve(screenshotDir,'preview-demo-review.png'),fullPage:true});
  await page.evaluate(async data=>{closeModal();await previewJSONFile(new File([JSON.stringify(data)],'测试备份.json',{type:'application/json'}));},fixture());await page.screenshot({path:resolve(screenshotDir,'preview-restore.png'),fullPage:true});
  await page.evaluate(()=>{closeModal();openProjectManager();});await page.screenshot({path:resolve(screenshotDir,'preview-projects.png'),fullPage:true});
  await reset();await page.locator('#epFilter').fill('1,3-5');await page.locator('#workFilter').selectOption('修改');await page.locator('#billingFilter').selectOption('excluded');await page.screenshot({path:resolve(screenshotDir,'preview-record-filters.png'),fullPage:true});
  await page.evaluate(()=>{clearRecordFilters();const p=state.data.projects[0];for(let i=5;i<=60;i++)p.episodes[String(i)]={date:'2026-10-12',duration:'00:01:00',workType:'混音'};settings.freezeLevel='full';render();applyTopPanelFreeze();scrollArea().scrollTop=180;});await page.screenshot({path:resolve(screenshotDir,'preview-top-panel-freeze.png'),fullPage:true});

  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.getElementById('toast').style.display='none';});await page.screenshot({path:resolve(screenshotDir,'preview-top-panel-freeze-dark.png'),fullPage:true});
  await page.screenshot({path:resolve(screenshotDir,'preview-three-pane-dark.png'),fullPage:true});
  await page.evaluate(()=>{toggleSidePanel('left');toggleSidePanel('right');});await page.screenshot({path:resolve(screenshotDir,'preview-three-pane-compact-dark.png'),fullPage:true});
  await page.evaluate(()=>{toggleSidePanel('left');toggleSidePanel('right');openSettings();});await page.screenshot({path:resolve(screenshotDir,'preview-three-pane-settings-dark.png'),fullPage:true});
  await page.evaluate(()=>{closeModal();openAppearanceSettings();});await page.screenshot({path:resolve(screenshotDir,'preview-three-pane-appearance-dark.png'),fullPage:true});
  await page.evaluate(()=>closeModal());for(const preset of ['entry','review','settlement']){await page.evaluate(preset=>{applyViewPreset(preset);document.getElementById('toast').style.display='none';},preset);await page.screenshot({path:resolve(screenshotDir,'preview-preset-'+preset+'-dark.png'),fullPage:true});}
  const visualDir=resolve(evidenceDir,'visual');await mkdir(visualDir,{recursive:true});
  for(const theme of ['dark','claude']){await page.evaluate(theme=>{closeModal();chooseAppearanceTheme(theme);applyViewPreset('review');document.getElementById('toast').style.display='none';},theme);await page.waitForTimeout(300);await page.screenshot({path:resolve(visualDir,theme+'-workspace.png'),fullPage:true});await page.evaluate(()=>openSettings());await page.screenshot({path:resolve(visualDir,theme+'-settings.png'),fullPage:true});}
  await transparency('no-preference');
  const liquidDir=resolve(evidenceDir,'liquid');await mkdir(liquidDir,{recursive:true});for(const theme of ['dark','claude']){await page.evaluate(theme=>{closeModal();setReducedMaterial(false);chooseAppearanceTheme(theme);applyViewPreset('review');document.getElementById('toast').style.display='none';},theme);await page.waitForTimeout(300);await page.screenshot({path:resolve(liquidDir,theme+'-liquid-workspace.png'),fullPage:true});}
  await page.evaluate(()=>setReducedMaterial(true));await page.waitForTimeout(300);await page.screenshot({path:resolve(liquidDir,'claude-reduced-workspace.png'),fullPage:true});await page.evaluate(()=>openAppearanceSettings());await page.screenshot({path:resolve(liquidDir,'claude-material-settings.png'),fullPage:true});
  } catch (e) { console.error('WARN 证据截图段落失败（不影响用例结论）\n' + ((e && e.stack) || e)); }
  assert.deepEqual(errors, [], '页面运行异常');
  console.log(`RESULT ${testCount - failures}/${testCount} passed`);
  await mkdir(evidenceDir,{recursive:true});await writeFile(resolve(evidenceDir,'test-result.json'),JSON.stringify({tests:`${testCount-failures}/${testCount}`,failures,pageErrors:errors},null,2));
  if (failures) process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}


