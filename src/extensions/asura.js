import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch, numberOrNull } from './utils.js';

const text = value => value.replace(/\s+/g, ' ').trim();

export default class Asura extends BaseScraper {
  constructor(options = {}) {
    const config = definitionFor('asura');
    super({ ...config, ...options, id: config.id });
  }

  resource(value, chapter = false) {
    const url = new URL(this.pageUrl(value));
    const pattern = chapter ? /^\/comics\/[^/]+\/chapter\/\d+(?:\.\d+)?\/?$/ : /^\/comics\/[^/]+\/?$/;
    if (!pattern.test(url.pathname)) throw new ScraperError('Enlace de Asura no reconocido.', { code: 'INVALID_URL', url: url.href });
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.href;
  }

  manga($, url) {
    const title = text($('h1').first().text());
    if (!title) throw new ScraperError('Ficha no encontrada.', { code: 'EXTRACTION_EMPTY', url });
    const cover = $('meta[property="og:image"]').attr('content');
    return { title, url, cover: cover ? this.resolveUrl(cover, url) : null,
      description: $('meta[name="description"]').attr('content') || null, language: 'en' };
  }

  async getManga(mangaUrl) {
    const url = this.resource(mangaUrl);
    const { $ } = await this.fetchDocument(url);
    return { source: this.id, manga: this.manga($, url) };
  }

  async search(query, { page = 0 } = {}) {
    validateSearch(query, page);
    const params = new URLSearchParams({ search: query.trim(), page: page + 1 });
    const { $, url } = await this.fetchDocument(new URL(`/browse/comics?${params}`, this.baseUrl).href);
    const results = new Map();
    $('a[href^="/comics/"]').each((_, element) => {
      const link = $(element);
      let mangaUrl;
      try { mangaUrl = this.resource(this.resolveUrl(link.attr('href'), url)); } catch { return; }
      const title = text(link.find('h3').first().text());
      if (!title) return;
      const card = link.parent();
      const cover = card.find('img').first().attr('src');
      results.set(mangaUrl, { title, url: mangaUrl, cover: cover ? this.resolveUrl(cover, url) : null, language: 'en' });
    });
    const hasNext = $('a[href^="/browse/comics"]').toArray().some(element => {
      const candidate = new URL(this.resolveUrl($(element).attr('href'), url));
      return candidate.pathname === '/browse/comics' && Number(candidate.searchParams.get('page')) === page + 2;
    });
    return { source: this.id, results: [...results.values()], nextPage: hasNext ? page + 1 : null };
  }

  async getChapters(mangaUrl) {
    const url = this.resource(mangaUrl);
    const { $ } = await this.fetchDocument(url);
    const chapters = new Map();
    $('a[href*="/chapter/"]').each((_, element) => {
      const link = $(element);
      const chapterUrl = this.resource(this.resolveUrl(link.attr('href'), url), true);
      if (!new URL(chapterUrl).pathname.startsWith(`${new URL(url).pathname}/chapter/`)) return;
      if (link.find('[data-locked],.chapter-locked').length || /unlock|premium|coins/i.test(link.text())) return;
      const number = numberOrNull(new URL(chapterUrl).pathname.split('/').at(-1));
      chapters.set(chapterUrl, { title: `Chapter ${number}`, number, url: chapterUrl });
    });
    if (!chapters.size) throw new ScraperError('No hay capítulos públicos.', { code: 'EXTRACTION_EMPTY', url });
    return { source: this.id, manga: this.manga($, url), chapters: [...chapters.values()] };
  }

  async getChapterImages(chapterUrl) {
    const url = this.resource(chapterUrl, true);
    const { $ } = await this.fetchDocument(url);
    const images = $('img').map((_, element) => $(element).attr('src')).get()
      .filter(image => image && new URL(this.resolveUrl(image, url)).pathname.startsWith('/asura-images/chapters/'))
      .map((image, index) => ({ index: index + 1, url: this.resolveUrl(image, url), referer: url }));
    if (!images.length) throw new ScraperError('Este capítulo no está disponible públicamente.', { code: 'CHAPTER_UNAVAILABLE', url });
    return { source: this.id, chapter: { title: `Chapter ${new URL(url).pathname.split('/').at(-1)}`, url }, images };
  }
}
