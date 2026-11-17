/* Project records, import batches and their reversible workflows. */
const workflowImportLabels=new Set(['导入','多项目导入','Demo版本导入']);
const workflowPreviousCommit=commitDataChange;
commitDataChange=function(next,label,preferences=null){
 try{
  if(workflowImportLabels.has(label)){
   next=reconcileFormalVersions(normalizeData(next));
   const event=SettlementImportHistory.create(state.data,next,label,SettlementIdentity.newId('import'),new Date().toISOString());
   next.importHistory=[...(state.data.importHistory||[]),event];
  }
  return workflowPreviousCommit(next,label,preferences);
 }catch(error){toast(error.message);return false;}
};
function openImportHistory(){
 const events=[...(state.data.importHistory||[])].reverse();
 openModal('<h2>导入记录</h2><p class="review-hint">按批次查看项目与文件；回退前检查后续修改并预览。</p>'+(events.length?events.map(e=>'<details class="history-batch"><summary><span>'+esc(new Date(e.time).toLocaleString(uiLanguage==='en'?'en-GB':'zh-CN'))+'</span><small>'+esc(e.label)+' · '+e.projects.length+' 项目 · '+(e.fileCount??e.projects.reduce((n,p)=>n+p.records.length,0))+' 文件 · '+(e.status==='reverted'?'已回退':'已登记')+'</small></summary>'+e.projects.map(p=>'<details class="history-project"><summary><span class="history-project-name">'+esc(p.name)+'</span><small>'+p.records.length+' 条变更</small></summary>'+p.records.map(r=>{const row=r.after?JSON.parse(r.after):r.before;const kind=({added:'新增',replaced:'替换',updated:'更新信息',superseded:'旧版不计费',reinstated:'恢复计费',removed:'移除'})[r.kind]||'更新信息';return '<p class="source-path"><small class="history-change-kind">'+esc(kind)+'</small> '+esc(row?.sourceFile||row?.sourcePath||row?.label||r.keyAfter||r.keyBefore)+'</p>';}).join('')+'</details>').join('')+'<button class="btn secondary" '+(e.status==='reverted'?'disabled':'')+' onclick="previewImportRollback('+jsStr(e.id)+')">'+(e.status==='reverted'?'已回退':'预览回退')+'</button></details>').join(''):'<p class="empty-state">暂无导入批次。旧版本未记录批次，历史步骤无法准确回退；新版导入后开始记录。</p>')+'<div class="modal-actions"><button class="btn secondary" onclick="closeModal()">关闭</button></div>');
}
let workflowRollbackPlan=null;
function previewImportRollback(id){
 try{
  const plan=SettlementImportHistory.rollback(state.data,id,new Date().toISOString());
  workflowRollbackPlan={id,source:JSON.stringify(state.data)};
  const before=backupStats(state.data).amount,after=plan.next?backupStats(plan.next).amount:before;
  openModal('<h2>回退导入批次</h2>'+(plan.conflicts.length?'<p class="review-hint">存在后续修改，暂不覆盖。请先处理这些记录。</p><ul>'+plan.conflicts.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>':'<p>将恢复 '+plan.count+' 条批次变更，后续无关记录保留。</p><p class="review-summary">全部账目 ¥'+before.toFixed(2)+' → ¥'+after.toFixed(2)+'</p>')+'<div class="modal-actions"><button class="btn secondary" onclick="openImportHistory()">返回</button><button class="btn" '+(plan.conflicts.length?'disabled':'')+' onclick="confirmImportRollback()">确认回退</button></div>');
 }catch(error){toast(error.message);}
}
function confirmImportRollback(){
 try{const plan=workflowRollbackPlan;if(!plan||plan.source!==JSON.stringify(state.data))throw Error('账目已变化，请重新预览');const result=SettlementImportHistory.rollback(state.data,plan.id,new Date().toISOString());if(result.conflicts.length)throw Error('存在后续修改，请重新预览');if(commitDataChange(result.next,'恢复批次')){workflowRollbackPlan=null;openImportHistory();toast('该批次已回退，可撤销');}}catch(error){toast(error.message);}
}
function pickBatchImportMore(){
 const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.wav,.mp4';input.onchange=()=>{const files=[...input.files].filter(f=>/\.(wav|mp4)$/i.test(f.name)),parts=SettlementImportMetadata.partition(files,mediaSourcePath,state.data.projects),x=window._multiImport;if(parts.some(p=>p.type==='Demo'))return toast('Demo请使用独立Demo批量导入入口');x.revision=(x.revision||0)+1;x.preview=null;for(const part of parts){const own=x.groups.find(g=>g.name===part.name);if(own){own.files.push(...part.files);own.scan=scanFiles(own.files);}else x.groups.push(newBatchImportGroup(part.files,{...part,type:'正式'}));}renderMultiProjectImport();};input.click();
}
const workflowOriginalFiltered=getFilteredList;
getFilteredList=function(options){
 let rows=workflowOriginalFiltered();const version=document.getElementById('versionFilter')?.value||'',duration=document.getElementById('durationFilter')?.value||'';
 if(!(options&&options.includeSuperseded)&&!settings.showSuperseded)rows=rows.filter(e=>!isSupersededRecord(e));
 if(version)rows=rows.filter(e=>recordVersionLabel(e.proj.episodes[e.epNo],e.proj)===version);
 if(duration)rows=rows.filter(e=>e.sec===Number(duration));return rows;
};
function isSupersededRecord(e){const r=e.proj.episodes[e.epNo];return r.versionSuperseded===true||r.demoSuperseded===true||r.finalCutSuperseded===true;}
const workflowOriginalHasFilters=hasRecordFilters;hasRecordFilters=function(){return workflowOriginalHasFilters()||!!document.getElementById('versionFilter')?.value||!!document.getElementById('durationFilter')?.value;};
const workflowOriginalClearFilters=clearRecordFilters;clearRecordFilters=function(){for(const id of ['versionFilter','durationFilter'])if(document.getElementById(id))document.getElementById(id).value='';workflowOriginalClearFilters();};
function toggleSupersededVersions(){settings.showSuperseded=!settings.showSuperseded;saveSettings(settings);if(settings.showSuperseded){for(const e of workflowOriginalFiltered()){const pk=periodKey(e.date);state.collapsed['P:'+pk]=false;state.collapsed['X:'+pk+'|'+(e.type==='Demo'?'\u0000Demo':e.proj.name)]=false;state.collapsed['GP:'+e.proj.name]=false;state.collapsed['GP:Demo-group']=false;}}render();if(settings.showSuperseded)document.querySelectorAll('.view.active details.record-group').forEach(el=>el.open=true);}
function setDurationDisplay(value){settings.durationDisplay=value==='minutes'?'minutes':'duration';saveSettings(settings);render();}
let workflowModePlan=null;
function requestRecordModeChange(projName,epNo){
 const {p,r}=maintenanceRecord(state.data,{projName,epNo});workflowModePlan={item:{projName,epNo},source:JSON.stringify(state.data)};
 openModal('<h2>单条计价方式</h2><p><span class="history-project-name">'+esc(p.name)+'</span> · '+esc(recordLabel(epNo,r))+'</p><div class="form-row"><label for="singleRecordMode">计价方式</label><select id="singleRecordMode" onchange="previewRecordMode()"><option value="按时长">按时长</option><option value="按集">按集</option></select></div><p id="singleModePreview" class="review-summary"></p><div class="modal-actions"><button class="btn secondary" onclick="closeModal()">取消</button><button class="btn" id="singleModeConfirm" onclick="confirmRecordMode()" disabled>确认保存</button></div>');document.getElementById('singleRecordMode').value=r.mode||p.mode;previewRecordMode();
}
function previewRecordMode(){
 try{const plan=workflowModePlan;if(!plan||plan.source!==JSON.stringify(state.data))throw Error('账目已变化，请重新打开');const mode=document.getElementById('singleRecordMode').value,{p,r}=maintenanceRecord(state.data,plan.item),next=buildBatchCorrection([plan.item],{mode});document.getElementById('singleModePreview').textContent='当前记录 ¥'+next.before.toFixed(2)+' → ¥'+next.after.toFixed(2)+'；确认后保存，可撤销。';document.getElementById('singleModeConfirm').disabled=mode===(r.mode||p.mode);}catch(error){document.getElementById('singleModePreview').textContent=error.message;document.getElementById('singleModeConfirm').disabled=true;}
}
function confirmRecordMode(){
 const plan=workflowModePlan;if(!plan||plan.source!==JSON.stringify(state.data))return toast('账目已变化，请重新打开');try{const mode=document.getElementById('singleRecordMode').value,next=buildBatchCorrection([plan.item],{mode});if(commitDataChange(next.next,'切换单条计价方式')){workflowModePlan=null;closeModal();}}catch(error){toast(error.message);}
}
const workflowOriginalCell=epCellHtml;epCellHtml=function(e,key){return workflowOriginalCell(e,key).replace(/^<td/,'<td data-col="'+key+'" data-project="'+attrStr(e.proj.name)+'" data-record="'+attrStr(e.epNo)+'"');};
function workflowFilters(){
 for(const [id,label] of [['versionFilter','版本'],['durationFilter','时长']])if(!document.getElementById(id)){const div=document.createElement('div');div.className='filter-field';div.innerHTML='<label for="'+id+'">'+label+'：</label><select id="'+id+'" onchange="workflowFilterChanged(this.id)"><option value="">全部</option></select>';const clear=document.querySelector('#rightFilterBody [onclick="clearRecordFilters()"]');if(clear)clear.before(div);else document.getElementById('rightFilterBody').appendChild(div);}
 const rows=allEpisodes(),versions=[...new Set(rows.map(e=>recordVersionLabel(e.proj.episodes[e.epNo],e.proj)))].filter(v=>v!=='—').sort((a,b)=>Number(a.slice(1))-Number(b.slice(1))),durations=[...new Set(rows.map(e=>e.sec))].sort((a,b)=>a-b);
 for(const [id,values,label] of [['versionFilter',versions,v=>v],['durationFilter',durations,v=>settings.durationDisplay==='minutes'?(v/60).toFixed(2)+' 分钟':sec2str(v)]]){const select=document.getElementById(id),old=select.value;select.innerHTML='<option value="">全部</option>'+values.map(v=>'<option value="'+v+'">'+esc(label(v))+'</option>').join('');select.value=old;}
}
function workflowFilterChanged(id){if(id==='versionFilter'&&document.getElementById(id).value){settings.showSuperseded=true;saveSettings(settings);}render();}
function setLinkedRecordFilter(id,value){const select=document.getElementById(id);if(!select)return;if(id==='epFilter'){select.value=value;render();}else{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}closeRecordContext();}
function closeRecordContext(){document.getElementById('recordContextMenu')?.remove();}
document.addEventListener('contextmenu',event=>{
 const cell=event.target.closest('.view [data-col]');if(!cell)return;event.preventDefault();closeRecordContext();
 const column=cell.dataset.col,map={proj:'projFilter',grade:'gradeFilter',type:'typeFilter',work:'workFilter',billing:'billingFilter',mode:'modeFilter',version:'versionFilter',duration:'durationFilter'},id=map[column],menu=document.createElement('div');menu.id='recordContextMenu';menu.className='record-context';menu.setAttribute('role','menu');
 const add=(text,action)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('role','menuitem');b.onclick=action;menu.appendChild(b);};
 if(id){const select=document.getElementById(id);if(cell.tagName==='TD'){const {p,r}=maintenanceRecord(state.data,{projName:cell.dataset.project,epNo:cell.dataset.record}),value=({proj:p.name,grade:SettlementBilling.grade(p,r),type:r.type||p.type,work:workTypeOf(r),billing:isBillable(r)?'billable':'excluded',mode:r.mode||p.mode,version:recordVersionLabel(r,p),duration:String(t2sec(r.duration))})[column];add('按此值筛选：'+(id==='durationFilter'?sec2str(Number(value)):value),()=>setLinkedRecordFilter(id,value));}else for(const option of select.options)add(option.textContent,()=>setLinkedRecordFilter(id,option.value));add('清除此列筛选',()=>setLinkedRecordFilter(id,''));}
 else if(column==='date'&&cell.tagName==='TD'){const {r}=maintenanceRecord(state.data,{projName:cell.dataset.project,epNo:cell.dataset.record});add('筛选日期：'+r.date,()=>{document.getElementById('dateStart').value=r.date;document.getElementById('dateEnd').value=r.date;render();closeRecordContext();});}
 else if(column==='epNo'&&cell.tagName==='TD'){const {r}=maintenanceRecord(state.data,{projName:cell.dataset.project,epNo:cell.dataset.record});add('搜索：'+recordLabel(cell.dataset.record,r),()=>setLinkedRecordFilter('epFilter',recordLabel(cell.dataset.record,r)));}
 add('清空筛选',()=>{clearRecordFilters();closeRecordContext();});document.body.appendChild(menu);const z=uiLayoutScale(),box=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-box.width-8,event.clientX))/z+'px';menu.style.top=Math.max(8,Math.min(innerHeight-box.height-8,event.clientY))/z+'px';uiApplyLanguage();
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#recordContextMenu'))closeRecordContext();});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeRecordContext();});
function workflowRefresh(){
 workflowFilters();
 for(const th of document.querySelectorAll('.view th[data-col="duration"]')){const nextMode=settings.durationDisplay==='minutes'?'duration':'minutes';th.innerHTML='<button type="button" class="duration-choice" aria-label="时长显示方式（左键切换）" title="左键切换：时长 ⇄ 分钟" style="cursor:pointer;padding:2px 6px;font:inherit;color:inherit;background:transparent;border:0" onclick="setDurationDisplay(\''+nextMode+'\')">'+(settings.durationDisplay==='minutes'?'分钟':'时长')+' ⇄</button>';}
 const raw=workflowOriginalFiltered().filter(e=>!state.selectedDate||e.date===state.selectedDate),old=raw.filter(isSupersededRecord).length,b=document.getElementById('versionRowsButton');b.textContent=(settings.showSuperseded?'收起原记录':'查看被替换的原记录')+'（'+old+'）';b.style.display=old?'':'none';b.disabled=!old;b.setAttribute('aria-pressed',String(!!settings.showSuperseded));
 const modeButton=document.getElementById('recordModeFilterButton');if(modeButton){const value=document.getElementById('modeFilter')?.value||'';modeButton.textContent='计价方式：'+(value||'全部');modeButton.setAttribute('aria-pressed',String(!!value));}
 for(const tr of document.querySelectorAll('.view tbody tr')){const cell=tr.querySelector('[data-project][data-record]');if(!cell)continue;const p=state.data.projects.find(p=>p.name===cell.dataset.project),r=p?.episodes[cell.dataset.record];tr.classList.toggle('superseded-row',!!(r&&(r.versionSuperseded||r.demoSuperseded)));}
}
const historyButton=document.createElement('button');historyButton.id='importHistoryButton';historyButton.className='btn secondary';historyButton.textContent='导入记录';historyButton.onclick=openImportHistory;document.getElementById('themeQuickBtn').before(historyButton);
const versionButton=document.createElement('button');versionButton.id='versionRowsButton';versionButton.className='btn secondary';versionButton.title='查看被新版本或成片替换的原记录：仅查看、不计价、不进汇总';versionButton.onclick=toggleSupersededVersions;document.getElementById('recordSortButton').after(versionButton);
// 计价方式快筛：单击在全部、按集、按时长之间切换，与右侧筛选面板同步。
const modeFilterButton=document.createElement('button');modeFilterButton.id='recordModeFilterButton';modeFilterButton.className='btn secondary';modeFilterButton.title='按计价方式筛选：单击在全部、按集、按时长之间切换';modeFilterButton.onclick=cycleRecordModeFilter;versionButton.after(modeFilterButton);
function cycleRecordModeFilter(){
 const select=document.getElementById('modeFilter');if(!select)return;
 const order=['','按集','按时长'],current=order.indexOf(select.value),next=order[(current+1)%order.length];
 select.value=next;select.dispatchEvent(new Event('change',{bubbles:true}));
}
// 重复集数检查：同一项目内归一集号出现多条记录时列出并可一键只保留一条计费。
let duplicateGroupsCache=[];
function projectModeStats(project){
 const counts=new Map();
 for(const record of Object.values((project&&project.episodes)||{})){const mode=record.mode||project.mode;if(!mode)continue;counts.set(mode,(counts.get(mode)||0)+1);}
 return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));
}
function projectDominantMode(project){
 const stats=projectModeStats(project);
 return stats.length?stats[0][0]:(project&&project.mode)||'';
}
function unifyProjectMode(project,mode){
 if(!project||!mode)return false;
 let changed=project.mode!==mode;
 project.mode=mode;
 for(const record of Object.values(project.episodes||{}))if(record.mode!==mode){record.mode=mode;changed=true;}
 return changed;
}
function duplicateReport(){
 const groups=[];
 for(const project of state.data.projects)for(const group of SettlementVersion.duplicateGroups(project))groups.push({project,identity:group.identity,items:group.items});
 return groups;
}
function openDuplicateCheck(){
 duplicateGroupsCache=duplicateReport();
 let totalBefore=0,totalAfter=0,totalCount=0;
 const body=duplicateGroupsCache.length?duplicateGroupsCache.map((g,gi)=>{
  const unifyMode=projectDominantMode(g.project);
  const keep=SettlementVersion.preferredRecord(g.project,g.items,unifyMode);
  let groupBefore=0,groupAfter=0;
  const rows=g.items.map(it=>{const r=it.record;const fee=feeOf(g.project,r);const rm=r.mode||g.project.mode;const mismatch=rm!==unifyMode;
   if(isBillable(r)){groupBefore+=fee;if(it.key===keep.key)groupAfter+=fee;}
   return `<tr class="${it.key===keep.key?'dup-keep':'dup-drop'}"><td>${esc(it.key)}</td><td>${esc(r.sourceFile||'（手工登记，无来源文件）')}</td><td>${esc(r.date)}</td><td>${esc(r.duration)}</td><td class="${mismatch?'mode-mismatch':''}">${esc(rm)}${mismatch?'<small>与统一后的「'+esc(unifyMode)+'」不一致，将删除</small>':''}</td><td>${esc(workTypeOf(r))}</td><td>¥${fee.toFixed(2)}</td><td>${it.key===keep.key?'<b>保留</b>':'将删除'}</td></tr>`;}).join('');
  totalBefore+=groupBefore;totalAfter+=groupAfter;totalCount+=g.items.length-1;
  return `<details class="duplicate-group"><summary><span>${esc(g.project.name)} · ${esc(g.identity)}</span><small>${g.items.length}条记录 · 保留 ${esc(keep.key)} · 删除后少计 ¥${(groupBefore-groupAfter).toFixed(2)}</small></summary><table class="duplicate-table"><thead><tr><th>记录键</th><th>来源</th><th>日期</th><th>时长</th><th>计价方式</th><th>工作类型</th><th>金额</th><th>处理</th></tr></thead><tbody>${rows}</tbody></table><div class="duplicate-actions"><button class="btn secondary" onclick="repairDuplicateGroup(${gi})">删除这组多余记录</button></div></details>`;
 }).join(''):'<p class="review-hint">没有发现会重复计价的同集记录。</p>';
 const summary=duplicateGroupsCache.length?`<p class="review-summary">${duplicateGroupsCache.length} 组重复 · ${totalCount} 条多余记录 · 多计 ¥${(totalBefore-totalAfter).toFixed(2)}（合计 ¥${totalBefore.toFixed(2)} → ¥${totalAfter.toFixed(2)}）</p>`:'';
 openModal('<h2>重复集数检查</h2><p class="review-hint">同一项目内同一集号出现多条“都会计价”的记录时列出（正常的多版本交付与“修改”不计价，不算重复）；「删除多余记录」会真正删除除保留项外的记录，删除后可撤销。</p>'+body+summary+(duplicateGroupsCache.length?'<div class="modal-actions"><button class="btn" onclick="repairAllDuplicateGroups()">全部删除多余记录</button><button class="btn secondary" onclick="closeModal()">关闭</button></div>':'<div class="modal-actions"><button class="btn secondary" onclick="closeModal()">关闭</button></div>'));
}
function repairDuplicateGroups(indices){
 const next=normalizeData(state.data);
 let changed=0,before=0;
 const affected=[];
 for(const index of indices){
  const group=duplicateGroupsCache[index];if(!group)continue;
  const keep=SettlementVersion.preferredRecord(group.project,group.items,projectDominantMode(group.project));
  const project=next.projects.find(p=>p.id===group.project.id||p.name===group.project.name);if(!project)continue;
  if(!affected.includes(project))affected.push(project);
  for(const item of group.items){
   if(item.key===keep.key)continue;
   const record=project.episodes[item.key];if(!record)continue;
   before+=feeOf(project,record);
   delete project.episodes[item.key];changed++;
  }
 }
 const unified=[];
 for(const project of affected){
  const stats=projectModeStats(project);
  if(stats.length>1){const mode=stats[0][0];if(unifyProjectMode(project,mode))unified.push(project.name+'→'+mode);}
 }
 if(!changed)return toast('没有需要删除的重复记录');
 const extra=unified.length?'；并统一计价方式：'+unified.join('、'):'';
 if(commitDataChange(next,'删除重复记录')){openDuplicateCheck();toast('已删除 '+changed+' 条重复记录（原金额 ¥'+before.toFixed(2)+'）'+extra+'，可撤销');}
}
function repairDuplicateGroup(index){repairDuplicateGroups([index]);}
function repairAllDuplicateGroups(){
 if(!duplicateGroupsCache.length)return toast('没有重复记录');
 if(!confirm('删除全部 '+duplicateGroupsCache.length+' 组重复记录中多余的记录？删除后可撤销。'))return;
 repairDuplicateGroups(duplicateGroupsCache.map((_,i)=>i));
}
workflowFilters();const workflowOriginalRender=render;render=function(){workflowOriginalRender();workflowRefresh();uiApplyLanguage();};
if(!document.getElementById('duplicateCheckButton')){const maintenance=document.getElementById('inlineMaintenance');const duplicateButton=document.createElement('button');duplicateButton.id='duplicateCheckButton';duplicateButton.className='btn secondary';duplicateButton.textContent='检查重复集数';duplicateButton.onclick=openDuplicateCheck;if(maintenance)maintenance.appendChild(duplicateButton);}
const workflowStyle=document.createElement('style');workflowStyle.textContent=`
html:root body .gui-panel.gui-docked{border-radius:12px!important;border:1px solid var(--line)!important;background:color-mix(in srgb,var(--white) clamp(8%,calc(var(--material-opacity,88%) - 55%),43%),transparent)!important;backdrop-filter:none!important;box-shadow:none!important}
html:root body .gui-panel .side-head{padding:12px!important;border:0!important;border-bottom:1px solid var(--line)!important;background:color-mix(in srgb,var(--text) 3%,transparent)!important;border-radius:11px 11px 0 0!important}
html:root body .gui-panel .side-group{background:transparent!important;border:0!important;margin:0!important;border-radius:0!important}
html:root body .gui-panel .side-group>summary{padding:12px 4px!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important}
html:root body #rightPanel .filter-field{border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;margin:0!important;padding:10px 0!important;background:transparent!important;box-shadow:none!important}
body .gui-panel :is(input,select,.btn.secondary,#leftNavBody .tab){border-radius:8px!important}html:root body.reduce-material .gui-panel{background:var(--white)!important}
.batch-import-groups .project-draft{padding:0;overflow:hidden;border-radius:12px;border-color:var(--line)}.batch-import-groups .project-draft>summary{display:flex;align-items:center;gap:12px;padding:12px 16px!important;border:0!important;border-radius:11px!important;background:color-mix(in srgb,var(--text) 3%,transparent)!important;box-shadow:none!important;backdrop-filter:none!important}.import-group-title{flex:1;min-width:0;font-weight:600}.import-group-title small{margin-left:10px;color:var(--muted);font-weight:400}.import-remove-btn{width:30px!important;min-width:30px;padding:0!important;height:30px;border-radius:8px!important;background:transparent!important;font-size:20px!important}.batch-import-groups .project-draft>.form-row,.batch-import-groups .project-draft>.review-hint,.batch-import-groups .project-draft>details{margin:12px 16px}
.batch-search{display:grid;grid-template-columns:1fr 1fr;gap:12px}.batch-search label{font-size:13px;color:var(--muted)}.batch-search input{display:block;width:100%;margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--input);color:var(--text);font:inherit}.batch-search input:focus{outline:2px solid var(--main);outline-offset:1px}.edit-project{border:1px solid var(--line);border-radius:10px;margin:8px 0}.edit-project>summary{display:flex;gap:10px;align-items:center;padding:10px;cursor:pointer}.edit-project-name{flex:1;font-weight:600}.edit-project>summary small{color:var(--muted)}.edit-record{border-top:1px solid var(--line);margin:0!important;padding:10px!important}.edit-record[hidden],.edit-project[hidden]{display:none!important}.maintenance-pick-list .edit-record{display:flex;gap:10px;align-items:flex-start}.edit-record span{min-width:0;display:flex;flex-direction:column;gap:3px}.edit-record .source-path{font-size:12px}.bulk-edit-fields{border-top:1px solid var(--line);padding-top:12px;margin:14px 0}.bulk-edit-fields>summary{cursor:pointer;font-weight:600;padding:8px 0}
.history-batch,.history-project{border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0}.history-batch>summary,.history-project>summary{cursor:pointer;display:flex;gap:12px;justify-content:space-between}.history-batch small,.history-project small{color:var(--muted)}.history-batch>.btn{margin-top:12px}.history-change-kind{display:inline-block;min-width:62px;color:var(--muted);margin-right:6px}.history-project-name,.import-project-name,.edit-project-name{min-width:0;overflow-wrap:anywhere}
.record-context{position:fixed;z-index:400;min-width:180px;max-width:320px;max-height:min(360px,calc(var(--ui-viewport-height,100dvh) - 16px));overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--white);padding:5px;box-shadow:0 12px 36px #0005}.record-context button{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--text);padding:8px 10px;border-radius:6px}.record-context button:hover{background:var(--input)}.duration-choice{max-width:90px;min-width:0!important;padding:4px 6px!important}.record-mode-button{border:0;background:transparent;color:var(--text);font:inherit;cursor:pointer;padding:4px}.record-mode-button:hover{background:var(--input)}.superseded-row{color:var(--muted)}
.duplicate-group{border:1px solid var(--line);border-radius:10px;padding:10px;margin:10px 0}.duplicate-group>summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer}.duplicate-group small{color:var(--muted)}.duplicate-table{width:100%;margin-top:8px;font-size:13px}.duplicate-table th,.duplicate-table td{padding:5px 6px;text-align:left;border-bottom:1px solid var(--line)}.duplicate-actions{margin-top:8px;display:flex;gap:8px}.duplicate-table tr.dup-keep{background:color-mix(in srgb,var(--ok,#2e9e5b) 10%,transparent)}.duplicate-table tr.dup-drop{background:color-mix(in srgb,var(--danger,#c0392b) 10%,transparent)}.duplicate-table td.mode-mismatch{color:var(--work-revise,#B4600F);font-weight:600}.duplicate-table td.mode-mismatch small{display:block;color:var(--muted);font-weight:400}
`;document.head.appendChild(workflowStyle);render();
