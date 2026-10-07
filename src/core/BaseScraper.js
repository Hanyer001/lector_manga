import { load, loadBuffer } from 'cheerio';
import { HttpTransport } from '../transports/HttpTransport.js';
import { BrowserTransport } from '../transports/BrowserTransport.js';
import { runOperation, operationContext } from './operation.js';
import { ScraperError } from './ScraperError.js';

export class BaseScraper {
  constructor({ id, baseUrl, timeoutMs = 15000, maxRetries = 2, retryDelayMs = 500,
    maxRetryDelayMs = 30000, maxHtmlBytes = 8 * 1024 * 1024, fetchImpl = globalThis.fetch,
    pageOrigins, apiBaseUrl, apiOrigins = [], browserOrigins = [], operationTimeoutMs = 45000, transport = 'http', browserOptions = {}, documentTransport } = {}) {
    if (!id || !baseUrl) throw new TypeError('id y baseUrl son obligatorios.');
    this.id = id;
    this.baseUrl = this.resolveUrl(baseUrl);
    this.pageOrigins = pageOrigins ?? [new URL(this.baseUrl).origin];
    this.apiBaseUrl = apiBaseUrl;
    this.apiOrigins = apiOrigins;
    this.browserOrigins = browserOrigins;
    for (const [name, value] of Object.entries({ timeoutMs, maxRetries, retryDelayMs, maxRetryDelayMs, maxHtmlBytes, operationTimeoutMs })) {
      if (!Number.isSafeInteger(value) || value < (['timeoutMs', 'maxHtmlBytes', 'operationTimeoutMs'].includes(name) ? 1 : 0)) {
        throw new TypeError(`${name} debe ser un entero válido.`);
      }
    }
    Object.assign(this, { timeoutMs, maxRetries, retryDelayMs, maxRetryDelayMs, maxHtmlBytes, fetchImpl, operationTimeoutMs });
    if (!['http', 'browser'].includes(transport)) throw new TypeError('Transporte desconocido.');
    this.http = new HttpTransport(this);
    this.documentTransport = documentTransport ?? (transport === 'browser' ? new BrowserTransport(this, browserOptions) : this.http);
  }

  resolveUrl(value, base = this.baseUrl) {
    try {
      if (typeof value !== 'string' || !value.trim()) throw new Error('URL vacía');
      const url = new URL(value.trim(), base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL no admitida');
      url.hash = '';
      return url.href;
    } catch (cause) {
      throw new ScraperError('URL HTTP(S) inválida.', { code: 'INVALID_URL', cause });
    }
  }

  pageUrl(value, base = this.baseUrl) {
    const url = this.resolveUrl(value, base);
    if (!this.pageOrigins.includes(new URL(url).origin)) {
      throw new ScraperError('La página no pertenece al origen de esta extensión.', { code: 'INVALID_ORIGIN', url });
    }
    return url;
  }

  async fetchDocument(input, options = {}) {
    const { buffer, url, encoding } = await this.documentTransport.fetchContent(input, { ...options, signal: operationContext()?.signal });
    return { $: encoding === 'utf8' ? load(buffer.toString('utf8'), { baseURI: url }) : loadBuffer(buffer, { baseURI: url }), url };
  }

  async fetchJson(input) {
    if (!this.apiBaseUrl) throw new TypeError('apiBaseUrl es obligatorio para JSON.');
    const { buffer, url } = await this.fetchContent(input, { json: true });
    try { return JSON.parse(buffer.toString('utf8')); }
    catch (cause) { throw new ScraperError('La API devolvió JSON inválido.', { code: 'INVALID_JSON', url, cause }); }
  }

  fetchContent(input, options) { return this.http.fetchContent(input, options); }
  runOperation(task, options = {}) { return runOperation(task, { timeoutMs: this.operationTimeoutMs, ...options }); }

  async getChapters(_mangaUrl) { throw new Error('La extensión debe implementar getChapters().'); }
  async getChapterImages(_chapterUrl) { throw new Error('La extensión debe implementar getChapterImages().'); }
  async getManga(_mangaUrl) { throw new ScraperError('Esta fuente no admite fichas.', { code: 'UNSUPPORTED_OPERATION' }); }
  async search(_query) { throw new ScraperError('Esta fuente no admite búsquedas.', { code: 'UNSUPPORTED_OPERATION' }); }
  async recommend(_genre) { throw new ScraperError('Esta fuente no admite recomendaciones por género.', { code: 'UNSUPPORTED_OPERATION' }); }
}
