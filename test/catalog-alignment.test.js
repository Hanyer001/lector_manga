import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../src/storage/database.js';
import {createApp} from '../src/backend/app.js';
import {chapterNumber,orderedChapters} from '../src/frontend/chapter-order.js';
import {equivalentChapter} from '../src/frontend/discovery-core.js';
import {catalogRouteHash,parseCatalogRoute} from '../src/frontend/catalog-route.js';
import {readCatalogHealth,recordCatalogHealth} from '../src/frontend/catalog-health.js';
const chapter=(title,number,url)=>({title,number,url:'https://example.com/'+url});

test('alineación manual conserva originales, ordena decimales y sobrevive a sincronizar y exportar',()=>{
  const db=openDatabase(':memory:'),copy=openDatabase(':memory:');
  try{
    const row=db.saveFavorite({source:'test',titulo:'Obra',url_origen:'https://example.com/work'});
    const items=[chapter('Capítulo 1',1,'one'),chapter('Prólogo',null,'prologue'),chapter('Extra',null,'extra')];
    const saved=db.saveChapters(row.id,items),prologue=saved.find(item=>item.titulo==='Prólogo'),extra=saved.find(item=>item.titulo==='Extra');
    const alignment=[{url:prologue.url_origen,number:0},{url:extra.url_origen,number:1.5}];
    db.updateProgress({serie_id:row.id,capitulo_id:extra.id,scroll_position_y:42});
    db.updateLibrary(row.id,{metadata:{chapterAlignment:alignment}});
    assert.deepEqual(db.listChapters(row.id).map(chapterNumber),[0,1,1.5]);
    assert.equal(db.getChapter(prologue.id).numero,null);assert.equal(db.getChapter(prologue.id).titulo,'Prólogo');
    assert.equal(db.getProgress(row.id).scroll_position_y,42);
    db.updateSourceMetadata(row.id,{chapterAlignment:[],genres:['Action']});
    assert.deepEqual(db.getSeries(row.id).chapterAlignment,alignment);
    assert.deepEqual(db.saveChapters(row.id,items).map(chapterNumber),[0,1,1.5]);
    copy.importLibrary(db.exportLibrary());assert.deepEqual(copy.listChapters(copy.listSeries()[0].id).map(chapterNumber),[0,1,1.5]);
    db.resetDiscovery();assert.equal(db.getChapter(extra.id).aligned_number,1.5);
    db.updateLibrary(row.id,{metadata:{chapterAlignment:[]}});assert.equal(db.getChapter(extra.id).aligned_number,undefined);
    assert.deepEqual(orderedChapters([{numero:10},{numero:1,aligned_number:11},{numero:2}]).map(chapterNumber),[2,10,11]);
  }finally{db.close();copy.close();}
});

test('alineación rechaza ajustes ajenos e inválidos y no decide ante duplicados',()=>{
  const db=openDatabase(':memory:');try{
    const row=db.saveFavorite({source:'test',titulo:'Obra',url_origen:'https://example.com/work'});
    db.saveChapters(row.id,[chapter('1',1,'one')]);
    for(const entries of [[{url:'https://example.com/foreign',number:0}],[{url:'https://example.com/one',number:-1}],[{url:'https://example.com/one',number:NaN}],[{url:'javascript:x',number:0}],[{url:'https://example.com/one',number:0},{url:'https://example.com/one',number:1}]])assert.throws(()=>db.updateLibrary(row.id,{metadata:{chapterAlignment:entries}}));
    assert.deepEqual(db.getSeries(row.id).chapterAlignment,undefined);
    assert.equal(equivalentChapter([{numero:1,aligned_number:0},{numero:0}],0).ambiguous,true);
  }finally{db.close();}
});

test('transferencia entre fuentes usa numeración común sin tocar el progreso de origen',async t=>{
  const db=openDatabase(':memory:'),a=db.saveFavorite({source:'a',titulo:'Obra',url_origen:'https://example.com/a'}),b=db.saveFavorite({source:'b',titulo:'Obra B',url_origen:'https://example.com/b'});
  db.linkSeries(a.work_id,b.id);
  const [from]=db.saveChapters(a.id,[chapter('Capítulo 1.5',1.5,'a/one')]),[to]=db.saveChapters(b.id,[chapter('Prólogo',null,'b/prologue')]);
  db.updateLibrary(b.id,{metadata:{chapterAlignment:[{url:to.url_origen,number:1.5}]}});db.updateProgress({serie_id:a.id,capitulo_id:from.id,scroll_position_y:80});
  const server=createServer(createApp({database:db,sources:new Map(),logger:{warn(){},error(){}}}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/works/${a.work_id}/transfer`;
  const info=await (await fetch(url+`?from=${a.id}&to=${b.id}`)).json();assert.equal(info.chapter.id,to.id);assert.equal(info.number,1.5);assert.equal(db.getProgress(b.id),null);
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:a.id,to:b.id})});assert.equal(response.status,200);assert.equal(db.getProgress(b.id).capitulo_id,to.id);assert.equal(db.getProgress(a.id).scroll_position_y,80);
});

test('rutas de catálogos conservan filtros, búsqueda y selección vacía sin guardar datos privados',()=>{
  const search={q:'Una historia & acción',source:'selected',genre:'adult',sources:[]};assert.deepEqual(parseCatalogRoute(catalogRouteHash('explore',search)).filters,search);
  const discover={genres:['action','fantasy'],themes:['magic'],excludeGenres:['horror'],sources:['mangadex'],mode:'genres',collection:'newest',country:'KR',status:'completed',minChapters:12,genreMatch:'all',onlyNew:true,q:'Dragón',sort:'title',source:'mangadex'};
  assert.deepEqual(parseCatalogRoute(catalogRouteHash('discover',discover)).filters,discover);
  assert.equal(catalogRouteHash('discover',{mode:'personal',collection:'recommendations',sort:'affinity',genreMatch:'any'}),'#discover');
  assert.equal(catalogRouteHash('private',{q:'Secreto'}),'#private');
  assert.deepEqual(parseCatalogRoute('#discover?mode=bad&country=no&minChapters=-2&catalog=https://bad').filters,{});
});

test('diagnóstico conserva últimas respuestas correctas y cinco consultas, tolerando almacenamiento dañado',()=>{
  let history={};for(let n=0;n<8;n++)history=recordCatalogHealth(history,'mangadex',n%2?'error':'ok',1000+n*2000);
  assert.equal(history.mangadex.history.length,5);assert.equal(history.mangadex.lastSuccess,13000);assert.equal(history.mangadex.lastFailure,15000);
  assert.deepEqual(readCatalogHealth(JSON.stringify(history)),history);assert.deepEqual(readCatalogHealth('{'),{});
  assert.deepEqual(recordCatalogHealth({},'https://invalid','ok'),{});assert.deepEqual(recordCatalogHealth({},'mangadex','loading'),{});
});
