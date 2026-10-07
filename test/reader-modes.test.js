import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../src/storage/database.js';
import { createApp } from '../src/backend/app.js';
import { normalizeReaderPreferences,pageStep,readingWindow,savedPageAnchor } from '../src/frontend/reader-preferences.js';

test('precarga prioriza visibles, limita futuras a 3–5 y retiene dos anteriores sin reordenar páginas',()=>{
  assert.deepEqual(readingWindow(72,30,31,4),{load:[30,31,32,33,34,35],retain:[30,31,32,33,34,35,29,28]});
  assert.deepEqual(readingWindow(72,71,71,5),{load:[71],retain:[71,70,69]});
  assert.deepEqual(readingWindow(2,0,0,3),{load:[0,1],retain:[0,1]});
  assert.equal(readingWindow(72,0,0,100).load.length,6);
  assert.deepEqual(readingWindow(0,0,0),{load:[],retain:[]});
  assert.equal(pageStep('ArrowLeft','rtl'),1);assert.equal(pageStep('ArrowRight','rtl'),-1);
  assert.equal(pageStep('ArrowRight','ltr'),1);assert.equal(pageStep('ArrowLeft','ltr'),-1);
});

test('anclas descartan copia local antigua, respetan página cero y se acotan si cambia el capítulo',()=>{
  const server={page_index:0,page_fraction:.4,timestamp:10000};
  assert.deepEqual(savedPageAnchor({anchor:{index:5,fraction:.8},timestamp:100},server,72),{index:0,fraction:.4});
  assert.deepEqual(savedPageAnchor({anchor:{index:90,fraction:.8},timestamp:11000},server,72),{index:71,fraction:.8});
  assert.equal(savedPageAnchor(null,{scroll_position_y:4000,timestamp:100},72),null);
  assert.equal(savedPageAnchor({anchor:{index:-1},timestamp:100},null,72),null);
  const options=normalizeReaderPreferences({mode:'invalid',brightness:0,zoom:Infinity,prefetch:2,warmth:500});
  assert.equal(options.mode,'vertical');assert.equal(options.brightness,35);assert.equal(options.zoom,100);
  assert.equal(options.prefetch,3);assert.equal(options.warmth,70);
});

test('migración v2 a v3 conserva datos y ancla opcional persiste al reabrir SQLite',()=>{
  const directory=mkdtempSync(join(tmpdir(),'reader-modes-')),filename=join(directory,'reader.db');let database;
  try {
    const old=new Database(filename);
    old.exec(readFileSync(new URL('../src/storage/schema.sql',import.meta.url),'utf8'));
    old.exec(readFileSync(new URL('../src/storage/library-migration.sql',import.meta.url),'utf8'));
    old.exec("INSERT INTO Series(id,source,titulo,url_origen) VALUES(1,'test','Conservada','https://example.com/series'); INSERT INTO Chapters(id,serie_id,titulo,url_origen,estado_lectura) VALUES(1,1,'Uno','https://example.com/chapter',1); INSERT INTO Progress(serie_id,capitulo_id,scroll_position_y,timestamp) VALUES(1,1,4500,123); INSERT INTO Folders(id,name) VALUES(1,'Favoritas'); INSERT INTO SeriesFolders(serie_id,folder_id) VALUES(1,1); PRAGMA user_version=2;");old.close();
    database=openDatabase(filename);
    assert.equal(database.getProgress(1).scroll_position_y,4500);assert.equal(database.getProgress(1).page_index,null);
    assert.equal(database.getChapter(1).estado_lectura,1);assert.deepEqual(database.getSeries(1).folder_ids,[1]);
    database.updateProgress({serie_id:1,capitulo_id:1,scroll_position_y:4500,page_index:8,page_fraction:.35});
    database.close();database=openDatabase(filename);assert.equal(database.getProgress(1).page_index,8);assert.equal(database.getProgress(1).page_fraction,.35);
    for(const patch of [{page_index:-1,page_fraction:0},{page_index:1.5,page_fraction:0},{page_index:0,page_fraction:2},{page_index:0,page_fraction:null}]) {
      assert.throws(()=>database.updateProgress({serie_id:1,capitulo_id:1,scroll_position_y:0,...patch}),{code:'INVALID_PAGE_ANCHOR'});
    }
    assert.equal(database.getProgress(1).page_index,8);
  }finally{database?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});}
});

test('API guarda ancla en POST y PUT; clientes antiguos no conservan anclas obsoletas',async t=>{
  const database=openDatabase(':memory:');const server=createServer(createApp({database}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
  const series=database.saveFavorite({source:'test',titulo:'Test',url_origen:'https://example.com/series'});
  const [chapter]=database.saveChapters(series.id,[{title:'Uno',number:1,url:'https://example.com/chapter'}]);
  const base=`http://127.0.0.1:${server.address().port}`;
  const body={serie_id:series.id,capitulo_id:chapter.id,scroll_position_y:400,page_index:3,page_fraction:.6};
  const send=(path,method,value)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  let result=await send('/api/progress','POST',body);assert.equal(result.status,200);assert.equal((await result.json()).page_index,3);
  result=await send(`/api/series/${series.id}/progress`,'PUT',{...body,page_index:4});assert.equal((await result.json()).page_index,4);
  result=await send('/api/progress','POST',{...body,page_fraction:'0.5'});assert.equal(result.status,400);assert.equal(database.getProgress(series.id).page_index,4);
  result=await send('/api/progress','POST',{serie_id:series.id,capitulo_id:chapter.id,scroll_position_y:500});assert.equal(result.status,200);assert.equal((await result.json()).page_index,null);
  for(const path of ['/reader-controls.js','/reader-preferences.js','/reader-controls.css'])assert.equal((await fetch(base+path)).status,200);
});
