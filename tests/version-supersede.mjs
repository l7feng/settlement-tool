import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});
context.state={data:{projects:[]}};
context.toast=()=>{};
context.normalizeData=v=>v;
context.renderImportPreview=()=>{};
context.renderMultiProjectPreview=()=>{};
context.window={_importPreview:null};
context.commitDataChange=()=>true;
context.refreshAffectedDemos=()=>{};
context.feeOf=()=>0;
context.backupStats=()=>({amount:0});
context.validateBackup=v=>({ok:true,data:v});
for(const name of ['billing-core','exclusion-rules','revision-parse','version-timeline','version-reconciliation']){
  vm.runInContext(await readFile(new URL('assets/'+name+'.js',webRootURL),'utf8'),context);
}
vm.runInContext('function workTypeOf(r){return SettlementBilling.workType(r);}',context);
const {SettlementExclusion:ex,SettlementBilling:billing}=context;

// ── 2.2 单一语义 ──
const r1={duration:'00:01:00',workType:'混音'};
ex.setAuto(r1,true,'旧交付版本（仅最高版本计费）');
assert.equal(r1.excluded,true);
assert.equal(r1.excludeSource,'auto');
assert.equal(ex.label(r1),'自动置零');
// 人工取消：等于覆盖自动规则
ex.setManual(r1,false,'')
assert.equal(r1.excluded,false);
assert.equal(r1.excludeSource,undefined);
assert.equal(r1.excludeManual,true);
// 规则显式置零时同样生效（等权，不是「人工优先」）；随后规则自己也能撤回
ex.setAuto(r1,true,'旧交付版本（仅最高版本计费）');
assert.equal(r1.excluded,true,'规则置零等权生效');
assert.equal(r1.excludeSource,'auto');
ex.clearAuto(r1);
assert.equal(r1.excluded,false,'规则自己置的零可以自己撤销');
// 人工最后表态 → 人工赢
ex.setManual(r1,true,'这集不结算');
assert.equal(r1.excludeSource,'manual');
assert.equal(ex.sourceOf(r1),'manual');
// 底层写入是「最后写的人赢」；防回弹由规则层负责（见下方 reconcile 用例）
ex.setAuto(r1,true,'旧交付版本（仅最高版本计费）');
assert.equal(r1.excludeSource,'auto','底层后写覆盖先写');
// 历史数据迁移：按原因判断谁置的零
const legacyAuto={excluded:true,excludeReason:'旧交付版本（仅最高版本计费）'};
ex.normalize(legacyAuto);
assert.equal(legacyAuto.excludeSource,'auto');
assert.equal(legacyAuto.excludeManual,undefined);
const legacyManual={excluded:true,excludeReason:'客户不结算'};
ex.normalize(legacyManual);
assert.equal(legacyManual.excludeSource,'manual');
assert.equal(legacyManual.excludeManual,true);
// 未置零的记录不会被写上来源
const open={excluded:false};
ex.normalize(open);
assert.equal(open.excludeSource,undefined);

// ── 2.3 幂等 reconcile ──
function fixture(){
  return {projects:[{id:'p1',name:'心剑',type:'正式',billingCategory:'premium',grade:'A',mode:'按时长',gradeRanges:'',episodes:{
    '1':{recordId:'r1',type:'正式',workType:'混音',episodeNo:'1',date:'2026-10-01',duration:'00:10:00',sourceFile:'心剑 V01.wav',grade:'A'},
    '2':{recordId:'r2',type:'正式',workType:'混音',episodeNo:'1',date:'2026-10-05',duration:'00:10:00',sourceFile:'心剑 V02.wav',grade:'A'},
    '3':{recordId:'r3',type:'正式',workType:'混音',episodeNo:'1',date:'2026-10-09',duration:'00:10:00',sourceFile:'心剑 V03.wav',grade:'A'},
  }}]};
}
const data=fixture();
context.state.data={projects:[]};
vm.runInContext('reconcileFormalVersions',context)(data);
const p=data.projects[0];
assert.equal(p.episodes['1'].versionSuperseded,true);
assert.equal(p.episodes['1'].excludeSource,'auto');
assert.equal(p.episodes['2'].versionSuperseded,true);
assert.equal(p.episodes['2'].excluded,true);
assert.equal(p.episodes['3'].versionSuperseded,undefined);
assert.equal(!!p.episodes['3'].excluded,false);
// 只有最高版本计价
const fees=Object.values(p.episodes).map(r=>billing.fee({A:{per_min:90,per_ep:90}},p,r));
assert.deepEqual(fees,[0,0,900]);
// 幂等：同一输入跑两次结果逐字节相同
const once=JSON.stringify(data);
vm.runInContext('reconcileFormalVersions',context)(data);
assert.equal(JSON.stringify(data),once);
// 编辑/纠正（不经过导入标签）同样会重算：改日期不影响版本序（版本号优先），最高版仍是 V03
p.episodes['3'].date='2026-09-01';
vm.runInContext('reconcileFormalVersions',context)(data);
assert.equal(p.episodes['3'].versionSuperseded,undefined,'版本号更高的仍是最高版');
assert.equal(p.episodes['1'].versionSuperseded,true);
p.episodes['3'].date='2026-10-09';
vm.runInContext('reconcileFormalVersions',context)(data);

// 人工在最高版上置零：规则不得撤销，也不得把它算成旧版本
ex.setManual(p.episodes['3'],true,'客户不结算');
vm.runInContext('reconcileFormalVersions',context)(data);
assert.equal(p.episodes['3'].excluded,true);
assert.equal(p.episodes['3'].excludeSource,'manual');
assert.equal(p.episodes['3'].versionSuperseded,undefined);
// 人工给旧版取消置零：规则不再回弹（excludeManual 优先）
ex.setManual(p.episodes['2'],false,'');
vm.runInContext('reconcileFormalVersions',context)(data);
assert.equal(p.episodes['2'].excluded,false,'人工取消后不得被自动回弹');
assert.equal(p.episodes['2'].versionSuperseded,true,'但仍标记为旧版本');

// 同版本 + 同日期：不猜、不抛错，标待核对
const tie={projects:[{id:'p2',name:'流放崖州',type:'正式',billingCategory:'premium',grade:'B',mode:'按时长',gradeRanges:'',episodes:{
  a:{recordId:'a',type:'正式',workType:'混音',episodeNo:'2',date:'2026-10-10',duration:'00:05:00',sourceFile:'流放 V02 甲.wav'},
  b:{recordId:'b',type:'正式',workType:'混音',episodeNo:'2',date:'2026-10-10',duration:'00:05:00',sourceFile:'流放 V02 乙.wav'},
}}]};
assert.doesNotThrow(()=>vm.runInContext('reconcileFormalVersions',context)(tie));
assert.equal(tie.projects[0].episodes.a.needsReview,true);
assert.equal(tie.projects[0].episodes.b.versionConflict,true);
console.log('PASS 置零来源可辨可覆盖、reconcile 幂等且与改动来源无关、同版同日不猜');
