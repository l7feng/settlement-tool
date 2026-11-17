/* Filename calibration and bulk edits use the same validated, undoable transaction. */
function maintenanceItems(scope='all') {
 if(scope==='selected')return selectedRecordItems();
 return (scope==='filtered'?displayedRecords():allEpisodes()).map(e=>({projName:e.proj.name,epNo:e.epNo}));
}
function maintenanceRecord(data,item){const p=data.projects.find(p=>p.name===item.projName),r=p?.episodes[item.epNo];if(!r)throw Error('记录已变化，请重新打开');return {p,r};}
function maintenanceChecked(data){const checked=validateBackup(data);if(!checked.ok)throw Error(checked.error);return checked.data;}
function maintenanceTotals(next){return {before:backupStats(state.data).amount,after:backupStats(next).amount};}
function refreshAffectedDemos(next,items){
 const names=new Set(),ids=new Set();for(const it of items){const {p,r}=maintenanceRecord(state.data,it);ids.add(r.recordId);if((r.type||p.type)==='Demo')names.add(demoWorkKey(demoWorkName(p,r)));}
 for(const p of next.projects)for(const r of Object.values(p.episodes))if(ids.has(r.recordId)&&(r.type||p.type)==='Demo')names.add(demoWorkKey(demoWorkName(p,r)));
 for(const key of names){const versions=[];for(const p of next.projects)for(const r of Object.values(p.episodes))if((r.demoRevision||r.demoSuperseded||/demo|试听|样片/i.test(r.sourceFile||''))&&(r.type||p.type)==='Demo'&&demoWorkKey(demoWorkName(p,r))===key&&workTypeOf(r)!=='修改'&&((!r.excluded&&r.billable!==false)||r.demoSuperseded))versions.push({p,r,revision:recordDemoRevision(p,r),date:r.date});
  versions.sort(compareDemoRevision);if(versions.length>1&&compareDemoRevision(versions.at(-1),versions.at(-2))===0)throw Error('Demo最新版日期和版本冲突，请分别调整后重试');
  for(const v of versions)if(v===versions.at(-1)){if(v.r.demoSuperseded){delete v.r.demoSuperseded;v.r.excluded=false;v.r.excludeReason='';}}else{v.r.demoSuperseded=true;v.r.excluded=true;v.r.excludeReason='Demo旧版本（仅最新版计费）';}
 }
}
function moveMaintenanceRecord(next,item,name){
 const {p,r}=maintenanceRecord(next,item);if(p.name===name)return;
 if((r.type||p.type)==='Demo')throw Error('Demo按作品统一分组，请在Demo导入中核对作品名');
 let target=next.projects.find(p=>p.name===name||p.aliases?.includes(name));
 if(!target){target={...p,id:SettlementIdentity.legacyId('project',['maintenance',p.id,name]),name,aliases:[],shortName:'',episodes:{}};next.projects.push(target);}
 if(target.demoBucket||target.type==='Demo')throw Error('正式记录不能移入Demo容器');
 if(!allowedGrades(target).includes(r.grade||p.grade))throw Error('目标项目等级不兼容，请先调整项目类别或等级');
 // Pin inherited billing fields before moving a subset of a project.
 r.grade=r.grade||p.grade;r.mode=r.mode||p.mode;r.type=r.type||p.type;
 let key=item.epNo;if(Object.hasOwn(target.episodes,key))key='work:'+r.recordId;
 if(Object.hasOwn(target.episodes,key))throw Error('目标项目已有相同记录编号');
 target.episodes[key]=r;delete p.episodes[item.epNo];
}

