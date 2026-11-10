import {webRoot,webRootURL,testOutputURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const context=vm.createContext({crypto:webcrypto});
vm.runInContext(await readFile(new URL('assets/sync-core.js',webRootURL),'utf8'),context);
const core=context.SettlementSyncCore;
const clone=x=>JSON.parse(JSON.stringify(x));
const tests=[];
const test=(name,fn)=>tests.push({name,fn});
let serial=0;
function setup(){
  const server=core.createMemoryServer();
  function client(deviceId,accountId='account-a',overrides={}) {
    let persisted=null,fail=false;const transport=server.connect(accountId);
    const instance=core.createClient({accountId,deviceId,transport,idFactory:()=>`op-${++serial}`,save:state=>{if(fail)throw new Error('模拟磁盘失败');persisted=clone(state);},...overrides});
    return {instance,transport,persisted:()=>persisted,fail:value=>{fail=value;}};
  }
  return {server,client};
}
test('新增项目与记录在两个设备之间同步',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');
  a.instance.put('project','project-1',{name:'完整项目',shortName:'完整'});
  a.instance.put('record','record-1',{projectId:'project-1',duration:60,fee:10});
  assert.equal((await a.instance.synchronize()).status,'synced');await b.instance.synchronize();
  assert.equal(b.instance.get('project','project-1').payload.shortName,'完整');
  assert.equal(b.instance.get('record','record-1').payload.fee,10);
});
test('不同设备新增不同记录自动合并',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');
  a.instance.put('record','one',{fee:10});b.instance.put('record','two',{fee:20});
  await a.instance.synchronize();await b.instance.synchronize();await a.instance.synchronize();
  assert.equal(Object.keys(a.instance.snapshot().entities).length,2);
  assert.equal(Object.keys(b.instance.snapshot().entities).length,2);
});
test('单设备修改正常接续版本号',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});
  await a.instance.synchronize();await b.instance.synchronize();b.instance.put('record','one',{fee:25});
  await b.instance.synchronize();await a.instance.synchronize();
  assert.equal(a.instance.get('record','one').revision,2);assert.equal(a.instance.get('record','one').payload.fee,25);
});
test('离线不丢本地数据和待上传队列',async()=>{
  const {client}=setup(),a=client('a');a.transport.setOnline(false);a.instance.put('record','one',{fee:8});
  assert.equal((await a.instance.synchronize()).status,'offline');assert.equal(a.instance.snapshot().queue.length,1);
  assert.equal(a.persisted().entities['["record","one"]'].payload.fee,8);
  a.transport.setOnline(true);assert.equal((await a.instance.synchronize()).status,'synced');assert.equal(a.instance.snapshot().queue.length,0);
});
test('多次离线编辑依次确认且最终值一致',async()=>{
  const {client,server}=setup(),a=client('a');a.instance.put('record','one',{fee:1});a.instance.put('record','one',{fee:2});a.instance.put('record','one',{fee:3});
  await a.instance.synchronize();assert.equal(server.inspect('account-a').entities[0].payload.fee,3);
  assert.equal(a.instance.get('record','one').revision,3);assert.equal(a.instance.snapshot().queue.length,0);
});
test('相同操作重复发送只确认一次',async()=>{
  const {client,server}=setup(),a=client('a');a.instance.put('record','one',{fee:10});const op=a.instance.snapshot().queue[0];
  const first=await a.transport.push(op),second=await a.transport.push(op);assert.deepEqual(clone(first),clone(second));
  assert.equal(server.inspect('account-a').acceptedOperations,1);await a.instance.synchronize();assert.equal(a.instance.snapshot().queue.length,0);
});
test('同操作编号不同内容拒绝重放',async()=>{
  const {client}=setup(),a=client('a');a.instance.put('record','one',{fee:10});const op=a.instance.snapshot().queue[0];await a.transport.push(op);
  op.payload.fee=999;await assert.rejects(a.transport.push(op),/内容不一致/);
});
test('上传后确认丢失可安全重试',async()=>{
  const {client,server}=setup();const underlying=server.connect('account-a');let drop=true;
  const a=client('a','account-a',{transport:{push:async op=>{const result=await underlying.push(op);if(drop){drop=false;throw new Error('确认丢失');}return result;},pull:cursor=>underlying.pull(cursor)}});
  a.instance.put('record','one',{fee:10});assert.equal((await a.instance.synchronize()).status,'error');assert.equal(a.instance.snapshot().queue.length,1);
  await a.instance.synchronize();assert.equal(server.inspect('account-a').acceptedOperations,1);assert.equal(a.instance.snapshot().queue.length,0);
});
test('本地保存失败不更改数据或队列',async()=>{
  const {client}=setup(),a=client('a'),before=a.instance.snapshot();a.fail(true);
  assert.throws(()=>a.instance.put('record','one',{fee:10}),/磁盘失败/);assert.deepEqual(clone(a.instance.snapshot()),clone(before));
  a.fail(false);a.instance.put('record','one',{fee:10});assert.equal(a.instance.snapshot().queue.length,1);
});
test('服务端确认后本地落盘失败保留操作以便幂等重试',async()=>{
  const {client,server}=setup(),a=client('a');a.instance.put('record','one',{fee:10});a.fail(true);
  assert.equal((await a.instance.synchronize()).status,'error');assert.equal(a.instance.snapshot().queue.length,1);
  a.fail(false);await a.instance.synchronize();assert.equal(server.inspect('account-a').acceptedOperations,1);assert.equal(a.instance.snapshot().queue.length,0);
});
test('断线后的游标补拉包含全部变化',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');await b.instance.synchronize();b.transport.setOnline(false);
  for(let i=0;i<4;i++){a.instance.put('record','r'+i,{fee:i});await a.instance.synchronize();}
  b.transport.setOnline(true);await b.instance.synchronize();assert.equal(Object.keys(b.instance.snapshot().entities).length,4);assert.equal(b.instance.snapshot().cursor,4);
});
test('并发修改保留本地与远端版本且阻止继续覆盖',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});await a.instance.synchronize();await b.instance.synchronize();
  a.instance.put('record','one',{fee:11});b.instance.put('record','one',{fee:12});await a.instance.synchronize();
  assert.equal((await b.instance.synchronize()).status,'conflict');const conflict=Object.values(b.instance.snapshot().conflicts)[0];
  assert.equal(conflict.local.payload.fee,12);assert.equal(conflict.remote.payload.fee,11);assert.equal(b.instance.snapshot().queue.length,1);
  assert.throws(()=>b.instance.put('record','one',{fee:100}),/先处理/);
});
async function conflictPair(){
  const {client,server}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});await a.instance.synchronize();await b.instance.synchronize();
  a.instance.put('record','one',{fee:11});b.instance.put('record','one',{fee:12});await a.instance.synchronize();await b.instance.synchronize();return {a,b,server};
}
test('保留本地解决冲突生成新操作再同步',async()=>{
  const {a,b}=await conflictPair(),old=b.instance.snapshot().queue[0].opId;b.instance.resolve('record','one','local');
  assert.notEqual(b.instance.snapshot().queue[0].opId,old);assert.equal((await b.instance.synchronize()).status,'synced');await a.instance.synchronize();assert.equal(a.instance.get('record','one').payload.fee,12);
});
test('采用远端解决冲突不会再次上传旧值',async()=>{
  const {b,server}=await conflictPair();b.instance.resolve('record','one','remote');await b.instance.synchronize();
  assert.equal(b.instance.get('record','one').payload.fee,11);assert.equal(server.inspect('account-a').acceptedOperations,2);
});
test('自定义解决冲突保存明确的新内容',async()=>{
  const {a,b}=await conflictPair();b.instance.resolve('record','one','custom',{fee:15});await b.instance.synchronize();await a.instance.synchronize();assert.equal(a.instance.get('record','one').payload.fee,15);
});
test('删除标记传播不被另一设备旧记录复活',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});await a.instance.synchronize();await b.instance.synchronize();
  a.instance.remove('record','one');await a.instance.synchronize();await b.instance.synchronize();assert.equal(b.instance.get('record','one').deleted,true);
});
test('远端删除与本地修改产生冲突',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});await a.instance.synchronize();await b.instance.synchronize();
  a.instance.remove('record','one');b.instance.put('record','one',{fee:12});await a.instance.synchronize();await b.instance.synchronize();
  const conflict=Object.values(b.instance.snapshot().conflicts)[0];assert.equal(conflict.remote.deleted,true);assert.equal(conflict.local.payload.fee,12);
  b.instance.resolve('record','one','remote');assert.equal(b.instance.get('record','one').deleted,true);
});
test('远端修改与本地删除产生冲突并可确认删除',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});await a.instance.synchronize();await b.instance.synchronize();
  a.instance.put('record','one',{fee:11});b.instance.remove('record','one');await a.instance.synchronize();await b.instance.synchronize();
  const conflict=Object.values(b.instance.snapshot().conflicts)[0];assert.equal(conflict.local.deleted,true);assert.equal(conflict.remote.payload.fee,11);
  b.instance.resolve('record','one','delete');await b.instance.synchronize();await a.instance.synchronize();assert.equal(a.instance.get('record','one').deleted,true);
});
test('两个账号同编号互相隔离',async()=>{
  const {client}=setup(),a=client('a','account-a'),b=client('b','account-b');a.instance.put('record','same',{fee:10});b.instance.put('record','same',{fee:90});
  await a.instance.synchronize();await b.instance.synchronize();assert.equal(a.instance.get('record','same').payload.fee,10);assert.equal(b.instance.get('record','same').payload.fee,90);
});
test('跨账号操作和状态恢复被拒绝',async()=>{
  const {client}=setup(),a=client('a'),b=client('b','account-b');a.instance.put('record','one',{fee:1});
  await assert.rejects(b.transport.push(a.instance.snapshot().queue[0]),/跨账号/);
  assert.throws(()=>core.createClient({accountId:'account-b',deviceId:'a',initialState:a.instance.snapshot(),save:()=>{}}),/不属于/);
});
test('重启恢复本地队列继续同步',async()=>{
  const {client}=setup(),a=client('a');a.instance.put('record','one',{fee:10});
  const restored=client('a','account-a',{initialState:a.persisted()});await restored.instance.synchronize();assert.equal(restored.instance.get('record','one').revision,1);
});
test('下载保存失败不推进游标且可重新拉取',async()=>{
  const {client}=setup(),a=client('a'),b=client('b');a.instance.put('record','one',{fee:10});await a.instance.synchronize();b.fail(true);
  assert.equal((await b.instance.synchronize()).status,'error');assert.equal(b.instance.snapshot().cursor,0);assert.equal(b.instance.get('record','one'),null);
  b.fail(false);await b.instance.synchronize();assert.equal(b.instance.snapshot().cursor,1);assert.equal(b.instance.get('record','one').payload.fee,10);
});
test('错误账号响应不修改本地队列',async()=>{
  const {client}=setup(),a=client('a','account-a',{transport:{push:async op=>({status:'accepted',accountId:'other',opId:op.opId}),pull:async()=>({})}});
  a.instance.put('record','one',{fee:1});assert.equal((await a.instance.synchronize()).status,'error');assert.equal(a.instance.snapshot().queue.length,1);
});
test('冲突实体不会阻塞其他记录同步',async()=>{
  const {a,b}=await conflictPair();b.instance.put('record','two',{fee:20});assert.equal((await b.instance.synchronize()).status,'conflict');await a.instance.synchronize();assert.equal(a.instance.get('record','two').payload.fee,20);
});
test('并行同步请求合并为单个活动同步',async()=>{
  const {client}=setup(),a=client('a');a.instance.put('record','one',{fee:1});const first=a.instance.synchronize();assert.equal((await a.instance.synchronize()).status,'busy');await first;
});
test('无传输只保留本地能力',async()=>{
  const {client}=setup(),a=client('a','account-a',{transport:null});a.instance.put('record','one',{fee:1});assert.equal((await a.instance.synchronize()).status,'offline');
});
test('保存回调返回false不提交内存状态',async()=>{
  const instance=core.createClient({accountId:'a',deviceId:'a',save:()=>false,idFactory:()=>`op-${++serial}`});assert.throws(()=>instance.put('record','one',{fee:1}),/保存失败/);assert.equal(instance.get('record','one'),null);
});
test('上传过程中继续编辑保留新内容和后续操作',async()=>{
  const {client,server}=setup(),underlying=server.connect('account-a');let release;
  const gate=new Promise(resolve=>{release=resolve;});let first=true;
  const a=client('a','account-a',{transport:{push:async op=>{if(first){first=false;await gate;}return underlying.push(op);},pull:cursor=>underlying.pull(cursor)}});
  a.instance.put('record','one',{fee:1});const syncing=a.instance.synchronize();a.instance.put('record','one',{fee:2});release();
  assert.equal((await syncing).status,'synced');assert.equal(server.inspect('account-a').entities[0].payload.fee,2);assert.equal(a.instance.get('record','one').payload.fee,2);
});
test('解决冲突后远端再次变化会重新产生冲突',async()=>{
  const {a,b}=await conflictPair();b.instance.resolve('record','one','local');a.instance.put('record','one',{fee:13});await a.instance.synchronize();
  assert.equal((await b.instance.synchronize()).status,'conflict');assert.equal(Object.values(b.instance.snapshot().conflicts)[0].remote.payload.fee,13);
});
test('无效实体响应不会清除待上传队列',async()=>{
  const {client}=setup(),a=client('a','account-a',{transport:{push:async op=>({status:'accepted',accountId:op.accountId,opId:op.opId,entity:{...op,id:'wrong',revision:1}}),pull:async()=>({})}});
  a.instance.put('record','one',{fee:1});assert.equal((await a.instance.synchronize()).status,'error');assert.equal(a.instance.snapshot().queue.length,1);
});
test('待处理冲突的远端候选随补拉更新以免游标遗漏',async()=>{
  const {a,b}=await conflictPair();a.instance.put('record','one',{fee:14});await a.instance.synchronize();await b.instance.synchronize();
  assert.equal(Object.values(b.instance.snapshot().conflicts)[0].remote.payload.fee,14);
  b.instance.resolve('record','one','remote');await b.instance.synchronize();assert.equal(b.instance.get('record','one').payload.fee,14);assert.equal(b.instance.get('record','one').revision,3);
});
const watchdog=setTimeout(()=>{console.error('模拟同步测试超过 60 秒');process.exit(1);},60000);
const results=[];let failed=0;
try{for(const {name,fn} of tests){try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(error){failed++;results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}}
finally{clearTimeout(watchdog);}
const dir=testOutputURL;await mkdir(dir,{recursive:true});
await writeFile(new URL('sync-core-result.json',dir),JSON.stringify({scope:'本地双设备内存模拟；未连接云端或真实业务存储',passed:results.length-failed,failed,results},null,2));
console.log(`${results.length-failed}/${results.length} PASS`);if(failed)process.exitCode=1;
