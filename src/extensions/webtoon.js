import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch } from './utils.js';
import { tagKey } from '../frontend/discovery-core.js';

const text = value => value.replace(/\s+/g, ' ').trim();

export default class Webtoon extends BaseScraper {
  constructor(options = {}) {
    const config = definitionFor('webtoon');
    super({ ...config, ...options, id: config.id });
    this.maxPages = options.maxPages ?? 200;
    this.genreDocuments = new Map();
  }

  resource(value, type = 'list') {
    const url = new URL(this.pageUrl(value));
    if (!url.pathname.startsWith('/es/') || !url.pathname.endsWith(`/${type}`) ||
        !/^[1-9]\d*$/.test(url.searchParams.get('title_no') ?? '') ||
        (type === 'viewer' && !/^[1-9]\d*$/.test(url.searchParams.get('episode_no') ?? ''))) {
      throw new ScraperError('Enlace de WEBTOON Español inválido.', { code: 'INVALID_URL', url: url.href });
    }
    const params = new URLSearchParams({ title_no: url.searchParams.get('title_no') });
    if (type === 'viewer') params.set('episode_no', url.searchParams.get('episode_no'));
    url.search = params.toString();
    return url;
  }

  manga($, url) {
    const titleNode=$('h1.subj').first().clone();titleNode.find('br').replaceWith(' ');
    const title = text(titleNode.text());
    if (!title) throw new ScraperError('Ficha de WEBTOON no encontrada.', { code: 'EXTRACTION_EMPTY', url });
    const cover = $('meta[property="og:image"]').attr('content');
    const genre=text($('.info .genre,.detail_header .genre').first().text());
    return { title, url, cover: cover ? this.resolveUrl(cover, url) : null,
      genres:genre?[tagKey(genre)]:[],authors:[text($('.info .author').first().text())].filter(Boolean),
      description: text($('p.summary').first().text()) || null, language: 'es' };
  }

  async genreDocument(path){const cached=this.genreDocuments.get(path);if(cached?.expires>Date.now())return cached.document;
    const document=await this.fetchDocument(path);if(this.genreDocuments.size>=20)this.genreDocuments.delete(this.genreDocuments.keys().next().value);this.genreDocuments.set(path,{document,expires:Date.now()+300000});return document;}
  async recommend(filters={}) {
    const { $,url }=await this.genreDocument('/es/genres'),items=new Map(),categories=new Map();
    const keys={SF:'sci-fi',SLICE_OF_LIFE:'slice of life',THRILLER:'thriller',SUPERNATURAL:'supernatural'};
    $('a._snb_tab_a[href]').each((_,el)=>{const link=$(el);categories.set(keys[link.attr('data-genre')]??tagKey(link.attr('data-genre')),this.pageUrl(link.attr('href')));});
    const unavailableTags=[...(filters.themes??[]),...(filters.genres??[]).filter(tag=>!categories.has(tagKey(tag)))];
    if(unavailableTags.length)return {source:this.id,results:[],unavailableTags};
    const ingest=($,url)=>$('a._genre_title_a[href]').each((_,el)=>{
      const link=$(el),genre=keys[link.attr('data-genre')]??tagKey(link.attr('data-genre'));
      let mangaUrl;try{mangaUrl=this.resource(link.attr('href')).href;}catch{return;}
      const title=text(link.find('.title').text()),cover=link.find('img').attr('src');if(!title)return;
      const previous=items.get(mangaUrl);
      if(previous){previous.genres=[...new Set([...previous.genres,genre])];return;}
      items.set(mangaUrl,{title,url:mangaUrl,cover:cover?this.resolveUrl(cover,url):null,genres:[genre],themes:[],authors:[text(link.find('.author').text())].filter(Boolean),contentRating:link.find('[data-title-unsuitable-for-children="true"]').length?'adult':'unknown',language:'es'});
    });
    ingest($,url);
    const paths=filters.genres?.length?filters.genres.map(tag=>categories.get(tagKey(tag))):['action','fantasy','romance'].map(key=>categories.get(key));
    let cursor=0;const worker=async()=>{while(cursor<paths.length){const path=paths[cursor++];if(!path)continue;const document=await this.genreDocument(path);ingest(document.$,document.url);}};
    await Promise.all([worker(),worker()]);
    if(!items.size)throw new ScraperError('Catálogo de géneros de WEBTOON vacío.',{code:'EXTRACTION_EMPTY'});
    // Una muestra por género evita que el primer bloque (drama) eclipse a los demás.
    const buckets=new Map();for(const item of items.values()){const key=item.genres[0];if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(item);}
    const results=[];while(results.length<60&&[...buckets.values()].some(list=>list.length))for(const list of buckets.values()){if(list.length)results.push(list.shift());if(results.length===60)break;}
    // Con géneros explícitos se conserva todo el bloque pertinente antes del límite.
    return {source:this.id,results:filters.genres?.length?[...items.values()].filter(item=>filters.genres.some(tag=>item.genres.includes(tagKey(tag)))).slice(0,60):results,unavailableTags:[]};
  }

