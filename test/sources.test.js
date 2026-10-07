import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createScraper, createSources, sourceDefinitions } from '../src/extensions/index.js';
import { sources, detectSource, allowedImageUrl } from '../src/backend/sources.js';
import { createApp } from '../src/backend/app.js';
import { openDatabase } from '../src/storage/database.js';

function jsonFixture(handler) {
  const calls = [];
  return { calls, fetchImpl: async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    const data = await handler(url);
    assert.notEqual(data, undefined, `Petición inesperada: ${url}`);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } };
}

const htmlFixture = handler => async input => {
  const body = await handler(new URL(input));
  assert.notEqual(body, undefined, `Petición inesperada: ${input}`);
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};

test('catálogo único: carga todas las fuentes activas y detecta dominios exactos', async () => {
  for (const definition of sourceDefinitions.filter(source => source.enabled !== false)) {
    const scraper = await createScraper(definition.id);
    assert.equal(scraper.id, definition.id);
    assert.equal(detectSource(sources, definition.baseUrl).id, definition.id);
  }
  assert.equal(detectSource(sources, 'https://www.manhwaweb.com/manhwa/demo').id, 'manhwaweb');
  assert.throws(() => detectSource(sources, 'https://manhwaweb.com.evil.invalid/'), { code: 'UNKNOWN_SOURCE' });
  assert.throws(() => detectSource(sources, 'javascript:alert(1)'), { code: 'INVALID_URL' });
  await assert.rejects(createScraper('bato'), { code: 'SOURCE_UNAVAILABLE' });
});

