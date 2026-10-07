import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../src/storage/database.js';
import { createApp } from '../src/backend/app.js';
import { filterSeries } from '../src/frontend/reader-core.js';
import { createSources } from '../src/extensions/catalog.js';

const favorite={source:'test',titulo:'Historia',url_origen:'https://example.com/series'};
const chapter=n=>({title:`Capítulo ${n}`,url:`https://example.com/chapter/${n}`,number:n});

test('migración v1 conserva favoritos, capítulos y progreso; versión actual se puede reabrir',()=>{
  const directory=mkdtempSync(join(tmpdir(),'reader-migration-'));const filename=join(directory,'reader.db');let database;
  try {
    const old=new Database(filename);old.exec(readFileSync(new URL('../src/storage/schema.sql',import.meta.url),'utf8'));
    old.exec("INSERT INTO Series(id,source,titulo,url_origen) VALUES(1,'test','Original','https://example.com/series'); INSERT INTO Chapters(id,serie_id,titulo,url_origen,numero,estado_lectura) VALUES(1,1,'Uno','https://example.com/chapter/1',1,1); INSERT INTO Progress(serie_id,capitulo_id,scroll_position_y,timestamp) VALUES(1,1,1200,123); PRAGMA user_version=1;");old.close();
    database=openDatabase(filename);assert.equal(database.listSeries()[0].titulo,'Original');assert.equal(database.getProgress(1).scroll_position_y,1200);assert.equal(database.getChapter(1).estado_lectura,1);
    database.saveChapters(1,[chapter(1),chapter(2)]);assert.equal(database.listUpdates().length,1);database.close();database=openDatabase(filename);assert.equal(database.getProgress(1).scroll_position_y,1200);
  } finally {database?.close();if(dirname(resolve(directory))!==resolve(tmpdir()))throw new Error('Ruta temporal inesperada');rmSync(directory,{recursive:true,force:true});}
});

test('novedades: primera sincronización sin falsos avisos; reintentos no duplican, progreso reconoce',()=>{
  const database=openDatabase(':memory:');try {
    const series=database.saveFavorite(favorite);database.saveChapters(series.id,[chapter(1)]);assert.deepEqual(database.listUpdates(),[]);
    const saved=database.saveChapters(series.id,[chapter(1),chapter(2)]);assert.equal(database.listUpdates()[0].numero,2);
    database.saveChapters(series.id,[chapter(1),chapter(2)]);assert.equal(database.listUpdates().length,1);
    assert.throws(()=>database.saveChapters(series.id,[chapter(3),{...chapter(4),number:NaN}]));assert.equal(database.listUpdates().length,1);
    database.updateProgress({serie_id:series.id,capitulo_id:saved[1].id,scroll_position_y:30});assert.equal(database.listUpdates().length,0);
  }finally{database.close();}
});

test('carpetas múltiples y metadatos: cambios atómicos, manual prevalece y quitar carpeta conserva series',()=>{
  const database=openDatabase(':memory:');try {
    const series=database.saveFavorite({...favorite,metadata:{genres:['Fantasy'],authors:['Autor'],status:'ongoing'}});
    const a=database.saveFolder('Favoritas'),b=database.saveFolder('Por leer');
    database.updateLibrary(series.id,{folder_ids:[a.id,b.id],reading_state:'reading',metadata:{genres:['Acción'],country:'KR'}});
    database.updateSourceMetadata(series.id,{genres:['Romance'],authors:['Nuevo autor']});
    assert.deepEqual(database.getSeries(series.id).genres,['Acción']);assert.deepEqual(database.getSeries(series.id).authors,['Nuevo autor']);
    assert.throws(()=>database.updateLibrary(series.id,{reading_state:'completed',folder_ids:[999]}),{code:'FOLDER_NOT_FOUND'});
    assert.equal(database.getSeries(series.id).reading_state,'reading');assert.equal(database.getSeries(series.id).folder_ids.length,2);
    assert.throws(()=>database.saveFolder('favoritas'),{code:'FOLDER_EXISTS'});
    database.removeFolder(a.id);assert.deepEqual(database.getSeries(series.id).folder_ids,[b.id]);assert.equal(database.listSeries().length,1);
    database.saveFolder('Pendientes',b.id);assert.equal(database.listFolders()[0].name,'Pendientes');
    assert.throws(()=>database.updateLibrary(series.id,{metadata:{country:'Corea'}}),{code:'INVALID_METADATA'});
    database.removeFavorite(series.id);assert.equal(database.listFolders()[0].count,0);
  }finally{database.close();}
});

test('filtros por autor, género, carpeta y estados distinguen desconocidos y publicación de lectura',()=>{
  const rows=[{id:1,titulo:'La historia',authors:['José Pérez'],genres:['Acción'],status:'ongoing',reading_state:'on_hold',folder_ids:[3],pendientes:2},
    {id:2,titulo:'Sin datos',authors:[],genres:[],reading_state:'planned',folder_ids:[],pendientes:0}];
  assert.deepEqual(filterSeries(rows,{query:'jose',genre:'accion',publication:'ongoing',reading:'on_hold',folder:'3'}).map(r=>r.id),[1]);
  assert.deepEqual(filterSeries(rows,{genre:'__unknown',publication:'unknown'}).map(r=>r.id),[2]);
  assert.equal(filterSeries(rows,{reading:'completed'}).length,0);
});

test('API: carpetas, organización y novedades se sirven sin imágenes persistidas',async t=>{
  const database=openDatabase(':memory:');const server=createServer(createApp({database}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}`;const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const series=database.saveFavorite(favorite);const folder=await(await fetch(base+'/api/folders',json('POST',{name:'Mis historias'}))).json();
  assert.ok(folder.id);const updated=await(await fetch(`${base}/api/series/${series.id}/library`,json('PUT',{folder_ids:[folder.id],metadata:{authors:['Autor'],status:'completed'},reading_state:'planned'}))).json();
  assert.equal(updated.status,'completed');assert.deepEqual(updated.folder_ids,[folder.id]);
  assert.equal((await fetch(base+'/api/folders',json('POST',{name:'Mis historias'}))).status,409);
  database.saveChapters(series.id,[chapter(1)]);database.saveChapters(series.id,[chapter(1),chapter(2)]);
  const updates=await(await fetch(base+'/api/updates')).json();assert.equal(updates.length,1);assert.equal(updates[0].coverUrl,null);
  assert.equal((await(await fetch(base+'/api/storage')).json()).persistentImages,false);
});

test('API de recomendaciones conserva carga diferida de fuentes, firma portadas y valida género',async t=>{
  let calls=0;
  class FixtureSource { async recommend(genre){calls++;assert.equal(genre,'Comedy');return {source:'mangadex',results:[{title:'Sugerencia',url:'https://example.com/title/2',cover:'https://example.com/cover.jpg',genres:['Comedy']}],nextPage:null};} }
  const sources=createSources([{id:'mangadex',name:'Prueba',baseUrl:'https://example.com/',imageOrigins:['https://example.com'],load:async()=>({default:FixtureSource})}]);
  const database=openDatabase(':memory:');const server=createServer(createApp({database,sources}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/sources/mangadex/recommendations')).status,400);assert.equal(calls,0);
  const result=await(await fetch(base+'/api/sources/mangadex/recommendations?genre=Comedy')).json();
  assert.equal(calls,1);assert.match(result.results[0].coverUrl,/^\/api\/image\?ticket=/);assert.deepEqual(result.results[0].genres,['Comedy']);
});
