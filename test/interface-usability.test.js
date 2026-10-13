import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterEntries} from '../src/frontend/chapter-browser.js';
import {libraryProgress} from '../src/frontend/library-progress.js';

test('capítulos: búsqueda completa entre mil capítulos, versiones decimales y extras', () => {
  const chapters = Array.from({length:1000}, (_,i) => ({id:i+1,numero:i+1,titulo:`Capítulo ${i+1}`,estado_lectura:i<5?1:0}));
  chapters.push({id:1001,numero:4.5,titulo:'Capítulo 4.5 · Versión A'}, {id:1002,numero:4.5,titulo:'Capítulo 4.5 · Versión B'}, {id:1003,numero:null,titulo:'Epílogo'});
  assert.equal(chapterEntries(chapters,{query:'1000'})[0].chapter.id,1000);
  assert.deepEqual(chapterEntries(chapters,{query:'4.5'}).map(row=>row.chapter.id),[1001,1002]);
  assert.equal(chapterEntries(chapters,{query:'epilogo'})[0].chapter.id,1003);
  assert.equal(chapterEntries(chapters,{filter:'read'}).length,5);
  assert.equal(chapterEntries(chapters,{filter:'last',lastId:'499'})[0].chapter.id,499);
  const versions=chapterEntries(chapters,{query:'4.5',order:'desc'});
  assert.deepEqual(versions.map(row=>chapters[row.index]),versions.map(row=>row.chapter));
  assert.equal(chapters[0].id,1,'los filtros nunca reordenan la lista de lectura original');
});

test('avance: usa capítulos marcados, respeta pausados y nunca inventa un porcentaje', () => {
  assert.deepEqual(libraryProgress({total_capitulos:10,pendientes:7,ultimo_capitulo_id:8}),{total:10,read:3,percent:30,label:'Leyendo'});
  assert.equal(libraryProgress({total_capitulos:10,pendientes:10,ultimo_capitulo_id:8}).percent,0);
  assert.equal(libraryProgress({total_capitulos:10,pendientes:3,reading_state:'on_hold',ultimo_capitulo_id:8}).label,'Pausado');
  assert.equal(libraryProgress({reading_state:'planned',ultimo_capitulo_id:8}).label,'Pendiente','el estado visible coincide con los filtros guardados');
  assert.equal(libraryProgress({total_capitulos:10,pendientes:50}).percent,0);
  assert.equal(libraryProgress({total_capitulos:10,pendientes:-5}).percent,100);
  assert.equal(libraryProgress({}).percent,0);
});
