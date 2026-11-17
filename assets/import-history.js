/* Import batches store inverse changes, not whole-workspace restore points. */
(function(scope){
 'use strict';
 const copy=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
 function sorted(v){if(Array.isArray(v))return v.map(sorted);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));return v;}
 const signature=v=>JSON.stringify(sorted(v));
 const info=p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='episodes'));
 function records(p){return new Map(Object.entries(p?.episodes||{}).map(([key,r])=>[r.recordId,{key,r}]));}
 function create(before,after,label,id,time){
  const projects=[];
  for(const p of after.projects){
   const old=before.projects.find(q=>q.id===p.id),a=records(old),b=records(p),changes=[];
   for(const rid of new Set([...a.keys(),...b.keys()])){const x=a.get(rid),y=b.get(rid);if(signature(x)!==signature(y)){
    const fields=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['excluded','excludeReason','demoSuperseded','versionSuperseded'].includes(k)));
    const autoOnly=x&&y&&signature(fields(x.r))===signature(fields(y.r))&&(x.r.demoSuperseded!==y.r.demoSuperseded||x.r.versionSuperseded!==y.r.versionSuperseded);
    const kind=!x?'added':!y?'removed':autoOnly?(y.r.demoSuperseded||y.r.versionSuperseded?'superseded':'reinstated'):x.r.sourceFile!==y.r.sourceFile||x.r.sourcePath!==y.r.sourcePath?'replaced':'updated';
    changes.push({id:rid,kind,keyBefore:x?.key??null,keyAfter:y?.key??null,before:copy(x?.r),after:y?signature(y.r):null});
   }}
   if(changes.length||!old||signature(info(old))!==signature(info(p)))projects.push({id:p.id,name:p.name,before:old?copy(info(old)):null,after:signature(info(p)),records:changes});
  }
  return {id,time,label,status:'active',fileCount:projects.reduce((n,p)=>n+p.records.filter(r=>['added','replaced','updated'].includes(r.kind)).length,0),projects};
 }
 function safe(v,depth=0){if(depth>12)throw Error('导入历史结构过深');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))throw Error('导入历史含危险字段');safe(x,depth+1);}}
 function validate(events){
  if(!Array.isArray(events))throw Error('导入历史无效');const ids=new Set();
  for(const e of events){
   if(!e||typeof e.id!=='string'||ids.has(e.id)||typeof e.label!=='string'||e.label.length>200||!Number.isFinite(Date.parse(e.time))||!['active','reverted'].includes(e.status)||!Array.isArray(e.projects))throw Error('导入批次无效');ids.add(e.id);
   const projects=new Set(),records=new Set();
   for(const p of e.projects){if(typeof p.id!=='string'||projects.has(p.id)||typeof p.name!=='string'||!Array.isArray(p.records))throw Error('导入项目历史无效');projects.add(p.id);const meta=JSON.parse(p.after);safe(meta);if(meta.id!==p.id||meta.name!==p.name)throw Error('导入项目快照无效');if(p.before){safe(p.before);if(p.before.id!==p.id)throw Error('回退项目编号不匹配');}
    for(const r of p.records){if(typeof r.id!=='string'||records.has(r.id)||r.after!==null&&typeof r.after!=='string'||r.keyBefore!==null&&typeof r.keyBefore!=='string'||r.keyAfter!==null&&typeof r.keyAfter!=='string')throw Error('导入文件历史无效');records.add(r.id);if(r.after!==null){const value=JSON.parse(r.after);safe(value);if(value.recordId!==r.id)throw Error('导入文件编号不匹配');}if(r.before){safe(r.before);if(r.before.recordId!==r.id)throw Error('回退文件编号不匹配');}}
   }
  }
  return events;
 }
 function rollback(data,id,time){
  validate(data.importHistory||[]);const event=data.importHistory?.find(e=>e.id===id);if(!event||event.status!=='active')throw Error('该导入批次已回退或不存在');
  const next=copy(data),conflicts=[];let count=0;
  for(const change of event.projects){const p=next.projects.find(p=>p.id===change.id);if(!p){conflicts.push(change.name+'：项目已被移除');continue;}
   for(const r of change.records){const current=Object.entries(p.episodes).find(([,x])=>x.recordId===r.id);
    if(r.after!==null&&(!current||current[0]!==r.keyAfter||signature(current[1])!==r.after)||r.after===null&&current){conflicts.push(change.name+' · '+(current?.[1].sourceFile||r.keyAfter)+'：后来已修改或移除');continue;}
    const occupied=r.before&&p.episodes[r.keyBefore];if(occupied&&occupied.recordId!==r.id){conflicts.push(change.name+' · '+r.keyBefore+'：位置已占用');continue;}
    if(current)delete p.episodes[current[0]];if(r.before)p.episodes[r.keyBefore]=copy(r.before);count++;
   }
   if(change.before===null){if(!Object.keys(p.episodes).length&&signature(info(p))===change.after)next.projects=next.projects.filter(q=>q!==p);}
   else if(signature(info(p))!==change.after&&signature(change.before)!==change.after){conflicts.push(change.name+'：项目资料后来已修改');}
   else if(signature(change.before)!==change.after){const episodes=p.episodes;Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,copy(change.before),{episodes});}
  }
  if(conflicts.length)return {next:null,count:0,conflicts};
  const entry=next.importHistory.find(e=>e.id===id);entry.status='reverted';entry.revertedAt=time;
  return {next,count,conflicts:[]};
 }
 scope.SettlementImportHistory=Object.freeze({create,rollback,validate,signature});
})(globalThis);
