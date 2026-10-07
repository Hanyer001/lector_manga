import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import SitioEjemplo from '../src/extensions/sitioEjemplo.js';

const manga = await readFile(new URL('./fixtures/manga.html', import.meta.url));
const chapter = await readFile(new URL('./fixtures/chapter.html', import.meta.url));

async function fixture(t, handler, options = {}) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return new SitioEjemplo({ baseUrl: `http://127.0.0.1:${server.address().port}/`, retryDelayMs: 1, ...options });
}

const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };

test('extrae capítulos sin duplicados, conserva orden y decimales', async t => {
  const scraper = await fixture(t, (_, res) => html(res, manga));
  const result = await scraper.getChapters('/manga/ejemplo');
  assert.equal(result.manga.title, 'Mi manhwa de ejemplo');
  assert.deepEqual(result.chapters.map(c => c.number), [2, 1.5, 1]);
  assert.equal(result.chapters[2].url, `${scraper.baseUrl}capitulo/1`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('extrae imágenes lazy, URLs CDN y referer; conserva query', async t => {
  const scraper = await fixture(t, (_, res) => html(res, chapter));
  const result = await scraper.getChapterImages('/capitulo/1');
  assert.equal(result.images.length, 3);
  assert.equal(result.images[0].url, `${scraper.baseUrl}images/01.webp`);
  assert.equal(result.images[1].url, 'https://cdn.example.com/02.jpg?token=abc&page=2');
  assert.deepEqual(result.images.map(i => i.index), [1, 2, 3]);
  assert.ok(result.images.every(i => i.referer === `${scraper.baseUrl}capitulo/1`));
});

test('reintenta HTTP 503 y luego entrega resultado', async t => {
  let attempts = 0;
  const scraper = await fixture(t, (_, res) => {
    if (++attempts < 3) { res.writeHead(503); res.end(); } else html(res, manga);
  });
  assert.equal((await scraper.getChapters('/manga')).chapters.length, 3);
  assert.equal(attempts, 3);
});

test('no reintenta HTTP 403/404', async t => {
  for (const status of [403, 404]) {
    let attempts = 0;
    const scraper = await fixture(t, (_, res) => { attempts++; res.writeHead(status); res.end(); });
    await assert.rejects(scraper.getChapters('/missing'), e => e.code === 'HTTP_ERROR' && e.status === status);
    assert.equal(attempts, 1);
  }
});

test('timeout acotado también durante descarga del cuerpo', async t => {
  let attempts = 0;
  const scraper = await fixture(t, (_, res) => {
    attempts++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write('<html>');
  }, { timeoutMs: 100, maxRetries: 1 });
  await assert.rejects(scraper.getChapters('/slow'), e => e.code === 'TIMEOUT');
  assert.equal(attempts, 2);
});

test('aborta después del número máximo de reintentos', async t => {
  let attempts = 0;
  const scraper = await fixture(t, (_, res) => { attempts++; res.writeHead(500); res.end(); });
  await assert.rejects(scraper.getChapters('/fail'), e => e.status === 500);
  assert.equal(attempts, 3);
});

test('errores explícitos ante selectores vacíos, contenido inesperado y tamaño excesivo', async t => {
  const scraper = await fixture(t, (req, res) => {
    if (req.url === '/json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }
    else html(res, req.url === '/big' ? 'x'.repeat(100) : '<html></html>');
  }, { maxHtmlBytes: 50 });
  await assert.rejects(scraper.getChapters('/empty'), e => e.code === 'EXTRACTION_EMPTY');
  await assert.rejects(scraper.getChapterImages('/empty'), e => e.code === 'EXTRACTION_EMPTY');
  await assert.rejects(scraper.getChapters('/json'), e => e.code === 'INVALID_CONTENT_TYPE');
  await assert.rejects(scraper.getChapters('/big'), e => e.code === 'HTML_TOO_LARGE');
});

test('rechaza origen ajeno, protocolos inválidos y redirecciones externas', async t => {
  const scraper = await fixture(t, (_, res) => { res.writeHead(302, { Location: 'https://example.org/' }); res.end(); });
  assert.throws(() => scraper.resolveUrl('javascript:alert(1)'), e => e.code === 'INVALID_URL');
  await assert.rejects(scraper.getChapters('https://example.org/'), e => e.code === 'INVALID_ORIGIN');
  await assert.rejects(scraper.getChapters('/redirect'), e => e.code === 'INVALID_ORIGIN');
});

test('resuelve rutas relativas usando la URL final tras redirección', async t => {
  const scraper = await fixture(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/series/manga/' }); res.end(); }
    else html(res, '<ul class="chapter-list"><a class="chapter-link" href="chapter-1">Uno</a></ul>');
  });
  const result = await scraper.getChapters('/redirect');
  assert.equal(result.chapters[0].url, `${scraper.baseUrl}series/manga/chapter-1`);
});

test('no reintenta antes de un Retry-After superior al presupuesto', async t => {
  let attempts = 0;
  const scraper = await fixture(t, (_, res) => { attempts++; res.writeHead(429, { 'Retry-After': '60' }); res.end(); });
  await assert.rejects(scraper.getChapters('/limited'), e => e.status === 429);
  assert.equal(attempts, 1);
});
