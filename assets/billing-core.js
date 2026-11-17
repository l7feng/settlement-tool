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
    finalcut: '已被成片替换'
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
  /** 定级：非阶梯项目沿用记录/项目自身等级；阶梯项目按区间命中，未覆盖按默认等级兜底。 */
  function grade(project,record){
    if(!usesStaircase(project,record))return record.grade||project.grade;
    return rangeLevel(project,record)??fallbackLevel(project);
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
  function price(prices,project,record,premiumPrices){
    return rateFor(grade(project,record),prices,project,record,premiumPrices);
  }
  /** 金额统一到分：按集单价可能带角分（如 78.888），落账前必须收敛为两位小数。
      先修正二进制浮点误差再四舍五入，避免 1.005 这类值被判成 1.00。 */
  function round2(value){
    const scaled=Number((value*100).toFixed(6));
    return Math.round(scaled)/100;
  }
  function fee(prices,project,record,premiumPrices){
    if(!isBillable(record))return 0;
    const rate=rateFor(grade(project,record),prices,project,record,premiumPrices);
    return round2((record.mode||project.mode)==='按集'?rate.per_ep:durationSeconds(record.duration)/60*rate.per_min);
  }
  scope.SettlementBilling=Object.freeze({workType,isBillable,exclusionReason,EXCLUSION_REASONS,durationSeconds,fee,price,grade,rangeLevel,fallbackLevel,unmatched,usesStaircase,episodeNumberOf,parseRanges,defaultRanges,defaultPremiumPrices});
})(globalThis);
