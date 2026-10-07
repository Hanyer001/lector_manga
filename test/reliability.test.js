import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once, EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { BaseScraper } from '../src/core/BaseScraper.js';
import { createGate, runOperation, operationContext } from '../src/core/operation.js';
import { BrowserTransport } from '../src/transports/BrowserTransport.js';
import { createApp } from '../src/backend/app.js';
import { openDatabase } from '../src/storage/database.js';
import { filterSeries } from '../src/frontend/reader-core.js';

async function serve(t, handler) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const html = '<h1>OK</h1>';
const response = () => new Response(html, { headers: { 'Content-Type': 'text/html' } });

test('presupuesto total compartido por páginas: no se reinicia en cada descarga', async () => {
  let calls = 0;
  const scraper = new BaseScraper({ id: 'test', baseUrl: 'https://example.com', timeoutMs: 1000,
    operationTimeoutMs: 120, fetchImpl: async (_url, { signal }) => { calls++; await sleep(70, undefined, { signal }); return response(); } });
  const started = Date.now();
  await assert.rejects(scraper.runOperation(async () => { await scraper.fetchDocument('/1'); await scraper.fetchDocument('/2'); }), { code: 'TIMEOUT' });
  assert.equal(calls, 2); assert.ok(Date.now() - started < 500);
});

