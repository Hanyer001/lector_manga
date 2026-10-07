import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';
import {createScraper} from '../src/extensions/catalog.js';import {allowedImageUrl,sources} from '../src/backend/sources.js';import {createApp} from '../src/backend/app.js';import {openDatabase} from '../src/storage/database.js';
const html=value=>new Response('<meta charset="utf-8">'+value,{headers:{'Content-Type':'text/html; charset=utf-8'}});
const novel='https://es.novelcool.com/novel/Obra.html',chapter='https://es.novelcool.com/chapter/Capitulo-1/123/';
const mangaHtml='<h1 class="bookinfo-title">Obra</h1><div class="book-type-manga">Manga</div><div class="bookinfo-pic"><img src="https://img.novelcool.com/cover.jpg"></div><span itemprop="keywords"><a>Acción</a><a>Reencarnación</a></span><div class="bookinfo-summary"><span itemprop="description">Descripción</span></div><div class="chapter-item-list"><a href="/chapter/Capitulo-1/123/"><span class="chapter-item-headtitle">Capítulo 1.5</span></a><a href="/chapter/Capitulo-1/123.html"><span class="chapter-item-headtitle">Capítulo 1.5</span></a></div>';

test('NovelCool: búsqueda y metadata de cómics, deduplicación, páginas completas y firmas intactas',async()=>{
 const calls=[],scraper=await createScraper('novelcool',{maxRetries:0,fetchImpl:async input=>{const url=new URL(input);calls.push(url);
 if(url.pathname==='/search/')return html('<div class="book-item"><a title="Obra" href="/novel/Obra.html"><img src="https://img.novelcool.com/cover.jpg"></a></div><a title="Obra (Novela)" href="/novel/Texto.html"></a><a href="/search/?page=2.html">2</a>');
 if(url.pathname.startsWith('/novel/'))return html(mangaHtml);
 if(url.pathname.endsWith('/'))return html('<img class="mangaread-manga-pic" src="https://es5.movietop.cc/1.webp"><div class="mangaread-pagenav"><option value="-10-1.html">10</option></div>');
 const page=Number(url.pathname.match(/-10-(\d+)\.html/)[1]);
 return html(`<div class="mangaread-title">Obra Capítulo 1.5</div><select class="sl-page">${[1,2,3].map(p=>`<option value="/chapter/Capitulo-1/123-10-${p}.html">${p}</option>`).join('')}</select><img class="mangaread-manga-pic" src="https://es5.movietop.cc/${page}.webp?acc=firmado&amp;exp=999">`);
 }});
 const search=await scraper.search('obra & otra');assert.equal(search.results.length,1);assert.equal(search.nextPage,1);assert.equal(calls[0].searchParams.get('name'),'obra & otra');
 const result=await scraper.getChapters(novel);assert.equal(result.chapters.length,1);assert.equal(result.chapters[0].number,1.5);assert.deepEqual(result.manga.genres,['action']);assert.deepEqual(result.manga.themes,['reincarnation']);
 const images=await scraper.getChapterImages(chapter);assert.deepEqual(images.images.map(i=>new URL(i.url).pathname),['/1.webp','/2.webp','/3.webp']);assert.ok(images.images.every(i=>i.url.endsWith('?acc=firmado&exp=999')));assert.match(images.images[2].referer,/-10-3.html$/);
 assert.equal(allowedImageUrl(images.images[0].url,sources.get('novelcool')),images.images[0].url);assert.throws(()=>allowedImageUrl('https://movietop.cc.evil.test/1.webp',sources.get('novelcool')),{code:'ORIGIN_NOT_ALLOWED'});
});
test('NovelCool rechaza paginación ajena, límites, páginas sin imágenes y novelas de texto',async()=>{
 let mode='foreign';const scraper=await createScraper('novelcool',{maxRetries:0,maxPages:1,fetchImpl:async()=>html(mode==='text'?'<h1 class="bookinfo-title">Obra (Novela)</h1>':`<img class="mangaread-manga-pic" src="https://es5.movietop.cc/1.webp"><select class="sl-page"><option value="${mode==='foreign'?'/chapter/Otro/456/':'/chapter/Capitulo-1/123-2.html'}">2</option></select>`)});
 await assert.rejects(scraper.getChapterImages(chapter),{code:'INVALID_RESPONSE'});mode='limit';await assert.rejects(scraper.getChapterImages(chapter),{code:'PAGINATION_LIMIT'});mode='text';await assert.rejects(scraper.getManga(novel),{code:'UNSUPPORTED_OPERATION'});await assert.rejects(scraper.getChapterImages(chapter),{code:'CHAPTER_UNAVAILABLE'});
 await assert.rejects(scraper.getManga('https://evil.test/novel/Obra.html'),{code:'INVALID_ORIGIN'});
});
test('TuManga.net extrae JSON sin ejecutar scripts, conserva versiones, etiquetas y orden de páginas',async()=>{
 let malicious=false;const scraper=await createScraper('tumanga',{maxRetries:0,fetchImpl:async input=>{const url=new URL(input);
 if(url.searchParams.has('s'))return html('<div class="bsx"><a href="/manga/obra/"><span class="tt">Obra</span><img src="/cover.webp"></a></div><a class="next page-numbers" href="/page/2/?s=obra">Siguiente</a>');
 if(url.pathname.startsWith('/manga/'))return html('<div class="main-info"><h1 class="entry-title">Obra</h1><span class="mgen"><a>Fantasía</a><a>Artes Marciales</a><a>Smut</a></span><div itemprop="description">Historia</div></div><meta property="og:image" content="https://tumanga.net/cover.webp"><div class="eplister"><a href="/obra/capitulo-1-1/"><span class="chapternum">Capítulo 1.5</span></a><a href="/obra/capitulo-1-2/"><span class="chapternum">Capítulo 1.5</span></a></div>');
 return html(`<script>throw Error('No ejecutar');</script><script>ts_reader.run(${malicious?'{images: ejecutar()}':JSON.stringify({sources:[{images:['https://tumanga.net/2.webp','https://tumanga.net/1.webp']} ]})});</script>`);
 }});
 const search=await scraper.search('obra');assert.equal(search.nextPage,1);const chapters=await scraper.getChapters(search.results[0].url);assert.deepEqual(chapters.chapters.map(c=>c.number),[1.5,1.5]);assert.equal(chapters.manga.contentRating,'adult');assert.deepEqual(chapters.manga.genres,['fantasy']);
 assert.deepEqual((await scraper.getChapterImages(chapters.chapters[0].url)).images.map(i=>i.url),['https://tumanga.net/2.webp','https://tumanga.net/1.webp']);malicious=true;await assert.rejects(scraper.getChapterImages(chapters.chapters[0].url),{code:'INVALID_RESPONSE'});
});
test('ManhwaWeb ignora entradas vacías del origen sin descartar páginas válidas',async()=>{
 const scraper=await createScraper('manhwaweb',{maxRetries:0,fetchImpl:async()=>new Response(JSON.stringify({chapter:{chapter:1,img:['https://img2mw.xyz/1.webp','',null,'   ','https://img2mw.xyz/2.webp']}}),{headers:{'Content-Type':'application/json'}})});
 assert.deepEqual((await scraper.getChapterImages('https://manhwaweb.com/leer/obra-1')).images.map(i=>i.url),['https://img2mw.xyz/1.webp','https://img2mw.xyz/2.webp']);
});
test('InManga encuentra la portada cuando cambia el contenedor sin admitir imágenes ajenas',async()=>{
 const id='11111111-1111-4111-8111-111111111111',cover=`https://cdn1.intomanga.com/i/m/${id}/t/o/${id}.jpg`;
 const scraper=await createScraper('inmanga',{maxRetries:0,fetchImpl:async()=>html(`<h1>Obra</h1><input id="Identification" value="${id}"><div class="custom-bg-center"><img src="${cover}"></div>`)});
 assert.equal((await scraper.getManga(`https://inmanga.com/ver/manga/Obra/${id}`)).manga.cover,cover);
});
test('TuManga.net conserva recomendaciones y portadas del catálogo ante una ficha caída',async()=>{
 const scraper=await createScraper('tumanga',{maxRetries:0,fetchImpl:async input=>{const url=new URL(input);if(url.pathname==='/')return html('<div class="bsx"><a title="Obra" href="/manga/obra/"><img src="/cover.webp"></a></div><div class="bsx"><a title="Caída" href="/manga/caida/"><img src="/cover2.webp"></a></div>');
 if(url.pathname==='/manga/caida/')return new Response('Fallo',{status:500});return html('<div class="main-info"><h1 class="entry-title">Obra</h1><span class="mgen"><a>Acción</a></span></div>');}});
 const result=await scraper.recommend({});assert.equal(result.results.length,1);assert.equal(result.results[0].cover,'https://tumanga.net/cover.webp');assert.equal(result.partial,true);assert.match(result.warnings[0],/1 ficha/);
});
test('WEBTOON reutiliza géneros, respeta clasificación y distingue filtros inexistentes de fallos de red',async t=>{
 let calls=0;const scraper=await createScraper('webtoon',{maxRetries:0,fetchImpl:async input=>{calls++;const u=new URL(input);return html(u.pathname==='/es/genres'?'<a class="_snb_tab_a" data-genre="ACTION" href="/es/genres/action">Acción</a>':'<a class="_genre_title_a" data-genre="ACTION" href="/es/action/obra/list?title_no=1"><span class="title">Obra</span><div data-title-unsuitable-for-children="true"></div></a>');}});
 assert.equal((await scraper.recommend({genres:['Acción']})).results[0].contentRating,'adult');const previous=calls;await scraper.recommend({genres:['Acción']});assert.equal(calls,previous);
 const database=openDatabase(':memory:'),source={...sources.get('webtoon'),scraper},server=createServer(createApp({database,sources:new Map([['webtoon',source]])}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));database.close();});
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/discovery/recommendations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{genres:['Harem']}})}),result=await response.json();assert.equal(response.status,200);assert.equal(result.sources[0].status,'unsupported');assert.match(result.sources[0].messages[0],/Harem/);
});
