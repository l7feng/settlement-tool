/* Formal deliveries: versioned replacements retain earlier work without double billing. */
// 版本号解析统一走 SettlementRevision（S2-2.1），此处只保留取文件名与转整数的语义。
function formalSourceVersion(record){return SettlementRevision.versionOf(record.sourceFile||record.sourcePath||'');}
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
  // D1（S2-2.5）：同一版本号 + 不同日期 = 版本号填错，不是两次交付。导入前就拦住，
  // 不让它变成第二条计费记录；提示里点名文件名，方便直接改版号。
  const datesByVersion=new Map();
  for(const c of row.candidates){
   const version=formalSourceVersion({sourceFile:c.file.name});
   if(c.role==='分轨'||!version)continue;
   const date=c.mmdd||c.fullDate||'';
   if(!datesByVersion.has(version))datesByVersion.set(version,new Map());
   const seen=datesByVersion.get(version);
   if(!seen.has(date))seen.set(date,c.file.name);
  }
  for(const [version,dates] of datesByVersion){
   if(dates.size<2)continue;
   const label=Number(row.episodeNo)?('第'+Number(row.episodeNo)+'集'):'本批';
   throw Error(label+'版本号 V'+String(version).padStart(2,'0')+' 出现在不同日期（'+[...dates.values()].join('、')+'）。'
     +'同版本不同日期一定是版本号填错，请把后交付的那个改成新版本号再导入。');
  }
  for(const c of row.candidates){
   const version=formalSourceVersion({sourceFile:c.file.name});
   if(c.role==='分轨'||!version)continue;
   // 同一次交付 = 同版本号 + 同日期
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
 // 唯一实现（S2-2.3）：全量、幂等、与「哪来的改动」无关。
 // 旧实现只看「导入/删除 标签 + 与 state.data 的差异」，导致编辑/纠正/恢复/重命名后旧版标记不更新；
 // 现在每次都按当前数据重算一遍：同一输入两次调用结果完全相同。
 for(const p of next.projects){
  if((p.type)==='Demo'&&p.demoBucket)continue;
  const groups=new Map();
  for(const [key,r] of Object.entries(p.episodes||{})){
   if((r.type||p.type)==='Demo')continue;
   const ep=formalEpisode(key,r),wt=workTypeOf(r),v=formalSourceVersion(r);
   if(ep==null||wt==='修改'||!v)continue;
   const g=ep+'|'+wt;if(!groups.has(g))groups.set(g,[]);groups.get(g).push({key,r,v});
  }
  for(const items of groups.values()){
   if(items.length<2)continue;
   items.sort((a,b)=>a.v-b.v||String(a.r.date||'').localeCompare(String(b.r.date||''))||String(a.key).localeCompare(String(b.key)));
   // D1（S2-2.5）：同一个版本号出现在两个不同日期 → 一定是版本号填错（忘了升版），
   // 但不是两次交付的钱。存量数据不静默计费也不静默置零：标待核对并写明冲突，由人改版本号。
   const datesByVersion=new Map();
   for(const it of items){const d=String(it.r.date||'');if(!datesByVersion.has(it.v))datesByVersion.set(it.v,new Set());datesByVersion.get(it.v).add(d);}
   let sameVersionDifferentDate=null;
   for(const [v,dates] of datesByVersion)if(dates.size>1)sameVersionDifferentDate=v;
   if(sameVersionDifferentDate!=null){
    for(const it of items)if(it.v===sameVersionDifferentDate){it.r.needsReview=true;it.r.versionConflict='V'+String(sameVersionDifferentDate).padStart(2,'0')+' 出现在不同日期';}
    continue;
   }
   const top=items.at(-1),second=items.at(-2);
   // 同版本 + 同日期 → 两条来源无法区分谁是最新，不猜也不报错阻塞保存：标待核对，由人在明细里选定。
   if(top.v===second.v&&String(top.r.date||'')===String(second.r.date||'')){
    for(const it of items){it.r.needsReview=true;it.r.versionConflict=true;}
    continue;
   }
   for(const it of items){
    const r=it.r;
    delete r.versionConflict;
    if(it===top){
     if(r.versionSuperseded){delete r.versionSuperseded;
      // 只有「规则自己置的零」才跟着撤销；人工置零保持不变（D3：谁最后改谁生效）。
      SettlementExclusion.clearAuto(r);}
    }else{
     r.versionSuperseded=true;
     // 人工已经表过态的记录，规则不再改它的 excluded，只在明细里显示「旧版本 / 人工覆盖」。
     if(!r.excludeManual)SettlementExclusion.setAuto(r,true,'旧交付版本（仅最高版本计费）');
    }
   }
  }
 }
 return next;
}
const versionOriginalCommit=commitDataChange;commitDataChange=function(next,label,preferences=null){
 // S2-2.3：不再按「导入/删除」标签路由——任何一次落账都无条件跑一遍幂等 reconcile，
 // 这样编辑、纠正、恢复、重命名之后旧版标记也跟得上；删除时另外补偿受影响的 Demo 分组。
 try{
  // normalizeData 内部已跑唯一 reconcile（S2-2.3），这里只补删除时的 Demo 分组补偿。
  next=normalizeData(next);
  if(label.includes('删除')){const remaining=new Set(next.projects.flatMap(p=>Object.values(p.episodes).map(r=>r.recordId))),removed=[];
   for(const p of state.data.projects)for(const [epNo,r]of Object.entries(p.episodes))if(!remaining.has(r.recordId)&&(r.type||p.type)==='Demo')removed.push({projName:p.name,epNo});
   if(removed.length)refreshAffectedDemos(next,removed);}
  return versionOriginalCommit(next,label,preferences);
 }catch(error){toast(error.message);return false;}
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
