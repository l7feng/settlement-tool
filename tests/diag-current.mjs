import {chromium} from './playwright-runtime.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const web=process.env.SETTLEMENT_WEB_ROOT||'D:/Ai-Files/Tools/Html/settlement-tool';
const out=process.env.SETTLEMENT_EVIDENCE||'D:/Ai-Files/Repos/GitHub/settlement-tool/build/diag-20261030';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=resolve(web,'.'+new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const page=await context.newPage();page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push('console:'+m.text());});
await context.addInitScript(()=>{localStorage.setItem('settlement-settings-v1',JSON.stringify({showCalendar:true,materialReduced:false}));});
await page.goto(origin+'/settlement-workbench.html');
// inject real workspace
const ws=JSON.parse(await readFile('C:/Users/Administrator/AppData/Local/SettlementTool/workspace.json','utf8'));
const data=JSON.parse(ws.storage['settlement_v1']);
await page.evaluate(d=>{localStorage.setItem('settlement_v1',JSON.stringify(d));},data);
await page.reload();
await page.waitForTimeout(400);

const info=await page.evaluate(()=>{
  const out={projects:state.data.projects.length};
  const target=state.data.projects.find(p=>p.name==='如何打破她的贞洁誓言');
  const eps=Object.entries(target.episodes).map(([k,e])=>({k,wt:e.workType,excl:e.excluded,mode:e.mode,grade:e.grade,fee:SettlementBilling.fee(state.data.prices,target,e,state.data.premiumPrices),billable:SettlementBilling.isBillable(e)}));
  out.target={count:eps.length,sum:eps.reduce((n,r)=>n+r.fee,0),billable:eps.filter(r=>r.billable).length};
  // what views show
  out.allEpisodes=state.data.projects.map(p=>{const list=allEpisodes().filter(e=>e.proj.name===p.name);return {name:p.name,n:list.length,fee:Math.round(list.reduce((s,e)=>s+e.fee,0)*100)/100,billed:list.filter(e=>e.billable).length};});
  return out;
});
console.log(JSON.stringify(info,null,1).slice(0,6000));
console.log('ERRORS:',errors);
// byProject group for target
await page.evaluate(()=>{switchTab('byProject');});
await page.waitForTimeout(200);
const group=await page.evaluate(()=>{
  const el=[...document.querySelectorAll('#view-byProject details')].find(d=>d.textContent.includes('打破她的贞洁誓言'));
  if(!el)return null;
  return {summary:el.querySelector('summary').innerText};
});
console.log('GROUP:',JSON.stringify(group));
await page.screenshot({path:out+'/byproject.png',fullPage:false});
// calendar for 心剑
await page.evaluate(()=>{switchTab('calendar');state.calYear=2026;state.calMonth=9;state.selectedDate=null;render();});
await page.waitForTimeout(200);
const cal=await page.evaluate(()=>[...document.querySelectorAll('.cal-cell')].map(c=>({d:c.querySelector('.dow')?.textContent,txt:c.querySelector('.eplist')?.innerText||'',foot:c.querySelector('.cellfoot')?.innerText||''})).filter(x=>x.txt));
console.log('CALENDAR:');for(const c of cal)console.log(' ',c.d,'|',JSON.stringify(c.txt),'|',JSON.stringify(c.foot));
await page.screenshot({path:out+'/calendar.png'});
await browser.close();await new Promise(r=>server.close(r));