test('cancelar interrumpe Retry-After y no inicia otro intento', async () => {
  let calls = 0;
  const controller = new AbortController();
  const scraper = new BaseScraper({ id: 'test', baseUrl: 'https://example.com', fetchImpl: async () => {
    calls++; setTimeout(() => controller.abort(), 15);
    return new Response('', { status: 429, headers: { 'Retry-After': '20' } });
  } });
  await assert.rejects(scraper.runOperation(() => scraper.fetchDocument('/'), { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(calls, 1);
});

test('colas por fuente: límite, cancelación en espera y liberación de turnos', async () => {
  const enter = createGate(1); const release = await enter();
  const controller = new AbortController(); const waiting = enter(controller.signal);
  controller.abort(); await assert.rejects(waiting, { code: 'CANCELLED' });
  let entered = false;
  const next = enter().then(done => { entered = true; done(); });
  await sleep(10); assert.equal(entered, false); release(); await next; assert.equal(entered, true);
});

test('contextos concurrentes no comparten señales de cancelación', async () => {
  const a = new AbortController();
  const first = runOperation(async () => { await sleep(40, undefined, { signal: operationContext().signal }); }, { signal: a.signal });
  const second = runOperation(async () => { await sleep(50, undefined, { signal: operationContext().signal }); return 'ok'; });
  a.abort(); await assert.rejects(first, { code: 'CANCELLED' }); assert.equal(await second, 'ok');
});

test('API: portadas firmadas, lectura sin caché ni imágenes persistidas y eliminación en cascada', async t => {
  let downloads = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=', 'base64');
  const origin = await serve(t, (_req, res) => { downloads++; res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); });
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const item = db.saveFavorite({ source: 'test', titulo: 'Prueba', url_origen: origin + '/series', portada: origin + '/cover' });
  const [chapter] = db.saveChapters(item.id, [{ title: 'Uno', number: 1, url: origin + '/chapter' }]);
  db.updateProgress({ serie_id: item.id, capitulo_id: chapter.id, scroll_position_y: 15 });
  const sources = new Map([['test', { id: 'test', pageOrigin: origin, imageOrigins: [origin], userAgent: 'test', scraper: {} }]]);
  const api = await serve(t, createApp({ database: db, sources }));
  const listResponse = await fetch(api + '/api/series'); assert.equal(listResponse.headers.get('cache-control'), 'no-store');
  const [row] = await listResponse.json(); assert.equal(row.total_capitulos, 1); assert.equal(row.pendientes, 1); assert.equal(row.ultimo_capitulo_id, chapter.id);
  assert.ok(row.coverUrl.startsWith('/api/image?ticket='));
  const before = db.storageInfo();
  for (let i = 0; i < 2; i++) {
    const image = await fetch(api + row.coverUrl); assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store'); await image.arrayBuffer();
  }
  assert.equal(downloads, 2); assert.deepEqual(db.storageInfo(), before); assert.equal(before.persistentImages, false);
  assert.equal((await fetch(api + '/api/storage').then(r => r.json())).mode, 'stream');
  assert.equal((await fetch(api + '/api/series/' + item.id, { method: 'DELETE' })).status, 200);
  assert.equal(db.listSeries().length, 0); assert.equal(db.storageInfo().chapters, 0);
  assert.throws(() => db.getChapter(chapter.id), { code: 'CHAPTER_NOT_FOUND' });
  assert.equal((await fetch(api + '/api/series/' + item.id, { method: 'DELETE' })).status, 404);
});

test('API: plazo total y diagnósticos acotados sin URLs ni consultas', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const scraper = new BaseScraper({ id: 'test', baseUrl: 'https://example.com', fetchImpl: async (_url, { signal }) => {
    await sleep(500, undefined, { signal }); return response();
  } });
  scraper.search = () => scraper.fetchDocument('/secret?token=private');
  const sources = new Map([['test', { id: 'test', pageOrigin: 'https://example.com', capabilities: { search: true }, scraper }]]);
  const api = await serve(t, createApp({ database: db, sources, operationTimeoutMs: 50, logger: {} }));
  assert.equal((await fetch(api + '/api/sources/test/search?q=private')).status, 504);
  const diagnostics = await fetch(api + '/api/diagnostics').then(r => r.json());
  assert.equal(diagnostics.sources.length, 1); assert.equal(diagnostics.sources[0].code, 'TIMEOUT');
  assert.ok(!JSON.stringify(diagnostics).includes('private'));
});

test('reabrir capítulo extrae URLs nuevas y no añade contenido a SQLite', async t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const item = db.saveFavorite({ source: 'test', titulo: 'Serie', url_origen: 'https://example.com/series' });
  const [chapter] = db.saveChapters(item.id, [{ title: 'Uno', number: 1, url: 'https://example.com/chapter' }]);
  let calls = 0;
  const source = { id: 'test', pageOrigin: 'https://example.com', imageOrigins: ['https://cdn.example.com'],
    scraper: { getChapterImages: async url => ({ source: 'test', chapter: { title: 'Uno', url },
      images: [{ index: 1, url: 'https://cdn.example.com/page?token=' + ++calls, referer: url }] }) } };
  const api = await serve(t, createApp({ database: db, sources: new Map([['test', source]]) }));
  const before = db.storageInfo();
  const a = await fetch(api + '/api/chapters/' + chapter.id + '/images').then(r => r.json());
  const b = await fetch(api + '/api/chapters/' + chapter.id + '/images').then(r => r.json());
  assert.equal(calls, 2); assert.notEqual(a.images[0].originalUrl, b.images[0].originalUrl);
  assert.deepEqual(db.storageInfo(), before);
});

test('API: desconectar aborta la descarga del scraper', async t => {
  const upstreamClosed = Promise.withResolvers(); const started = Promise.withResolvers();
  const origin = await serve(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('<h1>');
    res.once('close', () => upstreamClosed.resolve()); started.resolve(); });
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const scraper = new BaseScraper({ id: 'test', baseUrl: origin }); scraper.search = () => scraper.fetchDocument('/slow');
  const api = await serve(t, createApp({ database: db, sources: new Map([['test', { id: 'test', pageOrigin: origin, capabilities: { search: true }, scraper }]]), logger: {} }));
  const controller = new AbortController(); const request = fetch(api + '/api/sources/test/search?q=test', { signal: controller.signal });
  await started.promise; controller.abort(); await assert.rejects(request);
  await Promise.race([upstreamClosed.promise, sleep(1000).then(() => { throw new Error('Upstream no se canceló'); })]);
});

