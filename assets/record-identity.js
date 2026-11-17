/* 旧记录确定性补号，新记录独立随机编号；显示名称不是身份。 */
(function (scope) {
  'use strict';
  function legacyId(kind, parts) {
    const value=JSON.stringify(parts),seeds=[2166136261,2246822519,3266489917,668265263];
    const digest=seeds.map(seed=>{let h=seed;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}).join('');
    return kind+'-legacy-'+digest;
  }
  function newId(kind) {
    if(scope.crypto?.randomUUID)return kind+'-'+scope.crypto.randomUUID();
    const bytes=new Uint8Array(16);scope.crypto.getRandomValues(bytes);
    return kind+'-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function ensure(data) {
    const projects=new Set(),records=new Set();
    for(const p of data.projects){
      p.id=p.id||legacyId('project',[p.name]);
      if(projects.has(p.id))throw new Error('项目编号重复：'+p.name);projects.add(p.id);
      for(const [key,e] of Object.entries(p.episodes)){
        e.recordId=e.recordId||legacyId('record',[p.id,key]);
        if(records.has(e.recordId))throw new Error('工作记录编号重复：'+p.name+' / '+key);records.add(e.recordId);
      }
    }
    return data;
  }
  scope.SettlementIdentity=Object.freeze({legacyId,newId,ensure});
})(globalThis);
