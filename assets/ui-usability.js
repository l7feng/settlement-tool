/* Layout boundaries and Ctrl-wheel zoom. No business data is changed here. */
let uiZoomSaveTimer=null,uiWheelFrame=null,uiWheelDelta=0;
function uiLayoutScale(){return Math.max(.7,Math.min(1.5,Number(settings.layoutZoom)||1));}
function uiApplyZoom(value,persist=true){
 const zoom=Math.round(Math.max(.7,Math.min(1.5,value))*100)/100;settings.layoutZoom=zoom;
 document.documentElement.style.zoom=String(zoom);document.documentElement.style.setProperty('--ui-viewport-height',(innerHeight/zoom)+'px');
 document.getElementById('uiZoomControl').textContent=Math.round(zoom*100)+'%';
 uiAdaptPanels();document.querySelectorAll('.record-table-scroll').forEach(uiUpdateTableHint);
 if(persist){clearTimeout(uiZoomSaveTimer);uiZoomSaveTimer=setTimeout(()=>{uiZoomSaveTimer=null;saveSettings(settings);},180);}
}
function uiResetZoom(){uiApplyZoom(1);}
function uiAdaptPanels(){
 const width=innerWidth/uiLayoutScale(),area=document.getElementById('workArea');
 const header=document.getElementById('topHeader');document.documentElement.style.setProperty('--ui-panel-top',(header.getBoundingClientRect().bottom/uiLayoutScale()+8)+'px');
 area.classList.toggle('ui-stacked',width<780);document.body.classList.toggle('ui-compact',width<780);area.classList.remove('left-collapsed','right-collapsed');applySideWidths();
 for(const side of ['left','right']){
  const p=document.getElementById(side+'Panel'),docked=guiPanelMode(side)==='dock',handle=document.getElementById(side+'Splitter');
  p.classList.remove('gui-hidden','ui-overlay-panel');p.classList.add('gui-open');p.style.setProperty('display','flex','important');
  if(handle){handle.hidden=!docked||width<780;if(docked){if(side==='left')area.insertBefore(handle,p.nextSibling);else area.insertBefore(handle,p);}handle.setAttribute('aria-valuenow',String(Math.round(p.getBoundingClientRect().width/uiLayoutScale())));}
 }
}
const uiOriginalArrangePanels=guiArrangePanels;guiArrangePanels=function(){uiOriginalArrangePanels();uiAdaptPanels();};
const uiPreviousReloadPreferences=reloadWorkspacePreferences;reloadWorkspacePreferences=function(){clearTimeout(uiZoomSaveTimer);uiZoomSaveTimer=null;uiPreviousReloadPreferences();uiLanguage=settings.uiLanguage==='en'?'en':'zh-CN';uiApplyZoom(Number(settings.layoutZoom)||1,false);uiApplyLanguage();};
function uiUpdateTableHint(wrap){const hint=wrap.previousElementSibling;if(hint?.classList.contains('table-scroll-hint'))hint.hidden=wrap.scrollWidth<=wrap.clientWidth+2;}
const uiTableObserver=new ResizeObserver(entries=>entries.forEach(entry=>uiUpdateTableHint(entry.target)));
function uiWrapTables(){
 for(const table of document.querySelectorAll('.view table')){
  if(table.parentElement.classList.contains('record-table-scroll'))continue;
  const wrap=document.createElement('div');wrap.className='record-table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','明细横向滚动');const columns=[...table.querySelectorAll('colgroup col')];const minWidth=columns.length?columns.reduce((n,col)=>n+parseFloat(col.style.width||'96'),0):(table.querySelectorAll('thead th').length||12)*96;wrap.style.setProperty('--record-min-width',Math.max(760,minWidth)+'px');
  const hint=document.createElement('p');hint.className='table-scroll-hint';hint.textContent='左右滚动查看全部列';table.before(hint,wrap);wrap.appendChild(table);uiTableObserver.observe(wrap);uiUpdateTableHint(wrap);
 }
}
function uiRefreshLayout(){
 uiWrapTables();uiAdaptPanels();
}
const uiPreviousRender=render;render=function(){uiPreviousRender();uiRefreshLayout();uiApplyLanguage();};
const uiPreviousCalendar=showCalendarDetails;showCalendarDetails=function(anchor,date,pinned=false){uiPreviousCalendar(anchor,date,pinned);const tip=document.getElementById('calendarHover');if(!anchor?.isConnected||tip.hidden)return;const r=anchor.getBoundingClientRect(),box=tip.getBoundingClientRect(),z=uiLayoutScale();tip.style.left=Math.max(8,Math.min(innerWidth-box.width-8,r.left))/z+'px';tip.style.top=Math.max(8,Math.min(innerHeight-box.height-8,innerHeight-r.bottom-12>=box.height?r.bottom+8:r.top-box.height-8))/z+'px';uiApplyLanguage();};
document.addEventListener('wheel',event=>{
 if(!event.ctrlKey)return;event.preventDefault();event.stopPropagation();const units=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;uiWheelDelta+=event.deltaY*units;
 if(uiWheelFrame!==null)return;uiWheelFrame=requestAnimationFrame(()=>{uiWheelFrame=null;const steps=Math.trunc(uiWheelDelta/80);if(!steps)return;uiWheelDelta=0;uiApplyZoom(uiLayoutScale()-Math.max(-2,Math.min(2,steps))*.05);});
},{passive:false,capture:true});
document.addEventListener('keydown',event=>{if(event.ctrlKey&&!event.altKey&&['0','Numpad0'].includes(event.key)){event.preventDefault();uiResetZoom();}});
window.addEventListener('resize',()=>{document.documentElement.style.setProperty('--ui-viewport-height',(innerHeight/uiLayoutScale())+'px');guiArrangePanels();});
window.addEventListener('pagehide',()=>{if(uiZoomSaveTimer!==null){clearTimeout(uiZoomSaveTimer);uiZoomSaveTimer=null;saveSettings(settings);}});
document.querySelector('#topHeader .right').insertAdjacentHTML('beforeend','<label class="ui-language-choice" title="界面语言"><span aria-hidden="true">文/A</span><select id="uiLanguage" aria-label="界面语言" onchange="uiSetLanguage(this.value)"><option value="zh-CN">中文</option><option value="en">English</option></select></label><button class="btn secondary" id="uiZoomControl" title="Ctrl+滚轮缩放，Ctrl+0重置" aria-label="恢复100%布局缩放" onclick="uiResetZoom()">100%</button>');
UI_EN['界面语言']='Interface language';UI_EN['恢复100%布局缩放']='Reset layout zoom to 100%';UI_EN['Ctrl+滚轮缩放，Ctrl+0重置']='Ctrl+wheel to zoom; Ctrl+0 to reset';UI_EN['左右滚动查看全部列']='Scroll horizontally to view all columns';UI_EN['明细横向滚动']='Scrollable record table';UI_EN['中文']='中文';
const uiUsabilityStyle=document.createElement('style');uiUsabilityStyle.textContent=`
body.freeze-top{height:var(--ui-viewport-height,100dvh)!important}
body #workArea{margin:0 12px 8px!important;width:calc(100% - 24px)!important;padding:6px 0!important;gap:0!important;scrollbar-gutter:stable;overflow-x:hidden!important}
body #workArea.gui-left-dock.gui-right-dock{grid-template-columns:var(--left-width,224px) 10px minmax(0,1fr) 10px var(--right-width,300px)!important}
body #workArea.gui-left-dock{grid-template-columns:var(--left-width,224px) 10px minmax(0,1fr)!important}
body #workArea.gui-right-dock{grid-template-columns:minmax(0,1fr) 10px var(--right-width,300px)!important}
body #workArea>.content{min-width:0!important;max-width:100%;padding:0 8px 24px!important;overflow:visible!important}
.view,.month-group,.month-body,.record-group,.record-group-body,.group-records{min-width:0;max-width:100%;box-sizing:border-box}
.record-group>summary{flex-wrap:wrap;row-gap:6px}.record-group>summary .stat{margin-left:auto}
.record-table-scroll{display:block;width:100%;max-width:100%;min-width:0;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-gutter:stable;scrollbar-width:auto;border-radius:10px;outline-offset:2px}
body .view .record-table-scroll table{min-width:var(--record-min-width,1000px)!important;width:100%;table-layout:fixed;overflow:visible;border-radius:0}
.record-table-scroll th,.record-table-scroll td{white-space:nowrap;overflow:visible;box-sizing:border-box}.record-table-scroll td.record-project{white-space:normal;overflow-wrap:anywhere}
.record-table-scroll td:not(.record-name):not(.record-number){white-space:normal;overflow-wrap:anywhere}
.record-table-scroll th{font-size:12px;line-height:1.4;padding:10px 6px}.record-table-scroll td{font-size:13px;padding:10px 6px}
.table-scroll-hint{font-size:12px;color:var(--muted);margin:4px 6px 8px}
body .gui-panel .side-head{display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;padding:10px!important;min-height:56px}
body .gui-panel .side-head>span{font-size:13px;min-width:0;line-height:1.4;margin:0!important;overflow-wrap:normal}
body .gui-panel .side-head button{width:34px!important;height:34px!important;min-width:34px!important;flex:none;border-radius:9px!important;white-space:nowrap}
body .gui-panel .side-head button.gui-float-button{width:auto!important;min-width:64px!important;padding:6px 9px!important;display:inline-flex!important;align-items:center;justify-content:center;font-size:12px;line-height:1;white-space:nowrap}
body #workArea>.gui-docked{max-height:calc(var(--ui-viewport-height,100dvh) - var(--ui-panel-top,82px) - 16px)!important;scrollbar-gutter:stable}
body #workArea>.side-resize{display:block!important;position:sticky;top:0;bottom:auto;width:10px;height:calc(var(--ui-viewport-height,100dvh) - var(--ui-panel-top,82px) - 16px);border-radius:0;z-index:25;cursor:col-resize;touch-action:none;background:transparent}
body #workArea>.side-resize[hidden]{display:none!important}.side-resize:before{content:'';position:absolute;left:4px;top:14px;bottom:14px;width:2px;border-radius:2px;background:var(--line)}
.side-resize:hover:before,.side-resize:focus-visible:before,body.resizing-side .side-resize:before{background:var(--accent)}
body #workArea.ui-stacked,body #workArea.ui-stacked:is(.gui-left-dock,.gui-right-dock){grid-template-columns:minmax(0,1fr)!important;grid-template-rows:none!important;grid-auto-rows:max-content!important;align-content:start;row-gap:12px!important}body #workArea.ui-stacked>.gui-docked{position:relative!important;max-height:300px!important;order:0}body #workArea.ui-stacked>.content{order:1;min-height:0!important}
body #workArea.ui-stacked #leftNavBody .tabs{flex-direction:row;flex-wrap:wrap}
body.ui-compact #topHeader{flex-direction:column;align-items:stretch;gap:10px}body.ui-compact #topHeader h1{font-size:18px;white-space:nowrap;flex:none;line-height:1.4}body.ui-compact #topHeader .right{justify-content:flex-start}
body #leftPanel.gui-floating{width:var(--left-width,224px)!important;min-width:180px!important}body #rightPanel.gui-floating{width:var(--right-width,300px)!important;min-width:240px!important}
body .gui-floating{max-height:calc(var(--ui-viewport-height,100dvh) - 32px)!important}
body #modalBox.modal{max-height:calc(var(--ui-viewport-height,100dvh) * .9)!important}
body #calendarHover{max-height:min(480px,calc(var(--ui-viewport-height,100dvh) - 32px))!important}
#topHeader .right{flex-wrap:wrap;row-gap:6px;justify-content:flex-end}.ui-language-choice{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)}.ui-language-choice select{min-width:86px;max-width:112px}
#uiZoomControl{min-width:58px;font-variant-numeric:tabular-nums}
/* One typography scale for Chinese, English, controls and records. */
:root{--ui-font:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif}
body{font-family:var(--ui-font)!important;font-size:15px;font-weight:400;line-height:1.6;letter-spacing:normal}
body :is(button,input,select,textarea){font-family:var(--ui-font)!important;font-size:14px;font-weight:400;line-height:1.5;letter-spacing:normal}
body .btn{font-size:14px;font-weight:500}body .btn:not(.secondary){font-weight:600}body small{font-size:13px;line-height:1.55}
body :is(h1,h2,h3,h4,strong,b){font-weight:600}body #modalBox h2{font-size:21px;line-height:1.4;margin-bottom:16px}
body :is(.review-hint,.source-path,.table-scroll-hint,.calendar-hover-hint,.project-heading-meta,.record-project-revision){font-size:13px!important;line-height:1.6;font-weight:400}
body #topHeader .app-name{font-size:18px;font-weight:600}body #leftNavBody .tab{font-size:14px;font-weight:400}body #leftNavBody .tab.active{font-weight:600}
body .gui-panel .side-head>span,body .gui-panel .side-group>summary{font-size:14px;font-weight:600}
body .content :is(th,td),body #modalBox :is(th,td){font-family:var(--ui-font)!important;font-size:14px;line-height:1.55;font-variant-numeric:tabular-nums}
body :is(.content,#modalBox) table tbody td{font-weight:400}body :is(.calendar-hover h4,.calendar-hover-total,.calendar-work-card span,.calendar-hover-row small){font-size:13px!important}
body :is(table th,.group-title,.project-heading-label){font-weight:600}body #topCards .label{font-size:13px!important;font-weight:400}body #topCards .value{font-weight:600!important;font-variant-numeric:tabular-nums}
body .stat-unit{font-size:13px!important;font-weight:400}body :is(.form-row label,.filter-field label){font-weight:400}
/* Month locators and project groups have distinct, light surfaces. */
html:root body .period-group>.month-header{border-radius:0!important;border:0!important;border-bottom:1px solid var(--line)!important;padding:12px 4px!important;margin:12px 0!important;font-size:17px!important;font-weight:600;background:color-mix(in srgb,var(--white) clamp(0%,calc(var(--material-opacity,88%) - 78%),20%),transparent)!important;backdrop-filter:none!important;box-shadow:none!important}
html:root body :is(.project-group,.record-group){margin:0 0 16px!important;border:1px solid var(--line)!important;border-radius:12px!important;background:color-mix(in srgb,var(--white) clamp(8%,calc(var(--material-opacity,88%) - 55%),43%),transparent)!important;box-shadow:none!important;backdrop-filter:none!important}
html:root body .project-group>.month-header,html:root body .record-group>summary{padding:12px 16px!important;border:0!important;border-radius:11px!important;background:color-mix(in srgb,var(--text) 3%,transparent)!important;box-shadow:none!important;backdrop-filter:none!important;font-size:15px!important}
html:root body :is(.record-group-body,.project-group .month-body){background:transparent!important;border-top:1px solid var(--line);padding:12px!important}
body .project-heading-label{font-size:15px}body :is(.month-header,.record-group>summary) .stat{font-size:13px;font-weight:400;color:var(--muted)}
html:root body :is(.topbar,#workspaceContext,.preset-switch){background:color-mix(in srgb,var(--white) var(--material-opacity,88%),transparent)!important;backdrop-filter:blur(var(--glass-blur,6px))!important;-webkit-backdrop-filter:blur(var(--glass-blur,6px))!important}
html:root body :is(.gui-panel .filter-field,.gui-panel .tab.active,.topbar .btn.secondary,.gui-panel .btn.secondary){background:color-mix(in srgb,var(--text) 4%,transparent)!important;backdrop-filter:none!important}
html:root body table thead th{background:color-mix(in srgb,var(--white) clamp(75%,calc(var(--material-opacity,88%) + 8%),98%),transparent)!important;backdrop-filter:blur(var(--glass-blur,6px))!important}
html:root body.reduce-material :is(.topbar,#workspaceContext,.preset-switch,.project-group,.record-group,.month-header,.record-group>summary),html:root body.glass-solid-header :is(.topbar,#workspaceContext,.preset-switch){background:var(--white)!important;backdrop-filter:none!important}
html:root body.reduce-material table thead th{background:var(--white)!important;backdrop-filter:none!important}
.compact-help{margin:8px 0 14px;color:var(--muted);font-size:13px}.compact-help summary{cursor:pointer;font-size:13px}.compact-help p{margin:6px 0;line-height:1.6}
`;document.head.appendChild(uiUsabilityStyle);
new ResizeObserver(uiAdaptPanels).observe(document.getElementById('topHeader'));
uiApplyZoom(uiLayoutScale(),false);uiRefreshLayout();uiApplyLanguage();
