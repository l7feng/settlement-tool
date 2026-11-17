import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});
for(const name of ['billing-core','rate-snapshot']){
  vm.runInContext(await readFile(new URL('assets/'+name+'.js',webRootURL),'utf8'),context);
}
const {SettlementBilling:billing,SettlementRates:rates}=context;

const prices={A:{per_min:90,per_ep:90},B:{per_min:60,per_ep:60},C:{per_min:30,per_ep:30},D:{per_min:40,per_ep:10}};
const premiumPrices={A:{per_min:90,per_ep:90},B:{per_min:60,per_ep:60},C:{per_min:30,per_ep:30}};
// 用非阶梯（旧账本口径）项目，单价表走 prices，便于验证「改价不动历史」
const project={name:'旧项目',billingCategory:'legacy',grade:'B',mode:'按时长',episodes:{}};
const record={duration:'00:10:00',workType:'混音',date:'2026-10-01',grade:'B'};
const data={projects:[{...project,episodes:{'1':{...record}}}],prices,premiumPrices};

// 迁移：回填快照，金额与回填前逐条一致
const beforeFee=billing.fee(prices,project,record,premiumPrices);
assert.equal(beforeFee,600);
rates.ensure(data);
const p=data.projects[0],r=p.episodes['1'];
assert.equal(r.rateSource,'legacy');
assert.equal(r.rateSnapshot.level,'B');
assert.equal(r.rateSnapshot.per_min,60);
assert.equal(billing.fee(data.prices,p,r,data.premiumPrices),beforeFee);

// 改单价：历史记录金额不动
const newPrices={...prices,B:{per_min:200,per_ep:200}};
assert.equal(billing.fee(newPrices,p,r,premiumPrices),600,'改单价后历史记录金额必须不变');
// 新登记记录按新价冻结
const fresh=rates.stamp(p,{...record},newPrices,premiumPrices);
assert.equal(fresh.rateSnapshot.per_min,200);
assert.equal(billing.fee(newPrices,p,fresh,premiumPrices),2000,'00:10:00 × 200/分 = 2000');
// 再改一次价，这条新记录也不动
assert.equal(billing.fee({...newPrices,B:{per_min:1,per_ep:1}},p,fresh,premiumPrices),2000);

// 人工纠正等级 → 金额跟着等级走（改等级不是改单价）
const corrected={...fresh,grade:'A'};
assert.equal(billing.fee(newPrices,p,corrected,premiumPrices),900,'A 档 90/分 × 10 分钟');

// 阶梯项目：区间定级，等级一致时用快照（精品剧走 premiumPrices）
const stair={name:'精品',billingCategory:'premium',grade:'C',mode:'按集',gradeRanges:'1=A,2-10=B',episodes:{}};
const stairRecord=rates.stamp(stair,{episodeNo:'2',type:'正式',duration:'00:10:00'},prices,{...premiumPrices,B:{per_min:66,per_ep:66}});
assert.equal(stairRecord.rateSnapshot.level,'B');
assert.equal(billing.fee(prices,stair,stairRecord,premiumPrices),66);
// 区间改到 A：等级变了 → 回到现价（不能用 B 的旧快照）
assert.equal(billing.grade({...stair,gradeRanges:'1-99=A'},stairRecord),'A');
assert.equal(billing.fee(prices,{...stair,gradeRanges:'1-99=A'},stairRecord,premiumPrices),90);

// 不计价记录也要冻结（日后恢复计费时用的是交付时的价，不是改价后的价）
const excluded={...record,excluded:true,excludeReason:'客户不结算'};
rates.stamp(p,excluded,prices,premiumPrices);
assert.equal(excluded.rateSnapshot.per_min,60);
assert.equal(billing.fee(prices,p,{...excluded,excluded:false},premiumPrices),600);

// 界面取价与计价取价同源：price() 不返回「新价」而返回记录内快照
assert.equal(billing.price({B:{per_min:999,per_ep:999}},p,r,premiumPrices).per_min,60);
console.log('PASS 单价冻结：历史不动、新记录按新价、等级纠正仍生效、阶梯区间一致、展示同源');
