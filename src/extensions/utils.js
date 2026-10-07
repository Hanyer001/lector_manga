import { ScraperError } from '../core/ScraperError.js';

export function validateSearch(query, page) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200 ||
      !Number.isSafeInteger(page) || page < 0 || page > 10000) {
    throw new ScraperError('Consulta o página inválida.', { code: 'INVALID_QUERY' });
  }
}

export function numberOrNull(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export function localized(value, languages = ['es', 'es-la', 'en', 'ja-ro']) {
  if (!value || typeof value !== 'object') return '';
  return languages.map(language => value[language]).find(Boolean) || Object.values(value).find(Boolean) || '';
}
