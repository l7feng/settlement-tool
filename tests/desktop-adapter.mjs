// 桌面存储适配器单测：设置类写入合并（1.3）、升级快照原文加载（1.1）、工作台键托管（1.7）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const ROOT = process.env.SETTLEMENT_WEB_ROOT || 'D:/Ai-Files/Repos/settlement-tool';
const SOURCE = fs.readFileSync(path.join(ROOT, 'assets/desktop-workspace.js'), 'utf8');

function boot(initial = {}, opts = {}) {
  const server = { storage: { ...initial }, revision: Object.keys(initial).length ? 7 : 0, writes: [], blobs: opts.blobs || {}, conflictOnce: !!opts.conflictOnce, lastChange: opts.lastChange || null, previous: opts.previous || null };
  class XHR {
    constructor() { this.status = 0; this.responseText = ''; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      const payload = body ? JSON.parse(body) : null;
      server.writes.push({ method: this.method, url: this.url, payload });
      if (this.method === 'GET' && this.url === '/__workspace__') {
        this.status = 200;
        this.responseText = JSON.stringify({ formatVersion: 1, app: 'settlement-workbench', revision: server.revision, storage: server.storage, path: 'C:/x/workspace.json', lastChange: server.lastChange || null, capabilities: ['patch'] });
        return;
      }
      if (this.method === 'GET' && this.url === '/__workspace_previous__') {
        if (!server.previous) { this.status = 404; this.responseText = '{"error":"没有可用的上一版本"}'; return; }
        this.status = 200;
        this.responseText = JSON.stringify({ revision: server.revision - 1, storage: server.previous });
        return;
      }
      if (this.method === 'GET' && this.url.startsWith('/__upgrade_blob__')) {
        const name = decodeURIComponent(this.url.split('file=')[1]);
        if (!(name in server.blobs)) { this.status = 404; this.responseText = '{"error":"快照文件不存在"}'; return; }
        this.status = 200; this.responseText = server.blobs[name]; return;
      }
      if (this.method === 'POST' && this.url === '/__workspace__') {
        if (server.conflictOnce) {
          // 模拟另一个窗口先写了一步：磁盘版本号变了，回执带 conflict 标记（S2-2.8）
          server.conflictOnce = false;
          server.conflicts = (server.conflicts || 0) + 1;
          server.revision += 1;
          this.status = 409;
          this.responseText = JSON.stringify({ error: '另一个窗口已更新工作区，请关闭其他窗口并重新打开', conflict: 'revision', revision: server.revision, capabilities: ['patch'] });
          return;
        }
        if (payload.storage) { server.storage = { ...payload.storage }; }
        else { for (const [k, v] of Object.entries(payload.patch)) { if (v === null) delete server.storage[k]; else server.storage[k] = v; } }
        server.revision += 1;
        this.status = 200;
        this.responseText = JSON.stringify(payload.storage
          ? { formatVersion: 1, app: 'settlement-workbench', revision: server.revision, storage: server.storage }
          : { formatVersion: 1, app: 'settlement-workbench', revision: server.revision });
        return;
      }
      this.status = 200; this.responseText = '{"ok":true}';
    }
  }
  const store = new Map(Object.entries(opts.localStorage || {}));
  const cache = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), get length() { return store.size; }, key: i => [...store.keys()][i] ?? null };
  const listeners = {};
  const ctx = {
    console, JSON, setTimeout, clearTimeout, alert: () => { ctx.alerts.push('alert'); },
    alerts: [], XMLHttpRequest: XHR, localStorage: cache,
    __settlementWorkspaceToken: 'token-123',
    document: { visibilityState: 'visible', addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'desktop-workspace.js' });
  return { ctx, server, listeners, cache };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0;
const ok = (name) => { pass++; console.log('  ok  ' + name); };