const originalBuildBatchCorrection=buildBatchCorrection;
buildBatchCorrection=function(items,patch){
 const {projectName,episodeNo,recordName,...fields}=patch;
 if(projectName!==undefined&&(!projectName.trim()||projectName.length>200))throw Error('项目名称须为1–200字');
 if(episodeNo!==undefined&&!/^\d+$/.test(episodeNo))throw Error('集数应为非负整数');
 if(recordName!==undefined&&(!recordName.trim()||recordName.length>200))throw Error('作品名称须为1–200字');
 if(!Object.keys(patch).length)throw Error('请至少选择一项要编辑的信息');
 const unique=[...new Map(items.map(it=>[JSON.stringify(it),it])).values()];if(!unique.length)throw Error('请先选择记录');
 const next=Object.keys(fields).length?originalBuildBatchCorrection(unique,fields).next:normalizeData(state.data);
 for(const it of unique){const {p,r}=maintenanceRecord(next,it),demo=(r.type||p.type)==='Demo';
  if(episodeNo!==undefined){if(demo)throw Error('Demo保留作品名称，不能批量设置正式集数');r.episodeNo=String(Number(episodeNo));r.label='EP'+r.episodeNo;}
  if(recordName!==undefined){if(!demo)throw Error('正式记录请修改集数，作品名称仅用于Demo');r.demoName=recordName.trim();r.demoWorkKey=demoWorkKey(r.demoName);const rev=recordDemoRevision(p,r);r.label=r.demoName+' · '+demoTakeLabel(rev.take)+' / V'+String(rev.version).padStart(2,'0');if(r.sourceFile)r.demoFingerprint=demoFingerprint(r.demoName,rev.take,rev.version,r.sourceFile);}
 }
 if(projectName!==undefined){
  if(unique.some(it=>{const {p,r}=maintenanceRecord(next,it);return (r.type||p.type)==='Demo';}))throw Error('Demo请修改作品名，不能移入正式项目');
  const sources=[...new Set(unique.map(it=>it.projName))];
  const whole=sources.length===1&&unique.length===Object.keys(next.projects.find(p=>p.name===sources[0]).episodes).length;
  const p=next.projects.find(p=>p.name===sources[0]);
  if(whole&&!p.demoBucket&&!next.projects.some(q=>q.name===projectName.trim())){const old=p.name;p.name=projectName.trim();p.shortName='';p.aliases=[...new Set([...(p.aliases||[]),old])].filter(a=>a!==p.name);}
  else for(const it of unique)moveMaintenanceRecord(next,it,projectName.trim());
 }
 if(fields.date!==undefined||fields.type!==undefined||fields.workType!==undefined||fields.excluded!==undefined||recordName!==undefined){
  refreshAffectedDemos(next,unique);
 }
 const totals=maintenanceTotals(next),before=unique.reduce((sum,it)=>{const {p,r}=maintenanceRecord(state.data,it);return sum+feeOf(p,r);},0);
 return {next:maintenanceChecked(next),before,after:Math.round((before+totals.after-totals.before)*100)/100};
};
const originalReadCorrectionPatch=readCorrectionPatch;
readCorrectionPatch=function(){const patch=originalReadCorrectionPatch();for(const key of ['projectName','episodeNo','recordName']){const value=document.getElementById('bc_'+key)?.value.trim();if(value)patch[key]=value;}return patch;};
const originalOpenBatchCorrection=openBatchCorrection;
openBatchCorrection=function(items=selectedRecordItems()){
 const available=items.length?items:maintenanceItems('filtered');if(!available.length)return toast('没有可编辑记录');
 originalOpenBatchCorrection(available);
 const h=document.querySelector('#modalBox h2');h.textContent='批量编辑 · '+available.length+'条记录';
 const fields=document.createElement('div');fields.innerHTML='<div class="form-row"><label>目标项目</label><input id="bc_projectName" placeholder="空白保持；已有项目归入，新名称整组改名或拆分"></div><div class="form-row"><label>正式集数</label><input id="bc_episodeNo" inputmode="numeric" placeholder="空白保持；多选同一值请核对"></div><div class="form-row"><label>Demo作品名</label><input id="bc_recordName" placeholder="空白保持；正式记录使用集数"></div>';
 h.after(fields);
 const list=document.createElement('section');list.className='batch-record-browser';
 const groups=new Map();available.forEach((it,i)=>{const {p,r}=maintenanceRecord(state.data,it),key=p.id;if(!groups.has(key))groups.set(key,{p,rows:[]});groups.get(key).rows.push({it,i,r});});
 list.innerHTML='<div class="batch-search"><label>项目搜索<input id="batchProjectSearch" type="search" placeholder="输入项目名称" oninput="filterEditRecords()"></label><label>文件 / 集数搜索<input id="batchFileSearch" type="search" placeholder="输入文件名、集数或版本" oninput="filterEditRecords()"></label></div><p class="review-hint">先找项目，再展开文件；搜索会取消不匹配项。</p><div class="workspace-controls"><button class="btn secondary" onclick="selectEditRows(true)">全选</button><button class="btn secondary" onclick="selectEditRows(false)">全不选</button></div><div class="maintenance-pick-list">'+[...groups.values()].map(({p,rows})=>'<details class="edit-project" data-name="'+attrStr(p.name.toLocaleLowerCase())+'"><summary><input class="edit-project-check" type="checkbox" checked aria-label="选择项目'+attrStr(p.name)+'" onclick="event.stopPropagation()" onchange="selectEditProject(this)"><span class="edit-project-name">'+esc(p.name)+'</span><small>'+rows.length+'条</small></summary>'+rows.map(({it,i,r})=>'<label class="edit-record" data-search="'+attrStr([p.name,recordLabel(it.epNo,r),r.sourceFile,r.sourcePath,r.demoName].filter(Boolean).join(' ').toLocaleLowerCase())+'"><input class="edit-row-check" type="checkbox" data-index="'+i+'" checked> <span>'+esc(recordLabel(it.epNo,r))+'<small class="source-path">'+esc(r.sourceFile||r.sourcePath||r.date)+'</small></span></label>').join('')+'</details>').join('')+'</div>';
 fields.before(list);window._editAvailableItems=available;
 const invalidate=()=>{window._correctionItems=[...document.querySelectorAll('.edit-row-check:checked')].map(el=>_editAvailableItems[Number(el.dataset.index)]);window._correctionPreview=null;document.getElementById('correctionConfirm').disabled=true;document.getElementById('correctionPreview').textContent='';h.textContent='批量编辑 · '+_correctionItems.length+'条记录';syncEditProjectChecks();};
 window._invalidateEditSelection=invalidate;
 list.querySelectorAll('input').forEach(el=>el.addEventListener('change',invalidate));fields.querySelectorAll('input').forEach(el=>el.addEventListener('input',invalidate));
 const originalButton=document.querySelector('#modalBox [onclick="confirmCorrection()"]');originalButton.textContent='确认修改';
 const edit=document.createElement('details');edit.className='bulk-edit-fields';edit.innerHTML='<summary>批量更改信息</summary><div></div>';const body=edit.querySelector('div');const rows=[...new Set([...document.querySelectorAll('#modalBox [id^="bc_"]')].map(el=>el.closest('.form-row')).filter(Boolean))];rows.forEach(row=>body.appendChild(row));fields.replaceWith(edit);syncEditProjectChecks();
};
function syncEditProjectChecks(){for(const group of document.querySelectorAll('.edit-project')){const rows=[...group.querySelectorAll('.edit-row-check')].filter(el=>!el.closest('.edit-record').hidden),check=group.querySelector('.edit-project-check'),n=rows.filter(x=>x.checked).length;check.checked=!!rows.length&&n===rows.length;check.indeterminate=n>0&&n<rows.length;}}
function selectEditRows(on){document.querySelectorAll('.edit-row-check').forEach(el=>{if(!on||!el.closest('.edit-record').hidden&&!el.closest('.edit-project').hidden)el.checked=on;});window._invalidateEditSelection();}
function selectEditProject(check){check.closest('.edit-project').querySelectorAll('.edit-row-check').forEach(el=>{if(!el.closest('.edit-record').hidden)el.checked=check.checked;});window._invalidateEditSelection();}
function filterEditRecords(){const project=document.getElementById('batchProjectSearch').value.trim().toLocaleLowerCase(),file=document.getElementById('batchFileSearch').value.trim().toLocaleLowerCase();for(const group of document.querySelectorAll('.edit-project')){const match=group.dataset.name.includes(project);let visible=0;for(const row of group.querySelectorAll('.edit-record')){row.hidden=!match||!row.dataset.search.includes(file);if(row.hidden)row.querySelector('input').checked=false;else visible++;}group.hidden=!visible;if(file&&visible)group.open=true;}window._invalidateEditSelection();}


