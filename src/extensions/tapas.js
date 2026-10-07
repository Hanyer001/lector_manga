import { load } from 'cheerio';
import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch, numberOrNull } from './utils.js';

const text = value => value.replace(/\s+/g, ' ').trim();

export default class Tapas extends BaseScraper {
  constructor(options = {}) {
    const config = definitionFor('tapas');
    super({ ...config, ...options, id: config.id });
    this.maxPages = options.maxPages ?? 200;
  }

  resource(value, chapter = false) {
    const url = new URL(this.pageUrl(value));
    const match = url.pathname.match(chapter ? /^\/episode\/([1-9]\d*)\/?$/ : /^\/series\/([^/]+)(?:\/info)?\/?$/);
    if (!match) throw new ScraperError('Enlace de Tapas inválido.', { code: 'INVALID_URL', url: url.href });
    url.pathname = `/${chapter ? 'episode' : 'series'}/${match[1]}`;
    url.search = '';
    return { id: match[1], url: url.href };
  }

  async getManga(mangaUrl) {
    const { url } = this.resource(mangaUrl);
    const { $ } = await this.fetchDocument(`${url}/info`);
    const title = text($('meta[property="og:site_name"]').attr('content') ?? '')
      .replace(/^Read\s+/i, '') || text($('.title').first().text());
    if (!title) throw new ScraperError('Ficha de Tapas no encontrada.', { code: 'EXTRACTION_EMPTY', url });
    const cover = $('meta[property="og:image"]').attr('content');
    return { source: this.id, manga: { title, url, cover: cover ? this.resolveUrl(cover, url) : null,
      description: $('meta[name="description"]').attr('content') || null,
      language: $('meta[property="og:locale"]').attr('content')?.split('_')[0] ?? null } };
  }

  async search(query, { page = 0 } = {}) {
    validateSearch(query, page);
    const params = new URLSearchParams({ q: query.trim(), t: 'COMICS', page: page + 1 });
    const { $, url } = await this.fetchDocument(new URL(`/search?${params}`, this.baseUrl).href);
    const results = new Map();
    $('a[data-series-id][href^="/series/"]').each((_, element) => {
      const link = $(element);
      const id = link.attr('data-series-id');
      if (!/^[1-9]\d*$/.test(id ?? '')) return;
      const mangaUrl = new URL(`/series/${id}`, this.baseUrl).href;
      const title = text(link.find('img').attr('alt') ?? '').replace(/#\/?_h_i_g_h_L_i_g_h_t_#/g, '').trim();
      if (!title) return;
      const cover = link.find('img').attr('src');
      results.set(mangaUrl, { title, url: mangaUrl, cover: cover ? this.resolveUrl(cover, url) : null });
    });
    const hasNext = $('a[href^="/search"]').toArray().some(element => {
      const candidate = new URL(this.resolveUrl($(element).attr('href'), url));
      return candidate.pathname === '/search' && Number(candidate.searchParams.get('page')) === page + 2;
    });
    return { source: this.id, results: [...results.values()], nextPage: hasNext ? page + 1 : null };
  }

  async getChapters(mangaUrl) {
    const resource = this.resource(mangaUrl);
    const { manga } = await this.getManga(resource.url);
    let id = resource.id;
    if (!/^\d+$/.test(id)) {
      const { $ } = await this.fetchDocument(resource.url);
      id = $('script').text().match(/pandaWeb\.episode\(\{[\s\S]*?seriesId:\s*(\d+)/)?.[1];
      if (!id) throw new ScraperError('No se encontró el identificador de la serie.', { code: 'EXTRACTION_EMPTY' });
    }
    const chapters = new Map();
    const seenEntries = new Set();
    let page = 1;
    for (let count = 0; ; count++) {
      if (count >= this.maxPages) throw new ScraperError('Lista de episodios demasiado grande.', { code: 'PAGINATION_LIMIT' });
      const data = await this.fetchJson(`series/${id}/episodes?page=${page}`);
      if (data.code !== 200 || typeof data.data?.body !== 'string' || !data.data.pagination) {
        throw new ScraperError('Lista de episodios inválida.', { code: 'INVALID_RESPONSE' });
      }
      const $ = load(data.data.body);
      const entries = $('li[data-href]');
      let newEntries = 0;
      entries.each((_, element) => {
        const item = $(element);
        const href = item.attr('data-href');
        if (!seenEntries.has(href)) { seenEntries.add(href); newEntries++; }
        if (item.hasClass('js-have-to-sign') || item.find('.thumb__overlay--locked').length) return;
        const url = this.resource(this.resolveUrl(item.attr('data-href')), true).url;
        const label = text(item.find('.info__label').text());
        const title = text(item.find('.info__title').text()) || label || 'Episodio';
        const number = numberOrNull(label.match(/(?:Episode|Episodio)\s+(\d+(?:[.,]\d+)?)/i)?.[1]);
        chapters.set(url, { title, number, url });
      });
      if (!data.data.pagination.has_next) break;
      if (!newEntries) throw new ScraperError('La paginación no avanzó.', { code: 'INVALID_RESPONSE' });
      page++;
    }
    if (!chapters.size) throw new ScraperError('Esta serie no tiene episodios gratuitos accesibles sin sesión.', { code: 'EXTRACTION_EMPTY' });
    return { source: this.id, manga, chapters: [...chapters.values()] };
  }

  async getChapterImages(chapterUrl) {
    const { url } = this.resource(chapterUrl, true);
    const { $ } = await this.fetchDocument(url);
    const images = $('img.content__img[data-src]').map((_, element) => $(element).attr('data-src')).get()
      .map((image, index) => ({ index: index + 1, url: this.resolveUrl(image, url), referer: url }));
    if (!images.length) throw new ScraperError('El episodio requiere desbloqueo o no está disponible como cómic público.', { code: 'CHAPTER_UNAVAILABLE', url });
    const title = text($('meta[property="og:title"]').attr('content') ?? '').replace(/^Read\s+/i, '').replace(/\s*\| Tapas.*$/, '') || 'Episodio';
    return { source: this.id, chapter: { title, url }, images };
  }
}
