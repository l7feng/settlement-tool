/* Sidebars are docked by default; floating is an explicit personal layout. */
window.guiDockReady=true;
function guiPanelMode(side){return settings.guiPanelModes?.[side]==='float'?'float':'dock';}
function guiArrangePanels(){
 const area=document.getElementById('workArea'),content=area.querySelector('.content');
 for(const side of ['left','right']){const p=document.getElementById(side+'Panel'),floating=guiPanelMode(side)==='float';p.classList.toggle('gui-floating',floating);p.classList.toggle('gui-docked',!floating);
  if(floating){if(p.parentElement!==document.body)document.body.appendChild(p);const pos=settings.guiPanelPositions?.[side];if(pos){p.style.left=Math.max(8,Math.min(innerWidth/(settings.layoutZoom||1)-p.offsetWidth-8,pos.x))+'px';p.style.top=Math.max(8,Math.min(innerHeight/(settings.layoutZoom||1)-80,pos.y))+'px';p.style.right='auto';}}
  else{if(side==='left'){if(p.parentElement!==area||p.nextElementSibling!==content)area.insertBefore(p,content);}else if(p.parentElement!==area)area.appendChild(p);p.style.left='';p.style.top='';p.style.right='';}
  p.classList.remove('gui-hidden');const hidden=false;p.style.setProperty('display',hidden?'none':'flex','important');area.classList.toggle('gui-'+side+'-dock',!floating&&!hidden);
  if(!p.querySelector('.gui-float-button')){const b=document.createElement('button');b.className='btn secondary gui-float-button';b.onclick=()=>guiFloat(side);p.querySelector('.side-head').insertBefore(b,p.querySelector('.side-head button'));}
  p.querySelector('.gui-float-button').textContent=floating?'停靠':'浮动';p.querySelector('.side-head').title=floating?'拖动标题移动窗口':'';
 }
}
guiFloat=function(side){settings.guiPanelModes={...settings.guiPanelModes,[side]:guiPanelMode(side)==='dock'?'float':'dock'};const p=document.getElementById(side+'Panel');p.classList.remove('gui-hidden');p.classList.add('gui-open');saveSettings(settings);guiArrangePanels();};
function guiTogglePanel(side){guiSetPanelMode(side,'dock');}
function guiSetPanelMode(side,value){settings.guiPanelModes={...settings.guiPanelModes,[side]:value};document.getElementById(side+'Panel').classList.remove('gui-hidden');saveSettings(settings);guiArrangePanels();}
function guiPanelSettings(){openModal('<h2>窗口设置</h2>'+['left','right'].map(side=>'<div class="form-row"><label>'+(side==='left'?'视图导航':'筛选与详情')+'</label><select onchange="guiSetPanelMode(\''+side+'\',this.value)"><option value="dock" '+(guiPanelMode(side)==='dock'?'selected':'')+'>侧边展开，随明细滚动</option><option value="float" '+(guiPanelMode(side)==='float'?'selected':'')+'>浮动窗口，可拖动标题</option></select></div>').join('')+'<p class="review-hint">切换即时保存。浮动模式拖动标题栏调整位置，点击停靠回到侧边。</p><button class="btn secondary" onclick="closeModal()">关闭</button>');}
const dockPreviousSync=guiSync;guiSync=function(){dockPreviousSync();guiArrangePanels();};
for(const side of ['left','right']){
 const p=document.getElementById(side+'Panel');p.classList.remove('gui-hidden');p.classList.add('gui-open');
 const head=p.querySelector('.side-head');head.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,input,select')||guiPanelMode(side)!=='float')return;e.preventDefault();head.setPointerCapture(e.pointerId);const start=p.getBoundingClientRect(),x=e.clientX,y=e.clientY;
  const move=event=>{const zoom=settings.layoutZoom||1;p.style.left=Math.max(8,Math.min(innerWidth/zoom-p.offsetWidth-8,(start.left+event.clientX-x)/zoom))+'px';p.style.top=Math.max(8,Math.min(innerHeight/zoom-80,(start.top+event.clientY-y)/zoom))+'px';p.style.right='auto';};
  const stop=()=>{head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',stop);head.removeEventListener('pointercancel',stop);settings.guiPanelPositions={...settings.guiPanelPositions,[side]:{x:parseFloat(p.style.left)||start.left,y:parseFloat(p.style.top)||start.top}};saveSettings(settings);};head.addEventListener('pointermove',move);head.addEventListener('pointerup',stop);head.addEventListener('pointercancel',stop);
 });
}


