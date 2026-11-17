/* A synchronous Storage adapter keeps the existing journal/rollback contract. */
(function () {
  'use strict';
  // settlement_active_profile：当前打开的工作台。此前只在 localStorage，
  // 清缓存会静默回到「工作台1」，用户看到另一本账、以为数据丢了。随文件一起保存。
  const keys = ['settlement_v1','settlement_recovery_v2','settlement-settings-v1','settlement-cols-v1','settlement-theme','settlement-glass-tuner','settlement-workspace-journal-v1','settlement-upgrade-snapshots-v1','settlement_workbenches_v1','settlement_active_profile'];
  // 每个工作台各有一份账本；此前只落在浏览器存储里，必须随工作区文件一起保存和迁移。
  const LEDGER_KEY = /^settlement_(?:v1|recovery_v2)_profile_[A-Za-z0-9_-]{1,64}$/;
  function managed(key) { return keys.includes(key) || LEDGER_KEY.test(key); }
  let cache;
  try { cache = window.localStorage; } catch (_) { cache = null; }
  window.workspaceStorage = cache;
  window.desktopWorkspace = {enabled:false,error:null};
  if (!window.__settlementWorkspaceToken) return; // Standalone HTML keeps its browser store.
  // 升级前快照的原文已搬到 upgrade/ 目录（账本只留索引）；导出时按文件名同步取回。
  // 保持同步 XHR：downloadLatestUpgradeSnapshot 的 try/catch 语义不变。
  window.__settlementUpgradeLoader = function (file) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/__upgrade_blob__?file=' + encodeURIComponent(file), false);
    xhr.setRequestHeader('X-Settlement-Workspace', window.__settlementWorkspaceToken);
    xhr.send(null);
    if (xhr.status !== 200) throw new Error('快照原文读取失败');
    return xhr.responseText;
  };
  let values = {}, revision = 0, failure = null, notified = false;
  function request(method, path, payload) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, false);
    xhr.setRequestHeader('X-Settlement-Workspace', window.__settlementWorkspaceToken);
    if (payload) xhr.setRequestHeader('Content-Type','application/json');
    xhr.send(payload ? JSON.stringify(payload) : null);
    let result;
    try { result = JSON.parse(xhr.responseText); } catch (_) { throw new Error('工作区服务没有返回有效结果'); }
    if (xhr.status !== 200) throw new Error(result.error || '工作区保存失败');
    return result;
  }
  function fail(error) {
    failure = error;
    window.desktopWorkspace.error = error.message;
    if (!notified) {
      notified = true;
      setTimeout(() => alert('自动保存已暂停：'+error.message+'。请先导出备份，再检查文件或重新打开软件。'),0);
    }
    throw error;
  }
  // 增量落账：只把变化的键发给工作区服务，请求仍然同步（返回即落盘），
  // 但 415KB 全量请求变成几十字节，界面不再被序列化+传输拖住。
  function commitFull(next) {
    if (failure) throw failure;
    try {
      const saved = request('POST','/__workspace__',{revision,storage:next});
      revision = saved.revision;
      values = saved.storage;
    } catch (error) { return fail(error); }
  }
  function commit(changes) {
    if (failure) throw failure;
    try {
      const saved = request('POST','/__workspace__',{revision,patch:changes});
      revision = saved.revision;
      // 服务端只回执版本号（不回传 400KB 全文），本地按本次变更合并内存副本。
      const next = {...values};
      for (const [key, value] of Object.entries(changes)) { if (value === null) delete next[key]; else next[key] = value; }
      values = next;
    } catch (error) {
      // 旧版 exe 只认全量 storage：识别到格式不匹配就退回整份提交，不丢这次修改。
      if (/'storage'|增量写入|格式无效/.test(error.message||'')) {
        const next = {...values};
        for (const [key, value] of Object.entries(changes)) { if (value === null) delete next[key]; else next[key] = value; }
        return commitFull(next);
      }
      return fail(error);
    }
  }
  // ── 设置类写入合并（1.3）───────────────────────────────────────────────
  // 账本类键必须同步落盘：它承载钱，失败要立刻抛错、界面立刻知道。
  // 设置类键（主题/列宽/玻璃参数/偏好）在拖动滑块时每秒能写十几次，
  // 每次都走一遍 fsync 只是白等；这里先在内存里生效，200ms 内合并成一次写入。
  // 合并窗口内崩溃最多丢一次「刚拖到一半」的外观设置，不涉及账目。
  const FLUSH_DELAY = 200;
  const DEFERRABLE = new Set(['settlement-settings-v1','settlement-cols-v1','settlement-theme','settlement-glass-tuner']);
  let pending = {}, flushTimer = null;
  function flushPending() {
    if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
    const changes = pending;
    pending = {};
    if (!Object.keys(changes).length) return;
    try { commit(changes); } catch (_) {}   // 失败提示已在 commit/fail 里给出，这里不再抛到 UI
  }
  function schedule(key, value) {
    pending[key] = value;
    if (flushTimer === null) flushTimer = setTimeout(() => { flushTimer = null; flushPending(); }, FLUSH_DELAY);
  }
  window.workspaceStorage = {
    getItem(key) { return managed(key) ? (Object.hasOwn(values,key) ? values[key] : null) : cache?.getItem(key) ?? null; },
    setItem(key,value) {
      if (!managed(key)) { if(cache)cache.setItem(key,value);return; }
      value=String(value);
      if(values[key]===value)return;
      if(DEFERRABLE.has(key)) {
        values[key]=value;                       // 立刻可读，不等落盘
        try { cache?.setItem(key,value); } catch (_) {}
        schedule(key,value);
        return;
      }
      commit({[key]:value});
      try { cache?.setItem(key,value); } catch (_) {} // File success is authoritative.
    },
    removeItem(key) {
      if(!managed(key)){cache?.removeItem(key);return;}
      if(!Object.hasOwn(values,key))return;
      delete values[key];
      if(DEFERRABLE.has(key)) {
        try { cache?.removeItem(key); } catch (_) {}
        schedule(key,null);
        return;
      }
      commit({[key]:null});
      try { cache?.removeItem(key); } catch (_) {}
    },
    flush:flushPending
  };
  // 关窗/切后台前把待写设置补落一次，缩短「合并窗口内崩溃」的丢失面。
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushPending(); });
  function cacheValues() {
    const out={};
    for(const key of keys){const raw=cache?.getItem(key);if(raw!=null)out[key]=raw;}
    for(let i=0;i<(cache?.length||0);i++){const key=cache.key(i);if(key&&LEDGER_KEY.test(key)){const raw=cache.getItem(key);if(raw!=null)out[key]=raw;}}
    return out;
  }
  try {
    const legacy={};
    let cacheReadError=null;
    try { Object.assign(legacy,cacheValues()); }
    catch(error) { cacheReadError=error;cache=null; }
    const saved=request('GET','/__workspace__');
    revision=saved.revision;
    values=saved.storage;
    if(revision===0){if(cacheReadError)throw new Error('无法读取旧浏览器数据，首次迁移已暂停');values=legacy;if(Object.hasOwn(legacy,'settlement_v1'))commitFull(legacy);}
    else {
      request('POST','/__workspace_legacy__',{storage:legacy});
      // 旧版账本只存在浏览器里；并入文件后由文件统一保存，缺失键才迁移，不覆盖现有数据。
      const missing=Object.fromEntries(Object.entries(legacy).filter(([key])=>!Object.hasOwn(values,key)));
      if(Object.keys(missing).length)commit(missing);
    }
    window.desktopWorkspace.enabled=true;
    window.desktopWorkspace.path=saved.path;
  } catch(error) {
    // Read-only legacy data remains available; never seed defaults over a damaged file.
    values={};try { Object.assign(values,cacheValues()); } catch (_) {}
    try { fail(error); } catch (_) {}
  }
})();
