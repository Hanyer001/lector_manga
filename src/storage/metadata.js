import { ApiError } from '../backend/errors.js';

export const readingStates = ['planned', 'reading', 'on_hold', 'completed', 'abandoned'];
export const publicationStates = ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'];
export function normalizeMetadata(input = {}, strict = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (strict) throw new ApiError(400, 'INVALID_METADATA', 'Metadatos inválidos.');
    return {};
  }
  const result = {};
  if(input.chapterAlignment!==undefined&&strict){
    const entries=input.chapterAlignment;
    if(!Array.isArray(entries)||entries.length>1000||entries.some(entry=>!entry||typeof entry.url!=='string'||entry.url.length>2000||!/^https?:\/\//.test(entry.url)||typeof entry.number!=='number'||!Number.isFinite(entry.number)||entry.number<0||entry.number>100000)||new Set(entries.map(entry=>entry.url)).size!==entries.length)throw new ApiError(400,'INVALID_METADATA','Numeración común inválida. Usa números entre 0 y 100000 y un ajuste por capítulo.');
    result.chapterAlignment=entries.map(({url,number})=>({url,number}));
  }
  if (input.contentRating !== undefined) {
    if (['safe','suggestive','erotica','pornographic','adult'].includes(input.contentRating)) result.contentRating = input.contentRating;
    else if (strict) throw new ApiError(400, 'INVALID_METADATA', 'Clasificación de contenido inválida.');
  }
  for (const key of ['genres', 'themes', 'authors', 'altTitles']) if (input[key] !== undefined) {
    const value = input[key];
    const max=key==='altTitles'?2000:120;
    if (!Array.isArray(value) || value.length > 30 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > max)) {
      if (strict) throw new ApiError(400, 'INVALID_METADATA', `${key}: usa hasta 30 nombres de ${max} caracteres.`);
    } else result[key] = [...new Set(value.map(v => v.trim()))];
  }
  if (input.status !== undefined) {
    const aliases = { 'en emisión': 'ongoing', 'finalizado': 'completed', 'en pausa': 'hiatus' };
    const status = aliases[String(input.status).toLowerCase()] ?? input.status;
    if (publicationStates.includes(status)) result.status = status;
    else if (strict) throw new ApiError(400, 'INVALID_METADATA', 'Estado de publicación inválido.');
  }
  if (input.country !== undefined) {
    if (input.country === null || /^[A-Z]{2}$/.test(input.country)) result.country = input.country;
    else if (strict) throw new ApiError(400, 'INVALID_METADATA', 'País: usa un código de dos letras o un valor vacío.');
  }
  for (const [key, max] of [['description', 10000], ['language', 30]]) if (input[key] !== undefined) {
    if (input[key] === null || typeof input[key] === 'string' && input[key].length <= max) result[key] = input[key];
    else if (strict) throw new ApiError(400, 'INVALID_METADATA', `Campo ${key} inválido.`);
  }
  return result;
}
