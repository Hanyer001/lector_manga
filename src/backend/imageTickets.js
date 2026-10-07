import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

// URLs firmadas: no almacena imágenes ni un registro ilimitado en RAM.
export function createImageTickets({ secret = randomBytes(32), ttlMs = 6 * 60 * 60 * 1000 } = {}) {
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    issue(image) {
      const payload = Buffer.from(JSON.stringify({ ...image, expires: Date.now() + ttlMs })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    verify(ticket) {
      const invalid = () => new ApiError(403, 'INVALID_IMAGE_TICKET', 'Enlace de imagen inválido o vencido; recarga el capítulo.');
      if (typeof ticket !== 'string' || ticket.length > 24000) throw invalid();
      const parts = ticket.split('.');
      if (parts.length !== 2) throw invalid();
      const [payload, signature] = parts;
      const expected = Buffer.from(sign(payload));
      const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
      try {
        const image = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!Number.isFinite(image.expires) || image.expires <= Date.now()) throw invalid();
        return image;
      } catch { throw invalid(); }
    }
  };
}
