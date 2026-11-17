/* 工作区偏好、升级快照与跨键提交。存储由调用方注入，不读取网络或凭据。 */
(function (scope) {
  'use strict';
  const KEYS = Object.freeze({business:'settlement_v1',settings:'settlement-settings-v1',columns:'settlement-cols-v1',theme:'settlement-theme',glass:'settlement-glass-tuner',journal:'settlement-workspace-journal-v1',upgrades:'settlement-upgrade-snapshots-v1'});
  const PORTABLE = ['settings','columns','theme','glass'];
  const WRITABLE = [KEYS.business,...PORTABLE.map(k=>KEYS[k])];
  // 非默认账本此前只存在浏览器存储里，备份与事务必须按编号识别它们。
  const LEDGER_KEY = /^settlement_(?:v1|recovery_v2)_profile_[A-Za-z0-9_-]{1,64}$/;
  const LEDGER_DATA_KEY = /^settlement_v1_profile_[A-Za-z0-9_-]{1,64}$/;
  function managedKey(key){return WRITABLE.includes(key)||LEDGER_KEY.test(key);}
  function dataKey(key){return key===KEYS.business||LEDGER_DATA_KEY.test(key);}
  function ledgerKeys(storage){const out=[];try{const raw=storage.getItem('settlement_workbenches_v1');const list=raw?JSON.parse(raw):[];for(const item of Array.isArray(list)?list:[]){const id=item&&item.id;if(typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&id!=='default')out.push('settlement_v1_profile_'+id);}}catch(_){}return out;}
  const themes=['','paper','dark','claude','warm','ocean','forest','violet'];
  const cols=['epNo','proj','grade','type','work','billing','date','duration','min','version','mode','fee'];
  const panels=['cards','actions','summary','import','views','filters','total'];
  const settingNames=['confirmDel','defaultSort','weekStart','hideEmpty','freezeLevel','freezeTopPanel','topCollapsed','sideCollapsed','topOpacity','viewPreset','favoriteThemes','theme','style','materialReduced','settlementCycle','sideWidths','customWorkspace','showCalendar','showCalendarRevisions','calendarFilters','recordSort','uiLanguage','layoutZoom','durationDisplay','showSuperseded'];
  function object(v,label) {if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw new Error(label+'必须为普通对象');return v;}
  function keys(v,allowed,label) {object(v,label);for(const k of Object.keys(v))if(!allowed.includes(k))throw new Error(label+'含不支持字段：'+k);}
  function enumeration(v,allowed,label){if(!allowed.includes(v))throw new Error(label+'值无效');return v;}
  function number(v,min,max,label){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(label+'超出范围');return v;}
  function boolean(v,label){if(typeof v!=='boolean')throw new Error(label+'必须是布尔值');return v;}
  function list(v,allowed,label){if(!Array.isArray(v)||v.length>allowed.length||new Set(v).size!==v.length)throw new Error(label+'列表无效');return v.map(x=>enumeration(x,allowed,label));}
  function layout(v){keys(v,['freezeLevel','topCollapsed','sideCollapsed'],'自定义布局');const out={};if('freezeLevel'in v)out.freezeLevel=enumeration(v.freezeLevel,['none','header','overview','actions','full'],'冻结区域');if('topCollapsed'in v)out.topCollapsed=list(v.topCollapsed,panels,'折叠区域');if('sideCollapsed'in v){keys(v.sideCollapsed,['left','right'],'侧栏折叠');out.sideCollapsed={};for(const s of ['left','right'])if(s in v.sideCollapsed)out.sideCollapsed[s]=boolean(v.sideCollapsed[s],s);}return out;}
  function settings(v){keys(v,settingNames,'设置');const out={...layout(Object.fromEntries(['freezeLevel','topCollapsed','sideCollapsed'].filter(k=>k in v).map(k=>[k,v[k]])))};for(const k of ['confirmDel','hideEmpty','freezeTopPanel','materialReduced','showCalendar','showCalendarRevisions','showSuperseded'])if(k in v)out[k]=boolean(v[k],k);
    const enums={recordSort:['episode','time'],defaultSort:['project','time','grade'],weekStart:['mon','sun'],viewPreset:['entry','review','settlement','custom'],theme:themes,style:['glass'],settlementCycle:['natural','half']};for(const [k,a]of Object.entries(enums))if(k in v)out[k]=enumeration(v[k],a,k);
    if('durationDisplay'in v)out.durationDisplay=enumeration(v.durationDisplay,['duration','minutes'],'时长显示');
    if('uiLanguage'in v)out.uiLanguage=enumeration(v.uiLanguage,['zh-CN','en'],'界面语言');if('layoutZoom'in v)out.layoutZoom=number(v.layoutZoom,.7,1.5,'布局缩放');
    if('topOpacity'in v)out.topOpacity=number(v.topOpacity,.55,1,'顶部透明度');if('favoriteThemes'in v)out.favoriteThemes=list(v.favoriteThemes,themes,'收藏主题');
    if('sideWidths'in v){keys(v.sideWidths,['left','right'],'侧栏宽度');out.sideWidths={};for(const s of ['left','right'])if(s in v.sideWidths)out.sideWidths[s]=number(v.sideWidths[s],s==='left'?140:220,3000,'侧栏宽度');}
    if('calendarFilters'in v){keys(v.calendarFilters,['workTypes','types','categories'],'日历筛选');out.calendarFilters={};for(const [key,allowed] of Object.entries({workTypes:['混音','重混','修改'],types:['正式','Demo'],categories:['premium','automation']}))if(key in v.calendarFilters)out.calendarFilters[key]=list(v.calendarFilters[key],allowed,'日历筛选');}
    if('customWorkspace'in v)out.customWorkspace=layout(v.customWorkspace);return out;}
  function validatePreferences(input){keys(input,['formatVersion',...PORTABLE],'偏好备份');if(input.formatVersion!==1)throw new Error('不支持的偏好格式版本');const out={formatVersion:1};
    if('settings'in input)out.settings=settings(input.settings);
    if('columns'in input){keys(input.columns,['order','hidden'],'列配置');out.columns={order:list(input.columns.order,cols,'列顺序'),hidden:{}};keys(input.columns.hidden,cols,'隐藏列');for(const [k,v]of Object.entries(input.columns.hidden))out.columns.hidden[k]=boolean(v,'隐藏列');}
    if('theme'in input)out.theme=enumeration(input.theme,themes,'主题');
    if('glass'in input){const v=input.glass;keys(v,['blur','radius','blob','hl','shadow','bars','alphaLight','alphaDark','schema'],'玻璃参数');if(v.schema!==2)throw new Error('不支持的玻璃参数版本');out.glass={schema:2};for(const [k,min,max]of [['blur',0,8],['radius',16,28],['blob',0,2],['alphaLight',.55,.98],['alphaDark',.55,.98]])if(k in v)out.glass[k]=number(v[k],min,max,k);for(const k of ['hl','shadow','bars'])if(k in v)out.glass[k]=enumeration(v[k],[0,1],k);}
    return out;}
  function pick(v,allowed){object(v,'本机偏好');return Object.fromEntries(allowed.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));}
  function capturePreferences(storage){const p={formatVersion:1};for(const k of PORTABLE){const raw=storage.getItem(KEYS[k]);if(raw===null)continue;p[k]=k==='theme'?raw:JSON.parse(raw);}
    // 本机旧设置可包含临时筛选、删除模式；不进入可移植备份。
    if(p.settings)p.settings=pick(p.settings,settingNames);if(p.columns)p.columns=pick(p.columns,['order','hidden']);
    if(p.glass){p.glass=pick(p.glass,['blur','radius','blob','hl','shadow','bars','alphaLight','alphaDark','schema']);if(p.glass.schema===undefined||p.glass.schema===1){const g=p.glass;g.schema=2;for(const [k,min,max,def]of [['blur',0,8,6],['radius',16,28,22],['blob',0,2,1],['alphaLight',.55,.98,.82],['alphaDark',.55,.98,.82]])g[k]=Number.isFinite(Number(g[k]))?Math.max(min,Math.min(max,Number(g[k]))):def;for(const k of ['hl','shadow','bars'])g[k]=g[k]?1:0;}}
    return validatePreferences(p);}
  function rawMap(storage,affected){return Object.fromEntries(affected.map(k=>[k,storage.getItem(k)]));}
  function validateRawMap(map){object(map,'提交原文');for(const k of Object.keys(map))if(!managedKey(k))throw new Error('提交原文含不支持字段：'+k);for(const v of Object.values(map))if(v!==null&&typeof v!=='string')throw new Error('提交原文必须为字符串或空值');return map;}
  function restore(storage,before){const failures=[];for(const [k,v]of Object.entries(before)){try{v===null?storage.removeItem(k):storage.setItem(k,v);}catch(e){failures.push(k+': '+e.message);}}return failures;}
  function recoverInterrupted(storage){const raw=storage.getItem(KEYS.journal);if(raw===null)return {recovered:false};const j=JSON.parse(raw);keys(j,['formatVersion','before'],'恢复日志');if(j.formatVersion!==1)throw new Error('恢复日志版本无效');validateRawMap(j.before);const failures=restore(storage,j.before);if(failures.length){const e=new Error('未完成提交恢复失败：'+failures.join('; '));e.rollbackFailed=true;throw e;}try{storage.removeItem(KEYS.journal);}catch(cause){const e=new Error('原文已恢复，但恢复日志无法清除');e.cause=cause;e.rollbackFailed=true;throw e;}return {recovered:true};}
  function transact(storage,next){validateRawMap(next);if(storage.getItem(KEYS.journal)!==null)throw new Error('存在未恢复提交，请先恢复');const before=rawMap(storage,Object.keys(next));storage.setItem(KEYS.journal,JSON.stringify({formatVersion:1,before}));
    try{for(const [k,v]of Object.entries(next))v===null?storage.removeItem(k):storage.setItem(k,v);storage.removeItem(KEYS.journal);return {ok:true,before};}
    catch(cause){const failures=restore(storage,before);if(!failures.length){try{storage.removeItem(KEYS.journal);}catch(e){failures.push('恢复日志：'+e.message);}}const error=new Error('工作区提交失败'+(failures.length?'，回滚未完成：'+failures.join('; '):'，已恢复原值'));error.cause=cause;error.rollbackFailed=failures.length>0;error.before=before;throw error;}}
  function preferenceRaw(input){const p=validatePreferences(input),next=Object.fromEntries(PORTABLE.map(k=>[KEYS[k],null]));for(const k of PORTABLE)if(k in p)next[KEYS[k]]=k==='theme'?p[k]:JSON.stringify(p[k]);return next;}
  function writePreferences(storage,prefs){return transact(storage,preferenceRaw(prefs));}
  function writeBundle(storage,bundle){keys(bundle,['businessRaw','businessKey','preferences','ledgers'],'工作区提交');const next=bundle.preferences!=null?preferenceRaw(bundle.preferences):{};
    const businessKey='businessKey'in bundle?bundle.businessKey:KEYS.business;if(typeof businessKey!=='string'||!dataKey(businessKey))throw new Error('业务存储键无效');
    if('businessRaw'in bundle){if(typeof bundle.businessRaw!=='string')throw new Error('业务原文必须为字符串');next[businessKey]=bundle.businessRaw;}
    if('ledgers'in bundle){object(bundle.ledgers,'账本原文');for(const [k,raw] of Object.entries(bundle.ledgers)){if(!dataKey(k))throw new Error('账本存储键无效：'+k);if(k===businessKey)throw new Error('账本存储键重复：'+k);if(typeof raw!=='string')throw new Error('账本原文必须为字符串');next[k]=raw;}}
    return transact(storage,next);}
  function restoreBundle(storage,before){return transact(storage,validateRawMap(before));}
  function validVersion(value){if(typeof value!=='string'||!value||value.length>64||/[\u0000-\u001f]/.test(value))throw new Error('软件版本无效');return value;}
  // 升级前快照的原文可能不在账本里：桌面模式下原文已 gzip 搬到 upgrade/ 目录，
  // 账本只留 {id,appVersion,createdAt,file,bytes,sha256} 索引（否则一份 288KB × 20 份 = 3.9MB）。
  // 独立网页版没有后端，仍走内联 raw；两种形态都必须能读。
  const BLOB_NAME=/^[0-9A-Za-z._-]{1,80}\.json\.gz$/;
  function validateSnapshot(s){keys(s,['id','appVersion','createdAt','raw','file','bytes','sha256'],'升级快照条目');
    if(Object.hasOwn(s,'raw'))validateRawMap(s.raw);
    else if(typeof s.file!=='string'||!BLOB_NAME.test(s.file))throw new Error('升级快照原文索引无效');
    validVersion(s.appVersion);if(typeof s.id!=='string'||!s.id||s.id.length>160||/[\u0000-\u001f]/.test(s.id)||typeof s.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(s.createdAt)||!Number.isFinite(Date.parse(s.createdAt)))throw new Error('升级快照编号或日期无效');return s;}
  function snapshotRaw(s){if(Object.hasOwn(s,'raw'))return s.raw;const load=scope.__settlementUpgradeLoader;if(typeof load!=='function')throw new Error('此环境没有工作区服务，无法读取快照原文');return validateRawMap(JSON.parse(load(s.file)));}
  function readHistory(storage){const raw=storage.getItem(KEYS.upgrades);const h=raw===null?{formatVersion:1,snapshots:[]}:JSON.parse(raw);keys(h,['formatVersion','snapshots','currentVersion'],'升级快照');if(h.formatVersion!==1||!Array.isArray(h.snapshots))throw new Error('升级快照损坏或版本无效');if('currentVersion'in h)validVersion(h.currentVersion);for(const s of h.snapshots)validateSnapshot(s);return h;}
  // 升级前快照只留最近 3 份：此前无上限，攒到 20 份、3.9MB，占账本 70%。
  const UPGRADE_KEEP=3;
  function createUpgradeSnapshot(storage,appVersion){validVersion(appVersion);let history=readHistory(storage);
    if((history.currentVersion??history.snapshots[0]?.appVersion)===appVersion)return {created:false,snapshotId:history.snapshots[0]?.id??null};const originals=rawMap(storage,[...WRITABLE,...ledgerKeys(storage)]);
    if(Object.values(originals).every(v=>v===null)){storage.setItem(KEYS.upgrades,JSON.stringify({...history,currentVersion:appVersion}));return {created:false,snapshotId:null};}
    const createdAt=new Date().toISOString(),id=appVersion+'-'+createdAt;history={formatVersion:1,currentVersion:appVersion,snapshots:[{id,appVersion,createdAt,raw:originals},...history.snapshots].slice(0,UPGRADE_KEEP)};
    // 一次原子写入保留旧原文，成功前绝不改写业务或偏好键。
    storage.setItem(KEYS.upgrades,JSON.stringify(history));return {created:true,snapshotId:id};}
  function listUpgradeSnapshots(storage){return readHistory(storage).snapshots;}
  function exportUpgradeSnapshot(snapshot){validateSnapshot(snapshot);const raw=snapshotRaw(snapshot);const businessRaw=raw[KEYS.business];
    const asOriginal=()=>JSON.stringify({...snapshot,raw},null,2);
    if(businessRaw==null)return {kind:'raw-original',raw:asOriginal()};
    try{const data=JSON.parse(businessRaw);if(!data||typeof data!=='object'||Array.isArray(data)||!data.projects)throw new Error('业务原文无效');const shim={getItem:k=>raw[k]??null};const ledgers={};for(const [k,v] of Object.entries(raw)){const m=/^settlement_v1_profile_([A-Za-z0-9_-]{1,64})$/.exec(k);if(m&&typeof v==='string')ledgers[m[1]]=v;}return {kind:'backup',envelope:{formatVersion:2,app:'settlement-workbench',exportedAt:snapshot.createdAt,data,preferences:capturePreferences(shim),ledgers,upgradeSnapshot:{appVersion:snapshot.appVersion,id:snapshot.id}}};}catch(e){return {kind:'raw-original',raw:asOriginal(),reason:e.message};}}
  scope.SettlementWorkspace=Object.freeze({KEYS,capturePreferences,validatePreferences,writePreferences,writeBundle,restoreBundle,recoverInterrupted,createUpgradeSnapshot,listUpgradeSnapshots,exportUpgradeSnapshot});
})(globalThis);
