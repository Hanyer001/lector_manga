import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { ScraperError } from '../core/ScraperError.js';
import { cancellationError, operationContext } from '../core/operation.js';

export function browserExecutable() {
  let prepared;
  try {
    const directory=fileURLToPath(new URL('../../work/browser/',import.meta.url));
    const manifest=JSON.parse(readFileSync(new URL('../../work/browser/executable.json',import.meta.url),'utf8'));
    const candidate=resolve(directory,manifest.relativePath);
    if(candidate.startsWith(resolve(directory)+sep))prepared=candidate;
  }catch{/* El navegador preparado es opcional en modo local. */}
  const candidates = [process.env.BROWSER_EXECUTABLE,prepared,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find(path => path && existsSync(path));
}

// Navegador efímero para sitios que renderizan contenido con JavaScript.
// Nunca se usa automáticamente para eludir un bloqueo del transporte HTTP.
export class BrowserTransport {
  constructor(scraper, { executablePath, waitForSelector, launch } = {}) {
    this.scraper = scraper;
    Object.assign(this, { executablePath, waitForSelector, launch });
  }
  async fetchContent(input, { signal = operationContext()?.signal } = {}) {
    const scraper = this.scraper;
    const url = scraper.pageUrl(input);
    signal ??= AbortSignal.timeout(scraper.operationTimeoutMs);
    if (signal.aborted) throw cancellationError(signal);
    let browser;
    let closing;
    let blockedNavigation;
    let oversized = false;
    const close = () => closing ??= browser?.close().catch(() => {});
    const abort = () => { void close(); };
    try {
      const executablePath = this.executablePath ?? browserExecutable();
      if (!this.launch && !executablePath) throw new ScraperError('Instala Chrome/Edge o configura BROWSER_EXECUTABLE.', { code: 'BROWSER_UNAVAILABLE' });
      const launch = this.launch ?? (await import('puppeteer-core')).default.launch;
      browser = await launch({ executablePath, headless: true, timeout: scraper.timeoutMs,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) throw cancellationError(signal);
      const page = await browser.newPage();
      await page.setCacheEnabled(false);
      await page.setUserAgent('PersonalMangaReader/0.1');
      await page.setRequestInterception(true);
      const allowed = new Set([...scraper.pageOrigins, ...(scraper.browserOrigins ?? []),
        ...(scraper.apiBaseUrl ? [new URL(scraper.apiBaseUrl).origin] : [])]);
      page.on('request', request => {
        let valid = false;
        try {
          const target = new URL(request.url());
          valid = ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && allowed.has(target.origin);
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) scraper.pageUrl(target.href);
        } catch { valid = false; }
        if (!valid || ['image', 'media', 'font'].includes(request.resourceType())) {
          if (!valid && request.isNavigationRequest() && request.frame() === page.mainFrame()) blockedNavigation = request.url();
          void request.abort().catch(() => {});
        } else void request.continue().catch(() => {});
      });
      page.on('response', response => {
        const length = Number(response.headers()['content-length']);
        if (length > scraper.maxHtmlBytes && response.request().isNavigationRequest()) {
          oversized = true; void close();
        }
      });
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: scraper.timeoutMs });
      if (blockedNavigation) throw new ScraperError('Redirección de navegador no autorizada.', { code: 'INVALID_ORIGIN', url });
      if (oversized) throw new ScraperError('Documento demasiado grande.', { code: 'HTML_TOO_LARGE', url });
      if (!response?.ok()) throw new ScraperError(`HTTP ${response?.status() ?? 0} en el navegador.`, { code: 'HTTP_ERROR', status: response?.status(), url });
      const contentType = response.headers()['content-type'] ?? '';
      if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(contentType)) throw new ScraperError('El navegador no recibió HTML.', { code: 'INVALID_CONTENT_TYPE', url });
      if (this.waitForSelector) await page.waitForSelector(this.waitForSelector, { timeout: scraper.timeoutMs });
      const finalUrl = scraper.pageUrl(page.url());
      const html = await page.content();
      const buffer = Buffer.from(html);
      if (buffer.length > scraper.maxHtmlBytes) throw new ScraperError('Documento demasiado grande.', { code: 'HTML_TOO_LARGE', url });
      return { buffer, url: finalUrl, encoding: 'utf8' };
    } catch (error) {
      if (signal.aborted) throw cancellationError(signal);
      if (blockedNavigation) throw new ScraperError('Redirección de navegador no autorizada.', { code: 'INVALID_ORIGIN', url });
      if (oversized) throw new ScraperError('Documento demasiado grande.', { code: 'HTML_TOO_LARGE', url });
      if (error instanceof ScraperError) throw error;
      if (error.code === 'EPERM') throw new ScraperError('El entorno impide iniciar el navegador. Usa el transporte HTTP o ejecuta la aplicación en un entorno que permita abrir Chrome/Edge.', { code: 'BROWSER_UNAVAILABLE', url, cause: error });
      throw new ScraperError('No se pudo renderizar la página.', { code: error.name === 'TimeoutError' ? 'TIMEOUT' : 'BROWSER_ERROR', url, cause: error });
    } finally {
      signal.removeEventListener('abort', abort);
      await close();
    }
  }
}