(async () => {
  // 1.3 设置类写入合并：连拖 5 次玻璃参数只落一次盘，内存立刻可读
  {
    const { ctx, server } = boot({ settlement_v1: '{"projects":[]}' });
    const before = server.writes.length;
    for (let i = 0; i < 5; i++) ctx.workspaceStorage.setItem('settlement-glass-tuner', JSON.stringify({ blur: i }));
    assert.equal(ctx.workspaceStorage.getItem('settlement-glass-tuner'), JSON.stringify({ blur: 4 }));
    assert.equal(server.writes.length, before, '合并窗口内不应立即写盘');
    await wait(260);
    assert.equal(server.writes.length, before + 1, '窗口结束后应只写一次');
    assert.equal(server.storage['settlement-glass-tuner'], JSON.stringify({ blur: 4 }));
    ok('设置类连写 5 次 → 合并成 1 次落盘，内存立即生效');
  }

  // 1.3 业务账本仍同步落盘，失败要当场抛
  {
    const { ctx, server } = boot({ settlement_v1: 'old' });
    ctx.workspaceStorage.setItem('settlement_v1', 'new-ledger');
    assert.equal(server.storage.settlement_v1, 'new-ledger', '账本必须同步落盘');
    assert.equal(server.revision, 8);
    ok('业务账本 setItem 同步落盘（不进入合并队列）');
  }

  // 1.3 flush 主动补写（关窗前调用）
  {
    const { ctx, server } = boot({ settlement_v1: 'x' });
    ctx.workspaceStorage.setItem('settlement-theme', 'ocean');
    assert.equal(server.storage['settlement-theme'], undefined);
    ctx.workspaceStorage.flush();
    assert.equal(server.storage['settlement-theme'], 'ocean');
    ok('flush 把待写设置立刻落盘');
  }

  // 1.3 不同设置键在同一个窗口内合并为一次请求
  {
    const { ctx, server } = boot({ settlement_v1: 'x' });
    const before = server.writes.length;
    ctx.workspaceStorage.setItem('settlement-theme', 'paper');
    ctx.workspaceStorage.setItem('settlement-cols-v1', '{"order":[]}');
    ctx.workspaceStorage.setItem('settlement-settings-v1', '{"confirmDel":true}');
    await wait(260);
    assert.equal(server.writes.length, before + 1, '三个键应合并成一次请求');
    const patch = server.writes.at(-1).payload.patch;
    assert.deepEqual(Object.keys(patch).sort(), ['settlement-cols-v1', 'settlement-settings-v1', 'settlement-theme']);
    ok('不同设置键同窗口合并为一次 patch');
  }

  // 1.1 升级快照原文加载器：按索引文件名取回原文
  {
    const raw = { settlement_v1: '{"projects":[]}', 'settlement-theme': 'dark' };
    const blobs = { 'a-b-c.json.gz': JSON.stringify(raw) };
    const { ctx } = boot({ settlement_v1: 'x' }, { blobs });
    assert.equal(ctx.__settlementUpgradeLoader('a-b-c.json.gz'), JSON.stringify(raw));
    assert.throws(() => ctx.__settlementUpgradeLoader('missing.json.gz'), /快照原文读取失败/);
    ok('__settlementUpgradeLoader 按名取回快照原文，缺失时抛错');
  }

  // 1.7 当前工作台键纳入托管（不落 localStorage）
  {
    const { ctx, server } = boot({ settlement_v1: 'x' });
    ctx.workspaceStorage.setItem('settlement_active_profile', 'job');
    assert.equal(server.storage['settlement_active_profile'], 'job', '当前工作台必须进 workspace.json');
    ok('settlement_active_profile 写入工作区文件');
  }

  // 未托管键仍走浏览器存储
  {
    const { ctx, server, cache } = boot({ settlement_v1: 'x' });
    ctx.workspaceStorage.setItem('some-ui-flag', '1');
    assert.equal(cache.getItem('some-ui-flag'), '1');
    assert.equal(server.storage['some-ui-flag'], undefined);
    ok('未托管键不进入工作区文件');
  }

  // 2.8 版本冲突自动重放：另一个窗口先写过，这次改动重载后重放成功，不再让用户重开
  {
    const { ctx, server } = boot({ settlement_v1: 'old' }, { conflictOnce: true });
    ctx.workspaceStorage.setItem('settlement_v1', 'new-ledger');
    assert.equal(server.conflicts, 1, '应触发一次 409 冲突');
    assert.equal(server.storage.settlement_v1, 'new-ledger', '重放后账本必须落盘');
    assert.equal(ctx.workspaceStorage.getItem('settlement_v1'), 'new-ledger', '内存副本要跟着重载后的服务端状态');
    assert.equal(ctx.desktopWorkspace.error, undefined, '自动重放成功不应进入暂停保存状态');
    ok('409 冲突 → 重载磁盘版本后重放一次，改动不丢、不弹重开提示');
  }

  // 2.9 重启后一次撤销：开机把「上一次变更之前」的账本取到内存，用掉后日志删除
  {
    const previous = { settlement_v1: '{"projects":[]}', 'settlement-theme': 'dark' };
    const { ctx, server } = boot({ settlement_v1: '{"projects":[{"name":"A"}]}' },
      { lastChange: { revision: 7, label: '导入', updatedAt: '2026-11-17T10:00:00Z' }, previous });
    assert.equal(ctx.desktopWorkspace.restartUndo.label, '导入', '开机应带回可撤销的上次变更');
    assert.equal(ctx.desktopWorkspace.restartUndo.storage.settlement_v1, '{"projects":[]}', '要拿到上一个版本的账本原文');
    ctx.desktopWorkspace.consumeRestartUndo();
    assert.equal(ctx.desktopWorkspace.restartUndo, null, '用掉之后本会话不再提供');
    assert.ok(server.writes.some(w => w.payload && w.payload.action === 'consume-last-change'), '要通知服务端删日志，避免下次再撤一次');
    ok('重启后一次撤销：取上一版本原文 → 用掉即删日志');
  }

  console.log('desktop 适配器 ' + pass + ' 组断言通过');
})().catch(error => { console.error('FAIL', error.message); process.exit(1); });
