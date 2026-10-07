import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../src/storage/database.js';
import {createApp} from '../src/backend/app.js';
import {createScraper} from '../src/extensions/catalog.js';
import {groupWorks,rankRecommendations,matchesDiscovery} from '../src/frontend/discovery-core.js';

const favorite=(source,title='Obra',url=`https://example.com/${source}`)=>({source,titulo:title,url_origen:url,metadata:{genres:['Fantasy'],themes:['Reincarnation'],authors:['Autora'],country:'KR'}});
const chapter=(n,suffix='')=>({title:`Capítulo ${n}`,number:n,url:`https://example.com/chapter/${n}${suffix}`});
test('migración v3 conserva IDs, anclas, estados y carpetas; gustos sobreviven al reabrir',()=>{
  const directory=mkdtempSync(join(tmpdir(),'reader-discovery-')),filename=join(directory,'reader.db');let database;
  try {
    const old=new Database(filename);try{for(const file of ['schema.sql','library-migration.sql','reader-migration.sql'])old.exec(readFileSync(new URL('../src/storage/'+file,import.meta.url),'utf8'));
    old.exec("INSERT INTO Series(id,source,titulo,url_origen,reading_state) VALUES(7,'test','Obra original','https://example.com/7','reading'); INSERT INTO Chapters(id,serie_id,titulo,url_origen,numero,estado_lectura) VALUES(9,7,'Dos','https://example.com/chapter/2',2,1); INSERT INTO Progress(serie_id,capitulo_id,scroll_position_y,timestamp,page_index,page_fraction) VALUES(7,9,750,123,4,.6); INSERT INTO Folders(id,name) VALUES(3,'Favoritas'); INSERT INTO SeriesFolders VALUES(7,3); PRAGMA user_version=3;");}finally{old.close();}
    database=openDatabase(filename);assert.equal(database.getSeries(7).work_id,7);assert.equal(database.getChapter(9).estado_lectura,1);assert.equal(database.getProgress(7).page_fraction,.6);assert.deepEqual(database.getSeries(7).folder_ids,[3]);
    database.updateWorkFeedback(7,{sentiment:'like',rating:9});database.saveDiscovery({genres:['Fantasía'],excludeThemes:['Isekai']});database.close();database=openDatabase(filename);
    assert.equal(database.getSeries(7).rating,9);assert.deepEqual(database.getDiscovery().preferences.excludeThemes,['Isekai']);assert.equal(database.getProgress(7).timestamp,123);
  }finally{database?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});}
});
test('vincular y separar fuentes conserva capítulos y progreso independientes; altas conflictivas son atómicas',()=>{
  const db=openDatabase(':memory:');try {
    const a=db.saveFavorite(favorite('a')),b=db.saveFavorite(favorite('b','Título alternativo'));
    const [c1]=db.saveChapters(a.id,[chapter(2)]),[c2]=db.saveChapters(b.id,[chapter(2,'-b')]);
    db.updateProgress({serie_id:a.id,capitulo_id:c1.id,scroll_position_y:500,page_index:3,page_fraction:.2});
    db.updateProgress({serie_id:b.id,capitulo_id:c2.id,scroll_position_y:20});
    db.updateWorkFeedback(a.work_id,{rating:8});db.linkSeries(a.work_id,b.id);
    assert.equal(groupWorks(db.listSeries()).length,1);assert.equal(db.getSeries(b.id).rating,8);assert.equal(db.getProgress(a.id).page_index,3);assert.equal(db.getProgress(b.id).scroll_position_y,20);
    db.updateLibrary(b.id,{reading_state:'abandoned'});assert.equal(db.getSeries(a.id).reading_state,'abandoned');
    const separated=db.unlinkSeries(b.id);assert.notEqual(separated.id,a.work_id);assert.equal(db.getSeries(b.id).rating,8);assert.equal(db.listChapters(b.id)[0].id,c2.id);
    assert.throws(()=>db.saveFavorite({...favorite('b','NO sobrescribir'),work_id:a.work_id}),{code:'WORK_CONFLICT'});assert.equal(db.getSeries(b.id).titulo,'Título alternativo');
    assert.throws(()=>db.saveFavorite({...favorite('missing'),work_id:999}),{code:'WORK_NOT_FOUND'});assert.equal(db.listSeries().length,2);
  }finally{db.close();}
});
test('gustos y filtros se validan; deshacer/reiniciar no borra biblioteca ni progreso',()=>{
  const db=openDatabase(':memory:');try {
    const a=db.saveFavorite(favorite('a')),[c]=db.saveChapters(a.id,[chapter(1)]);db.updateProgress({serie_id:a.id,capitulo_id:c.id,scroll_position_y:15});
    db.updateWorkFeedback(a.work_id,{sentiment:'like',rating:10});assert.throws(()=>db.updateWorkFeedback(a.work_id,{rating:11}),{code:'INVALID_FEEDBACK'});assert.equal(db.getSeries(a.id).rating,10);
    assert.throws(()=>db.saveDiscovery({minChapters:'30'}),{code:'INVALID_PREFERENCES'});
    const item={source:'mangadex',title:'Nueva',url:'https://example.com/new',genres:['Fantasy'],themes:['Reincarnation']};db.saveRecommendationFeedback(item,{hidden:true});assert.equal(db.getDiscovery().feedback[0].hidden,true);
    db.removeRecommendationFeedback('mangadex|https://example.com/new');assert.equal(db.getDiscovery().feedback.length,0);
    db.saveRecommendationFeedback(item,{more_like:true});const saved=db.saveFavorite({source:item.source,titulo:item.title,url_origen:item.url});assert.equal(saved.more_like,true);assert.equal(db.getDiscovery().feedback.length,0);
    db.resetDiscovery();assert.equal(db.getSeries(a.id).rating,undefined);assert.equal(db.getProgress(a.id).scroll_position_y,15);assert.equal(db.listSeries().length,2);
  }finally{db.close();}
});
test('recomendaciones combinan etiquetas bilingües, respetan exclusiones y no repiten obras por alias',()=>{
  const library=[{id:1,work_id:1,source:'a',titulo:'Leída',genres:['Acción'],themes:['Reencarnación'],sentiment:'like',rating:9}];
  const candidate=(title,genres=['Action'],themes=['Reincarnation'])=>({source:'mangadex',title,url:'https://example.com/'+title,genres,themes,country:'KR',status:'completed',verified_chapters:35});
  const all=[candidate('Similar'),candidate('Distinta',['Romance'],[]),{...candidate('Otro nombre'),altTitles:['Leída']},candidate('Oculta'),candidate('Terror',['Action','Horror'])];
  const ranked=rankRecommendations(all,{library,feedback:[{...candidate('Oculta'),hidden:true}],filters:{excludeGenres:['Terror']}});
  assert.deepEqual(ranked.map(i=>i.title),['Similar']);assert.match(ranked[0].reason,/Porque te gustó Leída/);
  assert.equal(matchesDiscovery(all[0],{genres:['Acción'],themes:['Reencarnación'],country:'KR',status:'completed',minChapters:30}),true);
  assert.equal(matchesDiscovery({...all[0],verified_chapters:undefined},{minChapters:30}),false);
  assert.equal(matchesDiscovery(all[0],{excludeThemes:['Reencarnación']}),false);
  const abandoned=[{...library[0],reading_state:'abandoned'}];assert.deepEqual(rankRecommendations([all[0]],{library:abandoned}),[]);
});
test('MangaDex traduce filtros a etiquetas, idioma y origen sin relajar etiquetas desconocidas',async()=>{
  const queries=[];
  const scraper=await createScraper('mangadex',{maxRetries:0,fetchImpl:async value=>{const url=new URL(value);queries.push(url);return new Response(JSON.stringify(url.pathname==='/manga/tag'?{result:'ok',data:[{id:'action',attributes:{group:'genre',name:{en:'Action'}}},{id:'rebirth',attributes:{group:'theme',name:{en:'Reincarnation'}}},{id:'horror',attributes:{group:'genre',name:{en:'Horror'}}}]}:{result:'ok',data:[]}),{headers:{'Content-Type':'application/json'}});}});
  await scraper.recommend({genres:['Acción'],themes:['Reencarnación'],excludeGenres:['Terror'],country:'KR',status:'completed'});
  const query=queries.at(-1);assert.deepEqual(query.searchParams.getAll('includedTags[]'),['action','rebirth']);assert.deepEqual(query.searchParams.getAll('excludedTags[]'),['horror']);assert.deepEqual(query.searchParams.getAll('availableTranslatedLanguage[]'),['es','es-la']);assert.equal(query.searchParams.get('originalLanguage[]'),'ko');assert.equal(query.searchParams.get('status[]'),'completed');
  const length=queries.length,result=await scraper.recommend({themes:['Una etiqueta inexistente']});assert.equal(queries.length,length+1);assert.equal(result.results.length,0);assert.equal(result.unavailableTags.length,1);
  const manga=scraper.manga({id:'11111111-1111-4111-8111-111111111111',attributes:{title:{en:'Original'},altTitles:[{es:'Alternativo'},{en:'Other'}],originalLanguage:'ko',tags:[{attributes:{group:'theme',name:{en:'Reincarnation'}}}]}});
  assert.deepEqual(manga.altTitles,['Alternativo','Other']);assert.equal(manga.country,'KR');assert.deepEqual(manga.themes,['Reincarnation']);
});
test('ManhwaWeb separa géneros y temas y conserva títulos alternativos para descubrir obras leídas',async()=>{
  const scraper=await createScraper('manhwaweb');
  const manga=scraper.manga({real_id:'novela',name_esp:'El Extra',_categoris:[{'3':'Accion'},{'39':'Artes Marciales'},{'41':'Reencarnacion'}],_tipo:'manhwa',_status:'publicandose',autor:['Autora'],others_name:['The Novel’s Extra | Extra in the Novel']});
  assert.deepEqual(manga.genres,['Accion']);assert.deepEqual(manga.themes,['Artes Marciales','Reencarnacion']);assert.deepEqual(manga.authors,['Autora']);assert.equal(manga.country,'KR');assert.equal(manga.status,'ongoing');assert.deepEqual(manga.altTitles,['The Novel’s Extra','Extra in the Novel']);
});
async function fixture(t,results=[],scraperOverrides={}) {
  const database=openDatabase(':memory:');const source={id:'mangadex',name:'MangaDex de prueba',baseUrl:'https://example.com/',pageOrigin:'https://example.com',imageOrigins:['https://example.com'],enabled:true,capabilities:{search:true,manga:true,chapters:true,images:true},scraper:{recommend:async()=>({results}),getChapters:async url=>({chapters:[chapter(1,url),chapter(1,url+'alternate'),chapter(2,url)]}),...scraperOverrides}};
  const server=createServer(createApp({database,sources:new Map([['mangadex',source],['other',{...source,id:'other'}]]),logger:{warn(){},error(){}}}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));database.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  return {database,request:(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})};
}
test('API comprueba capítulos únicos para el mínimo, descarta leídos y rechaza feedback de otro origen',async t=>{
  const candidates=[{source:'mangadex',title:'Nueva',url:'https://example.com/new',genres:['Fantasy'],themes:['Reincarnation'],cover:'https://example.com/cover.png'}];
  const {database,request}=await fixture(t,candidates);database.saveFavorite(favorite('other'));
  let response=await request('/api/discovery/recommendations','POST',{filters:{minChapters:3}});assert.equal(response.status,200);assert.equal((await response.json()).results.length,0);
  response=await request('/api/discovery/recommendations','POST',{filters:{minChapters:2}});const result=await response.json();assert.equal(result.results[0].verified_chapters,2);assert.match(result.results[0].coverUrl,/^\/api\/image\?ticket=/);
  assert.equal((await request('/api/discovery/feedback','POST',{item:{...candidates[0],url:'https://evil.invalid/'},feedback:{hidden:true}})).status,403);
  await request('/api/discovery/feedback','POST',{item:candidates[0],feedback:{already_read:true}});assert.equal((await(await request('/api/discovery/recommendations','POST',{})).json()).results.length,0);
  assert.equal((await request('/api/discovery/recommendations','POST',{mode:'similar'})).status,400);
  for(const path of ['/discovery-ui.js','/discovery-core.js','/discovery.css'])assert.equal((await request(path)).status,200);
});
test('API transferencia exige correspondencia única y empieza al inicio conservando la lectura anterior',async t=>{
  const {database:db,request}=await fixture(t);const a=db.saveFavorite(favorite('mangadex')),b=db.saveFavorite(favorite('other'));db.linkSeries(a.work_id,b.id);
  const [from]=db.saveChapters(a.id,[chapter(2)]);db.updateProgress({serie_id:a.id,capitulo_id:from.id,scroll_position_y:500,page_index:6,page_fraction:.7});
  assert.equal((await request(`/api/works/${a.work_id}/transfer`,'POST',{from:a.id,to:b.id})).status,409);assert.equal(db.getProgress(b.id),null);
  db.saveChapters(b.id,[chapter(2,'other'),chapter(2,'alternate')]);assert.equal((await request(`/api/works/${a.work_id}/transfer`,'POST',{from:a.id,to:b.id})).status,409);
  const c=db.saveFavorite({...favorite('other','Tercera','https://example.com/third'),work_id:a.work_id});const [to]=db.saveChapters(c.id,[chapter(2,'third')]);
  const preview=await(await request(`/api/works/${a.work_id}/transfer?from=${a.id}&to=${c.id}`)).json();assert.equal(preview.canTransfer,true);assert.equal(db.getProgress(c.id),null);
  const response=await request(`/api/works/${a.work_id}/transfer`,'POST',{from:a.id,to:c.id});assert.equal(response.status,200);assert.equal(db.getProgress(c.id).capitulo_id,to.id);assert.equal(db.getProgress(c.id).page_index,0);assert.equal(db.getProgress(a.id).page_index,6);assert.equal(db.getChapter(to.id).estado_lectura,0);
});
test('API completa etiquetas de lecturas antiguas en memoria sin sobrescribir SQLite ni metadatos manuales',async t=>{
  let calls=0;const candidates=[{source:'mangadex',title:'Nueva',url:'https://example.com/new',genres:['Action'],themes:['Reincarnation']}];
  const {database:db,request}=await fixture(t,candidates,{getManga:async()=>{calls++;return {manga:{genres:['Accion'],themes:['Reencarnacion']}};}});
  const row=db.saveFavorite({source:'other',titulo:'Antigua',url_origen:'https://example.com/old'});db.updateWorkFeedback(row.work_id,{sentiment:'like'});
  const result=await(await request('/api/discovery/recommendations','POST',{mode:'personal'})).json();assert.equal(result.personalized,true);assert.match(result.results[0].reason,/Porque te gustó Antigua/);assert.equal(db.getSeries(row.id).genres,undefined);
  await request('/api/discovery/recommendations','POST',{mode:'personal'});assert.equal(calls,1);
  db.updateLibrary(row.id,{metadata:{genres:[],themes:[]}});
  const manual=await(await request('/api/discovery/recommendations','POST',{mode:'personal'})).json();assert.equal(manual.personalized,false);assert.deepEqual(db.getSeries(row.id).themes,[]);
});
