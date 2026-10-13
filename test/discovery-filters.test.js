import test from 'node:test';
import assert from 'node:assert/strict';
import {rankRecommendations,groupWorks} from '../src/frontend/discovery-core.js';
import {filterSeries} from '../src/frontend/reader-core.js';
import {createDeviceLibrary} from '../src/frontend/device-library.js';
import {openDatabase} from '../src/storage/database.js';

const saved={id:1,work_id:1,source:'one',titulo:'Fantasía favorita',url_origen:'https://one.test/saved',genres:['Fantasy','Horror'],sentiment:'like'};
const adult=(id,extra={})=>({source:'manhwaweb',title:id,url:'https://manhwaweb.com/manhwa/'+id,contentRating:'adult',genres:['Drama'],themes:['Ecchi'],...extra});
test('Para ti + filtros: mantiene el catálogo sin atribuir una afinidad inexistente',()=>{
  const pool=[adult('Por explorar'),adult('Relacionada',{genres:['Fantasy','Horror']}),adult('Descartada'),adult('Ya guardada',{url:saved.url_origen,source:saved.source})];
  const feedback=[{...adult('Descartada'),hidden:true}];
  const results=rankRecommendations(pool,{library:[saved],feedback,filters:{genres:['adult']}});
  assert.deepEqual(results.map(item=>item.title),['Relacionada','Por explorar']);
  assert.equal(results[0].discoveryMatch,'affinity');assert.equal(results[1].discoveryMatch,'filters');
  assert.equal(results[1].explanation.seedTitle,null);assert.match(results[1].reason,/sin afinidad confirmada/);
  assert.deepEqual(rankRecommendations([pool[0]],{library:[saved],filters:{genres:['adult'],excludeGenres:['Drama']}}),[]);
  assert.deepEqual(rankRecommendations([pool[0]],{library:[saved],mode:'similar',seedWorkId:1,filters:{genres:['adult']}}),[]);
  assert.deepEqual(rankRecommendations([pool[0]],{library:[saved],mode:'recent',filters:{genres:['adult']}}),[]);
});

test('última lectura: orden descendente con obras vinculadas, sin leer al final y filtros combinados',()=>{
  const rows=[{id:1,work_id:1,titulo:'A',source:'one',ultima_lectura:10},{id:2,work_id:2,titulo:'B',source:'two',ultima_lectura:30},{id:3,work_id:1,titulo:'A',source:'two',ultima_lectura:50},{id:4,work_id:4,titulo:'Sin empezar',source:'two',ultima_lectura:null}].map(row=>({...row,is_private:1,genres:['Acción'],authors:['Autora'],status:'ongoing',reading_state:'reading',folder_ids:[8],pendientes:2}));
  const filters={sort:'recent',genre:'accion',author:'Autora',publication:'ongoing',reading:'reading',folder:'8',unreadOnly:true};
  assert.deepEqual(groupWorks(filterSeries(rows,filters)).map(item=>item.id),[3,2,4]);
  assert.deepEqual(groupWorks(filterSeries(rows,{...filters,source:'one'})).map(item=>item.id),[1]);
  assert.deepEqual(groupWorks(filterSeries(rows,{...filters,query:'AUTORA'})).map(item=>item.id),[3,2,4]);
  assert.deepEqual(filterSeries(rows,{...filters,folder:'9'}),[]);
});

test('modo dispositivo: recuenta por catálogo después de personalizar',async t=>{
  const dbs=[],openStore=async()=>()=>{const db=openDatabase(':memory:');dbs.push(db);return db;};t.after(()=>dbs.forEach(db=>db.close()));
  let doc={owner:crypto.randomUUID(),revision:0,state:null,vault:{revision:0,envelope:null}};
  const storage={read:async()=>structuredClone(doc),update:async change=>doc=structuredClone(change(structuredClone(doc)))};
  const device=createDeviceLibrary({storage,openStore,transport:async()=>new Response(JSON.stringify({results:[adult('Una')],sources:[{id:'manhwaweb',count:1,candidates:30,status:'ok'}]}))});
  await device.handle('/api/series',{method:'POST',body:JSON.stringify({...saved,metadata:saved})});
  const response=await device.handle('/api/discovery/recommendations',{method:'POST',body:JSON.stringify({mode:'personal',filters:{genres:['adult'],themes:[]}})});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.results.length,1);assert.equal(result.results[0].discoveryMatch,'filters');assert.equal(result.sources[0].count,1);assert.equal(result.sources[0].candidates,30);
});
