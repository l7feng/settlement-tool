/* Floating tools, consolidated overview and opt-in amount visibility. */
let guiAmountTimer=null,guiTemporaryAmount=false;
// 金额隐私只作用于三处汇总（2026-11-04 裁决）：统计卡大字、右上工作明细金额、共计金额。
// 明细 / 日历 / 组头 / 悬停浮层 / 成片差额等 .amt 金额始终正常显示。
const GUI_AMOUNT_IDS=['cardFee','activeScopeAmount','filteredTotalAmount'];
function guiAmountCache(){
 for(const id of GUI_AMOUNT_IDS){const el=document.getElementById(id);if(el&&el.textContent!=='******')el.dataset.amount=el.textContent;}
}
function guiAmounts(){
 guiAmountCache();
 const show=!!settings.amountAlwaysVisible||guiTemporaryAmount;
 for(const id of GUI_AMOUNT_IDS){const el=document.getElementById(id);if(el)el.textContent=show?(el.dataset.amount||el.textContent):'******';}
 const controls=document.getElementById('amountControls');
 controls.innerHTML='<button class="amount-eye btn secondary" aria-label="'+(show?'隐藏金额':'显示金额30秒')+'" title="'+(show?'点击隐藏':'点击预览30秒')+'" aria-pressed="'+show+'" onclick="guiShowAmount(\''+(show?'hide':'temporary')+'\')"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+(show?'':'<path d="m3 3 18 18"/>')+'</svg></button>';

}
function guiShowAmount(mode){clearTimeout(guiAmountTimer);guiTemporaryAmount=mode==='temporary';settings.amountAlwaysVisible=mode==='always';saveSettings(settings);if(guiTemporaryAmount)guiAmountTimer=setTimeout(()=>{guiTemporaryAmount=false;guiAmounts();},30000);guiAmounts();}
function guiFloat(side){const panel=document.getElementById(side+'Panel'),other=document.getElementById((side==='left'?'right':'left')+'Panel');const show=!panel.classList.contains('gui-open');other.classList.remove('gui-open');panel.classList.toggle('gui-open',show);document.getElementById('guiNav')?.setAttribute('aria-expanded',String(document.getElementById('leftPanel').classList.contains('gui-open')));document.getElementById('guiFilters')?.setAttribute('aria-expanded',String(document.getElementById('rightPanel').classList.contains('gui-open')));}
function guiDayEdit(date){const items=getFilteredList().filter(e=>e.date===date).map(e=>({projName:e.proj.name,epNo:e.epNo}));if(!items.length)return toast('当天没有可编辑记录');window.guiEditingDay=date;closeCalendarDetails(true);openBatchCorrection(items);}
function guiSync(){
 for(const side of ['left','right']){const panel=document.getElementById(side+'Panel');panel.classList.add('gui-panel');if(!window.guiDockReady&&panel.parentElement!==document.body)document.body.appendChild(panel);}
 const cards=document.getElementById('topCards');for(const id of ['billingSummary','filteredTotal'])cards.appendChild(document.getElementById(id));
 guiAmountCache();
 if(!document.getElementById('amountControls')){const el=document.createElement('div');el.id='amountControls';document.getElementById('cardFee').after(el);}
 guiAmounts();
 let calendarTools=document.getElementById('guiCalendarTools');if(!calendarTools){calendarTools=document.createElement('div');calendarTools.id='guiCalendarTools';calendarTools.className='workspace-controls';document.getElementById('rightFilterBody').before(calendarTools);}
 for(const id of ['calendarToggle','calendarFilterButton'])calendarTools.appendChild(document.getElementById(id));
 document.getElementById('recordSortButton').after(document.getElementById('batchDelBtn'));
}
const guiOriginalRender=render;render=function(){guiOriginalRender();guiSync();};
const guiOriginalCalendar=showCalendarDetails;showCalendarDetails=function(anchor,date,pinned=false){guiOriginalCalendar(anchor,date,pinned);const tip=document.getElementById('calendarHover');guiAmounts();if(pinned){tip.setAttribute('role','dialog');tip.insertAdjacentHTML('beforeend','<button class="btn" onclick="guiDayEdit('+jsStr(date)+')">编辑当天记录</button>');}else tip.setAttribute('role','tooltip');};
const guiOriginalDetails=showRecordDetails;showRecordDetails=function(p,k){guiOriginalDetails(p,k);document.getElementById('rightPanel').classList.add('gui-open');document.getElementById('guiFilters')?.setAttribute('aria-expanded','true');};

document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const side of ['left','right'])document.getElementById(side+'Panel').classList.remove('gui-open');});
const guiStyle=document.createElement('style');guiStyle.textContent=`
body #workArea,body #workArea.left-collapsed,body #workArea.right-collapsed,body #workArea.left-collapsed.right-collapsed{display:block!important}
body #workArea>.content{width:100%;height:100%;box-sizing:border-box}
body>.gui-panel{position:fixed!important;top:100px;bottom:24px;width:min(350px,calc(100vw - 32px))!important;max-height:calc(100dvh - 124px);z-index:100;display:none;box-shadow:0 16px 48px #0005}
body #leftPanel{left:24px}body #rightPanel{right:24px}
body>.gui-panel.gui-open{display:flex}
body .gui-panel .side-body,body .gui-panel .side-head span{display:block!important}
body #workArea .side-resize{display:none}
body #topCards #billingSummary,body #topCards #filteredTotal{grid-column:1/-1;margin:0;padding:8px 12px;background:transparent!important;border:0;box-shadow:none;backdrop-filter:none!important}
#topCards{gap:10px}#amountControls{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}#amountControls button{font-size:12px;padding:5px 8px}
html:root body>.gui-panel{background:color-mix(in srgb,var(--white) var(--material-opacity,88%),transparent)!important;backdrop-filter:blur(calc(var(--glass-blur,6px) * 1.35))!important}
html:root body.reduce-material #workArea>.side-panel{background:var(--white)!important;backdrop-filter:none!important}
html:root body #calendarHover .calendar-work-card{background:color-mix(in srgb,var(--white) 94%,transparent)!important;backdrop-filter:none!important}
`;document.head.appendChild(guiStyle);
guiSync();

const guiOriginalConfirmCorrection=confirmCorrection;confirmCorrection=function(){const date=window.guiEditingDay,patch=readCorrectionPatch(),before=JSON.stringify(state.data);guiOriginalConfirmCorrection();if(date&&before!==JSON.stringify(state.data)){window.guiEditingDay=null;state.selectedDate=patch.date||date;const d=new Date(state.selectedDate+'T00:00:00');state.calYear=d.getFullYear();state.calMonth=d.getMonth();if(document.getElementById('monthFilter').value&&document.getElementById('monthFilter').value!==periodKey(state.selectedDate))document.getElementById('monthFilter').value='';render();}};

const guiOriginalCloseModal=closeModal;closeModal=function(){window.guiEditingDay=null;guiOriginalCloseModal();};
