import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const context=vm.createContext({
  commitDataChangeCallback:null,
  state:{data:{projects:[]}},
  toast(){},
  normalizeData(d){return d;},
  commitDataChange(next){this.lastCommit=next;return true;},
  renderImportPreview(){},
  renderMultiProjectPreview(){},
  workTypeOf(r){return r.workType||'混音';},
  importStorageKey(row){return String(Number(row.episodeNo||0))||'demo';},
  importExistingKey(){return null;},
  preferImportCandidate(){return 0;},
  deliveryDateInfo(){return {};},
  window:{_importPreview:null,_multiImport:null},
  console,
});
for(const name of ['revision-parse','exclusion-rules','version-reconciliation']){
  vm.runInContext(await readFile(new URL('assets/'+name+'.js',webRootURL),'utf8'),context);
}
context.state.data={schemaVersion:3,prices:{},premiumPrices:{},projects:[]};
const {SettlementRevision,reconcileFormalVersions}=context;

const project={name:'心剑',type:'正式',billingCategory:'premium',grade:'B',mode:'按时长',episodes:{}};
// 同集两条记录：同版本号 V02，但日期 10-12 / 10-18 → 一定是忘了升版
const p={...project,episodes:{
  v2a:{recordId:'r1',episodeNo:'3',type:'正式',workType:'混音',date:'2026-10-12',duration:'00:43:00',sourceFile:'心剑_EP03_混音_V02_1012.wav'},
  v2b:{recordId:'r2',episodeNo:'3',type:'正式',workType:'混音',date:'2026-10-18',duration:'00:43:00',sourceFile:'心剑_EP03_混音_V02_1018.wav'},
}};
const next={projects:[JSON.parse(JSON.stringify(p))]};
reconcileFormalVersions(next);
const a=next.projects[0].episodes.v2a,b=next.projects[0].episodes.v2b;
assert.equal(a.needsReview,true);
assert.equal(b.needsReview,true);
assert.match(a.versionConflict,/V02/);
// 冲突组不猜谁是最新版：两条都不置零、都不计费判定改动
assert.equal(!!a.excluded,false);
assert.equal(!!b.excluded,false);

// 正常两版（V02 10-12 / V03 10-18）：旧版置零，新版本保留
const ok={projects:[{...project,episodes:{
  a:{recordId:'r1',episodeNo:'3',type:'正式',workType:'混音',date:'2026-10-12',duration:'00:43:00',sourceFile:'心剑_EP03_混音_V02_1012.wav'},
  b:{recordId:'r2',episodeNo:'3',type:'正式',workType:'混音',date:'2026-10-18',duration:'00:43:00',sourceFile:'心剑_EP03_混音_V03_1018.wav'},
}}]};
reconcileFormalVersions(ok);
assert.equal(ok.projects[0].episodes.a.versionSuperseded,true);
assert.equal(ok.projects[0].episodes.a.excluded,true);
assert.equal(ok.projects[0].episodes.b.versionSuperseded,undefined);
assert.equal(ok.projects[0].episodes.b.needsReview,undefined);

// 幂等：再跑一次结果一致（不因上一次置零而改判）
const snapshot=JSON.stringify(ok);
reconcileFormalVersions(ok);
assert.equal(JSON.stringify(ok),snapshot);

console.log('PASS D1：同版本不同日期标待核对不猜；正常升级仍只压旧版；重复执行幂等');
