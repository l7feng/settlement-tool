import {webRootURL} from './web-root.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});
vm.runInContext(await readFile(new URL('assets/revision-parse.js',webRootURL),'utf8'),context);
const {SettlementRevision:rev}=context;

// 拉丁写法：V01 / V-1 / v1_final / 大小写混写
assert.equal(rev.versionOf('P3 第2版.wav'),2);
assert.equal(rev.versionOf('EP03_心剑_V01.wav'),1);
assert.equal(rev.versionOf('EP03_心剑_v1_final.wav'),1);
assert.equal(rev.versionOf('EP03_心剑_V-12.mp4'),12);
assert.equal(rev.versionOf('EP03_心剑_v007.mov'),7);
// 中文写法：第N版 / 版本N / 十一 / 十三
assert.equal(rev.versionOf('流放崖州 第十一集 第三版.wav'),3);
assert.equal(rev.versionOf('流放崖州 第十三版.wav'),13);
assert.equal(rev.versionOf('精品剧 版本十二.wav'),12);
assert.equal(rev.versionOf('Demo 版本一.wav'),1);
// 没有版本号：必须返回 0，不能回落成 1
assert.equal(rev.versionOf('普通交付.wav'),0);
assert.equal(rev.versionOf('EP03 心剑.wav'),0);
assert.equal(rev.versionOf(''),0);
// 版本号与「集数里的 v」不能混淆（v 前面必须是行首或非字母数字）
assert.equal(rev.versionOf('av2.wav'),0);
// 目录名也算不上版本号
assert.equal(rev.versionOf('D:/交付/v1/正式/final.wav'),0);
// 取文件名最后一段，反斜杠路径同样处理
assert.equal(rev.versionOf('D:\\交付\\EP03\\心剑 V2.wav'),2);
// Demo 大版本：尾部中文数字
assert.equal(rev.takeOf('片名 一.wav'),1);
assert.equal(rev.takeOf('片名 十二.wav'),12);
assert.equal(rev.takeOf('片名.wav'),0);
assert.equal(rev.takeOf('片名 第2版.wav'),0);
// 一次解析同时给出两者（跨 realm 对象，逐字段比较）
const both=rev.parseRevision('片名 二 V03.wav');
assert.equal(both.version,3);
assert.equal(both.take,0);
assert.equal(rev.cnNumber('二十三'),23);
assert.equal(rev.cnNumber('十'),10);
assert.equal(rev.cnNumber('一百零五'),105);
assert.equal(rev.cnNumber('乱写'),0);
// 幂等：同一输入多次解析结果一致
assert.deepEqual(rev.parseRevision('EP03 心剑 第十三版.wav'),rev.parseRevision('EP03 心剑 第十三版.wav'));
console.log('PASS 版本号单一实现：拉丁/中文/无版本号/路径/Demo大版本 16 组');
