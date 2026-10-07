import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/storage/database.js';
import { createApp } from '../src/backend/app.js';
import { createPrivateAccess } from '../src/backend/privacy.js';
import { createImageTickets } from '../src/backend/imageTickets.js';
import { createScraper } from '../src/extensions/catalog.js';
import { inLibraryScope } from '../src/frontend/content-policy.js';
import { matchesDiscovery } from '../src/frontend/discovery-core.js';

const favorite=(title='Visible',extra={})=>({source:'test',titulo:title,url_origen:`https://source.test/${encodeURIComponent(title)}`,portada:'https://images.test/cover.jpg',...extra});
const json=(method,body,headers={})=>({method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function serve(t,database,sources,tickets=createImageTickets()) {
  const server=createServer(createApp({database,sources,tickets,logger:{warn(){},error(){}}}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
  return `http://127.0.0.1:${server.address().port}`;
}
const source=(extra={})=>({id:'test',name:'Prueba',pageOrigin:'https://source.test',imageOrigins:['https://images.test'],capabilities:{search:true,manga:true,chapters:true,images:true,recommend:true,adult:true},scraper:{recommend:async()=>({results:[]}),search:async()=>({results:[]}),getManga:async url=>({manga:{title:'Detalle',url}}),getChapters:async()=>({chapters:[]}),getChapterImages:async()=>({chapter:{title:'Capítulo'},images:[]})},...extra});

test('migración v4: clasificación, favoritos y progreso intactos al reabrir',()=>{
  const directory=mkdtempSync(join(tmpdir(),'reader-private-')),filename=join(directory,'reader.db');let db;
  try {
    const old=new Database(filename);
    for(const file of ['schema.sql','library-migration.sql','reader-migration.sql','discovery-migration.sql'])old.exec(readFileSync(new URL('../src/storage/'+file,import.meta.url),'utf8'));
    old.prepare('INSERT INTO Series(id,source,titulo,url_origen,metadata_json) VALUES(1,?,?,?,?)').run('test','Conservada','https://source.test/a',JSON.stringify({contentRating:'erotica'}));
    old.exec("INSERT INTO Works(id,title) VALUES(1,'Conservada'); UPDATE Series SET work_id=1; INSERT INTO Chapters(id,serie_id,titulo,url_origen,numero,estado_lectura) VALUES(3,1,'Uno','https://source.test/1',1,1); INSERT INTO Progress(serie_id,capitulo_id,scroll_position_y,timestamp,page_index,page_fraction) VALUES(1,3,123,44,2,.5); PRAGMA user_version=4;");old.close();
    db=openDatabase(filename);assert.equal(db.getSeries(1).is_adult,1);assert.equal(db.getSeries(1).is_private,0);assert.equal(db.getProgress(1).page_index,2);assert.equal(db.getChapter(3).estado_lectura,1);assert.equal(db.listVisibleSeries().length,1);
    db.updateLibrary(1,{is_private:true});db.close();db=openDatabase(filename);assert.equal(db.listVisibleSeries('private').length,1);assert.equal(db.getProgress(1).scroll_position_y,123);
  }finally{db?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});}
});

test('privacidad por obra: herencia, vincular, separar y clasificación manual sobreviven al sincronizar',()=>{
  const db=openDatabase(':memory:');try {
    const a=db.saveFavorite(favorite('A')),b=db.saveFavorite(favorite('B'));db.updateLibrary(a.id,{is_private:true,is_adult:true});db.linkSeries(b.work_id,a.id);
    assert.ok(db.getWork(b.work_id).editions.every(e=>e.is_private&&e.is_adult));
    const c=db.saveFavorite(favorite('C',{work_id:b.work_id}));assert.equal(c.is_private,1);assert.equal(c.is_adult,1);
    db.updateLibrary(a.id,{is_adult:false});for(const item of db.listSeries())db.updateSourceMetadata(item.id,{contentRating:'erotica'});
    assert.ok(db.listSeries().every(e=>e.is_adult===0));db.unlinkSeries(c.id);assert.equal(db.getSeries(c.id).is_private,1);
    assert.throws(()=>db.updateLibrary(c.id,{is_private:'false'}),{code:'INVALID_FIELD'});
    assert.equal(inLibraryScope(db.getSeries(c.id),'library'),false);assert.equal(inLibraryScope(db.getSeries(c.id),'private'),true);
  }finally{db.close();}
});

test('PIN: hash con sal, caducidad, límite de intentos y cambio invalida sesiones',()=>{
  const db=openDatabase(':memory:');try {
    let now=1,cookie='';const access=createPrivateAccess(db,{now:()=>now,idleMs:1000}),req={socket:{localPort:1234},headers:{}},res={set(name,value){cookie=value.split(';')[0];}};
    access.setup(req,res,'2468');assert.match(cookie,/lector_private_1234=/);assert.notEqual(db.getPrivateAccess().pin_hash,'2468');assert.equal(db.getPrivateAccess().salt.length,32);
    req.headers.cookie=cookie;assert.equal(access.status(req).unlocked,true);now+=1001;assert.equal(access.status(req).unlocked,false);
    for(let i=0;i<5;i++)assert.throws(()=>access.unlock(req,res,'0000'),{code:'INVALID_PIN'});
    assert.throws(()=>access.unlock(req,res,'2468'),{code:'PIN_RATE_LIMIT'});now+=60001;access.unlock(req,res,'2468');req.headers.cookie=cookie;
    access.change(req,'1357');assert.equal(access.status(req).unlocked,false);assert.throws(()=>access.unlock(req,res,'2468'),{code:'INVALID_PIN'});access.unlock(req,res,'1357');
  }finally{db.close();}
});

test('API bloquea lecturas privadas, capítulos, obras, progreso y tickets emitidos antes de ocultar',async t=>{
  const db=openDatabase(':memory:'),saved=db.saveFavorite(favorite('Secreta')),[chapter]=db.saveChapters(saved.id,[{title:'Uno',number:1,url:'https://source.test/chapter'}]);
  const api=await serve(t,db,new Map([['test',source()]]));
  const cover=(await(await fetch(api+'/api/series')).json())[0].coverUrl;
  const setup=await fetch(api+'/api/private/setup',json('POST',{pin:'2468'}));assert.equal(setup.status,200);assert.match(setup.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const cookie=setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(api+`/api/series/${saved.id}/library`,json('PUT',{is_private:true},{Cookie:cookie}))).status,200);
  assert.deepEqual(await(await fetch(api+'/api/series')).json(),[]);
  assert.equal((await fetch(api+'/api/series?scope=private')).status,423);
  assert.equal((await fetch(api+`/api/works/${saved.work_id}`)).status,423);
  for(const path of [`/api/series/${saved.id}/chapters`,`/api/series/${saved.id}/progress`,`/api/chapters/${chapter.id}/images`,cover])assert.equal((await fetch(api+path)).status,423,path);
  assert.equal((await fetch(api+'/api/progress',json('POST',{serie_id:saved.id,capitulo_id:chapter.id,scroll_position_y:10}))).status,423);
  assert.equal((await fetch(api+'/api/series',json('POST',favorite('Secreta')))).status,423);
  assert.equal((await fetch(api+`/api/series/${saved.id}`,{method:'DELETE'})).status,423);
  const visible=await(await fetch(api+'/api/series?scope=private',{headers:{Cookie:cookie}})).json();assert.equal(visible[0].titulo,'Secreta');assert.equal((await fetch(api+`/api/series/${saved.id}/chapters`,{headers:{Cookie:cookie}})).status,200);
  await fetch(api+'/api/private/lock',json('POST',{}, {Cookie:cookie}));assert.equal((await fetch(api+'/api/series?scope=private',{headers:{Cookie:cookie}})).status,423);
  assert.equal((await fetch(api+'/api/private/pin',json('PUT',{pin:'1357'},{Cookie:cookie}))).status,423);
  assert.equal(db.getChapter(chapter.id).serie_id,saved.id);
});

test('listas y recomendaciones públicas excluyen privadas, +18, alias y gustos ocultos',async t=>{
  const db=openDatabase(':memory:'),hidden=db.saveFavorite(favorite('Oculta',{metadata:{genres:['Horror'],altTitles:['Alias privado']}})),adult=db.saveFavorite(favorite('Adulta',{metadata:{contentRating:'erotica'}})),publicItem=db.saveFavorite(favorite('Visible',{metadata:{genres:['Fantasy']}}));
  db.updateLibrary(hidden.id,{is_private:true});db.updateWorkFeedback(hidden.work_id,{sentiment:'like'});
  for(const s of [hidden,adult,publicItem]){const c={title:'Uno',number:1,url:s.url_origen+'/1'};db.saveChapters(s.id,[c]);db.saveChapters(s.id,[c,{title:'Dos',number:2,url:s.url_origen+'/2'}]);}
  const folder=db.saveFolder('Todo');db.updateLibrary(hidden.id,{folder_ids:[folder.id]});db.updateLibrary(publicItem.id,{folder_ids:[folder.id]});assert.equal(db.listFolders()[0].count,1);assert.equal(db.listUpdates().length,1);
  const item=(title,extra={})=>({title,url:'https://source.test/'+encodeURIComponent(title),genres:['Fantasy'],...extra}),calls=[];
  const scraper={...source().scraper,recommend:async filters=>{calls.push(filters);return {results:[item('Nueva'),item('Alias privado'),item('Fuera',{contentRating:'pornographic'})]};}};
  db.saveRecommendationFeedback({source:'test',...item('Alias privado')},{sentiment:'like'});
  const api=await serve(t,db,new Map([['test',source({scraper})]]));
  assert.equal((await(await fetch(api+'/api/discovery')).json()).feedback.length,0);
  const result=await(await fetch(api+'/api/discovery/recommendations',json('POST',{}))).json();assert.deepEqual(result.results.map(r=>r.title),['Nueva']);assert.ok(!calls.some(c=>c.genres.includes('horror')));
  assert.equal((await fetch(api+'/api/discovery/recommendations',json('POST',{mode:'similar',seedWorkId:hidden.work_id}))).status,403);
  assert.deepEqual((await(await fetch(api+'/api/series?scope=adult')).json()).map(s=>s.titulo),['Adulta']);assert.equal((await fetch(api+'/api/series?scope=all')).status,400);
});

test('catálogo +18 mezcla fuentes, filtra clasificación y conserva resultados ante fallo parcial',async t=>{
  const db=openDatabase(':memory:'),calls=[];
  const sources=new Map(['a','b','broken'].map(id=>[id,source({id,name:id,scraper:{...source().scraper,recommend:async filters=>{calls.push({id,filters});if(id==='broken')throw Error('Sin conexión');return {results:[{title:id,url:'https://source.test/'+id,contentRating:'adult'},{title:'Segura',url:'https://source.test/safe',contentRating:'safe'}]};},search:async(query,options)=>({results:[{title:query,url:'https://source.test/'+id,contentRating:'erotica'}],nextPage:options.page+1})}})]));
  const api=await serve(t,db,sources);const response=await fetch(api+'/api/adult/catalog',json('POST',{}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.sources.reduce((n,s)=>n+s.results.length,0),2);assert.ok(calls.every(c=>c.filters.adult===true));assert.match(result.sources[2].error,/Sin conexión/);
  const searched=await(await fetch(api+'/api/adult/catalog',json('POST',{source:'a',query:'Consulta',page:2}))).json();assert.equal(searched.sources[0].nextPage,3);assert.equal((await fetch(api+'/api/adult/catalog',json('POST',{page:-1}))).status,400);
});

test('MangaDex y ManhwaWeb separan clasificación adulta en consultas normales y +18',async()=>{
  const urls=[];const md=await createScraper('mangadex',{maxRetries:0,fetchImpl:async input=>{urls.push(new URL(input));return new Response(JSON.stringify({result:'ok',data:[],total:0,offset:0}),{headers:{'Content-Type':'application/json'}});}});
  await md.search('prueba');await md.search('prueba',{adult:true});assert.deepEqual(urls[0].searchParams.getAll('contentRating[]'),['safe','suggestive']);assert.deepEqual(urls[1].searchParams.getAll('contentRating[]'),['erotica','pornographic']);
  const mw=await createScraper('manhwaweb',{maxRetries:0,fetchImpl:async input=>{urls.push(new URL(input));return new Response(JSON.stringify({data:[{real_id:'work',name_esp:'Obra',_erotico:'si'}]}),{headers:{'Content-Type':'application/json'}});}});
  assert.equal((await mw.recommend({adult:true})).results[0].contentRating,'adult');assert.equal(urls.at(-1).searchParams.get('erotico'),'si');assert.equal((await mw.recommend()).results.length,0);assert.equal(urls.at(-1).searchParams.get('erotico'),'no');
});

test('género +18: recomendaciones usan dos proveedores adultos, combinan géneros y no crean sección',async t=>{
  const db=openDatabase(':memory:'),calls=[];
  const sources=new Map(['a','b','general'].map(id=>[id,source({id,capabilities:{recommend:true,adult:id!=='general'},scraper:{...source().scraper,recommend:async filters=>{calls.push({id,filters});return {results:[{title:id,url:'https://source.test/'+id,contentRating:'adult',genres:['Romance']},{title:'Segura',url:'https://source.test/safe',contentRating:'safe',genres:['Romance']}]};}}})]));
  const api=await serve(t,db,sources),result=await(await fetch(api+'/api/discovery/recommendations',json('POST',{mode:'genres',filters:{genres:['+18','Romance'],genreMatch:'all'}}))).json();
  assert.deepEqual(new Set(result.results.map(i=>i.source)),new Set(['a','b']));assert.ok(calls.every(c=>c.filters.adult&&!c.filters.genres.includes('adult')&&!c.filters.genres.includes('+18')));
  assert.equal(matchesDiscovery({contentRating:'safe',genres:['Romance']},{genres:['+18','Romance'],genreMatch:'any'}),false);
  assert.equal(matchesDiscovery({contentRating:'adult',genres:['Action']},{genres:['+18','Romance'],genreMatch:'any'}),false);
  assert.equal(matchesDiscovery({contentRating:'adult',genres:['Romance']},{genres:['+18','Romance'],genreMatch:'any'}),true);
  const html=await(await fetch(api+'/')).text();assert.ok(html.includes('id="search-genre"'));assert.ok(html.includes('id="show-private"'));assert.ok(!html.includes('id="show-adult"'));assert.ok(!html.includes('id="adult-panel"'));
});
