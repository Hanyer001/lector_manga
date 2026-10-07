import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { openDatabase } from '../src/storage/database.js';
import { createApp } from '../src/backend/app.js';
import { createImageTickets } from '../src/backend/imageTickets.js';
import SitioEjemplo from '../src/extensions/sitioEjemplo.js';

const logger = { warn() {}, error() {} };
async function serve(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function setup(t, handler, proxyOptions = {}) {
  const origin = await serve(t, handler);
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  const tickets = createImageTickets();
  const sources = new Map([['sitio-ejemplo', { pageOrigin: origin, imageOrigins: [origin],
    userAgent: 'ReaderTest/1.0', scraper: new SitioEjemplo({ baseUrl: origin }) }]]);
  const api = await serve(t, createApp({ database, sources, tickets, proxyOptions, logger }));
  const imageUrl = path => `${api}/api/image?ticket=${tickets.issue({ source: 'sitio-ejemplo', url: origin + path, referer: origin + '/chapter' })}`;
  return { api, origin, database, imageUrl, tickets };
}

test('SQLite: favoritos idempotentes, capítulos decimales y progreso persistente', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reader-test-'));
  const filename = join(directory, 'reader.db');
  let db;
  try {
    db = openDatabase(filename);
    const favorite = { source: 'test', titulo: 'Título', url_origen: 'https://example.com/series' };
    const series = db.saveFavorite(favorite);
    assert.equal(db.saveFavorite({ ...favorite, titulo: 'Actualizado' }).id, series.id);
    const input = { title: 'Extra', number: 1.5, url: 'https://example.com/chapter' };
    const [chapter] = db.saveChapters(series.id, [input]);
    assert.equal(db.markChapterRead(chapter.id).estado_lectura, 1);
    assert.equal(db.saveChapters(series.id, [input])[0].estado_lectura, 1);
    db.updateProgress({ serie_id: series.id, capitulo_id: chapter.id, scroll_position_y: 12.5 });
    db.updateProgress({ serie_id: series.id, capitulo_id: chapter.id, scroll_position_y: 100 });
    assert.equal(db.getProgress(series.id).scroll_position_y, 100);
    assert.throws(() => db.updateProgress({ serie_id: series.id, capitulo_id: chapter.id, scroll_position_y: -1 }), { code: 'INVALID_SCROLL' });
    const other = db.saveFavorite({ ...favorite, url_origen: 'https://example.com/other' });
    assert.throws(() => db.updateProgress({ serie_id: other.id, capitulo_id: chapter.id, scroll_position_y: 0 }), { code: 'CHAPTER_MISMATCH' });
    assert.throws(() => db.saveChapters(series.id, [
      { ...input, url: 'https://example.com/new' }, { ...input, number: NaN }
    ]));
    assert.equal(db.listChapters(series.id).length, 1, 'rollback del lote completo');
    db.close();
    db = openDatabase(filename);
    assert.equal(db.getProgress(series.id).scroll_position_y, 100);
    assert.equal(db.getChapter(chapter.id).numero, 1.5);
  } finally {
    db?.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Ruta temporal inesperada');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('API: scraper → SQLite → tickets → imagen y progreso', async t => {
  const { api, origin } = await setup(t, (req, res) => {
    if (req.url === '/series') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div class="chapter-list"><a class="chapter-link" data-number="1" href="/chapter">Uno</a></div>');
    } else if (req.url === '/chapter') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div class="reading-content"><img src="/page.png"></div>');
    } else { res.setHeader('Content-Type', 'image/png'); res.end('image-data'); }
  });
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const saved = await fetch(`${api}/api/series`, json('POST', { source: 'sitio-ejemplo', titulo: 'Serie', url_origen: origin + '/series' }));
  assert.equal(saved.status, 200);
  const series = await saved.json();
  const synced = await fetch(`${api}/api/series/${series.id}/sync`, { method: 'POST' });
  assert.equal(synced.status, 200);
  const [chapter] = await synced.json();
  const images = await (await fetch(`${api}/api/chapters/${chapter.id}/images`)).json();
  assert.equal(images.images.length, 1);
  assert.equal(await (await fetch(api + images.images[0].url)).text(), 'image-data');
  const progress = await fetch(`${api}/api/series/${series.id}/progress`, json('PUT', { capitulo_id: chapter.id, scroll_position_y: 450 }));
  assert.equal(progress.status, 200);
  assert.equal((await (await fetch(`${api}/api/series/${series.id}/progress`)).json()).scroll_position_y, 450);
  const read = await fetch(`${api}/api/chapters/${chapter.id}/read`, json('PUT', { read: true }));
  assert.equal((await read.json()).estado_lectura, 1);
  assert.equal((await fetch(`${api}/api/chapters/99999/read`, json('PUT', { read: true }))).status, 404);
});

