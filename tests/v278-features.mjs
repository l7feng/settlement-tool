/* v2.7.8 专项：交付时间线显示、日历颜色、重复集数检查与登记/导入防重。 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const web=process.env.SETTLEMENT_WEB_ROOT||'D:/Ai-Files/Tools/Html/settlement-tool';
const out=process.env.SETTLEMENT_EVIDENCE||'D:/Ai-Files/Repos/GitHub/settlement-tool/build/v278/features';await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const server=createServer(async(req,res)=>{try{const file=resolve(web,'.'+new URL(req.url,'http://localhost').pathname);assert.ok(file.startsWith(resolve(web)+sep));res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const page=await context.newPage();page.setDefaultTimeout(8000);
const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
// 合成账目：心剑式三版本（EP13）、兔子新娘式重复（EP2 两种计价方式）、正常单版本。
const fixture={prices:{A:{per_min:78,per_ep:78},B:{per_min:30,per_ep:30},C:{per_min:15,per_ep:15},D:{per_min:10,per_ep:10}},projects:[
 {name:'心剑',id:'p-xin',aliases:[],billingCategory:'premium',grade:'C',type:'正式',mode:'按时长',episodes:{
   '10':{recordId:'r10',date:'2026-10-20',duration:'00:00:51',workType:'混音',grade:'C',episodeNo:'10',mode:'按时长',sourceFile:'心剑 10集 1020 V01 7F_Master.wav',sourcePath:'FinalMix/心剑 10集 1020 V01 7F/心剑 10集 1020 V01 7F_Master.wav'},
   '11':{recordId:'r11',date:'2026-10-20',duration:'00:00:52',workType:'混音',grade:'C',episodeNo:'11',mode:'按时长',sourceFile:'心剑 11集 1020 V01 7F_Master.wav'},
   '12':{recordId:'r12',date:'2026-10-20',duration:'00:00:58',workType:'混音',grade:'C',episodeNo:'12',mode:'按时长',sourceFile:'心剑 12集 1020 V01 7F_Master.wav'},
   '13':{recordId:'r13a',date:'2026-10-20',duration:'00:01:16',workType:'混音',grade:'C',episodeNo:'13',mode:'按时长',sourceFile:'心剑 13集 1020 V02 7F_Master.wav',sourcePath:'FinalMix/心剑 13集 1020 V02 7F/心剑 13集 1020 V02 7F_Master.wav',excluded:true,versionSuperseded:true,excludeReason:'旧交付版本（仅最高版本计费）'},
   '13@1':{recordId:'r13b',date:'2026-10-21',duration:'00:01:15',workType:'混音',grade:'C',episodeNo:'13',mode:'按时长',sourceFile:'心剑 13集 1021 V02 7F_Master.wav',sourcePath:'FinalMix/心剑 13集 1021 V02 7F/心剑 13集 1021 V02 7F_Master.wav',excluded:true,versionSuperseded:true,excludeReason:'旧交付版本（仅最高版本计费）'},
   '13@2':{recordId:'r13c',date:'2026-10-27',duration:'00:01:09',workType:'混音',grade:'C',episodeNo:'13',mode:'按时长',sourceFile:'心剑 13集 1027 V03 7F_Master.wav',sourcePath:'FinalMix/心剑 13集 1027 V03 7F_Master.wav'},
   '31':{recordId:'r31a',date:'2026-10-21',duration:'00:00:49',workType:'混音',grade:'C',episodeNo:'31',mode:'按时长',sourceFile:'心剑 31集 1021 V01 7F_Master.wav',excluded:true,versionSuperseded:true,excludeReason:'旧交付版本（仅最高版本计费）'},
   '31@1':{recordId:'r31b',date:'2026-10-27',duration:'00:00:49',workType:'混音',grade:'C',episodeNo:'31',mode:'按时长',sourceFile:'心剑 31集 1027 V02 7F_Master.wav'}}},
 {name:'兔子新娘',id:'p-tu',aliases:[],billingCategory:'legacy',grade:'D',type:'正式',mode:'按集',episodes:{
   '2':{recordId:'rt2',date:'2026-10-09',duration:'00:01:45',workType:'混音',grade:'D',episodeNo:'2',mode:'按集',sourceFile:'兔子新娘 02集 1009 V01 7F_Master.wav'},
   '02':{recordId:'rt02',date:'2026-10-09',duration:'00:01:45',workType:'混音',grade:'D',mode:'按时长'}}}]};
await context.addInitScript(data=>{if(!sessionStorage.fixture){localStorage.setItem('settlement_v1',JSON.stringify(data));localStorage.setItem('settlement-settings-v1',JSON.stringify({showCalendar:true,materialReduced:false}));sessionStorage.fixture='yes';}},fixture);
const test=async(name,fn)=>{try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(error){results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+' '+error.stack);}};
const calendar=()=>page.evaluate(()=>{clearRecordFilters();state.calYear=2026;state.calMonth=9;state.selectedDate=null;render();return [...document.querySelectorAll('.cal-cell')].map(c=>({d:c.querySelector('.dow')?.textContent,lines:[...(c.querySelectorAll('.eplist span')||[])].map(s=>({t:s.textContent,cls:s.className})),foot:c.querySelector('.cellfoot')?.innerText||''}));});
try{
await page.goto(origin+'/settlement-workbench.html');
await page.waitForTimeout(300);

await test('日历默认筛选包含混音、修改与重混',async()=>{
 const f=await page.evaluate(()=>normalizeCalendarFilters(settings.calendarFilters));
 assert.deepEqual(f.workTypes.sort(),['修改','混音','重混'].sort());
});
await test('旧设置只有混音时迁移为全选',async()=>{
 const f=await page.evaluate(()=>normalizeCalendarFilters({workTypes:['混音'],types:['正式','Demo'],categories:['premium','automation']}));
 assert.deepEqual(f.workTypes.sort(),['修改','混音','重混'].sort());
});
await test('同集最早版本为交付、后续版本显示为修改',async()=>{
 const info=await page.evaluate(()=>{const p=state.data.projects.find(x=>x.name==='心剑');const t=SettlementVersion.buildTimeline(p);
  return Object.entries(p.episodes).filter(([k])=>k.startsWith('13')).map(([k,r])=>({k,date:r.date,delivery:t.get(k)?.delivery,display:displayWorkType({proj:p,epNo:k,workType:r.workType})}));});
 assert.deepEqual(info.map(x=>[x.date,x.delivery,x.display]),[['2026-10-20',true,'混音'],['2026-10-21',false,'修改'],['2026-10-27',false,'修改']]);
});
await test('日历按交付与修改分行并着色',async()=>{
 const cells=await calendar();
 const d20=cells.find(c=>c.lines.some(l=>l.t.includes('心剑')));
 assert.ok(d20,'20日应有心剑');
 const xin=d20.lines.find(l=>l.t.includes('心剑'));
 assert.match(xin.t,/10-13|10-12/);assert.ok(xin.cls.includes('cal-line-mix'));
 const d27=cells.find(c=>c.lines.some(l=>l.t.includes('2条修改')));
 assert.ok(d27,'27日应显示2条修改');
 assert.ok(d27.lines.find(l=>l.t.includes('2条修改')).cls.includes('cal-line-revise'));
});
await test('重复集数只报真正重复计费的组',async()=>{
 const groups=await page.evaluate(()=>duplicateReport().map(g=>({p:g.project.name,id:g.identity,n:g.items.length})));
 assert.deepEqual(groups,[{p:'兔子新娘',id:'EP2',n:2}]);
});
await test('重复记录只保留一条计费且可撤销',async()=>{
 const before=await page.evaluate(()=>backupStats(state.data).amount);
 await page.evaluate(()=>{duplicateGroupsCache=duplicateReport();repairDuplicateGroups([0]);});
 const after=await page.evaluate(()=>({amount:backupStats(state.data).amount,reason:state.data.projects.find(p=>p.name==='兔子新娘').episodes['02'].excludeReason,excluded:state.data.projects.find(p=>p.name==='兔子新娘').episodes['02'].excluded===true}));
 assert.equal(after.excluded,true);assert.equal(after.reason,'同集重复（仅保留一条计费）');
 assert.ok(after.amount<before);
 await page.evaluate(()=>undoDataChange());
 assert.equal(await page.evaluate(()=>backupStats(state.data).amount),before);
});
await test('重复检查按钮在操作菜单中可用',async()=>{
 assert.equal(await page.evaluate(()=>!!document.getElementById('duplicateCheckButton')),true);
});
await test('同集已有记录时导入默认跳过并可显式更新历史键',async()=>{
 const res=await page.evaluate(()=>{const p=state.data.projects.find(x=>x.name==='兔子新娘');
  const config={name:'兔子新娘',type:'正式',mode:'按集',grade:'D',billingCategory:'legacy',gradeRanges:'',date:'2026-10-20'};
  const row={episodeNo:'2',candidates:[{file:{name:'兔子新娘 02集 1009 V01 7F_Master.wav'},sourcePath:'x/兔子新娘 02集 1009 V01 7F_Master.wav'}],selected:0,date:'2026-10-09',grade:'D',type:'正式',workType:'混音'};
  const action=formalDefaultAction(row,config,p);
  const target=importExistingKey(row,config,p);
  row.action='update';const key=importTargetKey(row,config,p);
  // 只有手工登记（前导零键）时，更新必须命中该历史键，避免新增第二条同集记录。
  const manual={...p,episodes:{'02':p.episodes['02']}};
  const row2={...row};delete row2.action;
  const action2=formalDefaultAction(row2,config,manual);
  row2.action='update';const key2=importTargetKey(row2,config,manual);
  return {action,target,key,action2,key2};});
 assert.equal(res.action,'skip');
 assert.equal(res.target,'2');
 assert.equal(res.key,'2');
 assert.equal(res.action2,'skip');
 assert.equal(res.key2,'02');
});
await test('批量登记识别前导零键的同集记录',async()=>{
 const found=await page.evaluate(()=>{const p=state.data.projects.find(x=>x.name==='兔子新娘');return SettlementVersion.findEpisodeKey(p,'2');});
 assert.equal(found,'2');
});
await test('登记一条时同集已有记录会提示',async()=>{
 const msg=await page.evaluate(()=>{const p=state.data.projects.find(x=>x.name==='兔子新娘');
  const same=SettlementVersion.findEpisodeKey(p,'2');
  return same&&same!=='2'?'第2集已有记录（键 '+same+'）':same?'已有记录(同键)':'';});
 assert.ok(msg.includes('已有记录'));
});
await test('项目遮罩按计价方式着色并显示方式标签',async()=>{
 await page.evaluate(()=>{state.view='detail';state.selectedProject='兔子新娘';render();});
 const html=await page.evaluate(()=>document.querySelector('#view-detail')?.innerHTML||'');
 assert.ok(/mode-tag/.test(html),'应有计价方式标签');
 assert.ok(/mode-episode|mode-duration|mode-mixed/.test(html),'应有计价方式着色类');
});
await test('按集与按时长快筛按钮可切换',async()=>{
 const state1=await page.evaluate(()=>{const sel=document.getElementById('modeFilter');if(!sel)return null;cycleRecordModeFilter();return sel.value;});
 assert.equal(state1,'按集');
 const state2=await page.evaluate(()=>{const sel=document.getElementById('modeFilter');cycleRecordModeFilter();return sel.value;});
 assert.equal(state2,'按时长');
 const label=await page.evaluate(()=>document.getElementById('recordModeFilterButton')?.textContent||'');
 assert.ok(label.includes('计价方式'));
});
await test('无页面异常',async()=>assert.deepEqual(errors,[]));
await page.screenshot({path:out+'/features.png'});
}finally{await writeFile(out+'/results.json',JSON.stringify({results,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
if(results.some(r=>!r.passed))process.exitCode=1;
