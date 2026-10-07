import test from 'node:test';
import assert from 'node:assert/strict';
import {createScraper,createSources} from '../src/extensions/catalog.js';
import {sources,detectSource,allowedImageUrl} from '../src/backend/sources.js';
import {decodeSenshiProps} from '../src/extensions/senshimanga.js';
const html=body=>new Response(body,{headers:{'Content-Type':'text/html'}});
const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const root='https://zonatmo.org/library/manga/31361/berserk';
const tmoCard=`<a href="${root}"><div class="thumbnail book"><img class="cover-bg-img" src="https://storage2.zonatmo.org/cover.webp"><div class="thumbnail-title"><h4>Berserk</h4></div><span class="demography">Seinen</span></div></a>`;
const tmoManga=`<meta charset="UTF-8"><div class="element-header-content"><h1 class="element-title">Berserk <small>(1989)</small></h1><img class="book-thumbnail" src="https://zonatmo.org/cover.webp"><p class="element-description">Sinopsis</p><a href="/tag/horror">Horror</a><a href="/tag/gore">Gore</a><a href="/biblioteca?filter_by=author&title=Miura">Kentarou Miura</a><h5 class="element-subtitle">Estado</h5><p>Publicándose</p></div>`;
const tmoChapter=(number,id)=>`<li class="upload-link"><span class="chapter-number" data-number="${number}">Capítulo ${number}</span><div><a href="/view_uploads/${id}">Leer online</a><a href="/groups/12">Grupo</a></div></li>`;
test('ZonaTMO: búsqueda paginada, metadatos y todos los capítulos incluidos los ocultos del HTML',async()=>{
  const calls=[],scraper=await createScraper('tmo',{fetchImpl:async input=>{const url=new URL(input);calls.push(url);return html(url.pathname==='/biblioteca'?`<form action="https://zonatmo.org/biblioteca"></form>${tmoCard}<div class="pagination"><a href="/biblioteca?page=2">2</a></div><a href="/library/novel/1/novela"><h4>Novela</h4></a>`:
    `${tmoManga}<div class="element-chapters"><ul id="chapters-list" class="list-chapters">${tmoChapter(2,10)}</ul><ul id="chapters-hidden" class="list-chapters" hidden>${tmoChapter(1.5,11)}${tmoChapter(1.5,12)}</ul></div>`);}});
  const search=await scraper.search('Berserk & otro');assert.equal(calls[0].searchParams.get('title'),'Berserk & otro');assert.equal(search.nextPage,1);assert.equal(search.results.length,1);
  const {manga,chapters}=await scraper.getChapters(root);assert.equal(manga.title,'Berserk');assert.deepEqual(manga.genres,['horror']);assert.deepEqual(manga.themes,['gore']);assert.deepEqual(manga.authors,['Kentarou Miura']);assert.equal(manga.status,'ongoing');assert.deepEqual(chapters.map(row=>row.number),[2,1.5,1.5]);assert.equal(new Set(chapters.map(row=>row.url)).size,3);
  await assert.rejects(scraper.getManga('https://zonatmo.org/library/novel/1/demo'),{code:'INVALID_URL'});await assert.rejects(scraper.getManga('https://zonatmo.org.evil.invalid/library/manga/31361/berserk'),{code:'INVALID_ORIGIN'});
});
test('ZonaTMO: imágenes del lector, límites de red y ausencia de capítulos sin entregar una lista parcial',async()=>{
  let body='<title>Berserk — ZonaTMO</title><img src="https://ad.invalid/a"><img class="reader-image" src="https://storage2.zonatmo.org/1.webp"><img class="reader-image" data-src="https://storage.zonatmo.org/2.webp">';
  const scraper=await createScraper('tmo',{fetchImpl:async()=>html(body)});assert.deepEqual((await scraper.getChapterImages('https://zonatmo.org/view_uploads/10')).images.map(row=>row.index),[1,2]);
  body='<img class="reader-image" src="https://storage2.zonatmo.org.evil.invalid/1.webp">';await assert.rejects(scraper.getChapterImages('https://zonatmo.org/view_uploads/10'),{code:'INVALID_ORIGIN'});
  body=tmoManga;await assert.rejects(scraper.getChapters(root),{code:'EXTRACTION_EMPTY'});
  body=tmoManga+'<div class="element-chapters"><div class="pagination"></div></div>';await assert.rejects(scraper.getChapters(root),{code:'PAGINATION_LIMIT'});
});
const encode=value=>Array.isArray(value)?[1,value.map(encode)]:[0,value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)])):value];
const island=data=>'<script>'+ 'x'.repeat(1800)+'</script><meta charset="UTF-8"><astro-island props="'+JSON.stringify(Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encode(value)]))).replaceAll('&','&amp;').replaceAll('"','&quot;')+'"></astro-island>';
const senshiRoot='https://capibaratraductor.com/senshimanga/manga/obra';
const senshiRow={id:1,title:'Obra de acción',description:'Sinopsis en español',organization:{slug:'senshimanga'},isPublic:true,status:'ongoing',imageUrl:'https://r2.capibaratraductor.com/cover.webp',manga:{slug:'obra',bookType:{code:'manga'},demography:{name:'Shōnen'},authors:[{name:'Autora'}]},genres:[{name:'Acción'}],chapters:[{id:10,number:1.5,title:'Más',isUnreleased:false},{id:11,number:2,isUnreleased:true}]};
test('SenshiManga: catálogo paginado compartido, búsqueda con acentos, metadatos UTF-8 y recomendaciones con más resultados',async()=>{
  let catalogCalls=0;const scraper=await createScraper('senshimanga',{fetchImpl:async(input,options)=>{assert.equal(options.headers['X-Organization'],'senshimanga');assert.equal(options.redirect,'manual');const url=new URL(input);if(url.pathname==='/api/manga-custom'){catalogCalls++;return json({status:true,data:{maxPage:2,items:url.searchParams.get('page')==='1'?[senshiRow]:Array.from({length:24},(_,i)=>({...senshiRow,id:i+2,title:'Otra '+i,manga:{...senshiRow.manga,slug:'otra-'+i}}))}});}return html(island({manga:senshiRow,organization:{slug:'senshimanga'}}));}});
  const [search,recommend]=await Promise.all([scraper.search('acción'),scraper.recommend()]);assert.equal(catalogCalls,2);assert.equal(search.results[0].title,'Obra de acción');assert.equal(recommend.results.length,24);assert.equal(recommend.nextPage,1);assert.equal((await scraper.recommend({page:1})).results.length,1);
  const {manga,chapters}=await scraper.getChapters(senshiRoot);assert.equal(manga.description,'Sinopsis en español');assert.deepEqual(manga.genres,['action']);assert.deepEqual(manga.themes,['shounen']);assert.deepEqual(manga.authors,['Autora']);assert.equal(chapters.length,1);assert.equal(chapters[0].number,1.5);
  await assert.rejects(scraper.getManga('https://capibaratraductor.com/otrogrupo/manga/obra'),{code:'INVALID_URL'});
});
test('SenshiManga: acceso público, orden de páginas y rechaza capítulos restringidos, incompletos o CDN externo',async()=>{
  let access=true,pages=[{number:2,chapterId:10,imageUrl:'https://r2.capibaratraductor.com/2.webp'},{number:1,chapterId:10,imageUrl:'https://r2.capibaratraductor.com/1.webp'}],pageCalls=0;
  const scraper=await createScraper('senshimanga',{fetchImpl:async input=>{if(new URL(input).pathname.startsWith('/api/')){pageCalls++;return json({status:true,data:pages});}return html(island({manga:senshiRow,organization:{slug:'senshimanga'},hasAccess:access,chapter:{id:10,number:1.5,title:'Español',hasAccess:access}}));}}),url=senshiRoot+'/chapters/1.5';
  assert.deepEqual((await scraper.getChapterImages(url)).images.map(row=>row.url),['https://r2.capibaratraductor.com/1.webp','https://r2.capibaratraductor.com/2.webp']);
  access=false;await assert.rejects(scraper.getChapterImages(url),{code:'CHAPTER_UNAVAILABLE'});assert.equal(pageCalls,1);access=true;
  pages[0].number=3;await assert.rejects(scraper.getChapterImages(url),{code:'INVALID_RESPONSE'});pages[0].number=2;pages[0].imageUrl='https://evil.invalid/a';await assert.rejects(scraper.getChapterImages(url),{code:'INVALID_ORIGIN'});
  assert.throws(()=>decodeSenshiProps([2,'script']),{code:'INVALID_RESPONSE'});
});
test('fuentes nuevas: dominios exactos y Manhwa Latino no se anuncia como disponible',async()=>{
  assert.equal(detectSource(sources,root).id,'tmo');assert.equal(detectSource(sources,senshiRoot).id,'senshimanga');assert.equal(sources.get('manhwa-latino').enabled,false);await assert.rejects(createScraper('manhwa-latino'),{code:'SOURCE_UNAVAILABLE'});
  assert.throws(()=>allowedImageUrl('https://r2.capibaratraductor.com.evil.invalid/a',sources.get('senshimanga')),{code:'ORIGIN_NOT_ALLOWED'});assert.throws(()=>allowedImageUrl('https://storage2.zonatmo.org:444/a',sources.get('tmo')),{code:'ORIGIN_NOT_ALLOWED'});
});
test('ZonaTMO: disponible localmente y desactivada en Render por su bloqueo HTTP 403',async()=>{
  const local=createSources(undefined,{environment:'local'}),remote=createSources(undefined,{environment:'render'});
  assert.notEqual(local.get('tmo').enabled,false);assert.equal(remote.get('tmo').enabled,false);assert.match(remote.get('tmo').reason,/HTTP 403/);
  await assert.rejects(remote.get('tmo').scraper.search('Berserk'),{code:'SOURCE_UNAVAILABLE'});assert.notEqual(remote.get('senshimanga').enabled,false);
});
