import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../src/backend/app.js';
import { openDatabase } from '../src/storage/database.js';
import { ProgressWriter, debounce, imageProxyUrl } from '../src/frontend/reader-core.js';

test('el visor y sus recursos se sirven junto a la API; POST progress persiste en SQLite', async t => {
  const database = openDatabase(':memory:');
  const server = createServer(createApp({ database }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, type] of [['/', 'text/html'], ['/reader.css', 'text/css'], ['/reader.js', 'javascript'], ['/reader-core.js', 'javascript']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(type));
  }
  const series = database.saveFavorite({ source: 'sitio-ejemplo', titulo: 'Test', url_origen: 'https://example.com/manga' });
  const [chapter] = database.saveChapters(series.id, [{ title: 'Uno', number: 1, url: 'https://example.com/chapter' }]);
  const response = await fetch(base + '/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serie_id: series.id, capitulo_id: chapter.id, scroll_position_y: 2468.5 }) });
  assert.equal(response.status, 200);
  assert.equal(database.getProgress(series.id).scroll_position_y, 2468.5);
});

test('URLs de imagen codifican origen y Referer y mantienen ticket', () => {
  const image = { url: '/api/image?ticket=signature', originalUrl: 'https://cdn.example.com/a.png?x=1&y=2', referer: 'https://example.com/chapter?a=b' };
  const url = new URL(imageProxyUrl(image, 'http://127.0.0.1:3210'), 'http://127.0.0.1:3210');
  assert.equal(url.searchParams.get('url'), image.originalUrl);
  assert.equal(url.searchParams.get('referer'), image.referer);
  assert.equal(url.searchParams.get('ticket'), 'signature');
  assert.throws(() => imageProxyUrl({ url: 'https://evil.invalid/api/image?ticket=a' }, 'http://127.0.0.1:3210'));
});

test('debounce agrupa una ráfaga de scrolls y admite cancelar', async () => {
  const values = [];
  const run = debounce(value => values.push(value), 20);
  run(1); run(2); run(3);
  assert.deepEqual(values, []);
  await sleep(40);
  assert.deepEqual(values, [3]);
  run(4); run.cancel();
  await sleep(40);
  assert.deepEqual(values, [3]);
});

test('progreso serializado conserva la última posición sin escrituras simultáneas', async () => {
  let release;
  const sent = [];
  const gate = new Promise(resolve => { release = resolve; });
  const writer = new ProgressWriter(async value => { sent.push(value); if (value === 1) await gate; });
  const done = writer.enqueue(1);
  writer.enqueue(2); writer.enqueue(3);
  assert.deepEqual(sent, [1]);
  release();
  await done;
  assert.deepEqual(sent, [1, 3]);
});