test('proxy transmite el primer chunk antes de finalizar el origen e inyecta cabeceras', async t => {
  let finish;
  let incomingHeaders;
  const { imageUrl, origin } = await setup(t, (req, res) => {
    incomingHeaders = req.headers;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.write('first');
    finish = () => res.end('last');
  });
  const response = await fetch(imageUrl('/image'));
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(Buffer.from(first.value).toString(), 'first');
  assert.equal(incomingHeaders.referer, origin + '/chapter');
  assert.equal(incomingHeaders['user-agent'], 'ReaderTest/1.0');
  finish();
  let rest = '';
  for (;;) { const part = await reader.read(); if (part.done) break; rest += Buffer.from(part.value).toString(); }
  assert.equal(rest, 'last');
});

test('proxy: timeout de cabeceras devuelve 504 JSON', async t => {
  const { imageUrl } = await setup(t, () => {}, { headerTimeoutMs: 50 });
  const response = await fetch(imageUrl('/slow'));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'IMAGE_HEADER_TIMEOUT');
});

test('proxy: inactividad tras iniciar imagen corta el stream', async t => {
  const { imageUrl } = await setup(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.write('first');
  }, { idleTimeoutMs: 80 });
  const response = await fetch(imageUrl('/stalled'));
  assert.equal(response.status, 200);
  await assert.rejects(response.arrayBuffer());
});

test('proxy: plazo total se aplica aunque lleguen chunks continuamente', async t => {
  const { imageUrl } = await setup(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.write('first');
    const timer = setInterval(() => res.write('more'), 10);
    res.on('close', () => clearInterval(timer));
  }, { totalTimeoutMs: 100, idleTimeoutMs: 500 });
  const response = await fetch(imageUrl('/endless'));
  await assert.rejects(response.arrayBuffer());
});

test('proxy cancela upstream cuando el lector desconecta', async t => {
  let closed;
  const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const { imageUrl } = await setup(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.write('first');
    res.on('close', closed);
  });
  const controller = new AbortController();
  const response = await fetch(imageUrl('/image'), { signal: controller.signal });
  await response.body.getReader().read();
  controller.abort();
  await Promise.race([upstreamClosed, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('upstream no cancelado')), 1000); timer.unref();
  })]);
});

test('proxy rechaza HTML, excesos de tamaño, tickets alterados y redirecciones ajenas', async t => {
  const { api, imageUrl } = await setup(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://untrusted.invalid/image' }); res.end(); }
    else if (req.url === '/html') { res.setHeader('Content-Type', 'text/html'); res.end('blocked'); }
    else { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '100' }); res.end('x'.repeat(100)); }
  }, { maxBytes: 10 });
  for (const [path, status, code] of [['/redirect', 403, 'ORIGIN_NOT_ALLOWED'], ['/html', 502, 'IMAGE_CONTENT_TYPE'], ['/large', 502, 'IMAGE_TOO_LARGE']]) {
    const response = await fetch(imageUrl(path));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  assert.equal((await fetch(`${api}/api/image?ticket=invalid`)).status, 403);
  const mismatched = new URL(imageUrl('/html'));
  mismatched.searchParams.set('url', 'https://untrusted.invalid/other');
  const rejected = await fetch(mismatched);
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, 'IMAGE_TICKET_MISMATCH');
  assert.equal((await fetch(`${api}/api/series`, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
});

test('proxy valida redirección permitida y mantiene los bytes y Content-Length', async t => {
  const { imageUrl } = await setup(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/real' }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': '4' }); res.end(Buffer.from([0, 1, 2, 255])); }
  });
  const response = await fetch(imageUrl('/redirect'));
  assert.equal(response.headers.get('content-length'), '4');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 1, 2, 255]));
});

test('proxy limita imágenes sin Content-Length durante el stream', async t => {
  let finish;
  const { imageUrl } = await setup(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.write('first');
    finish = () => res.end('x'.repeat(20));
  }, { maxBytes: 10 });
  const response = await fetch(imageUrl('/large'));
  const reader = response.body.getReader();
  await reader.read();
  finish();
  await assert.rejects(async () => { while (!(await reader.read()).done) {} });
});

test('proxy limita concurrencia y libera cupos al desconectar', async t => {
  let closed;
  const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const { imageUrl } = await setup(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.write('first');
    res.on('close', closed);
  }, { maxConcurrent: 1 });
  const controller = new AbortController();
  const first = await fetch(imageUrl('/one'), { signal: controller.signal });
  await first.body.getReader().read();
  assert.equal((await fetch(imageUrl('/two'))).status, 503);
  controller.abort();
  await upstreamClosed;
  const secondController = new AbortController();
  const second = await fetch(imageUrl('/three'), { signal: secondController.signal });
  assert.equal(second.status, 200);
  secondController.abort();
});
