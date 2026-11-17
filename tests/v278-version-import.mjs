import {chromium} from './playwright-runtime.mjs';
/* v2.7.8：旧版本重新导入后应保留（日历显示交付+修改），且不产生重复计费。 */
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const web='D:/Ai-Files/Tools/Html/settlement-tool';
const out='D:/Ai-Files/Repos/GitHub/settlement-tool/build/v278';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=resolve(web,'.'+new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const page=await context.newPage();page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{localStorage.setItem('settlement-settings-v1',JSON.stringify({showCalendar:true,materialReduced:false,calendarFilters:{workTypes:['混音','修改','重混'],types:['正式','Demo'],categories:['premium','automation']}}));});
await page.goto(origin+'/settlement-workbench.html');
const ws=JSON.parse(await readFile('C:/Users/Administrator/AppData/Local/SettlementTool/workspace.json','utf8'));
const data=JSON.parse(ws.storage['settlement_v1']);
await page.evaluate(d=>{localStorage.setItem('settlement_v1',JSON.stringify(d));},data);
await page.reload();await page.waitForTimeout(500);

const money=async()=>await page.evaluate(()=>backupStats(state.data).amount);
const before=await money();
const beforeEp=await page.evaluate(()=>{const p=state.data.projects.find(x=>x.name==='心剑');return Object.entries(p.episodes).filter(([k,r])=>String(r.episodeNo)==='13'||String(r.episodeNo)==='31').map(([k,r])=>[k,r.sourceFile,r.date,r.excluded,r.versionSuperseded]);});
console.log('导入前 心剑 EP13/EP31 记录:');for(const r of beforeEp)console.log('  ',JSON.stringify(r));
console.log('导入前 账目总额 = ¥'+before.toFixed(2));

// ---- 选文件：心剑 EP13 / EP31 的全部版本（复制到临时目录，保留集文件夹结构） ----
const srcRoot='D:/DAW-Project/20-心剑_20261016_7F/FinalMix';
const tmpRoot=out+'/import-src';
await mkdir(tmpRoot,{recursive:true});
const files=[
 '心剑 13集 1020 V02 7F/心剑 13集 1020 V02 7F_Master.wav',
 '心剑 13集 1021 V02 7F/心剑 13集 1021 V02 7F_Master.wav',
 '心剑 31集 1021 V01 7F/心剑 31集 1021 V01 7F_Master.wav',
];
for(const f of files){const dst=tmpRoot+'/'+f;await mkdir(dst.substring(0,dst.lastIndexOf('/')),{recursive:true});await (await import('node:fs/promises')).copyFile(srcRoot+'/'+f,dst);}
const flat=['心剑 13集 1027 V03 7F_Master.wav','心剑 31集 1027 V02 7F_Master.wav'];
for(const f of flat)await (await import('node:fs/promises')).copyFile(srcRoot+'/'+f,tmpRoot+'/'+f);
await page.setInputFiles('#folderInput',tmpRoot);
await page.waitForTimeout(600);
// 导入设置：项目=心剑、类型=正式、类别=精品剧、计价=按时长、默认日期 2026-10-27
await page.evaluate(()=>{
 const set=(id,v)=>{const el=document.getElementById(id);el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));};
 set('im_proj','心剑');set('im_type','正式');set('im_category','premium');set('im_grade','C');set('im_mode','按时长');set('im_date','2026-10-27');set('im_dateMode','auto');
});
await page.click('button:has-text("读取时长并预览")');
await page.waitForTimeout(1200);
// 重复信息审核 → 完成审核
const hasReview=await page.evaluate(()=>!!document.querySelector('#modalBox h2')&&document.querySelector('#modalBox h2').textContent.includes('重复信息审核'));
if(hasReview){await page.click('button:has-text("完成审核，预览导入")');await page.waitForTimeout(600);}
const rows=await page.evaluate(()=>(window._importPreview?.rows||[]).map(r=>({ep:r.episodeNo,file:r.candidates[r.selected].file.name,date:r.date,action:r.action,target:r.targetKey||''})));
console.log('\n导入预览行:');for(const r of rows)console.log('  ',JSON.stringify(r));
await page.screenshot({path:out+'/import-preview.png'});
await page.click('button:has-text("确认导入")');
await page.waitForTimeout(800);

const afterEp=await page.evaluate(()=>{const p=state.data.projects.find(x=>x.name==='心剑');return Object.entries(p.episodes).filter(([k,r])=>String(r.episodeNo)==='13'||String(r.episodeNo)==='31').map(([k,r])=>[k,r.sourceFile,r.date,r.excluded===true,r.versionSuperseded===true]);});
console.log('\n导入后 心剑 EP13/EP31 记录:');for(const r of afterEp)console.log('  ',JSON.stringify(r));
const after=await money();
console.log('导入后 账目总额 = ¥'+after.toFixed(2)+'  变化 = ¥'+(after-before).toFixed(2));

// ---- 日历 ----
await page.evaluate(()=>{clearRecordFilters();state.calYear=2026;state.calMonth=9;state.selectedDate=null;render();});
await page.waitForTimeout(400);
const cal=await page.evaluate(()=>[...document.querySelectorAll('.cal-cell')].map(c=>({d:c.querySelector('.dow')?.textContent,lines:[...(c.querySelectorAll('.eplist span')||[])].map(s=>({t:s.textContent,cls:s.className.includes('revise')?'revise':s.className.includes('remix')?'remix':'mix'}))})).filter(x=>x.lines.length));
console.log('\n=== 日历 2026-10（心剑相关） ===');
for(const c of cal){const x=c.lines.filter(l=>l.t.includes('心剑'));if(x.length)console.log(' day',c.d,'|',x.map(l=>l.t+'('+l.cls+')').join(' / '));}

// ---- 悬停浮层分组（编辑弹窗） ----
const hover=await page.evaluate(()=>{
 const p=state.data.projects.find(x=>x.name==='心剑');
 const info=SettlementVersion.buildTimeline(p);
 return Object.entries(p.episodes).filter(([k,r])=>String(r.episodeNo)==='13'||String(r.episodeNo)==='31').map(([k,r])=>({k,file:(r.sourceFile||'').slice(-14),date:r.date,display:displayWorkType({proj:p,epNo:k,workType:r.workType}),info:info.get(k)}));
});
console.log('\n=== 显示分类（交付/修改） ===');
for(const h of hover)console.log('  ',h.k,'|',h.file,'|',h.date,'| 显示为:',h.display,'| delivery=',h.info?.delivery,'version=',h.info?.label);

const dup=await page.evaluate(()=>duplicateReport().map(g=>g.project.name+' '+g.identity));
console.log('\n重复组:',dup.length,dup.join(' / '));
console.log('ERRORS',errors);
await page.screenshot({path:out+'/after-import.png'});
await browser.close();await new Promise(r=>server.close(r));
