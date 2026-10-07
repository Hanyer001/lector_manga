import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import SitioEjemplo from '../src/extensions/sitioEjemplo.js';

const manga = await readFile(new URL('../test/fixtures/manga.html', import.meta.url));
const chapter = await readFile(new URL('../test/fixtures/chapter.html', import.meta.url));
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.url === '/manga/ejemplo' ? manga : chapter);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const scraper = new SitioEjemplo({ baseUrl: `http://127.0.0.1:${server.address().port}/` });
  console.log(JSON.stringify({
    chapters: await scraper.getChapters('/manga/ejemplo'),
    pages: await scraper.getChapterImages('/capitulo/1')
  }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
