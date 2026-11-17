/* Fixed side menu, compact overview and real default-grade hints. */
function menuLayout(){
 document.querySelectorAll('#guiNav,#guiFilters').forEach(el=>el.remove());
 document.querySelectorAll('[onclick="guiPanelSettings()"]').forEach(b=>b.remove());
 let group=document.getElementById('sideMenuGroup');if(!group){group=document.createElement('details');group.id='sideMenuGroup';group.open=!settings.sideMenuCollapsed;group.innerHTML='<summary>操作菜单</summary>';document.getElementById('leftNavBody').appendChild(group);group.addEventListener('toggle',()=>{settings.sideMenuCollapsed=!group.open;saveSettings(settings);});}
 const actions=document.getElementById('topActions');if(actions.parentElement!==group)group.appendChild(actions);
 if(!document.getElementById('inlineMaintenance')){const row=document.createElement('div');row.id='inlineMaintenance';row.innerHTML='<button class="btn secondary" onclick="openCalibration()">校准来源</button><button class="btn secondary" onclick="openBatchCorrection(maintenanceItems(\'filtered\'))">批量编辑</button><button class="btn secondary" onclick="openDataActions()">备份与恢复</button>';actions.appendChild(row);}
}
const menuPreviousSync=guiSync;guiSync=function(){menuPreviousSync();menuLayout();};
function menuGradeHints(){
 for(const input of document.querySelectorAll('input[id$="_ranges"],input[id*="gradeRanges"]')){
  let grade='';if(input.id==='pb_ranges'){const p=state.data.projects.find(p=>p.name===window._billingProject);grade=document.getElementById('pb_grade')?.value||p?.grade||'';}else grade=document.getElementById(input.id.replace(/_(?:ranges|gradeRanges)$/,'_grade'))?.value||'';
  const category=document.getElementById(input.id.replace(/_(?:ranges|gradeRanges)$/,'_category'))||document.getElementById(input.id.replace('_gradeRanges','_billingCategory'));const hint=category?.value==='premium'?'默认：1=A，2-10=B，未指定区间=C':grade?'默认：未指定区间使用'+grade+'级':'默认：1=A，2-10=B，未指定区间=C';input.placeholder=hint;input.title=hint;
 }
}
const menuPreviousModal=openModal;openModal=function(html){menuPreviousModal(html);menuGradeHints();};
document.getElementById('modalBox').addEventListener('change',menuGradeHints);
const menuStyle=document.createElement('style');menuStyle.textContent=`
.edge-tool{position:fixed;top:48%;z-index:110;width:28px;padding:10px 3px!important;border-radius:0 9px 9px 0!important}.edge-tool.left{left:0}.edge-tool.right{right:0;border-radius:9px 0 0 9px!important}
body #workArea>.gui-docked{position:sticky!important;top:0;max-height:calc(100dvh - 85px);overflow:auto!important}
body #sideMenuGroup{border-top:1px solid var(--line);margin-top:8px;padding-top:10px}#sideMenuGroup>summary{cursor:pointer;padding:8px}
body #topActions{display:grid;gap:6px;padding:8px;margin:0}#inlineMaintenance{display:grid;gap:6px}#topActions button{width:100%;text-align:left}
body #topCards{gap:6px;padding:8px}body #topCards>.card{min-height:0!important;height:auto!important;padding:10px 14px!important}body #topCards .value{font-size:27px!important;line-height:1.3;margin-top:5px}body #topCards .label{font-size:12px}body #topCards #billingSummary,body #topCards #filteredTotal{padding:4px 10px!important;font-size:12px}
body #topCards>.card:last-of-type{position:relative}#amountControls{display:inline-flex;margin:0 0 0 8px;vertical-align:middle}#cardFee{display:inline-block}.amount-eye{border:0!important;background:transparent!important;padding:4px!important;color:var(--muted)!important}.amount-eye svg{display:block}
input[id$="_ranges"]::placeholder,input[id*="gradeRanges"]::placeholder{color:var(--muted);opacity:.8}
`;document.head.appendChild(menuStyle);
settings.freezeLevel='header';settings.topCollapsed=(settings.topCollapsed||[]).filter(k=>!['cards','summary','total','actions'].includes(k));applyTopPanelFreeze();menuLayout();