function openCurrentBillingComparison(){openBillingComparison(hasRecordFilters()?'filtered':'all');}
function openBillingComparison(scope='all',month=null){
 if(month===null)month=scope==='filtered'?document.getElementById('monthFilter').value:'';
 const periods=[...new Set(allEpisodes().map(e=>periodKey(e.date)))].sort().reverse();
 const items=maintenanceItems(scope).filter(it=>!month||periodKey(maintenanceRecord(state.data,it).r.date)===month);
 const totals={time:0,episode:0,current:0};const groups=new Map();
 for(const it of items){const {p,r}=maintenanceRecord(state.data,it),fee=mode=>feeOf(p,{...r,mode});const a=fee('按时长'),b=fee('按集');totals.time+=a;totals.episode+=b;totals.current+=feeOf(p,r);const name=(r.type||p.type)==='Demo'?'Demo':p.name;if(!groups.has(name))groups.set(name,{time:0,episode:0,count:0});const g=groups.get(name);g.time+=a;g.episode+=b;g.count++;}
 window._billingComparison={items,source:JSON.stringify(state.data),totals,scope,month};
 const money=n=>'¥'+n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
 openModal('<h2>两套结算对比</h2><div class="form-row"><label for="comparisonScope">比较范围</label><select id="comparisonScope" onchange="openBillingComparison(this.value,document.getElementById(\'comparisonMonth\').value)"><option value="all">全部记录</option><option value="filtered">当前筛选</option><option value="selected">已勾选记录</option></select></div><div class="form-row"><label for="comparisonMonth">月份</label><select id="comparisonMonth" onchange="openBillingComparison(document.getElementById(\'comparisonScope\').value,this.value)"><option value="">全部月份</option>'+periods.map(p=>'<option value="'+esc(p)+'">'+esc(periodLabel(p))+'</option>').join('')+'</select></div><p class="review-hint">按现有单价比较；修改、排除及旧版本不计费。</p><div class="comparison-grid"><div><small>按分钟</small><strong>'+money(totals.time)+'</strong></div><div><small>按集数</small><strong>'+money(totals.episode)+'</strong></div></div><p class="review-summary">按集 − 按分钟：'+money(totals.episode-totals.time)+'；当前：'+money(totals.current)+'</p><div class="review-scroll"><table><thead><tr><th>项目</th><th>记录数</th><th>按分钟（元）</th><th>按集（元）</th><th>差额（元）</th></tr></thead><tbody>'+[...groups].map(([n,g])=>'<tr><td>'+esc(n)+'</td><td>'+g.count+'</td><td>'+money(g.time)+'</td><td>'+money(g.episode)+'</td><td>'+money(g.episode-g.time)+'</td></tr>').join('')+'</tbody></table></div>'+(!items.length?'<p class="review-hint" role="status">当前范围没有记录</p>':'')+'<p class="review-hint">仅预览；应用后切换当前范围，单价不变，可撤销。</p><div class="modal-actions"><button class="btn" onclick="applyBillingComparison(\'按集\')">'+(scope==='all'&&!month?'全部':'此范围')+'改为按集数</button><button class="btn secondary" onclick="applyBillingComparison(\'按时长\')">'+(scope==='all'&&!month?'全部':'此范围')+'改为按分钟</button><button class="btn secondary" onclick="closeModal()">关闭</button></div>');document.getElementById('comparisonScope').value=scope;document.getElementById('comparisonMonth').value=month;
 const select=document.getElementById('comparisonScope');select.querySelector('[value="selected"]').disabled=!selectedRecordItems().length;select.querySelector('[value="filtered"]').disabled=!displayedRecords().length;
 const scopeNote=document.createElement('p');scopeNote.className='action-scope';scopeNote.id='comparisonScopeNote';
 const filters=['monthFilter','projFilter','gradeFilter','typeFilter','workFilter','modeFilter','dateStart','dateEnd','epFilter','versionFilter','durationFilter'].map(id=>document.getElementById(id)).filter(el=>el.value).map(el=>el.tagName==='SELECT'?el.selectedOptions[0].textContent:el.value).join(' · ');
 scopeNote.textContent=(scope==='all'?'全部历史记录':scope==='selected'?'已勾选记录':'当前筛选'+(filters?' · '+filters:''))+(month?' · '+periodLabel(month):'')+' · '+items.length+' 条';
 document.querySelector('#modalBox h2').after(scopeNote);
 for(const mode of ['按集','按时长']){const button=document.querySelector('#modalBox [onclick='+CSS.escape("applyBillingComparison('"+mode+"')")+']');if(button)button.disabled=items.every(it=>{const {p,r}=maintenanceRecord(state.data,it);return (r.mode||p.mode)===mode;});}

}
function applyBillingComparison(mode){try{const plan=window._billingComparison;if(!plan||plan.source!==JSON.stringify(state.data))throw Error('账目已变化，请重新对比');if(!plan.items.length)throw Error('当前范围没有记录');if(!['按集','按时长'].includes(mode))throw Error('计价方式无效');if(plan.items.every(it=>{const {p,r}=maintenanceRecord(state.data,it);return (r.mode||p.mode)===mode;}))return toast('这些记录已经采用此计价方式');const result=buildBatchCorrection(plan.items,{mode});if(commitDataChange(result.next,'切换'+mode)){closeModal();toast('已切换'+plan.items.length+'条，可撤销；单价未改');}}catch(error){toast(error.message);}}

