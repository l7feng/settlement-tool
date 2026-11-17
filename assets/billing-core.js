/* 计价纯函数，保持既有按集原值及按时长逐条舍入规则。
   2026-11-16（2.8.4）精品剧价格规则：
   1) 默认阶梯补全为 1=A,2-10=B,11-999=C——项目没填阶梯时，第 11 集起按 C 计，不再整套漏算；
   2) 项目自定义区间仍未覆盖的记录，按项目「默认等级」兜底计价（默认等级非法时按 C），
      汇总行仍提示补全区间，既不算错钱也不把缺口藏起来；
   3) 因此 grade() 不再返回 null，price() 不再报错，fee() 不再静默计 0。 */
(function (scope) {
  'use strict';
  function workType(record){return record.workType==='首次制作'?'混音':record.workType||(record.rework?'重混':'混音');}
  // 不计价原因枚举：所有展示与统计只从这里取，避免各处各判一套。
  const EXCLUSION_REASONS = Object.freeze({
    modify: '修改不计价',
    excluded: '手动排除',
    optOut: '标记为不计价',
    demo: 'Demo旧版本不计价',
    version: '旧版本不计价',
    finalcut: '已被成片替换',
    unrated: '待定级（未计价）'
  });
  function exclusionReason(record) {
    if (workType(record) === '修改') return 'modify';
    if (record.excluded) return 'excluded';
    if (record.billable === false) return 'optOut';
    if (record.demoSuperseded === true) return 'demo';
    if (record.versionSuperseded === true) return 'version';
    if (record.finalCutSuperseded === true) return 'finalcut';
    return null;
  }
  function isBillable(record){return exclusionReason(record)===null;}
  function durationSeconds(value){const [h,m,s]=value.split(':').map(Number);return h*3600+m*60+s;}
  function defaultPremiumPrices(){return {A:{per_min:90,per_ep:90},B:{per_min:60,per_ep:60},C:{per_min:30,per_ep:30}};}
  const defaultRanges='1=A,2-10=B,11-999=C';
  // 该项目/该记录是否走阶梯区间定级（精品剧、非 Demo）
  function usesStaircase(project,record){
    if(!project||project.billingCategory!=='premium'||project.demoBucket)return false;
    return ((record&&record.type)||project.type)!=='Demo';
  }
  function parseRanges(text){
    const list=[];
    for(const part of String(text??'').split(/[,，;；\n]+/)){
      const m=part.trim().match(/^(\d+)\s*(?:[-~～至]\s*(\d+))?\s*[=:：]\s*([ABC])$/i);
      if(m)list.push({lo:Number(m[1]),hi:Number(m[2]||m[1]),level:m[3].toUpperCase()});
    }
    return list;
  }
  function episodeNumberOf(project,record){
    let number=record.episodeNo;
    if(number==null){
      number=String(record.label||'').match(/^EP(\d+)$/i)?.[1];
      if(number==null){
        const key=Object.entries(project.episodes||{}).find(([,r])=>r===record||(record.recordId&&r.recordId===record.recordId))?.[0];
        if(/^\d+$/.test(key||''))number=key;
      }
    }
    return /^\d+$/.test(String(number??''))?String(number):null;
  }
  /** 只按阶梯区间命中定级：命中返回区间等级，未覆盖返回 null（不做兜底）。 */
  function rangeLevel(project,record){
    const number=episodeNumberOf(project,record);
    if(number==null)return null;
    for(const part of parseRanges(project.gradeRanges?.trim()||defaultRanges)){
      if(Number(number)>=part.lo&&Number(number)<=part.hi)return part.level;
    }
    return null;
  }
  /** 兜底等级：项目「默认等级」；默认等级不是 A/B/C 时按最低档 C。 */
  function fallbackLevel(project){
    const level=project&&project.grade;
    return ['A','B','C'].includes(level)?level:'C';
  }
  /** 定级：非阶梯项目沿用记录/项目自身等级（都没有则返回 null＝待定级）；阶梯项目按区间命中，未覆盖按默认等级兜底。 */
  function grade(project,record){
    if(!usesStaircase(project,record))return record.grade||project.grade||null;
    return rangeLevel(project,record)??fallbackLevel(project);
  }
  /** 待定级：能计价但定不出等级（S2-2.4 导入不再默认 C）。返回 true 时界面上必须显式提示，不能静默按 0 计。 */
  function needsGrade(project,record){
    if(record&&record.excluded)return false;
    const level=grade(project,record);
    if(level==null)return true;
    if(project.billingCategory==='premium')return !['A','B','C'].includes(level);
    if(project.billingCategory==='automation')return level!=='D';
    return false;
  }
  /** 阶梯项目里「区间没覆盖到、已按默认等级兜底」的记录：用于汇总行提示补区间。 */
  function unmatched(project,record){return usesStaircase(project,record)&&rangeLevel(project,record)==null;}
  function rateFor(level,prices,project,record,premiumPrices){
    if(project.billingCategory==='premium'){
      if(!['A','B','C'].includes(level))throw Error('精品剧只允许ABC等级');
      return (premiumPrices||defaultPremiumPrices())[level]||defaultPremiumPrices()[level];
    }
    if(project.billingCategory==='automation'&&level!=='D')throw Error('自动化只允许D等级');
    return prices[level];
  }
  /** 单价（界面展示用）：与 fee 取同一来源，避免「显示新价、算的是旧价」。 */
  function price(prices,project,record,premiumPrices){
    return rateOf(prices,project,record,premiumPrices);
  }
  /** 金额统一到分：按集单价可能带角分（如 78.888），落账前必须收敛为两位小数。
      先修正二进制浮点误差再四舍五入，避免 1.005 这类值被判成 1.00。 */
  function round2(value){
    const scaled=Number((value*100).toFixed(6));
    return Math.round(scaled)/100;
  }
  /** 该记录实际用的单价：优先记录内快照（S2-2.10，改单价不动历史），
      快照等级与当前等级不一致（人工纠正过等级）时才回到现价。 */
  function rateOf(prices,project,record,premiumPrices){
    const level=grade(project,record);
    if(level==null)return null;
    const snapshot=record&&record.rateSnapshot;
    if(snapshot&&snapshot.level===level&&Number.isFinite(snapshot.per_min)&&Number.isFinite(snapshot.per_ep)){
      return {per_min:snapshot.per_min,per_ep:snapshot.per_ep};
    }
    return rateFor(level,prices,project,record,premiumPrices);
  }
  function fee(prices,project,record,premiumPrices){
    if(!isBillable(record))return 0;
    // 待定级（导入时未定等级且项目也没有默认等级）：不猜价，计 0 并由界面显式提示「N 条待定级」。
    if(grade(project,record)==null)return 0;
    const rate=rateOf(prices,project,record,premiumPrices);
    return round2((record.mode||project.mode)==='按集'?rate.per_ep:durationSeconds(record.duration)/60*rate.per_min);
  }
  scope.SettlementBilling=Object.freeze({workType,isBillable,exclusionReason,EXCLUSION_REASONS,durationSeconds,fee,price,rateOf,grade,needsGrade,rangeLevel,fallbackLevel,unmatched,usesStaircase,episodeNumberOf,parseRanges,defaultRanges,defaultPremiumPrices});
})(globalThis);
