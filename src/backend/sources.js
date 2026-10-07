import { createSources, publicSource } from '../extensions/index.js';
import { ApiError, httpUrl } from './errors.js';

export const sources = createSources();
export const listSources = sources => [...sources].filter(([,source])=>source.enabled!==false&&!source.demo).map(([id, source]) => publicSource(id, source));

export function sourceFor(sources, id) {
  const source = sources.get(id);
  if (!source) throw new ApiError(400, 'UNKNOWN_SOURCE', 'Extensión desconocida.');
  if (source.enabled === false) throw new ApiError(503, 'SOURCE_UNAVAILABLE', source.reason);
  return source;
}

export function allowedUrl(value, origins) {
  const url = httpUrl(value);
  if (!origins.includes(new URL(url).origin)) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origen no autorizado para esta extensión.');
  }
  return url;
}

export const allowedPageUrl = (value, source) => allowedUrl(value, source.pageOrigins ?? [source.pageOrigin]);

export function allowedImageUrl(value, source) {
  const url = httpUrl(value);
  const parsed = new URL(url);
  if (source.imageOrigins.includes(parsed.origin)) return url;
  // Solo nodos HTTPS de la red declarada, sin puertos alternativos ni hosts parecidos.
  if (parsed.protocol === 'https:' && !parsed.port && (source.imageHostSuffixes ?? []).some(suffix =>
    parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`))) return url;
  throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origen de imagen no autorizado para esta extensión.');
}

export function detectSource(sources, value) {
  const url = httpUrl(value);
  const origin = new URL(url).origin;
  for (const [id, source] of sources) {
    if ((source.pageOrigins ?? [source.pageOrigin]).includes(origin)) return { id, source };
  }
  throw new ApiError(400, 'UNKNOWN_SOURCE', 'No hay una extensión para este sitio.');
}
