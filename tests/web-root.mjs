import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const webRoot=resolve(process.env.SETTLEMENT_WEB_ROOT||'D:/Ai-Files/Tools/Html/settlement-tool');
export const webRootURL=pathToFileURL(webRoot+'/');
export const testOutputRoot=resolve(process.env.SETTLEMENT_TEST_OUTPUT||fileURLToPath(new URL('../build/sync-20261012/',import.meta.url)));
export const testOutputURL=pathToFileURL(testOutputRoot+'/');
