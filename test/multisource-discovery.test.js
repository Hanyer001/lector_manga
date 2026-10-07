import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';
import {createScraper} from '../src/extensions/catalog.js';import {createApp} from '../src/backend/app.js';import {openDatabase} from '../src/storage/database.js';
import {matchesDiscovery,rankRecommendations,tagKey} from '../src/frontend/discovery-core.js';import {discoveryTags} from '../src/frontend/discovery-tags.js';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const html=value=>new Response(value,{headers:{'Content-Type':'text/html'}});
const card=(source,n,extra={})=>({source,title:`${source} ${n}`,url:`https://${source}.test/series/${n}`,genres:['Fantasy'],...extra});

test('taxonomía amplia: etiquetas españolas consistentes y combinaciones O/Y con exclusiones estrictas',()=>{
  assert.equal(discoveryTags.genres.length,23);assert.equal(discoveryTags.themes.length,36);
  assert.equal(tagKey('Cultivación (cultivo)'),'cultivation');assert.equal(tagKey('Recuentos de la vida'),'slice of life');assert.equal(tagKey('Psicológico'),'psychological');
  const item={genres:['Action'],themes:['Reincarnation']};
  assert.equal(matchesDiscovery(item,{genres:['Fantasía','Acción'],genreMatch:'any'}),true);
  assert.equal(matchesDiscovery(item,{genres:['Fantasía','Acción'],genreMatch:'all'}),false);
  assert.equal(matchesDiscovery(item,{genres:['Acción'],genreMatch:'any',excludeGenres:['Action']}),false);
  assert.equal(matchesDiscovery(item,{themes:['Reencarnación','Magia']}),false);
});
test('ranking intercala fuentes, elimina títulos duplicados y mantiene los filtros',()=>{
  const pool=[...Array.from({length:32},(_,n)=>card('one',n)),card('two',1),card('three',1),card('two',2,{title:'one 0'}),card('three',2,{genres:['Horror']})];
  const result=rankRecommendations(pool,{filters:{excludeGenres:['Terror']}});
  assert.equal(result.length,24);assert.equal(new Set(result.slice(0,3).map(i=>i.source)).size,3);
  assert.equal(result.filter(i=>i.title==='one 0').length,1);assert.ok(!result.some(i=>i.genres.includes('Horror')));
});
test('ManhwaWeb usa IDs reales en búsqueda por género y normaliza las categorías numéricas',async()=>{
  let query;
  const scraper=await createScraper('manhwaweb',{maxRetries:0,fetchImpl:async input=>{query=new URL(input);return json({data:[{real_id:'work',name_esp:'Obra',_categoris:[3,23,41,39],_tipo:'manhwa',_erotico:'no'}]});}});
  const result=await scraper.recommend({genres:['Acción'],themes:['Reencarnación']});
  assert.equal(query.searchParams.get('generes'),'3a41');assert.equal(query.searchParams.get('order_item'),'popularidad');
  assert.deepEqual(result.results[0].genres,['Acción','Fantasía']);assert.deepEqual(result.results[0].themes,['Reencarnación','Artes marciales']);
  const unavailable=await scraper.recommend({themes:['Tema inventado']});assert.equal(unavailable.results.length,0);assert.equal(unavailable.unavailableTags.length,1);
});
test('Olympus busca solo cómics, pagina capítulos, conserva orden de páginas y permite solo su API declarada',async()=>{
  const calls=[],manga={id:1,type:'comic',name:'Obra Solo',slug:'obra-solo',cover:'https://media.imagesolymp.xyz/cover.webp',status:{id:1},genres:[{id:1,name:'Acción'},{id:25,name:'Reencarnación'}]};
  const scraper=await createScraper('olympus',{maxRetries:0,fetchImpl:async input=>{const url=new URL(input);calls.push(url);if(url.pathname.endsWith('/list'))return json({data:[manga,{...manga,type:'novel'}]});
    if(url.pathname==='/api/genres-statuses')return json({genres:manga.genres});
    if(url.pathname==='/api/series')return json({data:{series:{data:[manga]}}});
    if(url.pathname.endsWith('/chapters')){const page=Number(url.searchParams.get('page'));return json({data:page===1?[{id:11,name:'1.5'},{id:99,name:'9',locked:true}]:[{id:12,name:'2'}],meta:{current_page:page,last_page:2}});}
    if(url.pathname.startsWith('/api/capitulo/'))return json({chapter:{name:'1.5',pages:['https://media.imagesolymp.xyz/2.webp','https://media.imagesolymp.xyz/1.webp']}});
    return json({data:manga});}});
  assert.equal((await scraper.search('solo')).results.length,1);await scraper.search('solo');assert.equal(calls.filter(u=>u.pathname.endsWith('/list')).length,1);
  const result=await scraper.getChapters('https://olympusxyz.com/series/comic-obra-solo');assert.deepEqual(result.chapters.map(c=>c.number),[1.5,2]);
  assert.equal(calls.find(u=>u.pathname.endsWith('/chapters')).origin,'https://panel.olympusxyz.com');
  assert.deepEqual((await scraper.getChapterImages(result.chapters[0].url)).images.map(i=>i.url),['https://media.imagesolymp.xyz/2.webp','https://media.imagesolymp.xyz/1.webp']);
  assert.equal((await scraper.recommend({themes:['Reencarnación']})).results[0].themes[0],'Reencarnación');
  await assert.rejects(scraper.getManga('https://olympusxyz.com/series/novela-obra-solo'),{code:'INVALID_URL'});
  await assert.rejects(scraper.fetchJson('https://panel.olympusxyz.com.evil.test/api/series'),{code:'INVALID_ORIGIN'});
});
test('Olympus rechaza paginación estancada e imágenes sustituidas',async()=>{
  let pages=['/cp/cp-1.jpg'];const scraper=await createScraper('olympus',{maxRetries:0,fetchImpl:async input=>{const url=new URL(input);return json(url.pathname.endsWith('/chapters')?{data:[{id:11,name:'1'}],meta:{current_page:1,last_page:2}}:url.pathname.includes('/capitulo/')?{chapter:{pages}}:{data:{name:'Obra',slug:'obra',type:'comic'}});}});
  await assert.rejects(scraper.getChapters('https://olympusxyz.com/series/comic-obra'),{code:'INVALID_RESPONSE'});
  await assert.rejects(scraper.getChapterImages('https://olympusxyz.com/capitulo/11/comic-obra'),{code:'CHAPTER_UNAVAILABLE'});
  pages=[];await assert.rejects(scraper.getChapterImages('https://olympusxyz.com/capitulo/11/comic-obra'),{code:'CHAPTER_UNAVAILABLE'});
});
test('InManga: formulario de consulta codificado, fichas, capítulos y páginas sin ejecutar JavaScript',async()=>{
  const manga='11111111-1111-4111-8111-111111111111',chapter='22222222-2222-4222-8222-222222222222',page='33333333-3333-4333-8333-333333333333';let posted;
  const scraper=await createScraper('inmanga',{maxRetries:0,fetchImpl:async(input,options)=>{const url=new URL(input);
    if(url.pathname==='/manga/getMangasConsultResult'){posted=options;return html(`<a class="manga-result" href="/ver/manga/Obra/${manga}"><h4>Obra</h4><img data-src="https://cdn1.intomanga.com/cover.jpg"></a>`);}
    if(url.pathname==='/chapter/getall')return json({data:JSON.stringify({success:true,result:[{Identification:chapter,FriendlyChapterNumberUrl:'1.5',Number:1.5,PagesCount:2}]})});
    if(url.pathname==='/chapter/chapterIndexControls')return html(`<select id="PageList"><option value="${page}">1</option><option value="not-uuid">anuncio</option></select>`);
    if(url.pathname.split('/').length===6)return html(`<h1>Obra 1.5</h1><script>var pu = 'https://cdn1.intomanga.com/i/m/${manga}/c/${chapter}/o/identification.jpg'; throw Error('Nunca ejecutar');</script>`);
    return html(`<h1>Obra</h1><input id="Identification" value="${manga}"><input id="broadcastStatusInput" value="1"><div class="manga-index-detail-cover-photo-layout"><img src="https://cdn1.intomanga.com/cover.jpg"></div>`);}});
  const result=await scraper.search('obra & manga',{page:2});assert.equal(posted.method,'POST');assert.equal(new URLSearchParams(posted.body).get('filter[queryString]'),'obra & manga');assert.equal(new URLSearchParams(posted.body).get('filter[skip]'),'40');
  const chapters=await scraper.getChapters(result.results[0].url);assert.equal(chapters.chapters[0].number,1.5);
  const images=await scraper.getChapterImages(chapters.chapters[0].url);assert.equal(images.images.length,1);assert.ok(images.images[0].url.endsWith(page+'.jpg'));
  await assert.rejects(scraper.getManga('https://evil.test/ver/manga/x/'+manga),{code:'INVALID_ORIGIN'});
});
test('WEBTOON carga la categoría solicitada y comunica temas sin metadatos',async()=>{
  const root='https://www.webtoons.com/es/action/obra/list?title_no=10',calls=[];
  const scraper=await createScraper('webtoon',{maxRetries:0,fetchImpl:async input=>{const url=new URL(input);calls.push(url.pathname);return html(url.pathname==='/es/genres'?'<a class="_snb_tab_a" data-genre="ACTION" href="/es/genres/action">Acción</a>':`<a class="_genre_title_a" data-genre="ACTION" href="${root}"><strong class="title">Obra</strong><img src="https://webtoon-phinf.pstatic.net/cover.jpg"></a>`);}});
  const result=await scraper.recommend({genres:['Acción']});assert.equal(result.results.length,1);assert.deepEqual(result.results[0].genres,['action']);assert.ok(calls.includes('/es/genres/action'));
  assert.deepEqual((await scraper.recommend({themes:['Reencarnación']})).unavailableTags,['Reencarnación']);
});
test('API multisource: fallo parcial, filtros, firma por proveedor y mínimo verificado en su propia fuente',async t=>{
  const database=openDatabase(':memory:'),calls=[];
  const sources=new Map(['one','two','broken'].map(id=>[id,{id,name:id,pageOrigin:`https://${id}.test`,baseUrl:`https://${id}.test/`,imageOrigins:[`https://images.${id}.test`],languages:['es'],capabilities:{recommend:true,chapters:true},scraper:{
    recommend:async filters=>{calls.push({id,filters});if(id==='broken')throw Error('Sin conexión');return {results:[card(id,1,{cover:`https://images.${id}.test/cover.jpg`}),card(id,2,{genres:['Horror']})]};},
    getChapters:async url=>{assert.equal(new URL(url).origin,`https://${id}.test`);return {chapters:[{number:1,url:url+'/1'},{number:1,url:url+'/1-alt'},{number:2,url:url+'/2'}]};}
  }}]));
  const server=createServer(createApp({database,sources,logger:{warn(){},error(){}}}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
  const request=body=>fetch(`http://127.0.0.1:${server.address().port}/api/discovery/recommendations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let result=await(await request({filters:{minChapters:2,excludeGenres:['Terror']}})).json();assert.deepEqual(new Set(result.results.map(i=>i.source)),new Set(['one','two']));assert.ok(result.results.every(i=>i.verified_chapters===2&&i.coverUrl.startsWith('/api/image?ticket=')));assert.equal(result.sources.find(s=>s.id==='broken').status,'error');assert.match(result.warnings[0],/broken/);
  calls.length=0;result=await(await request({filters:{sources:['two'],genres:['Fantasía','Acción'],genreMatch:'any'}})).json();assert.ok(calls.every(c=>c.id==='two'));assert.equal(calls.length,2);assert.deepEqual(new Set(result.results.map(i=>i.source)),new Set(['two']));
  assert.equal((await request({filters:{sources:['unknown']}})).status,400);assert.equal(database.listSeries().length,0);
});
