import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../src/storage/database.js';
import {validateDiscovery} from '../src/storage/discovery.js';
import {rankRecommendations,selectRecommendationSeeds,recommendationQueryTags} from '../src/frontend/discovery-core.js';
import {createScraper} from '../src/extensions/catalog.js';
import {createApp} from '../src/backend/app.js';

test('búsquedas guardadas: validación acotada, persistencia y referencias de favoritos al importar',()=>{
  const db=openDatabase(':memory:'),copy=openDatabase(':memory:');
  try{
    const series=db.saveFavorite({source:'one',titulo:'Favorita',url_origen:'https://one.test/saved'});
    const preferences={favoriteWorkIds:[series.work_id],savedSearches:[{id:'one',name:'Fantasía terminada',collection:'completed',filters:{genres:['Fantasy'],status:'completed',sources:['manhwaweb'],onlyNew:true}}]};
    db.saveDiscovery(preferences);
    const backup=db.exportLibrary();
    copy.saveFavorite({source:'two',titulo:'Ya existente',url_origen:'https://two.test/existing'});
    copy.importLibrary(backup);
    const imported=copy.listSeries().find(item=>item.titulo==='Favorita');
    assert.deepEqual(copy.getDiscovery().preferences.favoriteWorkIds,[imported.work_id]);
    assert.equal(copy.getDiscovery().preferences.savedSearches[0].filters.onlyNew,true);
    assert.equal(copy.getDiscovery().preferences.savedSearches[0].collection,'completed');
    for(const invalid of [{favoriteWorkIds:[1,2,3,4]},{favoriteWorkIds:['1']},{savedSearches:Array(13).fill(preferences.savedSearches[0])},{savedSearches:[...preferences.savedSearches,...preferences.savedSearches]},{savedSearches:[{...preferences.savedSearches[0],filters:{minChapters:-1}}]},{catalogOrder:'inventado'}])assert.throws(()=>validateDiscovery(invalid),{code:'INVALID_PREFERENCES'});
  }finally{db.close();copy.close();}
});

test('tres favoritos: cambian afinidad y consulta sin alterar notas ni usar una obra privada',()=>{
  const library=[{id:1,work_id:1,source:'one',titulo:'Terror favorito',url_origen:'https://one.test/horror',genres:['Horror'],sentiment:'neutral'},{id:2,work_id:2,source:'one',titulo:'Romance habitual',url_origen:'https://one.test/romance',genres:['Romance'],sentiment:'like'}];
  const pool=[{source:'one',title:'Terror nuevo',url:'https://one.test/new-horror',genres:['Horror']},{source:'one',title:'Amor nuevo',url:'https://one.test/new-romance',genres:['Romance']}];
  assert.equal(rankRecommendations(pool,{library})[0].title,'Amor nuevo');
  const filters={favoriteWorkIds:[1]},results=rankRecommendations(pool,{library,filters});
  assert.equal(results[0].title,'Terror nuevo');assert.match(results[0].reason,/Por tu favorito Terror favorito/);
  assert.equal(recommendationQueryTags(selectRecommendationSeeds({library,filters}))[0].key,'horror');
  const seeds=selectRecommendationSeeds({library:[{...library[0],is_private:1},library[1]],filters});
  assert.ok(!seeds.some(seed=>seed.discoveryFavorite));assert.equal(library[0].sentiment,'neutral');
});

test('novedades: mantiene el orden de cada catálogo; terminadas excluye otros estados',()=>{
  const item=(source,title,status='completed')=>({source,title,status,url:`https://${source}.test/${title}`});
  const pool=[item('one','Z-reciente'),item('one','A-anterior'),item('two','Nueva'),item('two','En-emision','ongoing')];
  assert.deepEqual(rankRecommendations(pool,{mode:'genres',filters:{catalogOrder:'newest',status:'completed'}}).map(item=>item.title),['Z-reciente','Nueva','A-anterior']);
});

test('catálogos: novedades pide creación descendente y terminadas pide el estado real',async()=>{
  let manhwaQuery,dexQuery;
  const manhwa=await createScraper('manhwaweb',{maxRetries:0,fetchImpl:async url=>{manhwaQuery=new URL(url);return new Response(JSON.stringify({data:[]}),{headers:{'Content-Type':'application/json'}});}});
  await manhwa.recommend({catalogOrder:'newest',status:'completed'});
  assert.equal(manhwaQuery.searchParams.get('order_item'),'creacion');assert.equal(manhwaQuery.searchParams.get('estado'),'finalizado');
  const dex=await createScraper('mangadex',{maxRetries:0,fetchImpl:async url=>{dexQuery=new URL(url);return new Response(JSON.stringify({result:'ok',data:[],offset:0,total:0}),{headers:{'Content-Type':'application/json'}});}});
  await dex.recommend({catalogOrder:'newest',status:'completed'});
  assert.equal(dexQuery.searchParams.get('order[createdAt]'),'desc');assert.equal(dexQuery.searchParams.get('order[followedCount]'),null);assert.equal(dexQuery.searchParams.get('status[]'),'completed');
});

test('API: cachés independientes para novedades y populares, con paginación y filtros',async t=>{
  const db=openDatabase(':memory:'),calls=[];
  const source={id:'one',name:'Uno',enabled:true,pageOrigin:'https://one.test',baseUrl:'https://one.test/',imageOrigins:['https://one.test'],capabilities:{recommend:true},scraper:{recommend:async options=>{calls.push(options);return {results:[{title:'Historia '+options.catalogOrder,url:'https://one.test/'+options.catalogOrder,status:'completed'}],nextPage:1};}}};
  const server=createServer(createApp({database:db,sources:new Map([['one',source]]),logger:{warn(){},error(){}}}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  const query=async catalogOrder=>(await fetch(`http://127.0.0.1:${server.address().port}/api/discovery/recommendations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'genres',filters:{catalogOrder,status:'completed'}})})).json();
  assert.equal((await query('newest')).results[0].title,'Historia newest');
  assert.equal((await query('popular')).results[0].title,'Historia popular');
  const cached=await query('newest');assert.equal(cached.sources[0].cached,true);assert.equal(cached.nextPages.one,1);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.status==='completed'));
});
