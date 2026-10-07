import { createScraper } from './extensions/index.js';

const [source, action, url, baseUrl] = process.argv.slice(2);
try {
  if (!source || !['chapters', 'images', 'manga', 'search'].includes(action) || !url) {
    throw new Error('Uso: npm start -- FUENTE chapters|images|manga|search URL_O_CONSULTA [BASE_URL]');
  }
  const scraper = await createScraper(source, baseUrl ? { baseUrl, pageOrigins: [new URL(baseUrl).origin] } : {});
  const methods = { chapters: 'getChapters', images: 'getChapterImages', manga: 'getManga', search: 'search' };
  const result = await scraper.runOperation(() => scraper[methods[action]](url));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.toJSON?.() ?? { code: 'CLI_ERROR', message: error.message } }, null, 2)}\n`);
  process.exitCode = 1;
}
