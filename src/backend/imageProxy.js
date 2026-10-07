import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError } from './errors.js';
import { allowedPageUrl, allowedImageUrl, sourceFor } from './sources.js';

const redirects = new Set([301, 302, 303, 307, 308]);
const rasterTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);

function requestImage(url, { signal, headers, headerTimeoutMs, idleTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith('https:') ? https : http).get(url, { signal, headers });
    const headerTimer = setTimeout(() => request.destroy(new ApiError(504, 'IMAGE_HEADER_TIMEOUT', 'El origen no envió cabeceras a tiempo.')), headerTimeoutMs);
    headerTimer.unref();
    request.once('error', error => { clearTimeout(headerTimer); reject(error); });
    request.setTimeout(idleTimeoutMs, () => request.destroy(new ApiError(504, 'IMAGE_IDLE_TIMEOUT', 'La conexión de imagen quedó inactiva.')));
    request.once('response', response => { clearTimeout(headerTimer); resolve(response); });
  });
}

export function createImageProxy({ tickets, sources, headerTimeoutMs = 15000, idleTimeoutMs = 15000,
  totalTimeoutMs = 120000, maxBytes = 64 * 1024 * 1024, maxConcurrent = 8, logger = console, authorize = () => {} }) {
  let active = 0;
  return async function imageProxy(req, res, next) {
    const controller = new AbortController();
    let upstream;
    let timer;
    let counted = false;
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    try {
      const image = tickets.verify(req.query.ticket);
      authorize(req, image);
      if ((req.query.url !== undefined && req.query.url !== image.url) ||
          (req.query.referer !== undefined && req.query.referer !== image.referer)) {
        throw new ApiError(403, 'IMAGE_TICKET_MISMATCH', 'La URL no coincide con su firma.');
      }
      const source = sourceFor(sources, image.source);
      const referer = allowedPageUrl(image.referer, source);
      let url = allowedImageUrl(image.url, source);
      if (active >= maxConcurrent) throw new ApiError(503, 'IMAGE_BUSY', 'Demasiadas imágenes simultáneas.');
      active++;
      counted = true;
      res.once('close', disconnect);
      timer = setTimeout(() => controller.abort(new ApiError(504, 'IMAGE_TOTAL_TIMEOUT', 'Tiempo máximo de descarga agotado.')), totalTimeoutMs);
      timer.unref();
      for (let hop = 0; ; hop++) {
        upstream = await requestImage(url, {
          signal: controller.signal, headerTimeoutMs, idleTimeoutMs,
          headers: { Referer: referer, 'User-Agent': source.userAgent,
            Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'Accept-Encoding': 'identity' }
        });
        if (!redirects.has(upstream.statusCode)) break;
        const location = upstream.headers.location;
        upstream.destroy();
        if (hop >= 5 || !location) throw new ApiError(502, 'IMAGE_REDIRECT', 'Redirección de imagen inválida.');
        // Valida cada salto; nunca reenviar cabeceras a un destino arbitrario.
        url = allowedImageUrl(new URL(location, url).href, source);
      }
      if (upstream.statusCode !== 200) {
        throw new ApiError(upstream.statusCode === 404 ? 404 : 502, 'IMAGE_UPSTREAM_STATUS', `El origen respondió HTTP ${upstream.statusCode}.`);
      }
      const type = upstream.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (!rasterTypes.has(type)) throw new ApiError(502, 'IMAGE_CONTENT_TYPE', 'El origen no devolvió una imagen compatible.');
      if (upstream.headers['content-encoding'] && upstream.headers['content-encoding'] !== 'identity') {
        throw new ApiError(502, 'IMAGE_ENCODING', 'El origen no respetó Accept-Encoding: identity.');
      }
      const length = upstream.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
        throw new ApiError(502, 'IMAGE_TOO_LARGE', 'La imagen supera el límite permitido.');
      }
      res.status(200).set({ 'Content-Type': type, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff' });
      if (length) res.set('Content-Length', length);
      let bytes = 0;
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes) callback(new ApiError(502, 'IMAGE_TOO_LARGE', 'La imagen supera el límite permitido.'));
          else callback(null, chunk);
        }
      });
      // Buffers acotados + backpressure. No Buffer.concat(), arrayBuffer() ni text().
      // Tras enviar cabeceras un error debe cerrar la conexión, no añadir JSON a la imagen.
      res.flushHeaders();
      await pipeline(upstream, limiter, res, { signal: controller.signal });
    } catch (cause) {
      const error = controller.signal.reason instanceof ApiError ? controller.signal.reason : cause;
      if (!res.headersSent && !res.destroyed) {
        next(error instanceof ApiError ? error : new ApiError(502, 'IMAGE_NETWORK_ERROR', 'Falló la conexión con el origen.', { cause: error }));
      } else {
        if (!res.destroyed) res.destroy();
        if (!controller.signal.aborted) logger.warn?.('Stream de imagen interrumpido', { code: error.code ?? 'IMAGE_STREAM_ERROR' });
      }
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
      upstream?.destroy();
      controller.abort();
      if (counted) active--;
    }
  };
}
