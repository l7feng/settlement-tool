// 一条命令跑纯 Node 单测（S3-3.1）：无浏览器依赖，< 10 s 量级。
// 套件清单只有 tests/suites.json 一份，python 的 run_tests.py 也读它，避免两处漂移。
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'tests', 'suites.json'), 'utf8'));
const env = {...process.env, SETTLEMENT_WEB_ROOT: process.env.SETTLEMENT_WEB_ROOT || root};

let failed = [];
for (const suite of manifest.unit) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(root, 'tests', suite.file)], {cwd: path.join(root, 'tests'), env, encoding: 'utf8'});
  const ms = Date.now() - started;
  if (run.status === 0) {
    console.log(`  通过  ${suite.file}  (${ms} ms)  ${suite.title}`);
  } else {
    failed.push(suite.file);
    console.log(`  失败  ${suite.file}  ${suite.title}`);
    if (run.stdout) console.log(run.stdout.trim().split('\n').map(l => '      ' + l).join('\n'));
    if (run.stderr) console.log(run.stderr.trim().split('\n').map(l => '      ' + l).join('\n'));
  }
}
console.log(`\n单元：${manifest.unit.length - failed.length}/${manifest.unit.length} 通过`);
process.exit(failed.length ? 1 : 0);
