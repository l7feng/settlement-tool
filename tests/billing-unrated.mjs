import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});
for(const name of ['revision-parse','import-metadata','billing-core']){
  vm.runInContext(await readFile(new URL('assets/'+name+'.js',webRootURL),'utf8'),context);
}
const {SettlementImportMetadata:meta,SettlementBilling:billing}=context;

// 导入识别不再默认 C：无显式标记、无同名项目 → null（待定级）
assert.equal(meta.infer('D:/交付/某项目 第3集/V03.wav',[]).grade,null);
// 已经有同名项目 → 取项目等级（项目 B 级导入无标记交付按 B）
const known={name:'心剑',grade:'B',billingCategory:'premium'};
assert.equal(meta.infer('D:/交付/心剑/V03.wav',[known]).grade,'B');
assert.equal(meta.infer('D:/交付/心剑/V03.wav',[{...known,grade:'A'}]).grade,'A');
// 显式标记仍然优先
assert.equal(meta.infer('D:/交付/心剑 A/V03.wav',[]).grade,'A');
assert.equal(meta.infer('D:/交付/自动化剧/V03.wav',[]).grade,'D');
assert.equal(meta.infer('D:/交付/某项目 Demo/V03.wav',[]).grade,'A');

// 待定级记录：计 0 但 needsGrade 为真，界面据此提示，不静默
const prices={A:{per_min:90,per_ep:90},B:{per_min:60,per_ep:60},C:{per_min:30,per_ep:30},D:{per_min:40,per_ep:10}};
const legacy={name:'旧账本项目',billingCategory:'legacy',grade:null,mode:'按时长',episodes:{}};
const record={duration:'00:01:00',workType:'混音',date:'2026-11-01'};
assert.equal(billing.fee(prices,legacy,record),0);
assert.equal(billing.needsGrade(legacy,record),true);
assert.equal(billing.grade(legacy,record),null);
// 项目一旦定了等级就不再是待定级
assert.equal(billing.fee(prices,{...legacy,grade:'B'},record),60);
assert.equal(billing.needsGrade({...legacy,grade:'B'},record),false);
// 排除/旧版本即使没有等级也不算待定级（本来就不计钱）
assert.equal(billing.needsGrade(legacy,{...record,excluded:true}),false);
// 精品剧阶梯项目：区间命中用区间等级，不因记录无等级而待定级
const premium={name:'精品',billingCategory:'premium',grade:'C',mode:'按集',gradeRanges:'1=A,2-10=B',episodes:{}};
assert.equal(billing.grade(premium,{episodeNo:'2',type:'正式'}),'B');
assert.equal(billing.needsGrade(premium,{episodeNo:'2',type:'正式'}),false);
assert.equal(billing.fee(prices,premium,{episodeNo:'2',type:'正式',duration:'00:10:00'}),60);
// 自动化项目只有 D：等级不是 D 时算待定级配置错误
assert.equal(billing.needsGrade({name:'自动',billingCategory:'automation',grade:'D',mode:'按时长'} ,{duration:'00:01:00',grade:'A'}),true);
console.log('PASS 导入不再默认 C、待定级计 0 且可被汇总发现、阶梯与自动化口径不变');
