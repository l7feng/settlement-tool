import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
// 默认指向本仓库自身：历史上默认指向 D:/Ai-Files/Tools/Html/settlement-tool 工作副本，
// 结果「改完仓库再跑测试，测的还是旧副本」，一度把已修好的计价断言又跑红。
export const webRoot=resolve(process.env.SETTLEMENT_WEB_ROOT||fileURLToPath(new URL('../',import.meta.url)));
export const webRootURL=pathToFileURL(webRoot+'/');
export const testOutputRoot=resolve(process.env.SETTLEMENT_TEST_OUTPUT||fileURLToPath(new URL('../build/sync-20261012/',import.meta.url)));
export const testOutputURL=pathToFileURL(testOutputRoot+'/');
