import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';

const text = value => value.replace(/\s+/g, ' ').trim();

export default class SitioEjemplo extends BaseScraper {
  constructor(options = {}) {
    super({ ...options, id: 'sitio-ejemplo', baseUrl: options.baseUrl ?? 'https://example.com/' });
  }

  async getChapters(mangaUrl) {
    const { $, url } = await this.fetchDocument(mangaUrl);
    const chapters = [];
    const seen = new Set();
    $('.chapter-list a.chapter-link').each((_, element) => {
      const link = $(element);
      const href = link.attr('href');
      if (!href?.trim()) return;
      const chapterUrl = this.pageUrl(href, url);
      if (seen.has(chapterUrl)) return;
      seen.add(chapterUrl);
      const title = text(link.text()) || text(link.attr('title') ?? '') || `Capítulo ${chapters.length + 1}`;
      const rawNumber = link.attr('data-number')?.trim();
      const parsedNumber = rawNumber ? Number(rawNumber.replace(',', '.')) : NaN;
      chapters.push({ title, number: Number.isFinite(parsedNumber) ? parsedNumber : null, url: chapterUrl });
    });
    if (!chapters.length) throw new ScraperError('No se encontraron capítulos; comprueba los selectores o el HTML recibido.', { code: 'EXTRACTION_EMPTY', url });
    return { source: this.id, manga: { title: text($('h1.manga-title').first().text()) || null, url }, chapters };
  }

  async getManga(mangaUrl) {
    const { $, url } = await this.fetchDocument(mangaUrl);
    const title = text($('h1.manga-title').first().text());
    if (!title) throw new ScraperError('No se encontró el título.', { code: 'EXTRACTION_EMPTY', url });
    const cover = $('.manga-cover img').first().attr('src');
    return { source: this.id, manga: { title, url, cover: cover ? this.resolveUrl(cover, url) : null,
      description: text($('.manga-description').first().text()) || null } };
  }

  async getChapterImages(chapterUrl) {
    const { $, url } = await this.fetchDocument(chapterUrl);
    const images = [];
    const seen = new Set();
    $('.reading-content img').each((_, element) => {
      const img = $(element);
      // El sitio de ejemplo usa data-src/data-lazy-src para lazy loading.
      const raw = ['data-src', 'data-lazy-src', 'src'].map(key => img.attr(key)?.trim())
        .find(value => value && !/^(data|blob):/i.test(value));
      if (!raw) return;
      const imageUrl = this.resolveUrl(raw, url);
      if (seen.has(imageUrl)) return;
      seen.add(imageUrl);
      images.push({ index: images.length + 1, url: imageUrl, referer: url });
    });
    if (!images.length) throw new ScraperError('No se encontraron imágenes; comprueba los selectores o si el sitio requiere JavaScript.', { code: 'EXTRACTION_EMPTY', url });
    return { source: this.id, chapter: { title: text($('h1.chapter-title').first().text()) || null, url }, images };
  }
}