const dockPreviousCalendar=showCalendarDetails;showCalendarDetails=function(anchor,date,pinned=false){dockPreviousCalendar(anchor,date,pinned);if(pinned){const tip=document.getElementById('calendarHover'),b=tip.querySelector('[onclick^="guiDayEdit"]');if(b){b.textContent='编辑';b.classList.add('calendar-edit-top');tip.querySelector('strong').after(b);}const bounds=tip.getBoundingClientRect();tip.style.top=Math.max(8,Math.min(innerHeight-bounds.height-8,bounds.top))+'px';}};
const dockPreviousDetails=showRecordDetails;showRecordDetails=function(p,k){dockPreviousDetails(p,k);document.getElementById('rightPanel').classList.remove('gui-hidden');guiArrangePanels();};
function guiImportSelect(){const folder=document.getElementById('guiImportSource').value==='folder',demo=document.getElementById('guiImportPurpose').value==='demo',input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.wav,.mp4';if(folder)input.webkitdirectory=true;input.onchange=()=>{const files=[...input.files].filter(f=>/\.(wav|mp4)$/i.test(f.name));if(!files.length)return toast('未选择音视频文件');if(demo)openDemoImport(files);else showImportModal(scanFiles(files));};input.click();}
openRecordActions=function(){openModal('<h2>导入与登记</h2><p class="review-hint">选文件 → 核对 → 预览 → 登记。</p><section class="action-section"><div class="form-row"><label>文件来源</label><select id="guiImportSource"><option value="folder">整个交付文件夹</option><option value="files">多个音视频文件</option></select></div><div class="form-row"><label>作品用途</label><select id="guiImportPurpose"><option value="auto">自动识别正式 / Demo</option><option value="demo">Demo作品</option></select></div><button class="btn" onclick="guiImportSelect()">选择文件并预览</button><p class="review-hint">从目录和文件名识别信息，确认后入账；Demo仅最高版本计费。</p></section><details><summary>没有文件，手动登记</summary><div class="workspace-controls"><button class="btn secondary" onclick="openAddEp()">登记一条</button><button class="btn secondary" onclick="openBatch()">批量登记</button></div></details><div class="modal-actions"><button class="btn secondary" onclick="closeModal()">关闭</button></div>');};
const dockStyle=document.createElement('style');dockStyle.textContent=`
body #workArea{display:grid!important;grid-template-columns:minmax(0,1fr)!important;align-items:start;overflow:auto!important}
body #workArea.gui-left-dock{grid-template-columns:190px minmax(0,1fr)!important}
body #workArea.gui-right-dock{grid-template-columns:minmax(0,1fr) 300px!important}
body #workArea.gui-left-dock.gui-right-dock{grid-template-columns:190px minmax(0,1fr) 300px!important}
body #workArea>.content{overflow:visible!important;min-height:100%;height:auto;grid-column:auto!important;grid-row:auto!important}
body #workArea>.gui-docked{display:flex!important;position:relative!important;top:auto;bottom:auto;left:auto;right:auto;width:100%!important;height:auto;max-height:none;grid-column:auto!important;grid-row:auto!important}
body #workArea>.gui-docked .side-body{overflow:visible!important;flex:none!important;max-height:none!important}
body .gui-hidden{display:none!important}
body>.gui-floating{display:flex;resize:both;overflow:auto;min-width:240px;max-width:calc(100vw - 16px)}
body>.gui-floating .side-head{cursor:move;touch-action:none}
body .gui-panel .side-head{flex-wrap:wrap;gap:5px}body .gui-panel .side-head span{margin-right:auto}
body .gui-panel.gui-hidden{display:none!important}
body td.record-project{text-align:center!important;vertical-align:middle;white-space:normal}
.calendar-edit-top{float:right;margin:0 0 8px 12px;padding:4px 12px!important}.calendar-work-group{clear:both}
@media(max-width:1000px){body #workArea.gui-left-dock.gui-right-dock{grid-template-columns:150px minmax(280px,1fr) 250px!important}body #workArea{overflow-x:auto!important}}
`;document.head.appendChild(dockStyle);guiArrangePanels();

document.addEventListener("keydown",e=>{if(e.key==="Escape")for(const side of ["left","right"])if(guiPanelMode(side)==="float"&&!document.getElementById(side+"Panel").classList.contains("gui-hidden"))guiTogglePanel(side);});
