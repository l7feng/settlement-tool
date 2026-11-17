import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const context=vm.createContext({console});
vm.runInContext(await readFile(new URL('assets/version-timeline.js',webRootURL),'utf8'),context);
const {SettlementVersion}=context;

const project={name:'心剑',billingCategory:'legacy',grade:'B',episodes:{
  '3':{recordId:'r1',episodeNo:'3',type:'正式',workType:'混音',date:'2026-10-01',duration:'00:40:00'},
  '03b':{recordId:'r2',episodeNo:'3',type:'正式',workType:'重混',date:'2026-10-08',duration:'00:40:00'},
}};

// 同集同工作类型 → 判重复
assert.equal(SettlementVersion.findEpisodeKey(project,'3','混音'),'3');
// 同集不同工作类型 → 不判重复（重混是另一份工作）
assert.equal(SettlementVersion.findEpisodeKey(project,'3','重混'),'03b');
assert.equal(SettlementVersion.findEpisodeKey(project,'3','修改'),null);
// 不传工作类型保持旧行为：命中该集第一条
assert.equal(SettlementVersion.findEpisodeKey(project,'3'),'3');
// 集号带前导零视为同一集
assert.equal(SettlementVersion.findEpisodeKey(project,'03','重混'),'03b');
assert.equal(SettlementVersion.findEpisodeKey(project,'9','混音'),null);
assert.equal(SettlementVersion.findEpisodeKey(project,'abc','混音'),null);
assert.equal(SettlementVersion.findEpisodeKey(null,'3','混音'),null);

console.log('PASS 登记判重：按集号+工作类型，重混不再被混音挡住');
