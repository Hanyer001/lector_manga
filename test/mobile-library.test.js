import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceLibrary} from '../src/frontend/device-library.js';
import {ProgressWriter} from '../src/frontend/reader-core.js';
import {rankRecommendations,groupWorks} from '../src/frontend/discovery-core.js';
import {openDatabase} from '../src/storage/database.js';

test('dispositivo: conserva biblioteca y ancla al recargar sin escribir en una cuenta',async t=>{
  let document={owner:crypto.randomUUID(),revision:0,state:null,vault:{revision:0,envelope:null}};
  const storage={read:async()=>structuredClone(document),update:async change=>{document=structuredClone(change(structuredClone(document)));return structuredClone(document);}},stores=[];
  const openStore=async()=>()=>{const db=openDatabase(':memory:');stores.push(db);return db;};t.after(()=>stores.forEach(db=>db.close()));
  const requested=[];const transport=async path=>{requested.push(path);assert.ok(path.startsWith('/api/vault/'));return new Response(JSON.stringify(path.endsWith('/chapters')?{chapters:[{title:'Capítulo 1',number:1,url:'https://example.test/chapter/1'}]}:[]),{headers:{'Content-Type':'application/json'}});};
  const first=createDeviceLibrary({storage,openStore,transport});
  const call=async(path,body)=>{const result=await first.handle(path,body?{method:'POST',body:JSON.stringify(body)}:{});assert.equal(result.status,200);return result.json();};
  const item=await call('/api/series',{source:'test',titulo:'Lectura local',url_origen:'https://example.test/manga'});
  const chapters=await call(`/api/series/${item.id}/sync`,{});
  await call('/api/progress',{serie_id:item.id,capitulo_id:chapters[0].id,scroll_position_y:1400,page_index:3,page_fraction:.42,expected_timestamp:null});
  const second=createDeviceLibrary({storage,openStore,transport}),progress=await (await second.handle(`/api/series/${item.id}/progress`)).json();
  assert.equal(progress.page_index,3);assert.equal(progress.page_fraction,.42);
  assert.equal((await (await second.handle('/api/series')).json())[0].titulo,'Lectura local');
  assert.deepEqual(requested,['/api/vault/chapters']);
  const before=document.revision;
  await assert.rejects(second.sync.commit({expectedRevision:0,envelope:{ciphertext:'opaque'}},{revision:before-1,state:{}}),{code:'VAULT_CHANGED'});
  assert.equal(document.revision,before);assert.equal(document.vault.envelope,null);
});

test('progreso: agrupa por obra sin perder la posición de otra serie',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),sent=[];
  const writer=new ProgressWriter(async snapshot=>{sent.push(snapshot);if(sent.length===1)await gate;});
  const first=writer.enqueue({serie_id:1,page:1});
  writer.enqueue({serie_id:1,page:2});writer.enqueue({serie_id:2,page:3});writer.enqueue({serie_id:1,page:4});
  release();await first;assert.deepEqual(sent,[{serie_id:1,page:1},{serie_id:1,page:4},{serie_id:2,page:3}]);
});

test('recomendaciones: devuelve más de 24 sin perder la mezcla de fuentes',()=>{
  const candidates=Array.from({length:80},(_,id)=>({source:id%2?'a':'b',title:'Historia '+id,url:'https://example.test/'+id,genres:['Fantasy']}));
  const result=rankRecommendations(candidates,{mode:'genres',filters:{genres:['Fantasy']},limit:120});
  assert.equal(result.length,80);assert.equal(new Set(result.slice(0,24).map(item=>item.source)).size,2);
});

test('portada de una obra estable al continuar desde otra edición',()=>{
  const editions=[{id:1,work_id:1,coverUrl:'uno',coverKey:'a',ultima_lectura:1},{id:2,work_id:1,coverUrl:'dos',coverKey:'b',ultima_lectura:2}];
  assert.equal(groupWorks(editions)[0].coverUrl,'uno');editions[0].ultima_lectura=3;
  assert.equal(groupWorks(editions)[0].coverUrl,'uno');
});
