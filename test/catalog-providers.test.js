import test from'node:test';import assert from'node:assert/strict';
import AniList from'../src/extensions/anilist.js';import ComicK from'../src/extensions/comick.js';import Ikigai from'../src/extensions/ikigai.js';
import{createSources,definitionFor}from'../src/extensions/catalog.js';
import ZonaTMO from'../src/extensions/zonatmo.js';
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}),html=body=>new Response('<meta charset="utf-8">'+body,{headers:{'Content-Type':'text/html'}});
test('AniList: GraphQL POST público, fichas seguras y sin prometer lectura',async()=>{
 let payload;const row={id:30002,format:'MANGA',title:{romaji:'Berserk',english:null,native:'ベルセルク'},description:'<b>Una historia</b>',genres:['Action'],tags:[{name:'Revenge',isAdult:false}],staff:{edges:[{role:'Story & Art',node:{name:{full:'Kentaro Miura'}}}]},coverImage:{large:'https://s4.anilist.co/file/a.jpg'},status:'RELEASING',countryOfOrigin:'JP',isAdult:false};
 const scraper=new AniList({fetchImpl:async(url,options)=>{assert.equal(url,'https://graphql.anilist.co/');assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'application/json');payload=JSON.parse(options.body);return json(payload.query.includes('Page(')?{data:{Page:{pageInfo:{hasNextPage:true},media:[row,{...row,format:'NOVEL'}]}}}:{data:{Media:row}});}});
 const found=await scraper.search('Berserk',{page:1});assert.equal(payload.variables.page,2);assert.equal(found.results.length,1);assert.equal(found.results[0].metadataOnly,true);assert.equal(found.results[0].description,'Una historia');assert.deepEqual(found.results[0].authors,['Kentaro Miura']);assert.equal(found.nextPage,2);
 assert.equal((await scraper.getManga(found.results[0].url)).manga.title,'Berserk');await assert.rejects(scraper.getChapters(found.results[0].url),{code:'UNSUPPORTED_OPERATION'});await assert.rejects(scraper.getManga('https://anilist.co/anime/1'),{code:'INVALID_URL'});
 const broken=new AniList({fetchImpl:async()=>json({errors:[{message:'Too many requests'}]})});await assert.rejects(broken.search('test'),{code:'INVALID_RESPONSE'});
});
test('ComicK: búsqueda de fichas, idiomas preservados y capítulos deshabilitados',async()=>{
 let calls=0;const scraper=new ComicK({fetchImpl:async()=>{calls++;return json([{slug:'berserk',title:'Berserk',media_type:'manga',country:'jp',status:1,md_titles:[{title:'ベルセルク'}],content_rating:'safe'}]);}});
 const result=await scraper.search('Berserk');assert.equal(result.results[0].metadataOnly,true);assert.equal(result.results[0].cover,null);assert.equal((await scraper.getManga('https://comick.io/comic/berserk')).manga.title,'Berserk');assert.equal(calls,1);await assert.rejects(scraper.getChapterImages('anything'),{code:'UNSUPPORTED_OPERATION'});
});
function qwik(value){const objs=[];const put=value=>{const index=objs.length;objs.push(null);objs[index]=Array.isArray(value)?value.map(put):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,put(item)])):value;return index.toString(36);};put(value);return '<script type="qwik/json">'+JSON.stringify({objs})+'</script>';}
test('Ikigai: páginas de capítulos completas, numéricas y sin enlaces de primer/último duplicados',async()=>{
 const definition=definitionFor('ikigai');assert.equal(createSources([definition],{environment:'render'}).get('ikigai').enabled,false);assert.notEqual(createSources([definition],{environment:'local'}).get('ikigai').enabled,false);
 const origin=definitionFor('ikigai').baseUrl,root=origin+'series/historia/';let pages=[];
 const scraper=new Ikigai({fetchImpl:async url=>{const page=Number(new URL(url).searchParams.get('pagina'));pages.push(page);return html(`<main><div><div><h1>Historia</h1><p>En Curso</p></div></div><a href="/capitulo/999/">Primer capítulo</a><a href="/capitulo/${page===1?'10':'2'}/"><h3>Capítulo ${page===1?'10':'2'}</h3></a>${page===1?'<a href="?pagina=2">Siguiente</a>':''}</main>`);}});
 const result=await scraper.getChapters(root);assert.deepEqual(pages,[1,2]);assert.deepEqual(result.chapters.map(row=>row.number),[2,10]);assert.equal(result.chapters.length,2);
});
test('Ikigai: datos Qwik sin ejecutar scripts, banners excluidos, páginas ajenas y bloqueo rechazados',async()=>{
 const base=definitionFor('ikigai').baseUrl,url=base+'capitulo/20/';let locked=false,wrong=false;
 const scraper=new Ikigai({fetchImpl:async()=>html(qwik({chapter:{id:'\u001820',series_id:'\u001810',name:2,pages:['https://image3.ikigaimangas.cloud/series/10/'+(wrong?'21':'20')+'/01.webp','https://image3.ikigaimangas.cloud/posts/misc/banner.png','https://image3.ikigaimangas.cloud/series/10/20/01.webp']},locked,is_scheduled:false}))});
 const result=await scraper.getChapterImages(url);assert.equal(result.images.length,1);assert.equal(result.images[0].index,1);locked=true;await assert.rejects(scraper.getChapterImages(url),{code:'CHAPTER_UNAVAILABLE'});locked=false;wrong=true;await assert.rejects(scraper.getChapterImages(url),{code:'INVALID_RESPONSE'});
});
test('ZonaTMO: dominio y CDN configurables, Referer exacto y límites de origen',async()=>{
 const definition=definitionFor('tmo'),source=createSources([definition],{environment:'render',tmoBaseUrl:'https://tmo.example/',tmoImageOrigins:'https://images.example'}).get('tmo');assert.notEqual(source.enabled,false,'un dominio explícito permite probar el adaptador desde Render');
 assert.equal(source.baseUrl,'https://tmo.example/');assert.deepEqual(source.pageOrigins,['https://tmo.example']);assert.ok(source.imageOrigins.includes('https://images.example'));
 for(const invalid of ['http://example.com','https://127.0.0.1/','https://example.com/path','https://user:secret@example.com/'])assert.throws(()=>createSources([definition],{tmoBaseUrl:invalid}));
 const scraper=new ZonaTMO({baseUrl:source.baseUrl,pageOrigins:source.pageOrigins,imageOrigins:source.imageOrigins,fetchImpl:async(_url,options)=>{assert.equal(options.headers.Referer,source.baseUrl);return html('<h1 class="element-title">Historia</h1>');}});await scraper.getManga('https://tmo.example/library/manga/1/historia');assert.equal(scraper.image('https://images.example/a.jpg',source.baseUrl),'https://images.example/a.jpg');assert.throws(()=>scraper.image('https://images.example.evil/a.jpg',source.baseUrl),{code:'INVALID_ORIGIN'});
});
