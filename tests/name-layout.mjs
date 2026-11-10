import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Script} from 'node:vm';
const web=process.env.SETTLEMENT_WEB_ROOT||'D:/Ai-Files/Tools/Html/settlement-tool';
const out=process.env.SETTLEMENT_EVIDENCE||'D:/Ai-Files/Repos/GitHub/settlement-tool/build/demo-latest-20261023/tests';await mkdir(out,{recursive:true});
for(const m of (await readFile(resolve(web,'settlement-workbench.html'),'utf8')).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new Script(m[1]);
const {chromium}=await import(pathToFileURL('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const server=createServer(async(req,res)=>{try{const file=resolve(web,'.'+new URL(req.url,'http://localhost').pathname);assert.ok(file.startsWith(resolve(web)+sep));res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
const fixture={prices:{A:{per_min:78,per_ep:78},B:{per_min:30,per_ep:30},C:{per_min:15,per_ep:15},D:{per_min:10,per_ep:10}},projects:[{name:'旧项目',grade:'C',type:'正式',mode:'按时长',episodes:{1:{date:'2026-09-21',duration:'00:01:00',workType:'混音'}}},{name:'精品样本',billingCategory:'premium',grade:'C',type:'正式',mode:'按时长',episodes:{1:{date:'2026-10-20',duration:'00:01:00',grade:'A',type:'Demo',workType:'混音'},2:{date:'2026-10-20',duration:'00:01:00',grade:'C',type:'正式',workType:'混音'},3:{date:'2026-10-20',duration:'00:01:00',grade:'C',type:'正式',workType:'修改'},4:{date:'2026-10-20',duration:'00:01:00',grade:'C',type:'正式',workType:'重混'}}},{name:'自动样本',billingCategory:'automation',grade:'D',type:'正式',mode:'按时长',episodes:{1:{date:'2026-10-20',duration:'00:01:00',type:'Demo',workType:'混音'}}}]};
await context.addInitScript(data=>{if(!sessionStorage.fixture){localStorage.setItem('settlement_v1',JSON.stringify(data));localStorage.setItem('settlement-settings-v1',JSON.stringify({showCalendar:true,materialReduced:false}));sessionStorage.fixture='yes';}},fixture);
const reset=()=>page.evaluate(data=>{state.data=normalizeData(data);state.collapsed={};settings.calendarFilters=defaultCalendarFilters();settings.showCalendar=true;dataUndoStack.length=0;closeModal();state.calYear=null;clearRecordFilters();saveData();},fixture);
const test=async(name,fn)=>{try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(error){results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+' '+error.stack);}};
const makeFiles=paths=>page.evaluate(paths=>{
 const header=new ArrayBuffer(44),v=new DataView(header),str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,960036,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,960000,true);
 window.testMediaFiles=paths.map(path=>{const file=new File([header],path.replace(/\\/g,'/').split('/').at(-1));mediaPaths.set(file,path);return file;});return testMediaFiles.length;
},paths);
const clean=()=>page.evaluate(()=>{closeModal();state.data.projects=[];state.displayNumbers=chronologyNumbers();state.selectedDate=null;state.calYear=null;settings.recordSort='episode';settings.calendarFilters=defaultCalendarFilters();dataUndoStack.length=0;clearRecordFilters();saveData();render();});
const preview=()=>page.evaluate(()=>prepareDemoImport());
const stored=()=>page.evaluate(()=>JSON.stringify(state.data));
try{
await page.goto(origin+'/settlement-workbench.html');
await clean();
await page.evaluate(()=>{
 const p=(name,date,type,episodes)=>({id:SettlementIdentity.newId('project'),name,grade:'D',billingCategory:'automation',type,mode:'按时长',episodes:episodes||{1:{date,duration:'00:01:00',type,workType:'混音'}}});
 state.data.projects=[p('正式项目','2026-10-01','正式'),p('Demo','2026-10-02','Demo',{
 'demo:1':{date:'2026-10-02',duration:'00:01:00',type:'Demo',workType:'混音',demoName:'我的心',demoRevision:{take:1,version:1},demoSuperseded:true},
 'demo:2':{date:'2026-10-03',duration:'00:01:00',type:'Demo',workType:'混音',demoName:'我的心',demoRevision:{take:1,version:2}},
 'demo:3':{date:'2026-10-04',duration:'00:01:00',type:'Demo',workType:'混音',demoName:'很长的作品名称<安全显示>&其他文字',demoRevision:{take:2,version:3}}
 })];
 state.data.projects[1].demoBucket=true;
 state.data=normalizeData(state.data);settings.showCalendar=false;clearRecordFilters();render();
});
const before=await stored();
for(const view of ['detail','byProject','byGrade']){
 await test(view+'名称和编号位置',async()=>{
 await page.evaluate(view=>{switchTab(view);document.querySelectorAll('.view.active details').forEach(x=>x.open=true);document.querySelectorAll('.view.active .collapsed').forEach(x=>x.classList.remove('collapsed'));},view);
 const heads=await page.locator('.view.active th').allTextContents();assert.ok(heads.includes('集数'));assert.ok(!heads.includes('集号'));
 const r=await page.locator('.view.active .record-project').evaluateAll(els=>els.map(el=>({text:el.childNodes[0].textContent,number:el.parentElement.querySelector('.record-number')?.textContent,episode:el.parentElement.querySelector('.record-name')?.textContent,lines:[...el.querySelectorAll('small')].map(x=>({text:x.textContent,display:getComputedStyle(x).display})),align:getComputedStyle(el).textAlign})));
 const demo=r.find(x=>x.lines.some(y=>y.text==='V02'));assert.ok(demo);assert.equal(demo.number,'01');assert.equal(demo.text,'《我的心》');assert.equal(demo.episode,'EP01');assert.deepEqual(demo.lines.map(x=>x.text),['第一版','V02']);assert.ok(demo.lines.every(x=>x.display==='block'));assert.equal(demo.align,'center');
 assert.ok(r.some(x=>x.text==='《很长的作品名称<安全显示>&其他文字》'&&x.number==='02'));
 assert.equal(await stored(),before);
 });
}
await page.evaluate(()=>{switchTab('byProject');document.querySelectorAll('.view.active details').forEach(x=>x.open=true);document.querySelectorAll('.view.active .collapsed').forEach(x=>x.classList.remove('collapsed'));});
await page.screenshot({path:out+'/names-dark.png',fullPage:true});
await test('列宽分配及窄屏可读',async()=>{
 const widths=await page.locator('.view.active table').first().locator('col').evaluateAll(els=>els.map(x=>parseFloat(x.style.width)));
 assert.ok(Math.abs(widths.reduce((a,b)=>a+b,0)-100)<.1);
 await page.setViewportSize({width:1000,height:900});await page.screenshot({path:out+'/names-narrow.png',fullPage:true});
 assert.equal(await stored(),before);
});
await test('没有运行异常',async()=>assert.deepEqual(errors,[]));
}finally{
 await writeFile(out+'/results.json',JSON.stringify({results,errors,passed:results.filter(x=>x.passed).length,total:results.length},null,2));await browser.close();await new Promise(r=>server.close(r));
}
console.log('RESULT '+results.filter(x=>x.passed).length+'/'+results.length);if(results.some(x=>!x.passed))process.exitCode=1;
