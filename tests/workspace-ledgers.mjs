import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('assets/workspace-state.js', webRootURL), 'utf8'), context);
const W = context.SettlementWorkspace, K = W.KEYS;
const inRealm = value => vm.runInContext(`(${JSON.stringify(value)})`, context);
const business = '{"prices":{},"projects":[]}';
const ledger = '{"prices":{},"projects":[{"name":"外包"}]}';

function makeStorage(seed = {}, failOnceKey = null) {
  const map = new Map(Object.entries(seed));
  let failed = false;
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (!failed && key === failOnceKey) { failed = true; throw new Error('quota'); }
      map.set(key, String(value));
    },
    removeItem(key) {
      if (!failed && key === failOnceKey) { failed = true; throw new Error('quota'); }
      map.delete(key);
    }
  };
}

// 非默认账本与业务原文一次提交，成功后不留日志。
{
  const s = makeStorage({settlement_v1_profile_job: 'old'});
  const {before} = W.writeBundle(s, inRealm({businessRaw: business, ledgers: {'settlement_v1_profile_job': ledger}}));
  assert.equal(s.getItem(K.business), business);
  assert.equal(s.getItem('settlement_v1_profile_job'), ledger);
  assert.equal(s.getItem(K.journal), null);
  assert.equal(before[K.business], null);
  assert.equal(before.settlement_v1_profile_job, 'old');
}

// 中途写入失败时，业务与全部账本回到原值并清掉日志。
{
  const s = makeStorage({settlement_v1: 'old business', settlement_v1_profile_job: 'old ledger'}, 'settlement_v1_profile_job');
  assert.throws(() => W.writeBundle(s, inRealm({businessRaw: business, ledgers: {'settlement_v1_profile_job': ledger}})), /工作区提交失败/);
  assert.equal(s.getItem(K.business), 'old business');
  assert.equal(s.getItem('settlement_v1_profile_job'), 'old ledger');
  assert.equal(s.getItem(K.journal), null);
}

// 只接受真实账本键；任意路径或非账本键一律拒绝。
{
  const s = makeStorage();
  assert.throws(() => W.writeBundle(s, inRealm({businessRaw: business, ledgers: {'settlement_v1_profile_a/b': ledger}})), /账本存储键无效/);
  assert.throws(() => W.writeBundle(s, inRealm({businessRaw: business, ledgers: {'settlement-settings-v1': ledger}})), /账本存储键无效/);
  assert.equal(s.map.size, 0);
}

// 遗留日志存在时拒绝覆盖。
{
  const s = makeStorage({[K.journal]: JSON.stringify({formatVersion: 1, before: {}})});
  assert.throws(() => W.writeBundle(s, inRealm({businessRaw: business})), /存在未恢复提交/);
}

// 升级快照收录账本原文，导出的备份包裹带 ledgers。
{
  const s = makeStorage({
    [K.business]: business,
    settlement_workbenches_v1: JSON.stringify([{id: 'default', name: '工作台1'}, {id: 'job', name: '外包'}]),
    settlement_v1_profile_job: ledger,
    [K.upgrades]: JSON.stringify({formatVersion: 1, snapshots: []})
  });
  assert.equal(W.createUpgradeSnapshot(s, '9.9.9').created, true);
  const snapshot = inRealm(JSON.parse(s.getItem(K.upgrades)).snapshots[0]);
  assert.equal(snapshot.raw.settlement_v1_profile_job, ledger);
  const exported = W.exportUpgradeSnapshot(snapshot);
  assert.equal(exported.kind, 'backup');
  assert.equal(exported.envelope.ledgers.job, ledger);
}

// 活动账本不是默认账本时，业务写入该账本键，默认账本按原键恢复。
{
  const s = makeStorage();
  W.writeBundle(s, inRealm({businessRaw: business, businessKey: 'settlement_v1_profile_job', ledgers: {settlement_v1: ledger}}));
  assert.equal(s.getItem('settlement_v1_profile_job'), business);
  assert.equal(s.getItem('settlement_v1'), ledger);
  assert.throws(() => W.writeBundle(s, inRealm({businessRaw: business, businessKey: 'settlement_v1_profile_job', ledgers: {'settlement_v1_profile_job': ledger}})), /账本存储键重复/);
}

console.log('PASS 多账本事务、回滚、键白名单与升级快照');
