// 一条命令跑浏览器端 UI 测试（S3-3.1）。默认 300s 超时与仓库自身作为页面真源，
// 换机后不需要再改测试里的路径（playwright-runtime 会自己找浏览器）。
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'tests', 'suites.json'), 'utf8'));
const env = {
  ...process.env,
  SETTLEMENT_WEB_ROOT: process.env.SETTLEMENT_WEB_ROOT || root,
  SETTLEMENT_TIMEOUT: process.env.SETTLEMENT_TIMEOUT || '300000',
};

let failed = [];
for (const suite of manifest.ui) {
  const run = spawnSync(process.execPath, [path.join(root, 'tests', suite.file)], {cwd: path.join(root, 'tests'), env, encoding: 'utf8'});
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const result = (output.match(/RESULT\s+\S+/) || [''])[0];
  if (run.status === 0) {
    console.log(`  通过  ${suite.file}  ${result}  ${suite.title}`);
  } else {
    failed.push(suite.file);
    console.log(`  失败  ${suite.file}  ${result}  ${suite.title}`);
    console.log(output.trim().split('\n').slice(-12).map(l => '      ' + l).join('\n'));
  }
}
console.log(`\nUI：${manifest.ui.length - failed.length}/${manifest.ui.length} 通过`);
process.exit(failed.length ? 1 : 0);