test('una extensión rota no impide usar otra ni iniciar health y catálogo', async t => {
  let brokenLoads = 0;
  const definitions = [
    { id: 'bad', name: 'Rota', baseUrl: 'https://bad.invalid/', load: async () => { brokenLoads++; throw new SyntaxError('broken'); } },
    { id: 'good', name: 'Sana', baseUrl: 'https://good.invalid/', capabilities: { chapters: true },
      load: async () => ({ default: class { async getChapters() { return { chapters: [1] }; } } }) }
  ];
  const localSources = createSources(definitions);
  const database = openDatabase(':memory:');
  const server = createServer(createApp({ database, sources: localSources }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/health')).status, 200);
  const list = await (await fetch(origin + '/api/sources')).json();
  assert.equal(list.length, 2);
  assert.equal(brokenLoads, 0);
  await assert.rejects(localSources.get('bad').scraper.getChapters(), { code: 'SOURCE_LOAD_ERROR' });
  assert.deepEqual(await localSources.get('good').scraper.getChapters(), { chapters: [1] });
  assert.equal((await fetch(origin + '/api/health')).status, 200);
});

test('nodos de imágenes: permite dominios declarados y rechaza hosts parecidos y puertos', () => {
  const source = sources.get('mangadex');
  assert.equal(allowedImageUrl('https://node.mangadex.network/data/a/1.png', source), 'https://node.mangadex.network/data/a/1.png');
  for (const url of ['http://node.mangadex.network/a', 'https://node.mangadex.network:1234/a',
    'https://mangadex.network.evil.invalid/a', 'https://evil-mangadex.network/a', 'https://127.0.0.1/a']) {
    assert.throws(() => allowedImageUrl(url, source), { code: 'ORIGIN_NOT_ALLOWED' });
  }
});

test('ManhwaWeb: búsqueda paginada, ficha, versiones, decimales, extras e imágenes', async () => {
  const data = { _id: 'demo_123', name_esp: 'Obra', _imagen: 'https://img1mw.xyz/cover.jpg', _sinopsis: 'Sinopsis',
    chapters: [
      { chapter: '2', versions: [{ link: 'https://manhwaweb.com/leer/demo_123-2', joint: [{ name: 'Grupo' }] },
        { link: 'https://www.manhwaweb.com/leer/demo_123-2' }, { link: 'https://external.invalid/chapter/2' }] },
      { chapter: '1,5', link: 'https://manhwaweb.com/leer/demo_123-1.5' },
      { chapter: null, link: 'https://manhwaweb.com/leer/demo_123-extra' }
    ] };
  const fixture = jsonFixture(url => url.pathname === '/manhwa/library' ? { data: [data], next: true } :
    url.pathname.startsWith('/manhwa/see/') ? data :
    url.pathname.startsWith('/chapters/see/') ? { name: 'Obra', chapter: { chapter: 2,
      img: ['https://img2mw.xyz/1.webp?token=a&x=2', 'https://img2mw.xyz/1.webp?token=a&x=2', 'https://img2mw.xyz/2.webp'] } } : undefined);
  const scraper = await createScraper('manhwaweb', fixture);
  const search = await scraper.search('obra & otra', { page: 2 });
  assert.equal(search.nextPage, 3);
  assert.equal(fixture.calls[0].searchParams.get('buscar'), 'obra & otra');
  assert.equal((await scraper.getManga('https://www.manhwaweb.com/manga/demo_123')).manga.title, 'Obra');
  const result = await scraper.getChapters('https://manhwaweb.com/manhwa/demo_123');
  assert.deepEqual(result.chapters.map(chapter => chapter.number), [2, 1.5, null]);
  assert.match(result.chapters[0].title, /Grupo/);
  const images = await scraper.getChapterImages(result.chapters[0].url);
  assert.deepEqual(images.images.map(image => image.index), [1, 2]);
  assert.match(images.images[0].url, /token=a&x=2/);
  await assert.rejects(scraper.getChapters('https://untrusted.invalid/manhwa/demo'), { code: 'INVALID_ORIGIN' });
  await assert.rejects(scraper.getManga('https://manhwaweb.com/'), { code: 'INVALID_URL' });
});

test('APIs JSON: rechaza JSON inválido, HTML de bloqueo y redirecciones externas', async () => {
  for (const [response, code] of [
    [new Response('{', { headers: { 'Content-Type': 'application/json' } }), 'INVALID_JSON'],
    [new Response('<html>blocked</html>', { headers: { 'Content-Type': 'text/html' } }), 'INVALID_CONTENT_TYPE'],
    [new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/api' } }), 'INVALID_ORIGIN']
  ]) {
    const scraper = await createScraper('manhwaweb', { fetchImpl: async () => response, maxRetries: 0 });
    await assert.rejects(scraper.search('obra'), { code });
  }
});

const mangaId = '11111111-1111-4111-8111-111111111111';
const chapterIds = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const dexManga = { id: mangaId, attributes: { title: { en: 'Work', es: 'Obra' }, description: { es: 'Sinopsis' } },
  relationships: [{ type: 'cover_art', attributes: { fileName: 'cover.jpg' } }] };

test('MangaDex: paginación completa, idioma español y filtrado de capítulos externos', async () => {
  const chapter = (id, number, attributes = {}) => ({ id, attributes: { chapter: number,
    translatedLanguage: 'es', pages: 2, ...attributes } });
  const fixture = jsonFixture(url => {
    if (url.pathname === `/manga/${mangaId}`) return { result: 'ok', data: dexManga };
    if (url.pathname === '/manga') return { result: 'ok', data: [dexManga], offset: 0, total: 1 };
    if (url.pathname.endsWith('/feed')) {
      assert.deepEqual(url.searchParams.getAll('translatedLanguage[]'), ['es', 'es-la']);
      const first = url.searchParams.get('offset') === '0';
      return { result: 'ok', total: 5, data: first ? [chapter(chapterIds[0], '1.5'),
        chapter('external', '2', { externalUrl: 'https://elsewhere.invalid' }),
        chapter('english', '3', { translatedLanguage: 'en' }), chapter('locked', '4', { isUnavailable: true })] :
        [chapter(chapterIds[1], null)] };
    }
  });
  const scraper = await createScraper('mangadex', fixture);
  assert.equal((await scraper.search('obra')).results[0].title, 'Obra');
  const result = await scraper.getChapters(`https://mangadex.org/title/${mangaId}/slug`);
  assert.deepEqual(result.chapters.map(chapter => chapter.number), [1.5, null]);
  assert.equal(fixture.calls.filter(url => url.pathname.endsWith('/feed')).length, 2);
  await assert.rejects(scraper.getChapters('https://mangadex.org/title/not-a-uuid'), { code: 'INVALID_URL' });
});

test('MangaDex: orden de imágenes, nodo permitido y detección de paginación estancada', async () => {
  let node = 'https://node.mangadex.network';
  const fixture = jsonFixture(url => url.pathname.startsWith('/chapter/') ? { result: 'ok', data: {
    attributes: { chapter: '2', title: 'Título', pages: 2 } } } : url.pathname.startsWith('/at-home/') ?
    { result: 'ok', baseUrl: node, chapter: { hash: 'abc123', data: ['1.png', '2.png'] } } :
    url.pathname.endsWith('/feed') ? { result: 'ok', data: [], total: 1 } : { result: 'ok', data: dexManga });
  const scraper = await createScraper('mangadex', fixture);
  const result = await scraper.getChapterImages(`https://mangadex.org/chapter/${chapterIds[0]}`);
  assert.deepEqual(result.images.map(image => image.url), ['https://node.mangadex.network/data/abc123/1.png', 'https://node.mangadex.network/data/abc123/2.png']);
  node = 'https://mangadex.network.evil.invalid';
  await assert.rejects(scraper.getChapterImages(`https://mangadex.org/chapter/${chapterIds[0]}`), { code: 'INVALID_ORIGIN' });
  await assert.rejects(scraper.getChapters(`https://mangadex.org/title/${mangaId}`), { code: 'INVALID_RESPONSE' });
});

test('WEBTOON: recorre páginas de episodios y extrae solo imágenes del lector', async () => {
  const root = 'https://www.webtoons.com/es/romance/demo/';
  const scraper = await createScraper('webtoon', { fetchImpl: htmlFixture(url => {
    if (url.pathname.endsWith('/viewer')) return '<h1 class="subj">Ep. 1</h1><img data-url="https://evil.invalid/ad"><div id="_imageList"><img data-url="https://webtoon-phinf.pstatic.net/page.png?type=opti"></div>';
    if (url.pathname === '/es/search') return `<a href="${root}list?title_no=10"><strong class="title">Obra</strong></a>`;
    const page = Number(url.searchParams.get('page') ?? 1);
    return `<h1 class="subj">Obra</h1><meta property="og:image" content="https://swebtoon-phinf.pstatic.net/cover.jpg"><p class="summary">Sinopsis</p>
      <li data-episode-no="${page}"><a href="${root}ep/viewer?title_no=10&episode_no=${page}"><span class="subj"><span>Ep. ${page}</span></span></a></li>
      ${page === 1 ? '<div class="paginate"><a href="?title_no=10&page=2">2</a></div>' : ''}`;
  }) });
  assert.equal((await scraper.search('obra')).results[0].title, 'Obra');
  const result = await scraper.getChapters(root + 'list?title_no=10');
  assert.deepEqual(result.chapters.map(chapter => chapter.number), [1, 2]);
  assert.equal((await scraper.getChapterImages(result.chapters[0].url)).images.length, 1);
  await assert.rejects(scraper.getManga('https://www.webtoons.com/en/demo/list?title_no=10'), { code: 'INVALID_URL' });
});

test('Asura: detecta capítulos únicos y decimales sin mezclar recomendaciones', async () => {
  const scraper = await createScraper('asura', { fetchImpl: htmlFixture(url => url.pathname.includes('/chapter/') ?
    '<img src="https://cdn.asurascans.com/banner.jpg"><img src="https://cdn.asurascans.com/asura-images/chapters/demo/1/1.webp">' :
    `<h1>Obra</h1><a href="/comics/demo/chapter/1.5">Chapter 1.5</a><a href="/comics/demo/chapter/1.5">First chapter</a><a href="/comics/other/chapter/2">Other</a><a href="/comics/demo/chapter/3">Unlock premium</a>`) });
  const result = await scraper.getChapters('https://asurascans.com/comics/demo');
  assert.deepEqual(result.chapters.map(chapter => chapter.number), [1.5]);
  assert.equal((await scraper.getChapterImages(result.chapters[0].url)).images.length, 1);
});

test('Tapas: pagina episodios gratuitos y conserva firmas de imágenes', async () => {
  const scraper = await createScraper('tapas', { fetchImpl: async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/episodes')) {
      const page = Number(url.searchParams.get('page'));
      return new Response(JSON.stringify({ code: 200, data: { pagination: { has_next: page === 1 }, body: page === 1 ?
        '<li data-href="/episode/123"><a class="info__label">Episode 1.5</a><a class="info__title">Inicio</a></li><li data-href="/episode/124" class="js-have-to-sign"><a class="info__title">Locked</a></li>' :
        '<li data-href="/episode/125"><a class="info__label">Episode 2</a><a class="info__title">Segundo</a></li>' } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(url.pathname.startsWith('/episode/') ?
      '<meta property="og:title" content="Read Inicio | Tapas Web Comics"><img class="content__img" data-src="https://us-a.tapas.io/page.png?__token__=abc&version=v4"><img src="https://us-a.tapas.io/cover.jpg">' :
      '<meta property="og:site_name" content="Read Obra"><meta property="og:locale" content="en_US"><meta property="og:image" content="https://us-a.tapas.io/cover.jpg">',
      { headers: { 'Content-Type': 'text/html' } });
  } });
  const result = await scraper.getChapters('https://tapas.io/series/100');
  assert.deepEqual(result.chapters.map(chapter => chapter.number), [1.5, 2]);
  const images = await scraper.getChapterImages(result.chapters[0].url);
  assert.equal(images.images.length, 1);
  assert.match(images.images[0].url, /__token__=abc&version=v4/);
});

test('API: catálogo, detección, búsqueda, alta por URL, lectura y progreso de dos fuentes', async t => {
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from([1, 2, 3])); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const imageOrigin = `http://127.0.0.1:${server.address().port}`;
  const localSources = new Map(['one', 'two'].map(id => {
    const origin = `https://${id}.test`;
    return [id, { name: id, pageOrigin: origin, imageOrigins: [imageOrigin], userAgent: 'ReaderTest/1.0',
      capabilities: { search: true, manga: true, chapters: true, images: true },
      scraper: { search: async () => ({ source: id, results: [{ title: id, url: origin + '/manga' }], nextPage: null }),
        getManga: async url => ({ manga: { title: id, url, cover: null } }),
        getChapters: async () => ({ chapters: [{ title: 'Uno', number: 1, url: origin + '/chapter' }] }),
        getChapterImages: async url => ({ chapter: { title: 'Uno', url }, images: [{ index: 1, url: imageOrigin + '/image', referer: url }] }) } }];
  }));
  const database = openDatabase(':memory:');
  const apiServer = createServer(createApp({ database, sources: localSources }));
  apiServer.listen(0, '127.0.0.1'); await once(apiServer, 'listening');
  t.after(async () => { for (const instance of [apiServer, server]) { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); } database.close(); });
  const origin = `http://127.0.0.1:${apiServer.address().port}`;
  const post = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await (await fetch(origin + '/api/sources')).json()).length, 2);
  const savedChapters = [];
  const savedSeries = [];
  for (const id of ['one', 'two']) {
    const url = `https://${id}.test/manga`;
    assert.equal((await (await fetch(origin + `/api/sources/detect?url=${encodeURIComponent(url)}`)).json()).id, id);
    assert.equal((await (await fetch(origin + `/api/sources/${id}/search?q=obra`)).json()).source, id);
    const favorite = await (await fetch(origin + '/api/series', post('POST', { url_origen: url }))).json();
    assert.equal(favorite.source, id); savedSeries.push(favorite);
    const [chapter] = await (await fetch(origin + `/api/series/${favorite.id}/sync`, { method: 'POST' })).json(); savedChapters.push(chapter);
    const images = await (await fetch(origin + `/api/chapters/${chapter.id}/images`)).json();
    assert.deepEqual(Buffer.from(await (await fetch(origin + images.images[0].url)).arrayBuffer()), Buffer.from([1, 2, 3]));
    assert.equal((await fetch(origin + '/api/progress', post('POST', { serie_id: favorite.id, capitulo_id: chapter.id, scroll_position_y: 100 }))).status, 200);
    assert.equal((await fetch(origin + `/api/chapters/${chapter.id}/read`, post('PUT', { read: true }))).status, 200);
    assert.equal(database.getProgress(favorite.id).scroll_position_y, 100);
  }
  assert.equal((await fetch(origin + '/api/progress', post('POST', { serie_id: savedSeries[0].id,
    capitulo_id: savedChapters[1].id, scroll_position_y: 10 }))).status, 400);
  assert.equal((await fetch(origin + '/api/sources/one/search?q=&page=-1')).status, 400);
  assert.equal((await fetch(origin + '/api/sources/unknown/search?q=obra')).status, 400);
});

test('API: solo anuncia fuentes disponibles; las pendientes rechazan altas sin modificar SQLite', async t => {
  const database = openDatabase(':memory:');
  const server = createServer(createApp({ database }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(origin + '/api/sources')).json();
  assert.ok(catalog.every(source=>source.enabled&&!source.demo));
  assert.equal(catalog.find(source => source.id === 'bato'),undefined);
  assert.equal(catalog.find(source => source.id === 'sitio-ejemplo'),undefined);
  const detected=await fetch(origin+'/api/sources/detect?'+new URLSearchParams({url:'https://bato.to/series/demo'}));assert.equal(detected.status,503);
  const result = await fetch(origin + '/api/series', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url_origen: 'https://bato.to/series/demo' }) });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'SOURCE_UNAVAILABLE');
  assert.equal(database.listSeries().length, 0);
});
