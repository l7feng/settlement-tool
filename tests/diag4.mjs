import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const web='D:/Ai-Files/Tools/Html/settlement-tool';
const out='D:/Ai-Files/Repos/GitHub/settlement-tool/build/diag-20261030';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=resolve(web,'.'+new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=await import(pathToFileURL('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const page=await context.newPage();page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{localStorage.setItem('settlement-settings-v1',JSON.stringify({showCalendar:true,materialReduced:false,calendarFilters:{workTypes:['混音','修改','重混'],types:['正式','Demo'],categories:['premium','automation']}}));});
await page.goto(origin+'/settlement-workbench.html');
const ws=JSON.parse(await readFile('C:/Users/Administrator/AppData/Local/SettlementTool/workspace.json','utf8'));
const data=JSON.parse(ws.storage['settlement_v1']);
await page.evaluate(d=>{localStorage.setItem('settlement_v1',JSON.stringify(d));},data);
await page.reload();await page.waitForTimeout(500);

// ---------- 1. 日历 ----------
await page.evaluate(()=>{clearRecordFilters();state.calYear=2026;state.calMonth=9;state.selectedDate=null;render();});
await page.waitForTimeout(300);
const cal=await page.evaluate(()=>[...document.querySelectorAll('.cal-cell')].map(c=>({d:c.querySelector('.dow')?.textContent,lines:[...(c.querySelectorAll('.eplist span')||[])].map(s=>({t:s.textContent,cls:s.className})),foot:c.querySelector('.cellfoot')?.innerText||''})).filter(x=>x.lines.length));
console.log('=== CALENDAR 2026-10 ===');
for(const c of cal)console.log(' day',c.d,'|',c.lines.map(l=>l.t+' ['+l.cls+']').join(' / '),'|',JSON.stringify(c.foot));

// ---------- 2. 重复检查 ----------
const dup=await page.evaluate(()=>{
  const groups=duplicateReport();
  return groups.map(g=>{const keep=SettlementVersion.preferredRecord(g.project,g.items);
    let before=0,after=0;
    for(const it of g.items){const f=feeOf(g.project,it.record);if(isBillable(it.record)){before+=f;if(it.key===keep.key)after+=f;}}
    return {project:g.project.name,id:g.identity,n:g.items.length,keep:keep.key,before,after,excess:+(before-after).toFixed(2),
      items:g.items.map(it=>({key:it.key,mode:it.record.mode,src:it.record.sourceFile||'手工',fee:feeOf(g.project,it.record)}))};});
});
console.log('\n=== DUPLICATE GROUPS ===', dup.length);
for(const g of dup)console.log(' ',g.project,g.id,'n='+g.n,'keep='+g.keep,'excess=¥'+g.excess,'|',g.items.map(i=>`${i.key}(${i.mode},${i.src.slice(0,18)},¥${i.fee})`).join(' '));
console.log('TOTAL excess=¥'+dup.reduce((n,g)=>n+g.excess,0).toFixed(2));

// ---------- 3. 导入防重（兔子新娘 EP2） ----------
const imp=await page.evaluate(()=>{
  const p=state.data.projects.find(x=>x.name==='兔子新娘');
  const config={name:'兔子新娘',type:'正式',mode:p.mode,grade:'D',billingCategory:p.billingCategory||'legacy',gradeRanges:'',date:'2026-10-20'};
  const mk=(ep,file)=>({episodeNo:String(ep),candidates:[{file:{name:file},sourcePath:file,episodeNo:String(ep),label:String(ep)}],selected:0,date:'2026-10-20',dateSource:'file',grade:'D',type:'正式',workType:'混音',excluded:false});
  const out=[];
  for(const [ep,file] of [[2,'兔子新娘 02集 1009 V01 7F_Master.wav'],[3,'兔子新娘 03集 1009 V01 7F_Master.wav'],[9,'兔子新娘 9集 1012 V02_Master.wav']]){
    const row=mk(ep,file);row.action=formalDefaultAction(row,config,p);
    out.push({ep,action:row.action,targetKey:row.targetKey||'',key:importTargetKey(row,config),exists:!!p.episodes[importTargetKey(row,config)]});
  }
  return out;
});
console.log('\n=== IMPORT DEFAULT ACTION (兔子新娘) ===');
for(const r of imp)console.log(' EP'+r.ep,'action='+r.action,'targetKey='+JSON.stringify(r.targetKey),'key='+JSON.stringify(r.key),'exists='+r.exists);

console.log('\nERRORS',errors);
await page.screenshot({path:out+'/diag4.png'});
await browser.close();await new Promise(r=>server.close(r));
