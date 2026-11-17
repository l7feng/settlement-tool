/* Pure filename/directory suggestions. They are reviewed before import. */
(function(scope){
 'use strict';
 const generic=/^(?:[0-9]+[-_ ]*)?(?:demo|finalmix|out|output|交付文件|交付|归档|音频|成品|master|wav|mp4|共享文件夹|audio|video|project|revision)$/i;
 function cleanName(text){return String(text).replace(/\.(wav|mp4)$/i,'').replace(/^\d+[-_. ]+/,'').replace(/(?:精品剧|精品|自动化|自动剧)/g,'').replace(/(?:[ _-]*[ABCD])(?=[ _.-]*(?:20\d{6}|\d{6}(?:\D|$)|$))/i,'').replace(/[ _.-]*(?:20\d{2}[-_.]?\d{2}[-_.]?\d{2}|\d{6}(?=[ _.-]|$)).*$/,'').replace(/[ _-]+$/,'').trim();}
 function infer(path,projects=[]){
  const parts=String(path).replace(/\\/g,'/').split('/').filter(Boolean),file=parts.at(-1)||'',folders=parts.slice(0,-1);
  const demo=parts.some(x=>/demo|试听|样片/i.test(x));
  const rawPrefix=file.split(/demo|试听|样片|(?:第\s*)?\d+\s*集|\bEP\s*\d+/i)[0].trim();
  const segment=rawPrefix.match(/\s+([一二三四五六七八九十上下]+)$/)?.[1]||'';
  const prefix=rawPrefix.replace(/\s+[一二三四五六七八九十上下]+$/,'').trim();
  const episodeFolder=[...folders].reverse().find(x=>/\d+\s*集/.test(x));
  const episodePrefix=episodeFolder?.split(/(?:第\s*)?\d+\s*集/)[0].trim();
  const folder=[...folders].reverse().find(x=>!generic.test(x)&&!/(?:\d+\s*集|^EP\d+|^[A-Za-z]:$|^\d+$)/i.test(x));
  const fileHasTitle=/demo|试听|样片|\d+\s*集|\bEP\s*\d+/i.test(file)&&!!prefix;
  const rawName=cleanName(fileHasTitle?prefix:episodePrefix||folder||'');
  const known=projects.find(p=>[p.name,...(p.aliases||[])].includes(rawName));
  const name=known?.name||rawName;
  const tag=parts.join('/'),explicitGrade=[...parts].reverse().map(x=>x.match(/(?:^|[^A-Za-z])([ABCD])(?=[ _.-]*(?:20\d{6}|\d{4}|$)|[_ .-])/i)?.[1]?.toUpperCase()).find(Boolean);
  const category=/自动化|自动剧/.test(tag)||explicitGrade==='D'?'automation':/精品剧|精品/.test(tag)||explicitGrade&&explicitGrade!=='D'?'premium':known?.billingCategory&&known.billingCategory!=='legacy'?known.billingCategory:known?.grade==='D'?'automation':'premium';
  const grade=category==='automation'?'D':explicitGrade&&explicitGrade!=='D'?explicitGrade:demo?'A':known?.grade&&known.grade!=='D'?known.grade:'C';
  const named=!!name;
  const explicitCategory=/精品|自动化|自动剧/.test(tag)||!!explicitGrade;
  return {name:named?name:'',type:demo?'Demo':null,billingCategory:category,grade,segment,named,explicitGrade:!!explicitGrade,categorySource:explicitCategory?'名称标记':known?'已有项目':'默认建议，请核对',nameSource:known?'已有项目匹配':fileHasTitle?'文件名前缀':'项目文件夹'};
 }
 function sourceInfo(path,year){
  const parts=String(path||'').replace(/\\/g,'/').split('/').filter(Boolean),file=parts.at(-1)||'';
  const folder=parts.slice(0,-1).reverse().find(x=>/(?:\d+\s*集|\bEP\s*\d+)/i.test(x));
  const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  const epText=/(?:第\s*)?(\d+)\s*集|\bEP\s*(\d+)/i;
  const ep=file.match(epText)||folder?.match(epText),episodeNo=ep?String(Number(ep[1]||ep[2])):null;
  for(const [text,source] of [[file,'file-name'],[folder||'','episode-folder']]){
   const full=[...text.matchAll(/(?:^|\D)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?=\D|$)/g)].map(m=>m[1]+'-'+m[2]+'-'+m[3]);
   if(full.length){const dates=[...new Set(full)];return {episodeNo,date:dates.length===1&&valid(dates[0])?dates[0]:null,dateSource:source,issue:dates.length!==1?'名称中有多个日期':valid(dates[0])?'':'名称日期无效'};}
   const after=text.match(/(?:\d+\s*集|\bEP\s*\d+|demo|试听|样片)[ _.-]+(\d{4})(?=[ _.-]|$)/i);
   if(after){const date=String(year)+'-'+after[1].slice(0,2)+'-'+after[1].slice(2);return {episodeNo,date:valid(date)?date:null,dateSource:'month-day-inferred-year',issue:valid(date)?'月日取名称，年份沿用记录，请核对跨年':'名称日期无效'};}
  }
  return {episodeNo,date:null,dateSource:null,issue:'未识别到交付日期'};
 }
 function partition(files,pathOf,projects=[]){
  const groups=new Map();
  for(const file of files){const meta=infer(pathOf(file),projects),key=meta.name||'待指定项目';if(!groups.has(key))groups.set(key,{...meta,name:key,files:[]});groups.get(key).files.push(file);}
  return [...groups.values()];
 }
 scope.SettlementImportMetadata=Object.freeze({infer,partition,cleanName,sourceInfo});
})(globalThis);
