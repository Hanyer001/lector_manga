import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../src/storage/database.js';
import {createApp} from '../src/backend/app.js';
import {rankRecommendations,selectRecommendationSeeds,recommendationQueryTags,itemKey} from '../src/frontend/discovery-core.js';
import {createRecommendationCache} from '../src/backend/recommendation-cache.js';
import {readRecommendationStream} from '../src/frontend/discovery-stream.js';
import {createScraper} from '../src/extensions/catalog.js';

const berserk={id:1,work_id:1,source:'one',titulo:'Berserk',url_origen:'https://one.test/berserk',genres:['Drama','Acción','Fantasía','Horror'],authors:['MIURA Kentaro'],sentiment:'like'};
const candidate=(title,genres,themes=[],extra={})=>({source:'one',title,url:'https://one.test/'+encodeURIComponent(title),genres,themes,...extra});
test('Berserk: similitud exige rasgos relevantes, rechaza romance y etiquetas generales y no mezcla otras obras',()=>{
  const library=[berserk,{id:2,work_id:2,source:'one',titulo:'Romance favorito',genres:['Romance','Drama'],sentiment:'like'}];
  const pool=[candidate('Fantasía oscura',['Action','Fantasy','Horror']),candidate('Romance de fantasía',['Romance','Fantasy','Drama']),candidate('Drama escolar',['Drama','Romance'],['School Life']),candidate('Solo acción',['Action']),candidate('Fantasía genérica',['Drama','Action','Fantasy']),candidate('Sin datos',[]),candidate('Otra obra de Miura',[],[],{authors:['Miura Kentaro']})];
  const result=rankRecommendations(pool,{library,mode:'similar',seedWorkId:1});
  assert.deepEqual(new Set(result.map(item=>item.title)),new Set(['Fantasía oscura','Otra obra de Miura']));
  assert.ok(result.every(item=>item.reason.startsWith('Similar a Berserk')));assert.match(result.find(item=>item.title==='Fantasía oscura').reason,/terror/i);
  assert.deepEqual(rankRecommendations(pool,{library,mode:'similar',seedWorkId:1,filters:{excludeGenres:['Horror']}}).map(item=>item.title),['Otra obra de Miura']);
});
test('modos: recientes solo usa lecturas reales; gustos positivos y temas específicos prevalecen; géneros es independiente',()=>{
  const dark={...berserk,ultima_lectura:100},romance={id:2,work_id:2,source:'two',titulo:'Amor',genres:['Romance','Drama'],ultima_lectura:200,sentiment:'like'},planned={id:3,work_id:3,titulo:'Deporte pendiente',genres:['Sports'],reading_state:'planned'};
  const pool=[candidate('Oscura',['Fantasy','Horror']),candidate('Amor nuevo',['Romance','Drama']),candidate('Deportes',['Sports'])],library=[dark,romance,planned];
  const recent=rankRecommendations(pool,{library,mode:'recent'});assert.equal(recent[0].title,'Amor nuevo');assert.ok(!recent.some(item=>item.title==='Deportes'));assert.ok(recent.every(item=>item.reason.startsWith('Por tu lectura de')));
  assert.deepEqual(rankRecommendations(pool,{library:[planned],mode:'recent'}),[]);
  const themed={...berserk,themes:['Venganza','Reencarnación']};assert.equal(recommendationQueryTags([themed])[0].kind,'themes');
  const personal=rankRecommendations(pool,{library:[dark],mode:'personal'});assert.deepEqual(personal.map(item=>item.title),['Oscura']);
  assert.deepEqual(selectRecommendationSeeds({library:[{...dark,rating:2}],mode:'personal'}),[]);
  const genres=rankRecommendations(pool,{library:[dark],mode:'genres',filters:{genres:['Romance'],genreMatch:'any'}});assert.deepEqual(genres.map(item=>item.title),['Amor nuevo']);assert.match(genres[0].reason,/Romance/);assert.deepEqual(genres[0].explanation.matchedFilters,['Romance']);
  const diverse=rankRecommendations(pool,{library:[dark],mode:'diverse'});assert.equal(diverse[0].title,'Deportes');assert.match(diverse[0].reason,/salir de lo habitual/);
});
test('alias y años de catálogo no duplican ni reintroducen una obra guardada o descartada',()=>{
  const result=rankRecommendations([candidate('Nombre ( 2021 )',['Horror']),candidate('Alternativo',['Horror'],[],{altTitles:['Nombre']}),candidate('Berserk (1989)',['Horror'])],{library:[berserk],mode:'genres'});
  assert.equal(result.length,1);
});
test('caché de catálogo: solicitudes simultáneas comparten tráfico, cancelación aislada, caducidad y refresh',async()=>{
  let now=0,calls=0,resolve,aborted=false;
  const cache=createRecommendationCache({ttlMs:50,maxEntries:2,now:()=>now}),first=new AbortController(),second=new AbortController();
  const load=signal=>{calls++;signal.addEventListener('abort',()=>{aborted=true});return new Promise(r=>resolve=r);};
  const a=cache('one',load,first.signal),b=cache('one',load,second.signal);const rejected=assert.rejects(a,{code:'CANCELLED'});
  await Promise.resolve();first.abort();await rejected;assert.equal(aborted,false);resolve({results:[{title:'Primero'}]});await b;assert.equal(calls,1);
  const hit=await cache('one',load);assert.equal(hit.cached,true);hit.value.results[0].title='Mutado';assert.equal((await cache('one',load)).value.results[0].title,'Primero');
  now=51;assert.equal((await cache('one',async()=>{calls++;return {results:[]}})).cached,false);assert.equal(calls,2);
  await cache('one',async()=>{calls++;return {results:[]}},undefined,{refresh:true});assert.equal(calls,3);
  const last=new AbortController();const stopped=cache('cancel',signal=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('abortado')))),last.signal);const failed=assert.rejects(stopped,{code:'CANCELLED'});await Promise.resolve();last.abort();await failed;
  assert.equal((await cache('cancel',async()=>({results:[]}))).cached,false);
});
async function fixture(t,scrapers,options={}){
  const database=openDatabase(':memory:');const sources=new Map(Object.entries(scrapers).map(([id,scraper])=>[id,{id,name:id,baseUrl:`https://${id}.test/`,pageOrigin:`https://${id}.test`,imageOrigins:[`https://${id}.test`],enabled:true,capabilities:{recommend:true,chapters:true},scraper}]));
  const server=createServer(createApp({database,sources,discoveryOptions:options,logger:{warn(){},error(){}}}));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
  const request=(body,stream=false)=>fetch(`http://127.0.0.1:${server.address().port}/api/discovery/recommendations`,{method:'POST',headers:{'Content-Type':'application/json',Accept:stream?'application/x-ndjson':'application/json'},body:JSON.stringify(body)});
  return {database,request,sources};
}
test('stream muestra resultados rápidos mientras otra fuente sigue pendiente; JSON sigue compatible',async t=>{
  let unblock;const late=new Promise(resolve=>unblock=resolve);
  const {request}=await fixture(t,{one:{recommend:async()=>({results:[candidate('Rápida',['Fantasy'])]})},two:{recommend:async()=>{await late;return {results:[{...candidate('Lenta',['Fantasy']),source:'two',url:'https://two.test/slow'}]};}}});
  const response=await request({},true),reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',progress;
  while(!progress){const {value}=await reader.read();buffer+=decoder.decode(value);for(const line of buffer.split('\n').filter(Boolean)){const event=JSON.parse(line);if(event.type==='progress'&&event.results.length)progress=event;}buffer=buffer.slice(buffer.lastIndexOf('\n')+1);}
  assert.equal(progress.results[0].title,'Rápida');assert.equal(progress.sources.find(source=>source.id==='two').status,'loading');unblock();
  let remaining='';while(true){const {value,done}=await reader.read();if(done)break;remaining+=decoder.decode(value);}assert.match(remaining,/"type":"complete"/);assert.match(remaining,/Lenta/);
  const result=await (await request({})).json();assert.equal(result.results.length,2);assert.ok(result.sources.every(source=>source.cached));
});
test('caché nunca congela gustos ni privacidad; más como una sugerencia usa su ficha exacta',async t=>{
  let calls=0;const liked=candidate('Semilla externa',['Horror','Fantasy']);
  const {database,request}=await fixture(t,{one:{recommend:async()=>{calls++;return {results:[liked,candidate('Nueva',['Horror','Fantasy']),candidate('Romance',['Drama','Romance'])]};}}});
  database.saveRecommendationFeedback(liked,{more_like:true,sentiment:'like'});
  const seedFeedbackKey=itemKey(liked),first=await (await request({mode:'similar',seedFeedbackKey})).json();assert.deepEqual(first.results.map(item=>item.title),['Nueva']);assert.match(first.results[0].reason,/Semilla externa/);
  const saved=database.saveFavorite({source:'one',titulo:'Nueva',url_origen:'https://one.test/Nueva',metadata:{genres:['Horror','Fantasy']}});database.updateLibrary(saved.id,{is_private:true});
  const second=await (await request({mode:'similar',seedFeedbackKey})).json();assert.deepEqual(second.results,[]);assert.equal(calls,2); // Dos filtros aprendidos; la segunda petición reutiliza ambos.
  assert.equal((await request({mode:'similar',seedFeedbackKey:'one|inexistente'})).status,404);
});
test('Sorpréndeme consulta catálogo general y Lo que lees sin historial no inventa personalización',async t=>{
  const queries=[];const {database,request}=await fixture(t,{one:{recommend:async filters=>{queries.push(filters);return {results:[candidate('Nueva',['Fantasy','Horror'])]};}}});
  database.saveFavorite({source:'one',titulo:'Berserk',url_origen:'https://one.test/berserk',metadata:berserk});
  const diverse=await(await request({mode:'diverse'})).json();assert.equal(diverse.results.length,1);assert.ok(queries.every(query=>!query.genres.length&&!query.themes?.length));
  const recent=await(await request({mode:'recent'})).json();assert.equal(recent.results.length,0);assert.match(recent.message,/no hay lecturas recientes/);assert.equal(queries.length,1);
});
test('stream no revela una semilla que pasa a privada durante una consulta',async t=>{
  let unblock;const late=new Promise(resolve=>unblock=resolve);
  const {database,request}=await fixture(t,{one:{recommend:async()=>({results:[candidate('Primera',['Horror','Fantasy'])]})},two:{recommend:async()=>{await late;return {results:[{...candidate('Segunda',['Horror','Fantasy']),source:'two',url:'https://two.test/second'}]};}}});
  const saved=database.saveFavorite({source:'one',titulo:'Berserk',url_origen:'https://one.test/berserk',metadata:berserk});
  const response=await request({mode:'similar',seedWorkId:saved.work_id},true),reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',seen=false;
  while(!seen){const {value}=await reader.read();buffer+=decoder.decode(value);for(const line of buffer.split('\n').filter(Boolean)){const event=JSON.parse(line);if(event.results?.length)seen=true;}buffer=buffer.slice(buffer.lastIndexOf('\n')+1);}
  database.updateLibrary(saved.id,{is_private:true});unblock();let tail=buffer;
  while(true){const {value,done}=await reader.read();if(done)break;tail+=decoder.decode(value);}
  const complete=tail.split('\n').filter(Boolean).map(JSON.parse).find(event=>event.type==='complete');assert.deepEqual(complete.results,[]);assert.equal(complete.personalized,false);assert.ok(!JSON.stringify(complete).includes('Berserk'));
});
test('parser NDJSON mantiene UTF-8 dividido y detecta errores y streams incompletos',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type:'progress',results:[{title:'Fantasía'}]})+'\n'+JSON.stringify({type:'complete',results:[]})+'\n');
  const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),events=[];
  await readRecommendationStream(new Response(stream),event=>events.push(event));assert.equal(events[0].results[0].title,'Fantasía');assert.equal(events.at(-1).type,'complete');
  await assert.rejects(readRecommendationStream(new Response('{"type":"progress"}\n')),/interrumpió/);
  await assert.rejects(readRecommendationStream(new Response('{"type":"error","error":{"message":"Fallo","code":"X"}}\n')),{code:'X'});
});
test('TuManga: una ficha lenta se cancela y conserva otras fichas en orden sin agotar toda la consulta',async()=>{
  let aborted=false;const html=value=>new Response('<meta charset="utf-8">'+value,{headers:{'Content-Type':'text/html'}});
  const scraper=await createScraper('tumanga',{maxRetries:0,recommendationPageTimeoutMs:35,recommendationBudgetMs:500,fetchImpl:async(input,{signal})=>{const path=new URL(input).pathname;
    if(path==='/')return html(['slow','first','second'].map(name=>`<div class="bsx"><a href="/manga/${name}/"><div class="tt">${name}</div><img src="/cover/${name}.jpg"></a></div>`).join(''));
    if(path==='/manga/slow/')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
    return html(`<div class="main-info"><h1 class="entry-title">${path}</h1><div class="mgen"><a>Horror</a><a>Fantasy</a></div></div>`);}});
  const result=await scraper.recommend();assert.equal(aborted,true);assert.equal(result.partial,true);assert.equal(result.results.length,2);assert.ok(result.results[0].title.includes('first'));assert.ok(result.results[1].title.includes('second'));assert.match(result.warnings[0],/1 ficha/);
});
