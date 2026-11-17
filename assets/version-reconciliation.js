/* Formal deliveries: versioned replacements retain earlier work without double billing. */
function formalSourceVersion(record){const name=String(record.sourceFile||record.sourcePath||'').replace(/\\/g,'/').split('/').at(-1);return Number(name.match(/(?:^|[^a-z0-9])v(\d+)(?=$|[^0-9])/i)?.[1]||0);}
function formalEpisode(key,r){const v=r?.episodeNo;if(v!=null&&/^\d+$/.test(String(v)))return String(Number(v));return /^\d+$/.test(String(key))?String(Number(key)):null;}
function formalDefaultAction(row,config,project){
 const key=importStorageKey(row,config);if(!project)return 'add';
 const candidate=row.candidates[row.selected],number=String(Number(row.episodeNo));
 const matched=Object.entries(project.episodes).filter(([k,r])=>(r.type||project.type)==='正式'&&formalEpisode(k,r)===number);
 const records=matched.filter(([,r])=>workTypeOf(r)==='混音').map(([,r])=>r);
 const version=formalSourceVersion({sourceFile:candidate.file.name});
 // 完全相同的来源文件已登记过：跳过（按文件名判断，导入根目录可能与当初不同）。
 const sameFile=records.some(r=>r.sourceFile&&r.sourceFile===candidate.file.name);
 if(sameFile)return 'skip';
 if(matched.length){
  // 记住同集既有记录的键，供“更新替换”精确命中历史键（如 '02'），不新增第二条。
  row.targetKey=importExistingKey(row,config,project);
  const versioned=records.filter(r=>formalSourceVersion(r)>0);
  // 同集已有带版本号的交付：另存新版本，旧版本保留（只对最高有效版计费）。
  if(version&&versioned.length)return 'append';
  // 同集已有记录：默认跳过，避免重复计费；需要替换时在预览里选“更新已有”。
  return 'skip';
 }
 return project.episodes[key]?'skip':'add';
}
// 同集既有记录的键（'02' 与 '2' 视为同一集），用于更新替换与重复提示。
function importExistingKey(row,config,project){
 const key=importStorageKey(row,config);
 if(project?.episodes?.[key])return key;
 if(!row.episodeNo)return null;
 const number=String(Number(row.episodeNo));
 const matched=Object.entries(project?.episodes||{}).filter(([k,r])=>(r.type||project.type)==='正式'&&formalEpisode(k,r)===number);
 if(!matched.length)return null;
 return (matched.find(([,r])=>!formalSourceVersion(r))||matched[0])[0];
}
// 更新既有记录时使用命中的历史键，避免同一集出现第二条记录。
function importTargetKey(row,config,project){
 if(row.action==='update'){
  const existing=row.targetKey&&project?.episodes?.[row.targetKey]?row.targetKey:importExistingKey(row,config,project);
  if(existing){row.targetKey=existing;return existing;}
 }
 return importStorageKey(row,config);
}
function expandFormalVersionRows(rows,config,project){
 if(config.type!=='正式')return rows;
 return rows.flatMap(row=>{
  const versions=new Map();
  for(const c of row.candidates){
   const version=formalSourceVersion({sourceFile:c.file.name});
   if(c.role==='分轨'||!version)continue;
   // 同一次交付 = 同版本号 + 同日期；同版本号不同日期是两次交付，必须分别保留。
   const gkey=version+'|'+(c.mmdd||c.fullDate||'');
   if(!versions.has(gkey))versions.set(gkey,[]);
   versions.get(gkey).push(c);
  }
  if(versions.size<2)return [{...row,action:row.action||formalDefaultAction(row,config,project)}];
  return [...versions].sort((a,b)=>{
   const av=Number(a[0].split('|')[0]),bv=Number(b[0].split('|')[0]);
   if(av!==bv)return bv-av;
   return String(a[0].split('|')[1]||'').localeCompare(String(b[0].split('|')[1]||''));
  }).map(([gkey,candidates],i)=>{
   const version=Number(gkey.split('|')[0]);
   const best=candidates.reduce((a,b)=>preferImportCandidate(b,a)>0?b:a),r={...row,candidates,selected:candidates.indexOf(best),...deliveryDateInfo(best,config),retainedVersion:version};
   r.action=formalDefaultAction(r,config,project);
   if(!project?.episodes[importStorageKey(r,config)]&&r.action==='add'&&i>0)r.action='append';
   if(r.action==='update'&&i>0)r.action='append';
   r.recommendedAction=r.action;return r;
  });
 });
}
function reconcileFormalVersions(next){
 for(const p of next.projects){const old=state.data.projects.find(q=>q.id===p.id)||{episodes:{}};const affected=new Set();
  for(const [key,r] of Object.entries(p.episodes)){const before=Object.values(old.episodes).find(e=>e.recordId===r.recordId);if((r.type||p.type)==='正式'&&formalEpisode(key,r)&&formalSourceVersion(r)>0&&(!before||r.sourceFile!==before.sourceFile))affected.add(JSON.stringify([formalEpisode(key,r),workTypeOf(r)]));}
  const remaining=new Set(Object.values(p.episodes).map(r=>r.recordId));for(const [key,r]of Object.entries(old.episodes))if(!remaining.has(r.recordId)&&(r.type||old.type)==='正式'&&formalEpisode(key,r)&&formalSourceVersion(r)>0)affected.add(JSON.stringify([formalEpisode(key,r),workTypeOf(r)]));
  for(const identity of affected){const rows=Object.entries(p.episodes).filter(([key,r])=>(r.type||p.type)==='正式'&&JSON.stringify([formalEpisode(key,r),workTypeOf(r)])===identity&&formalSourceVersion(r)>0&&workTypeOf(r)!=='修改'&&(!r.excluded&&r.billable!==false||r.versionSuperseded)).map(([,r])=>r);
   rows.sort((a,b)=>formalSourceVersion(a)-formalSourceVersion(b)||a.date.localeCompare(b.date));
   if(rows.length>1&&formalSourceVersion(rows.at(-1))===formalSourceVersion(rows.at(-2))&&rows.at(-1).date===rows.at(-2).date)throw Error(p.name+'同集最高版本有多个相同日期文件，请先选定一个');
   for(const r of rows)if(r===rows.at(-1)){if(r.versionSuperseded){delete r.versionSuperseded;r.excluded=false;r.excludeReason='';}}else{r.versionSuperseded=true;r.excluded=true;r.excludeReason='旧交付版本（仅最高版本计费）';}
  }
 }
 return next;
}
const versionOriginalCommit=commitDataChange;commitDataChange=function(next,label,preferences=null){
 try{if(label.includes('导入')||label.includes('删除')){next=reconcileFormalVersions(normalizeData(next));if(label.includes('删除')){const remaining=new Set(next.projects.flatMap(p=>Object.values(p.episodes).map(r=>r.recordId))),removed=[];for(const p of state.data.projects)for(const [epNo,r]of Object.entries(p.episodes))if(!remaining.has(r.recordId)&&(r.type||p.type)==='Demo')removed.push({projName:p.name,epNo});if(removed.length)refreshAffectedDemos(next,removed);}}return versionOriginalCommit(next,label,preferences);}catch(error){toast(error.message);return false;}
};
function formalPreviewTotals(groups){
 const next=normalizeData(state.data),refs=new Map();let index=0;
 for(const g of groups){const c=g.config;let p=next.projects.find(p=>p.name===c.name);if(!p){p={id:SettlementIdentity.legacyId('project',['preview',c.name]),name:c.name,billingCategory:c.billingCategory,grade:c.grade,type:c.type,mode:c.mode,gradeRanges:c.gradeRanges||'',episodes:{}};next.projects.push(p);}
  for(const row of g.rows){if(row.action==='skip')continue;let key=importTargetKey(row,c,p);const existing=p.episodes[key],recordId=row.action==='update'?existing?.recordId:SettlementIdentity.legacyId('record',['preview',p.id,key,index++]);if(row.action==='append')key='preview:'+recordId;p.episodes[key]={...importRowRecord(row,c),recordId};refs.set(row,{p,r:p.episodes[key]});}
 }
 reconcileFormalVersions(next);return {fees:new Map([...refs].map(([row,v])=>[row,feeOf(v.p,v.r)])),before:backupStats(state.data).amount,after:backupStats(next).amount,old:next.projects.reduce((n,p)=>n+Object.values(p.episodes).filter(r=>r.versionSuperseded).length,0)};
}
function formalPreviewNote(groups,host){try{const result=formalPreviewTotals(groups),delta=result.after-result.before;const text='最高版本计费校验：全部账目 ¥'+result.before.toFixed(2)+' → ¥'+result.after.toFixed(2)+'；旧交付版本 '+result.old+' 条不计费（已有手动排除保持）。识别到更高版本建议另存并将旧版置零，确认后才更新。';let note=document.getElementById('formalVersionPreview');if(!note){note=document.createElement('p');note.id='formalVersionPreview';note.className='review-summary';host.after(note);}note.textContent=text;
 const deltaNode=document.getElementById('importDelta');if(deltaNode)deltaNode.textContent='版本校验后结算变化：¥'+delta.toFixed(2);
 const tables=[...document.querySelectorAll('#modalBox .import-table,#modalBox .batch-preview-table')];let amount=0,count=0;groups.forEach((g,gi)=>g.rows.forEach((row,ri)=>{const fee=result.fees.get(row)||0;if(row.action!=='skip'){count++;amount+=fee;}const tr=tables[gi]?.querySelectorAll('tbody tr')[ri];if(tr)tr.lastElementChild.textContent='¥'+fee.toFixed(2);}));
 const summary=[...document.querySelectorAll('#modalBox p.review-summary')].find(el=>el.id!=='formalVersionPreview');if(summary)summary.textContent='选入'+count+'条 · 选入版本计价 ¥'+amount.toFixed(2)+' · 本次金额变化 ¥'+delta.toFixed(2);
 }catch(error){toast(error.message);document.querySelectorAll('#modalBox button[onclick^="confirm"]').forEach(b=>b.disabled=true);}}

const versionSinglePreview=renderImportPreview;renderImportPreview=function(){versionSinglePreview();formalPreviewNote([window._importPreview],document.getElementById('importDelta'));};
const versionMultiPreview=renderMultiProjectPreview;renderMultiProjectPreview=function(){versionMultiPreview();formalPreviewNote(window._multiImport.preview.groups,document.querySelector('#modalBox h2'));};
