import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});
context.commitDataChange=()=>true;
context.toast=()=>{};
context.state={data:{projects:[],prices:{}}};
context.normalizeData=v=>v;
// version-reconciliation.js 末尾会包装这两个渲染函数，先给替身
context.renderImportPreview=()=>{};
context.renderMultiProjectPreview=()=>{};
context.window={_importPreview:null};
for(const name of ['record-identity','revision-parse','import-metadata','version-timeline','version-reconciliation','demo-latest-workflow']){
  vm.runInContext(await readFile(new URL('assets/'+name+'.js',webRootURL),'utf8'),context);
}
const {SettlementRevision:rev,SettlementVersion:version,SettlementImportMetadata:meta}=context;

// 同一 fixture 在「导入识别 / 归并 / 时间线 / Demo / 表格列」四个入口得到同一个版本号。
const fixtures=[
 'P3 第2版.wav','EP03_心剑_V01.wav','EP03_心剑_v1_final.wav','流放崖州 第十三版.wav',
 '精品剧 版本十二.wav','普通交付.wav','EP03 心剑.wav','av2.wav','D:\\交付\\EP03\\心剑 V2.wav'
];
for(const file of fixtures){
  const expected=rev.versionOf(file);
  const viaReconcile=context.formalSourceVersion({sourceFile:file});
  const viaTimeline=version.versionNumber({sourceFile:file});
  assert.equal(viaReconcile,expected,file+' 归并入口不一致');
  assert.equal(viaTimeline,expected,file+' 时间线入口不一致');
}
// 「第十三版」不再回落成第 1 版
assert.equal(rev.versionOf('流放崖州 第十三版.wav'),13);
assert.equal(context.formalSourceVersion({sourceFile:'流放崖州 第十三版.wav'}),13);
assert.equal(version.versionNumber({sourceFile:'流放崖州 第十三版.wav'}),13);
// 无版本号：三处都必须是 0（0 表示「独立一条交付」，不是第 1 版）
for(const src of [undefined,'','普通交付.wav'])assert.equal(context.formalSourceVersion({sourceFile:src}),0);
// Demo 入口：version 缺省才补 1，识别得出就用识别的
assert.equal(context.demoSourceMeta('片名 第十三版.wav').version,13);
assert.equal(context.demoSourceMeta('片名.wav').version,1);
assert.equal(context.demoSourceMeta('片名 十二.wav').take,12);
// 导入识别本身不产出版本号，但产出的作品名不应把「第N版」当作品名残留
assert.equal(meta.infer('片名 第2版.wav',[]).name.includes('版'),false);
// 表格列：HTML 的 recordVersionLabel 必须走同一实现，且旧正则已删
const html=await readFile(new URL('settlement-workbench.html',webRootURL),'utf8');
assert.match(html,/function recordVersionLabel\(r,p\).*SettlementRevision\.versionOf/);
assert.equal(html.includes("match(/(?:^|[^a-z0-9])v(\\d+)(?=$|[^0-9])/i)?.[1]||0"),false,'HTML 里仍有旧版本号正则');
console.log('PASS 四入口版本号一致：'+fixtures.length+' 组 fixture，含第十三版与无版号');
