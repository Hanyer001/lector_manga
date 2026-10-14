import test from 'node:test';
import assert from 'node:assert/strict';
import {homeModel} from '../src/frontend/home-model.js';
const reading={id:1,work_id:10,titulo:'En lectura',reading_state:'reading',ultimo_capitulo_id:2,ultima_lectura:100,total_capitulos:5,pendientes:3};

test('Inicio agrupa fuentes y excluye lecturas privadas y adultas de todo su resumen',()=>{
  const model=homeModel([reading,{...reading,id:2,ultima_lectura:50},{id:3,work_id:30,titulo:'Pendiente',reading_state:'planned',total_capitulos:3,pendientes:3},{...reading,id:4,work_id:40,is_private:true},{...reading,id:5,work_id:50,is_adult:true}]);
  assert.equal(model.works.length,2);assert.equal(model.reading,1);assert.equal(model.planned.length,1);assert.equal(model.unread,2);assert.equal(model.hero.id,1);
});
test('Inicio no ofrece historias completadas, pausadas o abandonadas como lectura para retomar',()=>{
  const closed=['completed','on_hold','abandoned'].map((reading_state,index)=>({...reading,id:index+1,work_id:index+1,reading_state}));
  assert.equal(homeModel(closed).hero,null);
  const planned={id:4,work_id:4,titulo:'Siguiente',reading_state:'planned'};
  assert.equal(homeModel([...closed,planned]).hero.id,4);
});
test('novedades elige el primer capítulo nuevo de una edición y elimina obras ajenas o privadas',()=>{
  const model=homeModel([reading,{...reading,id:2,ultima_lectura:50},{...reading,id:3,work_id:30,is_private:true}],[
    {id:18,serie_id:1,numero:8,first_seen_at:200},{id:17,serie_id:1,numero:7,first_seen_at:200},
    {id:21,serie_id:2,numero:9,first_seen_at:210},{id:99,serie_id:3,numero:1},{id:98,serie_id:88,numero:1}]);
  assert.equal(model.news.length,1);assert.equal(model.news[0].count,2);assert.equal(model.news[0].chapter.id,17);assert.equal(model.news[0].detectedAt,210);
});
