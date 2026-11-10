import {webRoot,webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('assets/data-repository.js', webRootURL), 'utf8'), context);
const values = new Map([['settlement-theme', 'dark']]);
let blocked = false;
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem(key, value) { if (blocked) throw new Error('QuotaExceededError'); values.set(key, value); },
  removeItem(key) { if (blocked) throw new Error('拒绝删除'); values.delete(key); }
};
const repo = context.SettlementRepository.createLocalRepository(storage);
assert.equal(repo.readCurrent(), null);
const corrupt = '{损坏原文\r\n';
repo.writeCurrent(corrupt);
assert.equal(repo.readCurrent(), corrupt);
repo.writeRecovery(repo.readCurrent());
assert.equal(repo.readRecovery(), corrupt);
blocked = true;
assert.throws(() => repo.writeCurrent('{}'), /QuotaExceededError/);
assert.equal(repo.readCurrent(), corrupt);
assert.throws(() => repo.deleteCurrent(), /拒绝删除/);
assert.equal(repo.readCurrent(), corrupt);
blocked = false;
assert.throws(() => repo.writeCurrent({}), /字符串/);
assert.equal(repo.readCurrent(), corrupt);
repo.writeCurrent('{"prices":{},"projects":[]}');
assert.equal(repo.readRecovery(), corrupt);
repo.deleteCurrent();
assert.equal(repo.readCurrent(), null);
assert.equal(values.get('settlement-theme'), 'dark');
console.log('PASS 仓储空值、损坏原文、恢复快照、失败不覆写、输入约束和设置隔离');
