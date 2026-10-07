import { setTimeout as sleep } from 'node:timers/promises';
import { ScraperError } from '../core/ScraperError.js';
import { operationContext, cancellationError } from '../core/operation.js';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
export class HttpTransport {
  constructor(scraper) { Object.assign(this, scraper); this.pageUrl = scraper.pageUrl.bind(scraper); this.resolveUrl = scraper.resolveUrl.bind(scraper); }
  async fetchContent(input, { json = false, signal: externalSignal, form } = {}) {
    const checkUrl = value => {
      if (!json) return this.pageUrl(value);
      const url = this.resolveUrl(value, this.apiBaseUrl);
      if (![new URL(this.apiBaseUrl).origin,...this.apiOrigins].includes(new URL(url).origin)) {
        throw new ScraperError('Destino de API no autorizado.', { code: 'INVALID_ORIGIN', url });
      }
      return url;
    };
    const initialUrl = checkUrl(input);
    const total = externalSignal ?? operationContext()?.signal ?? AbortSignal.timeout(this.operationTimeoutMs);
    if (total.aborted) throw cancellationError(total);
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const signal = AbortSignal.any([total, AbortSignal.timeout(this.timeoutMs)]);
      try {
        let url = initialUrl;
        // Algunos catálogos consultan mediante formularios POST públicos, sin sesión.
        let body = form === undefined ? undefined : new URLSearchParams(form).toString();
        let response;
        for (let redirects = 0; ; redirects++) {
          response = await this.fetchImpl(url, {
            signal, redirect: 'manual', method: body === undefined ? 'GET' : 'POST', body,
            headers: { Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
              ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
              'User-Agent': 'PersonalMangaReader/0.1', Referer: this.baseUrl }
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          await response.body?.cancel();
          if (redirects >= 5) throw new ScraperError('Demasiadas redirecciones.', { code: 'REDIRECT_LIMIT', url });
          url = checkUrl(this.resolveUrl(response.headers.get('location'), url));
          if (response.status === 303) body = undefined;
        }
        if (!response.ok) {
          await response.body?.cancel();
          const raw = response.headers.get('retry-after');
          const retryAfterMs = !raw ? 0 : /^\d+$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - Date.now()) || 0;
          throw new ScraperError(`HTTP ${response.status} al obtener la página.`, {
            code: 'HTTP_ERROR', status: response.status, url,
            retryable: RETRY_STATUSES.has(response.status), retryAfterMs
          });
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!(json ? /^application\/json(;|$)/i : /^(text\/html|application\/xhtml\+xml)(;|$)/i).test(contentType)) {
          await response.body?.cancel();
          throw new ScraperError(`La respuesta no es ${json ? 'JSON' : 'HTML'}.`, { code: 'INVALID_CONTENT_TYPE', url });
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > this.maxHtmlBytes) throw new ScraperError('HTML demasiado grande.', { code: 'HTML_TOO_LARGE', url });
          chunks.push(Buffer.from(chunk));
        }
        // El timeout también cubre la descarga del cuerpo, no solo sus cabeceras.
        signal.throwIfAborted();
        return { buffer: Buffer.concat(chunks), url };
      } catch (cause) {
        if (total.aborted) throw cancellationError(total);
        const error = cause instanceof ScraperError ? cause : new ScraperError(
          signal.aborted ? 'Tiempo de espera agotado.' : 'No se pudo descargar la página.',
          { code: signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', url: initialUrl, retryable: true, cause }
        );
        if (!error.retryable || attempt === this.maxRetries) throw error;
        // Si Retry-After supera el presupuesto, no reintentar antes de lo pedido.
        if (error.retryAfterMs > this.maxRetryDelayMs) throw error;
        const backoff = this.retryDelayMs * 2 ** attempt + Math.random() * this.retryDelayMs;
        await sleep(Math.min(this.maxRetryDelayMs, Math.max(error.retryAfterMs, backoff)), undefined, { signal: total }).catch(() => { throw cancellationError(total); });
      }
    }
  }

}
