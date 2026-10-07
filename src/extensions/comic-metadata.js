import {tagKey} from '../frontend/discovery-core.js';
import {genreKeys} from '../frontend/discovery-tags.js';
export const cleanText=value=>String(value??'').replace(/\s+/g,' ').trim();
export function comicTags(values){
  const tags=[...new Set(values.map(cleanText).filter(Boolean).map(tagKey))];
  return {genres:tags.filter(tag=>genreKeys.has(tag)),themes:tags.filter(tag=>!genreKeys.has(tag)),
    contentRating:tags.some(tag=>['adult','hentai','smut','pornographic','erotica','adulto'].includes(tag))?'adult':'unknown'};
}
