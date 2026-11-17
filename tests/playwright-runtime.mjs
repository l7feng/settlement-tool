// 统一的 Playwright 入口，替代各测试里写死的机器路径。
//
// 历史问题：27 个 UI 测试各自 import 一个绝对路径，散落在三台不同机器/不同 codex 运行时目录，
// 换机或升级后全变成「文件不存在」。这里按顺序探测，找不到就给出能照做的错误信息。
//
// 另一个坑：Playwright 包自带的浏览器版本经常和 `%LOCALAPPDATA%\ms-playwright` 里装的对不上
// （实测包要 chromium-1234，本地只有 1243）。所以统一注入系统浏览器可执行文件，绕开版本绑定。
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.SETTLEMENT_PLAYWRIGHT,
  'C:/Users/Administrator/AppData/Local/hermes/hermes-agent/node_modules/playwright/index.mjs',
  'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
  'C:/Users/32112/.codex/visualizations/2026/10/11/01a12aa9-0081-7d52-aa44-6ba306a04d0b/ppt-runtime/gen-pptx/node_modules/playwright/index.mjs',
  new URL('../node_modules/playwright/index.mjs', import.meta.url).pathname,
  new URL('./node_modules/playwright/index.mjs', import.meta.url).pathname,
].filter(Boolean);

const BROWSERS = [
  process.env.SETTLEMENT_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const runtime = CANDIDATES.find((p) => existsSync(p));
if (!runtime) {
  throw new Error('未找到 Playwright：请设置 SETTLEMENT_PLAYWRIGHT 指向 playwright/index.mjs，或在仓库根执行 npm i -D playwright');
}
const executablePath = BROWSERS.find((p) => existsSync(p)) || null;
const real = await import(pathToFileURL(runtime).href);

// 只拦 launch：测试里唯一的用法就是 chromium.launch。
export const chromium = {
  async launch(options = {}) {
    const merged = { headless: true, ...(executablePath && !options.executablePath ? { executablePath } : {}), ...options };
    return real.chromium.launch(merged);
  },
};
export const playwrightRuntime = { runtime, executablePath };