function mockBrowser() {
  const page = new EventEmitter(); let closed = 0; let cacheEnabled;
  Object.assign(page, { setCacheEnabled: async value => { cacheEnabled = value; }, setUserAgent: async () => {}, setRequestInterception: async () => {},
    mainFrame: () => page, goto: async () => ({ ok: () => true, headers: () => ({ 'content-type': 'text/html' }) }), url: () => 'https://example.com/final', content: async () => html });
  const browser = { newPage: async () => page, close: async () => { closed++; } };
  return { page, browser, closed: () => closed, cacheEnabled: () => cacheEnabled };
}

test('transporte navegador: documento renderizado, sin caché y cierre incluso ante errores', async () => {
  const scraper = new BaseScraper({ id: 'test', baseUrl: 'https://example.com' });
  for (const fail of [false, true]) {
    const mock = mockBrowser();
    if (fail) mock.page.content = async () => { throw new Error('DOM roto'); };
    const transport = new BrowserTransport(scraper, { launch: async () => mock.browser });
    if (fail) await assert.rejects(transport.fetchContent('/'), { code: 'BROWSER_ERROR' });
    else assert.equal((await transport.fetchContent('/')).url, 'https://example.com/final');
    assert.equal(mock.closed(), 1); assert.equal(mock.cacheEnabled(), false);
  }
});

test('transporte navegador: cancelación cierra sesión y rechaza redirecciones externas', async () => {
  const scraper = new BaseScraper({ id: 'test', baseUrl: 'https://example.com' });
  const mock = mockBrowser(); let rejected;
  mock.page.goto = async () => new Promise((_resolve, reject) => { rejected = reject; });
  mock.browser.close = async () => { rejected(new Error('closed')); };
  const controller = new AbortController();
  const task = new BrowserTransport(scraper, { launch: async () => mock.browser }).fetchContent('/', { signal: controller.signal });
  await sleep(10); controller.abort(); await assert.rejects(task, { code: 'CANCELLED' });
  const redirect = mockBrowser(); let blocked = false;
  redirect.page.goto = async () => { redirect.page.emit('request', { url: () => 'https://external.example/', isNavigationRequest: () => true,
    frame: () => redirect.page, resourceType: () => 'document', abort: async () => { blocked = true; } }); throw new Error('blocked'); };
  await assert.rejects(new BrowserTransport(scraper, { launch: async () => redirect.browser }).fetchContent('/'), { code: 'INVALID_ORIGIN' });
  assert.equal(blocked, true); assert.equal(redirect.closed(), 1);
});

test('biblioteca: filtro sin acentos, fuente, pendientes y orden reciente', () => {
  const items = [{ id: 1, titulo: 'Ángel', source: 'a', pendientes: 0, ultima_lectura: 30 },
    { id: 2, titulo: 'Bosque', source: 'b', pendientes: 2, ultima_lectura: 50 },
    { id: 3, titulo: 'Ángel nuevo', source: 'a', pendientes: 1 }];
  assert.deepEqual(filterSeries(items).map(i => i.id), [2, 1, 3]);
  assert.deepEqual(filterSeries(items, { query: 'angel', unreadOnly: true }).map(i => i.id), [3]);
  assert.deepEqual(filterSeries(items, { source: 'a', sort: 'title' }).map(i => i.id), [1, 3]);
  assert.equal(items[0].id, 1);
});

test('documento renderizado conserva Unicode aunque el HTML declare otra codificación', async () => {
  const scraper = new BaseScraper({ id: 'test', baseUrl: 'https://example.com', documentTransport: {
    fetchContent: async () => ({ buffer: Buffer.from('<meta charset="windows-1252"><h1>Capítulo del héroe</h1>'), url: 'https://example.com', encoding: 'utf8' })
  } });
  assert.equal((await scraper.fetchDocument('/')).$('h1').text(), 'Capítulo del héroe');
  const denied = new BrowserTransport(scraper, { launch: async () => { const error = new Error('spawn blocked'); error.code = 'EPERM'; throw error; } });
  await assert.rejects(denied.fetchContent('/'), { code: 'BROWSER_UNAVAILABLE' });
});