function calibrationChanges(p,r,key,path){
 const info=SettlementImportMetadata.sourceInfo(path,r.date.slice(0,4)),meta=SettlementImportMetadata.infer(path,[]),demo=(r.type||p.type)==='Demo',changes=[];
 if(info.date&&info.date!==r.date)changes.push({field:'date',label:'日期',before:r.date,after:info.date,dateSource:info.dateSource});
 if(!demo&&info.episodeNo!==null&&info.episodeNo!==String(r.episodeNo??(/^\d+$/.test(key)?Number(key):'')))changes.push({field:'episodeNo',label:'集数',before:r.episodeNo||key,after:info.episodeNo});
 if(!demo&&meta.name&&![p.name,...(p.aliases||[])].includes(meta.name))changes.push({field:'projectName',label:'项目',before:p.name,after:meta.name});
 const notes=[info.issue];
 if(demo&&meta.name&&demoWorkKey(meta.name)!==demoWorkKey(demoWorkName(p,r)))notes.push('Demo作品名不同，请在批量编辑核对');
 if(meta.explicitGrade&&(meta.billingCategory!==uiCategory(p)||meta.grade!==(r.grade||p.grade)))notes.push('名称类别/等级与账目不同：'+(meta.billingCategory==='automation'?'自动化':'精品剧')+' '+meta.grade+'；请在项目方案或批量编辑核对');
 if(demo){const rev=recordDemoRevision(p,r),source=demoSourceMeta(path);if(rev.take!==source.take||rev.version!==source.version)notes.push('Demo版本与名称不同，请在导入中核对；本次不重写版本');}
 return {changes,notes:notes.filter(Boolean),info,meta};
}
function buildCalibrationScan(items=maintenanceItems('all'),paths=[]){
 const byBase=new Map();for(const path of paths){const base=String(path).replace(/\\/g,'/').split('/').at(-1).toLowerCase();if(!byBase.has(base))byBase.set(base,[]);byBase.get(base).push(path);}
 const rows=[];let checked=0,missing=0,unchanged=0;
 for(const it of items){const {p,r}=maintenanceRecord(state.data,it),saved=r.sourcePath||r.sourceFile||r.sourceName||'';let path=saved,matched=false,issue='';
  if(paths.length){const base=String(saved).replace(/\\/g,'/').split('/').at(-1).toLowerCase();let found=byBase.get(base)||[];
   if(!found.length){found=paths.filter(path=>{const info=SettlementImportMetadata.sourceInfo(path,r.date.slice(0,4)),meta=SettlementImportMetadata.infer(path,[]);return (r.type||p.type)!=='Demo'&&info.episodeNo!==null&&info.episodeNo===String(r.episodeNo??it.epNo)&&[p.name,...(p.aliases||[])].includes(meta.name);});}
   if(found.length===1){path=found[0];matched=true;}else issue=found.length?'多个候选文件，未自动匹配':'未匹配到磁盘文件；仅核对已存来源名';
  }
  if(!path){missing++;rows.push({...it,path:'',changes:[],notes:['无来源文件名，请选择源文件夹，或先在编辑中核对项目和集数',...(issue?[issue]:[])],matched:false});continue;}
  checked++;const result=calibrationChanges(p,r,it.epNo,path);
  // A changed path is provenance too and must be selected explicitly.
  if(matched&&path!==saved)result.changes.push({field:'sourcePath',label:'来源路径',before:saved,after:path});
  if(result.changes.length||issue||result.notes.some(n=>!n.startsWith('月日取名称'))){rows.push({...it,path,matched,...result,notes:[...result.notes,...(issue?[issue]:[])]});}else unchanged++;
 }
 return {rows,checked,missing,unchanged,total:items.length,source:JSON.stringify(state.data)};
}
function openCalibration(paths=[]){window._calibration=buildCalibrationScan(maintenanceItems('all'),paths);renderCalibration();}
function chooseCalibrationFolder(){const input=document.createElement('input');input.type='file';input.webkitdirectory=true;input.multiple=true;input.onchange=()=>openCalibration([...input.files].filter(f=>/\.(wav|mp4)$/i.test(f.name)).map(mediaSourcePath));input.click();}
function renderCalibration(){const scan=_calibration;
 openModal('<h2>文件信息校准</h2><p class="review-hint">扫描文件名，核对日期、项目和集数；预览后应用。</p><details class="compact-help"><summary>识别规则</summary><p>不修改源文件。月日沿用记录年份；多版本或匹配不唯一时需人工核对。缺少来源可选文件夹补扫。</p></details><div class="workspace-controls"><button class="btn secondary" onclick="chooseCalibrationFolder()">选择源文件夹重新扫描</button><button class="btn secondary" onclick="selectCalibrationChanges(true)">全选差异</button><button class="btn secondary" onclick="selectCalibrationChanges(false)">全不选</button></div><p>共'+scan.total+'条，已扫描'+scan.checked+'条，无来源'+scan.missing+'条，无差异'+scan.unchanged+'条。</p><div class="maintenance-pick-list calibration-list">'+scan.rows.map((row,i)=>'<section><strong>'+esc(row.projName)+' · '+esc(recordLabel(row.epNo,maintenanceRecord(state.data,row).r))+'</strong><small class="source-path">'+esc(row.path||'无来源')+'</small>'+row.changes.map((c,j)=>'<label><input type="checkbox" class="calibration-change" data-row="'+i+'" data-change="'+j+'" checked> '+esc(c.label)+'：'+esc(String(c.before))+' → '+esc(String(c.after))+'</label>').join('')+row.notes.filter(n=>n!=='无来源文件名，请选择源文件夹，或先在编辑中核对项目和集数').map(n=>'<small>'+esc(n)+'</small>').join('')+'</section>').join('')+'</div><div id="calibrationPreview" class="review-summary">尚未写入；可逐项取消差异。</div><div class="modal-actions"><button class="btn secondary" onclick="previewCalibration()">预览校准</button><button class="btn" id="calibrationConfirm" disabled onclick="confirmCalibration()">应用所选校准</button><button class="btn secondary" onclick="closeModal()">关闭</button></div>');
 document.querySelectorAll('.calibration-change').forEach(el=>el.addEventListener('change',invalidateCalibration));
}
function invalidateCalibration(){_calibration.preview=null;document.getElementById('calibrationConfirm').disabled=true;document.getElementById('calibrationPreview').textContent='选择已变化，请重新预览';}
function selectCalibrationChanges(on){document.querySelectorAll('.calibration-change').forEach(el=>el.checked=on);invalidateCalibration();}
function calibrationSelection(){return [...document.querySelectorAll('.calibration-change:checked')].map(el=>[Number(el.dataset.row),Number(el.dataset.change)]);}
function buildCalibrationPlan(selection){const scan=_calibration;if(scan.source!==JSON.stringify(state.data))throw Error('账目已变化，请重新扫描');if(!selection.length)throw Error('请先选择差异');const next=normalizeData(state.data),affected=new Map(),moves=[];
 for(const [i,j] of selection){const row=scan.rows[i],change=row?.changes[j];if(!change)throw Error('校准项已变化');const {p,r}=maintenanceRecord(next,row);affected.set(JSON.stringify([row.projName,row.epNo]),row);
  if(change.field==='projectName')moves.push({row,name:change.after});
  else if(change.field==='episodeNo'){r.episodeNo=change.after;r.label='EP'+change.after;}
  else if(change.field==='date'){r.date=change.after;r.dateSource=change.dateSource;}
  else if(change.field==='sourcePath'){r.sourcePath=change.after;r.sourceFile=change.after.replace(/\\/g,'/').split('/').at(-1);}
 }
 refreshAffectedDemos(next,[...affected.values()]);for(const move of moves)moveMaintenanceRecord(next,move.row,move.name);
 return {next:maintenanceChecked(next),...maintenanceTotals(next),count:affected.size};
}
function previewCalibration(){try{invalidateCalibration();const selection=calibrationSelection(),plan=buildCalibrationPlan(selection);_calibration.preview={selection,serialized:JSON.stringify(plan.next)};document.getElementById('calibrationPreview').textContent='影响'+plan.count+'条记录 · 全部账目 ¥'+plan.before.toFixed(2)+' → ¥'+plan.after.toFixed(2)+'（包含相关Demo最新版计价校准），确认后可撤销';document.getElementById('calibrationConfirm').disabled=false;}catch(error){document.getElementById('calibrationPreview').textContent=error.message;}}
function confirmCalibration(){try{const preview=_calibration.preview;if(!preview||JSON.stringify(preview.selection)!==JSON.stringify(calibrationSelection()))throw Error('请重新预览');const plan=buildCalibrationPlan(preview.selection);if(JSON.stringify(plan.next)!==preview.serialized)throw Error('校准内容已变化，请重新预览');if(commitDataChange(plan.next,'文件信息校准')){closeModal();toast('已应用校准，可撤销');}}catch(error){document.getElementById('calibrationPreview').textContent=error.message;}}

matchMedia('(max-width:900px)').addEventListener('change',()=>{window._compactOpenSide=null;applySidePanels();});
