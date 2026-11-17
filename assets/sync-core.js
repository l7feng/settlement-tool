/* 本地优先同步协议原型：模拟传输不提供真实账号认证或云存储。 */
(function (scope) {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<=160;
  const key=(type,id)=>JSON.stringify([type,id]);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function checkEntity(type,id,payload,deleted) {
    if(!validId(type)||!validId(id))throw new Error('实体类型或稳定编号无效');
    if(typeof deleted!=='boolean')throw new Error('删除标记必须是布尔值');
    if(!deleted&&(payload===null||typeof payload!=='object'||Array.isArray(payload)))throw new Error('实体内容必须是对象');
    if(!deleted)copy(payload);
  }
  function emptyState(accountId,deviceId) {
    if(!validId(accountId)||!validId(deviceId))throw new Error('账号或设备编号无效');
    return {formatVersion:1,accountId,deviceId,cursor:0,entities:{},queue:[],conflicts:{}};
  }
  function validateState(state,accountId,deviceId) {
    if(state.formatVersion!==1||state.accountId!==accountId||state.deviceId!==deviceId)throw new Error('同步状态不属于当前账号或设备');
    if(!Number.isSafeInteger(state.cursor)||state.cursor<0||!state.entities||!state.conflicts||!Array.isArray(state.queue))throw new Error('同步状态格式错误');
    for(const [entityKey,e] of Object.entries(state.entities)) {
      checkEntity(e.type,e.id,e.payload,e.deleted);
      if(entityKey!==key(e.type,e.id)||!Number.isSafeInteger(e.revision)||e.revision<0)throw new Error('实体版本无效');
    }
    const ids=new Set();
    for(const op of state.queue) {
      checkEntity(op.type,op.id,op.payload,op.deleted);
      if(!validId(op.opId)||ids.has(op.opId)||op.accountId!==accountId||op.deviceId!==deviceId||!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0)throw new Error('待同步操作无效');
      ids.add(op.opId);
    }
  }
  function createClient(options) {
    const {accountId,deviceId,save,transport}=options;
    if(typeof save!=='function')throw new Error('必须提供原子保存回调');
    const idFactory=options.idFactory||(()=>scope.crypto.randomUUID());
    let state=copy(options.initialState||emptyState(accountId,deviceId)),busy=false;
    validateState(state,accountId,deviceId);
    // 数据、队列、游标和冲突同批保存；失败时不提交内存状态。
    function commit(next) {
      validateState(next,accountId,deviceId);
      const result=save(copy(next));
      if(result&&typeof result.then==='function')throw new Error('原子保存回调必须同步完成');
      if(result===false)throw new Error('本地保存失败');
      state=next;
    }
    function operation(type,id,payload,deleted,revision) {
      const opId=idFactory();
      if(!validId(opId))throw new Error('操作编号无效');
      return {opId,accountId,deviceId,type,id,payload:deleted?null:copy(payload),deleted:!!deleted,baseRevision:revision};
    }
    function write(type,id,payload,deleted) {
      checkEntity(type,id,payload,deleted);
      const entityKey=key(type,id);
      if(state.conflicts[entityKey])throw new Error('先处理这条记录的同步冲突');
      const next=copy(state),revision=next.entities[entityKey]?.revision||0;
      next.entities[entityKey]={type,id,payload:deleted?null:copy(payload),deleted:!!deleted,revision};
      next.queue.push(operation(type,id,payload,deleted,revision));
      commit(next);return copy(next.entities[entityKey]);
    }
    function resolve(type,id,choice,payload) {
      const entityKey=key(type,id),conflict=state.conflicts[entityKey];
      if(!conflict)throw new Error('没有待处理冲突');
      if(!['local','remote','custom','delete'].includes(choice))throw new Error('冲突处理方式无效');
      const next=copy(state),remote=conflict.remote;
      next.queue=next.queue.filter(op=>key(op.type,op.id)!==entityKey);
      delete next.conflicts[entityKey];
      const entity=choice==='remote'?copy(remote):choice==='local'?copy(conflict.local):{type,id,payload:choice==='delete'?null:copy(payload),deleted:choice==='delete'};
      checkEntity(type,id,entity.payload,entity.deleted);
      entity.revision=remote.revision;next.entities[entityKey]=entity;
      if(choice!=='remote')next.queue.push(operation(type,id,entity.payload,entity.deleted,remote.revision));
      commit(next);return copy(entity);
    }
    async function synchronize() {
      if(busy)return {status:'busy'};
      if(!transport)return {status:'offline',reason:'未连接模拟传输'};
      busy=true;let uploaded=0,downloaded=0;
      try {
        // 冲突操作留在队列，其他实体可以继续同步。
        while(true) {
          const pending=state.queue.find(op=>!state.conflicts[key(op.type,op.id)]);
          if(!pending)break;
          const op=copy(pending),answer=await transport.push(op);
          if(answer.accountId!==accountId||answer.opId!==op.opId)throw new Error('同步响应账号或操作编号不匹配');
          const entityKey=key(op.type,op.id),next=copy(state);
          if(answer.status==='conflict') {
            checkEntity(answer.remote.type,answer.remote.id,answer.remote.payload,answer.remote.deleted);
            if(key(answer.remote.type,answer.remote.id)!==entityKey||!Number.isSafeInteger(answer.remote.revision)||answer.remote.revision<0)throw new Error('冲突响应实体不匹配');
            next.conflicts[entityKey]={local:copy(next.entities[entityKey]),remote:copy(answer.remote),opId:op.opId};
          } else if(answer.status==='accepted') {
            if(key(answer.entity.type,answer.entity.id)!==entityKey||answer.entity.revision!==op.baseRevision+1||answer.entity.deleted!==op.deleted||!same(answer.entity.payload,op.payload))throw new Error('确认响应实体不匹配');
            next.queue=next.queue.filter(item=>item.opId!==op.opId);
            const entity=next.entities[entityKey];entity.revision=answer.entity.revision;
            // 连续离线编辑依次提交；首次确认后，后续操作使用新版本号。
            for(const item of next.queue)if(key(item.type,item.id)===entityKey)item.baseRevision=answer.entity.revision;
            uploaded++;
          } else throw new Error('无法识别同步响应');
          commit(next);
        }
        const answer=await transport.pull(state.cursor);
        if(answer.accountId!==accountId||!Array.isArray(answer.changes)||!Number.isSafeInteger(answer.cursor)||answer.cursor<state.cursor)throw new Error('下载响应账号或游标无效');
        const next=copy(state);
        for(const entity of answer.changes) {
          checkEntity(entity.type,entity.id,entity.payload,entity.deleted);
          if(!Number.isSafeInteger(entity.revision)||entity.revision<1)throw new Error('下载实体版本无效');
          const entityKey=key(entity.type,entity.id);
          // 游标可以前进，但冲突的远端候选也必须跟随，防止选择过期版本。
          if(next.conflicts[entityKey]) {
            if(entity.revision>=next.conflicts[entityKey].remote.revision)next.conflicts[entityKey].remote=copy(entity);
            continue;
          }
          if(next.queue.some(op=>key(op.type,op.id)===entityKey))continue;
          if(!next.entities[entityKey]||entity.revision>=next.entities[entityKey].revision){next.entities[entityKey]=copy(entity);downloaded++;}
        }
        next.cursor=answer.cursor;commit(next);
        return {status:Object.keys(state.conflicts).length?'conflict':'synced',uploaded,downloaded,pending:state.queue.length,conflicts:Object.keys(state.conflicts).length,cursor:state.cursor};
      } catch(error) {
        return {status:error.code==='OFFLINE'?'offline':'error',reason:error.message,uploaded,downloaded,pending:state.queue.length};
      } finally {busy=false;}
    }
    return Object.freeze({put:(type,id,payload)=>write(type,id,payload,false),remove:(type,id)=>write(type,id,null,true),resolve,synchronize,snapshot:()=>copy(state),get:(type,id)=>state.entities[key(type,id)]?copy(state.entities[key(type,id)]):null});
  }
  function createMemoryServer() {
    const accounts=new Map();
    function store(accountId){if(!accounts.has(accountId))accounts.set(accountId,{entities:new Map(),operations:new Map(),changes:[],cursor:0});return accounts.get(accountId);}
    function connect(accountId) {
      if(!validId(accountId))throw new Error('模拟账号无效');
      let online=true;
      function checkOnline(){if(!online){const error=new Error('模拟网络离线');error.code='OFFLINE';throw error;}}
      return Object.freeze({setOnline:value=>{online=!!value;},async push(op) {
        checkOnline();if(op.accountId!==accountId)throw new Error('拒绝跨账号写入');
        checkEntity(op.type,op.id,op.payload,op.deleted);
        if(!validId(op.opId)||!validId(op.deviceId)||!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0)throw new Error('操作格式无效');
        const account=store(accountId),previous=account.operations.get(op.opId);
        if(previous){if(!same(previous.operation,op))throw new Error('重复操作编号内容不一致');return copy(previous.answer);}
        const entityKey=key(op.type,op.id),current=account.entities.get(entityKey)||{type:op.type,id:op.id,payload:null,deleted:true,revision:0};
        if(current.revision!==op.baseRevision)return {status:'conflict',accountId,opId:op.opId,remote:copy(current)};
        const entity={type:op.type,id:op.id,payload:op.deleted?null:copy(op.payload),deleted:!!op.deleted,revision:current.revision+1};
        const answer={status:'accepted',accountId,opId:op.opId,entity};
        account.entities.set(entityKey,entity);account.cursor++;account.changes.push({cursor:account.cursor,entity:copy(entity)});
        account.operations.set(op.opId,{operation:copy(op),answer:copy(answer)});return copy(answer);
      },async pull(cursor) {
        checkOnline();const account=store(accountId);
        if(!Number.isSafeInteger(cursor)||cursor<0||cursor>account.cursor)throw new Error('同步游标无效');
        return {accountId,cursor:account.cursor,changes:account.changes.filter(change=>change.cursor>cursor).map(change=>copy(change.entity))};
      }});
    }
    return Object.freeze({connect,inspect:accountId=>{const account=store(accountId);return {cursor:account.cursor,entities:Array.from(account.entities.values(),copy),acceptedOperations:account.operations.size};}});
  }
  scope.SettlementSyncCore=Object.freeze({emptyState,createClient,createMemoryServer});
})(globalThis);
