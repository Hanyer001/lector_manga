import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterNumber,orderedChapters,chapterGaps} from '../src/frontend/chapter-order.js';
import {trialChapters} from '../src/frontend/trial-reading.js';
import {openDatabase} from '../src/storage/database.js';
test('capítulos: orden numérico estable para fuentes desordenadas, decimales y extras',()=>{
  const items=['10','1','2,5','2',null,null].map((number,i)=>({number,title:i===4?'Capítulo 3':'Extra',url:'https://example.com/'+i}));
  assert.deepEqual(trialChapters(items).map(row=>row.number),[1,2,2.5,3,10,null]);
  assert.equal(items[0].number,'10');
  assert.equal(chapterNumber({title:'Especial 2024',url:'https://example.com/12'}),null);
  assert.equal(chapterNumber({title:'Capítulo 2.5 · Otra versión'}),2.5);
  assert.deepEqual(chapterGaps([1,1,2,2.5,3,10].map(number=>({number}))),[[3,10]]);
  assert.deepEqual(orderedChapters([{number:2,id:1},{number:1,id:2},{number:2,id:3}]).map(row=>row.id),[2,1,3]);
});
test('sincronizar y abrir capítulos conservan el mismo orden y progreso, incluso con números ausentes',t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const serie=db.saveFavorite({source:'test',titulo:'Historia',url_origen:'https://example.com/serie',portada:null});
  const chapters=[10,1,2,3].map(number=>({number:number===2?null:number,title:`Capítulo ${number}`,url:`https://example.com/c/${number}`}));
  const saved=db.saveChapters(serie.id,chapters);
  assert.deepEqual(saved.map(chapterNumber),[1,2,3,10]);
  db.markChapterRead(saved[1].id);
  assert.deepEqual(db.listChapters(serie.id).map(row=>row.id),saved.map(row=>row.id));
  const again=db.saveChapters(serie.id,chapters.slice().reverse());
  assert.equal(again[1].estado_lectura,1);
  assert.deepEqual(again.map(row=>row.id),saved.map(row=>row.id));
});
