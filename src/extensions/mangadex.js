import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch, numberOrNull, localized } from './utils.js';
import { tagKey } from '../frontend/discovery-core.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export default class MangaDex extends BaseScraper {
  constructor(options = {}) {
    const config = definitionFor('mangadex');
    super({ ...config, ...options, id: config.id });
    this.languages = options.languages ?? ['es', 'es-la'];
    this.maxPages = options.maxPages ?? 100;
  }

  resource(value, kind) {
    const url = this.pageUrl(value);
    const match = new URL(url).pathname.match(new RegExp(`^/${kind}/(${uuid})(?:/[^/]*)?/?$`, 'i'));
    if (!match) throw new ScraperError('Enlace de MangaDex inválido.', { code: 'INVALID_URL', url });
    const id = match[1].toLowerCase();
    return { id, url: new URL(`/${kind}/${id}`, this.baseUrl).href };
  }

  check(data) {
    if (data?.result !== 'ok') throw new ScraperError('Respuesta de MangaDex inválida.', { code: 'INVALID_RESPONSE' });
    return data;
  }

  manga(data) {
    if (!data?.id || !data.attributes?.title) throw new ScraperError('Ficha de MangaDex inválida.', { code: 'INVALID_RESPONSE' });
    const cover = data.relationships?.find(item => item.type === 'cover_art')?.attributes?.fileName;
    return { title: localized(data.attributes.title), url: new URL(`/title/${data.id}`, this.baseUrl).href,
      cover: cover ? `https://uploads.mangadex.org/covers/${encodeURIComponent(data.id)}/${encodeURIComponent(cover)}.512.jpg` : null,
      genres: (data.attributes.tags ?? []).filter(tag => tag.attributes?.group === 'genre').map(tag => localized(tag.attributes.name)).filter(Boolean),
      themes: (data.attributes.tags ?? []).filter(tag => tag.attributes?.group === 'theme').map(tag => localized(tag.attributes.name)).filter(Boolean),
      altTitles: (data.attributes.altTitles??[]).map(title=>localized(title)).filter(Boolean).slice(0,30),
      country: ({ja:'JP',ko:'KR',zh:'CN'})[data.attributes.originalLanguage]??null,
      authors: (data.relationships ?? []).filter(rel => ['author','artist'].includes(rel.type)).map(rel => rel.attributes?.name).filter(Boolean),
      contentRating: data.attributes.contentRating ?? 'safe',
      description: localized(data.attributes.description) || null, status: data.attributes.status ?? null };
  }

  async search(query, { page = 0, adult = false } = {}) {
    validateSearch(query, page);
    const limit = 20;
    if (page * limit > 9980) throw new ScraperError('Se alcanzó el límite de paginación de MangaDex.', { code: 'PAGINATION_LIMIT' });
    const params = new URLSearchParams({ title: query.trim(), limit, offset: page * limit });
    for (const rating of adult ? ['erotica','pornographic'] : ['safe','suggestive']) params.append('contentRating[]', rating);
    for (const language of this.languages) params.append('availableTranslatedLanguage[]', language);
    for (const include of ['cover_art', 'author', 'artist']) params.append('includes[]', include);
    const data = this.check(await this.fetchJson(`manga?${params}`));
    if (!Array.isArray(data.data)) throw new ScraperError('Resultados inválidos.', { code: 'INVALID_RESPONSE' });
    return { source: this.id, results: data.data.map(item => this.manga(item)),
      nextPage: data.offset + data.data.length < data.total ? page + 1 : null };
  }

  async getManga(mangaUrl) {
    const { id } = this.resource(mangaUrl, 'title');
    const data = this.check(await this.fetchJson(`manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`));
    return { source: this.id, manga: this.manga(data.data) };
  }

  async recommend(input) {
    const options=typeof input==='string'?{genres:[input]}:input??{};
    const tags = this.check(await this.fetchJson('manga/tag'));
    const find=(name,group)=>tags.data?.find(tag=>tag.attributes?.group===group&&Object.values(tag.attributes.name??{}).some(value=>tagKey(value)===tagKey(name)));
    const include=[...(options.genres??[]).map(name=>({name,group:'genre'})),...(options.themes??[]).map(name=>({name,group:'theme'}))];
    const unavailableTags=include.filter(({name,group})=>!find(name,group)).map(t=>t.name);
    if(unavailableTags.length)return {source:this.id,results:[],nextPage:null,unavailableTags};
    const params = new URLSearchParams({ limit: 32, offset: (options.page??0)*32, 'order[followedCount]': 'desc',includedTagsMode:'AND',excludedTagsMode:'OR',hasAvailableChapters:'true' });
    for (const rating of options.adult ? ['erotica','pornographic'] : ['safe','suggestive']) params.append('contentRating[]', rating);
    for(const {name,group} of include)params.append('includedTags[]',find(name,group).id);
    for(const [key,group] of [['excludeGenres','genre'],['excludeThemes','theme']])for(const name of options[key]??[]){const tag=find(name,group);if(tag)params.append('excludedTags[]',tag.id);}
    if(options.status)params.append('status[]',options.status);
    const language=({JP:'ja',KR:'ko',CN:'zh'})[options.country];if(language)params.append('originalLanguage[]',language);
    for (const language of this.languages) params.append('availableTranslatedLanguage[]', language);
    for (const include of ['cover_art', 'author', 'artist']) params.append('includes[]', include);
    const data = this.check(await this.fetchJson(`manga?${params}`));
    if(!Array.isArray(data.data))throw new ScraperError('Resultados inválidos.',{code:'INVALID_RESPONSE'});
    return { source: this.id, results: data.data.map(item => this.manga(item)), nextPage: data.offset + data.data.length < data.total ? (options.page??0)+1 : null,unavailableTags:[] };
  }

  async getChapters(mangaUrl) {
    const { id, url } = this.resource(mangaUrl, 'title');
    const { manga } = await this.getManga(url);
    const chapters = [];
    const seen = new Set();
    let offset = 0;
    for (let page = 0; ; page++) {
      if (page >= this.maxPages || offset > 9900) throw new ScraperError('Lista demasiado grande; no se guardó un resultado parcial.', { code: 'PAGINATION_LIMIT', url });
      const params = new URLSearchParams({ limit: 100, offset, 'order[chapter]': 'asc', includeExternalUrl: 0 });
      for (const language of this.languages) params.append('translatedLanguage[]', language);
      for (const rating of ['safe', 'suggestive', 'erotica', 'pornographic']) params.append('contentRating[]', rating);
      const data = this.check(await this.fetchJson(`manga/${id}/feed?${params}`));
      if (!Array.isArray(data.data) || !Number.isSafeInteger(data.total) || data.total < 0) {
        throw new ScraperError('Lista de capítulos inválida.', { code: 'INVALID_RESPONSE', url });
      }
      for (const item of data.data) {
        const attributes = item.attributes;
        if (!attributes || attributes.externalUrl || attributes.isUnavailable || !attributes.pages ||
            !this.languages.includes(attributes.translatedLanguage) || seen.has(item.id)) continue;
        const chapterUrl = this.resource(new URL(`/chapter/${item.id}`, this.baseUrl).href, 'chapter').url;
        seen.add(item.id);
        chapters.push({ title: `Capítulo ${attributes.chapter ?? 'extra'}${attributes.title ? ` · ${attributes.title}` : ''} [${attributes.translatedLanguage}]`,
          number: numberOrNull(attributes.chapter), url: chapterUrl });
      }
      offset += data.data.length;
      if (offset >= data.total) break;
      if (!data.data.length) throw new ScraperError('La paginación no avanzó.', { code: 'INVALID_RESPONSE', url });
    }
    if (!chapters.length) throw new ScraperError('Esta obra no tiene capítulos públicos en los idiomas seleccionados.', { code: 'EXTRACTION_EMPTY', url });
    return { source: this.id, manga, chapters };
  }

  async getChapterImages(chapterUrl) {
    const { id, url } = this.resource(chapterUrl, 'chapter');
    const detail = this.check(await this.fetchJson(`chapter/${id}`)).data;
    if (!detail?.attributes || detail.attributes.externalUrl || detail.attributes.isUnavailable || !detail.attributes.pages) {
      throw new ScraperError('Capítulo externo o no disponible.', { code: 'CHAPTER_UNAVAILABLE', url });
    }
    const data = this.check(await this.fetchJson(`at-home/server/${id}?forcePort443=true`));
    const node = new URL(this.resolveUrl(data.baseUrl));
    if (node.protocol !== 'https:' || node.port || node.pathname !== '/' || node.search ||
        !(node.hostname === 'uploads.mangadex.org' || node.hostname.endsWith('.mangadex.network'))) {
      throw new ScraperError('Nodo de imágenes no autorizado.', { code: 'INVALID_ORIGIN', url });
    }
    if (typeof data.chapter?.hash !== 'string' || !/^[a-f0-9]+$/i.test(data.chapter.hash) ||
        !Array.isArray(data.chapter.data) || !data.chapter.data.length) {
      throw new ScraperError('Lista de imágenes inválida.', { code: 'INVALID_RESPONSE', url });
    }
    const images = data.chapter.data.map((file, index) => {
      if (typeof file !== 'string' || !file || /[\/\\]/.test(file)) throw new ScraperError('Nombre de imagen inválido.', { code: 'INVALID_RESPONSE', url });
      return { index: index + 1, url: `${node.origin}/data/${data.chapter.hash}/${encodeURIComponent(file)}`, referer: url };
    });
    const attributes = detail.attributes;
    return { source: this.id, chapter: { title: `Capítulo ${attributes.chapter ?? 'extra'}${attributes.title ? ` · ${attributes.title}` : ''}`, url }, images };
  }
}