  async getManga(mangaUrl) {
    const url = this.resource(mangaUrl).href;
    const { $ } = await this.fetchDocument(url);
    return { source: this.id, manga: this.manga($, url) };
  }

  async search(query, { page = 0 } = {}) {
    validateSearch(query, page);
    const params = new URLSearchParams({ keyword: query.trim(), page: page + 1 });
    const { $, url } = await this.fetchDocument(new URL(`/es/search?${params}`, this.baseUrl).href);
    const results = new Map();
    $('a[href*="title_no="]').each((_, element) => {
      const link = $(element);
      let mangaUrl;
      try { mangaUrl = this.resource(this.resolveUrl(link.attr('href'), url)).href; } catch { return; }
      const title = text(link.find('.subj,.title').first().text()) || link.find('img').attr('alt');
      if (!title) return;
      const cover = link.find('img').first().attr('src');
      results.set(mangaUrl, { title, url: mangaUrl, cover: cover ? this.resolveUrl(cover, url) : null, language: 'es' });
    });
    const next = $('.paginate a.pg_next').length > 0;
    return { source: this.id, results: [...results.values()], nextPage: next ? page + 1 : null };
  }

  async getChapters(mangaUrl) {
    const base = this.resource(mangaUrl);
    const chapters = new Map();
    let manga;
    let page = 1;
    for (let count = 0; ; count++) {
      if (count >= this.maxPages) throw new ScraperError('Se alcanzó el límite de páginas; lista incompleta.', { code: 'PAGINATION_LIMIT' });
      const target = new URL(base);
      target.searchParams.set('page', page);
      const { $, url } = await this.fetchDocument(target.href);
      manga ??= this.manga($, base.href);
      const previousCount = chapters.size;
      $('li[data-episode-no] a[href]').each((_, element) => {
        const link = $(element);
        const chapter = this.resource(this.resolveUrl(link.attr('href'), url), 'viewer');
        if (chapter.searchParams.get('title_no') !== base.searchParams.get('title_no')) return;
        const title = text(link.find('.subj span').first().text()) || `Episodio ${chapter.searchParams.get('episode_no')}`;
        chapters.set(chapter.href, { title, number: Number(chapter.searchParams.get('episode_no')), url: chapter.href });
      });
      const later = $('.paginate a[href]').map((_, element) => {
        const candidate = new URL(this.pageUrl($(element).attr('href'), url));
        if (candidate.pathname !== base.pathname || candidate.searchParams.get('title_no') !== base.searchParams.get('title_no')) return null;
        const value = Number(candidate.searchParams.get('page'));
        return Number.isSafeInteger(value) && value > page ? value : null;
      }).get().filter(value => value !== null);
      if (!later.length) break;
      if (chapters.size === previousCount) throw new ScraperError('La paginación no avanzó.', { code: 'INVALID_RESPONSE' });
      page = Math.min(...later);
    }
    if (!chapters.size) throw new ScraperError('No hay episodios públicos disponibles.', { code: 'EXTRACTION_EMPTY', url: base.href });
    return { source: this.id, manga, chapters: [...chapters.values()] };
  }

  async getChapterImages(chapterUrl) {
    const chapter = this.resource(chapterUrl, 'viewer');
    const { $, url } = await this.fetchDocument(chapter.href);
    const images = $('#_imageList img').map((_, element) => $(element).attr('data-url')).get()
      .filter(Boolean).map((image, index) => ({ index: index + 1, url: this.resolveUrl(image, url), referer: url }));
    if (!images.length) throw new ScraperError('Este episodio no está disponible para lectura pública en la web.', { code: 'CHAPTER_UNAVAILABLE', url });
    return { source: this.id, chapter: { title: text($('h1.subj').first().text()) || `Episodio ${chapter.searchParams.get('episode_no')}`, url }, images };
  }
}
