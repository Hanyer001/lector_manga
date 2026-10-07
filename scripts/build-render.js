import './prepare-client.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
if(process.env.INSTALL_BROWSER==='1') {
  const { install, Browser, detectBrowserPlatform } = await import('@puppeteer/browsers');
  const { PUPPETEER_REVISIONS } = await import('puppeteer-core');
  const cacheDir=fileURLToPath(new URL('../work/browser/',import.meta.url));
  await mkdir(cacheDir,{recursive:true});
  const browser=await install({browser:Browser.CHROME,buildId:PUPPETEER_REVISIONS.chrome,platform:detectBrowserPlatform(),cacheDir});
  await writeFile(new URL('../work/browser/executable.json',import.meta.url),JSON.stringify({relativePath:relative(cacheDir,browser.executablePath)}));
  console.log('Chrome compatible preparado para las fuentes que usan JavaScript.');
}
