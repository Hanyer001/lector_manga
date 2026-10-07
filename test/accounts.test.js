import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/storage/database.js';
import { createApp } from '../src/backend/app.js';
import { createImageTickets } from '../src/backend/imageTickets.js';
import { readServerConfig } from '../src/backend/config.js';
import { createCloudStore } from '../src/backend/cloud-store.js';
import { memoryAccountStore, USERS } from './helpers/account-store.js';
const silent={warn(){},error(){}};
const source={id:'test',name:'Fuente de prueba',pageOrigin:'https://example.test',imageOrigins:['https://images.example.test'],capabilities:{manga:true,chapters:true,images:true,recommend:true},scraper:{recommend:async({page=0})=>({results:[{title:'Sugerencia '+page,url:'https://example.test/recommend/'+page,genres:['Fantasy']}],nextPage:page===0?1:null})}};
const favorite={source:'test',titulo:'Historia',url_origen:'https://example.test/manga',portada:'https://images.example.test/cover.png'};
async function setup(t,store=memoryAccountStore()) {
  const tickets=createImageTickets(),server=createServer();
  server.listen(0,'127.0.0.1');await once(server,'listening');
  server.on('request',createApp({cloudStore:store,apiOrigin:`https://127.0.0.1:${server.address().port}`,frontendOrigins:['https://reader.example.test'],sources:new Map([['test',source]]),tickets,logger:silent}));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,{user='a',method='GET',body,privateToken,operation,origin='https://reader.example.test',https=true}={})=>{
    const headers={Origin:origin,...(https?{'X-Forwarded-Proto':'https'}:{}),...(user?{Authorization:'Bearer '+user}:{}),...(body?{'Content-Type':'application/json'}:{}),...(privateToken?{'X-Private-Token':privateToken}:{}),...(operation?{'X-Operation-Id':operation}:{})};
    const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
    return {status:response.status,headers:response.headers,data:await response.json()};
  };
  return {request,store,tickets};
}
test('cuentas: exige sesión, HTTPS y origen autorizado, incluso para imágenes',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/api/series',{user:null})).status,401);
  assert.equal((await request('/api/series',{user:'forged'})).status,401);
  assert.equal((await request('/api/series',{https:false})).status,403);
  assert.equal((await request('/api/series',{origin:'https://evil.test'})).status,403);
  const result=await request('/api/account');assert.equal(result.data.user.id,USERS.a.id);assert.match(result.headers.get('access-control-expose-headers'),/X-Library-Revision/);
  assert.equal((await request('/api/image?ticket=invalid',{user:null})).status,401);
});

test('invitado: sólo recursos públicos, sin cargar cuentas ni aceptar tickets ajenos',async t=>{
  const store=memoryAccountStore();store.authenticate=()=>{throw new Error('No debe autenticar invitados');};store.load=()=>{throw new Error('No debe cargar bibliotecas');};
  const {request,tickets}=await setup(t,store);
  assert.equal((await request('/api/guest/sources',{user:null})).status,200);
  const first=await request('/api/guest/discovery/recommendations',{user:null,method:'POST',body:{mode:'genres',filters:{}}});
  assert.equal(first.status,200);assert.equal(first.data.results[0].title,'Sugerencia 0');assert.equal(first.data.nextPages.test,1);
  const next=await request('/api/guest/discovery/recommendations',{user:null,method:'POST',body:{mode:'genres',filters:{},pages:first.data.nextPages}});
  assert.equal(next.status,200);assert.equal(next.data.results[0].title,'Sugerencia 1');assert.deepEqual(next.data.nextPages,{});
  for(const path of ['/series','/account','/private/status','/library/export','/vault'])assert.equal((await request('/api/guest'+path,{user:null})).status,404);
  assert.equal((await request('/api/guest/progress',{user:null,method:'POST',body:{}})).status,404);
  const ticket=tickets.issue({source:'test',url:favorite.portada,ownerId:USERS.a.id});
  assert.equal((await request('/api/guest/image?ticket='+encodeURIComponent(ticket),{user:null})).data.error.code,'IMAGE_ACCOUNT_MISMATCH');
  assert.equal((await request('/api/guest/sources',{user:null,origin:'https://evil.test'})).status,403);
});
test('cuentas: favoritos y carpetas quedan separados aunque coincidan IDs locales',async t=>{
  const {request}=await setup(t);
  const a=await request('/api/series',{method:'POST',body:favorite});assert.equal(a.status,200);
  await request('/api/folders',{method:'POST',body:{name:'Favoritos'}});
  assert.deepEqual((await request('/api/series',{user:'b'})).data,[]);
  assert.deepEqual((await request('/api/folders',{user:'b'})).data,[]);
  assert.equal((await request('/api/series/'+a.data.id,{user:'b',method:'DELETE'})).status,404);
  const b=await request('/api/series',{user:'b',method:'POST',body:{...favorite,titulo:'Otra biblioteca'}});
  assert.equal(b.data.id,a.data.id);assert.equal((await request('/api/series')).data[0].titulo,'Historia');
});
test('cuentas: un segundo dispositivo recupera capítulos leídos, carpetas y ancla',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const row=db.saveFavorite(favorite),folder=db.saveFolder('Por leer');db.updateLibrary(row.id,{folder_ids:[folder.id]});
  const [chapter]=db.saveChapters(row.id,[{title:'Capítulo 1',url:'https://example.test/chapter/1',number:1}]);db.markChapterRead(chapter.id);
  db.updateProgress({serie_id:row.id,capitulo_id:chapter.id,scroll_position_y:100,page_index:2,page_fraction:.45});
  const {request}=await setup(t);assert.equal((await request('/api/library/import',{method:'POST',body:db.exportLibrary()})).status,200);
  const remote=(await request('/api/series')).data[0],chapters=(await request(`/api/series/${remote.id}/chapters`)).data;
  assert.equal(chapters[0].estado_lectura,1);assert.equal(remote.folder_ids.length,1);
  const progress=(await request(`/api/series/${remote.id}/progress`)).data;assert.equal(progress.page_index,2);assert.equal(progress.page_fraction,.45);
  const body={serie_id:remote.id,capitulo_id:chapters[0].id,scroll_position_y:40,page_index:3,page_fraction:.2,expected_timestamp:progress.timestamp};
  assert.equal((await request('/api/progress',{method:'POST',body})).status,200);
  const stale=await request('/api/progress',{method:'POST',body});assert.equal(stale.status,409);assert.equal(stale.data.error.code,'PROGRESS_CONFLICT');
  assert.equal((await request('/api/progress',{method:'POST',body:{...body,expected_timestamp:undefined}})).status,428);
  assert.equal((await request(`/api/series/${remote.id}/progress`)).data.page_index,3);
});
test('cuentas: el PIN y su sesión pertenecen a una cuenta, y los tickets no cruzan cuentas',async t=>{
  const {request,tickets}=await setup(t);const series=(await request('/api/series',{method:'POST',body:favorite})).data;
  const oldCatalogCover='/api/image?ticket='+encodeURIComponent(tickets.issue({source:'test',url:favorite.portada,referer:favorite.url_origen,libraryUrl:favorite.url_origen,ownerId:USERS.a.id}));
  const pin=await request('/api/private/setup',{method:'POST',body:{pin:'1234'}});assert.ok(pin.data.privateToken);assert.equal(pin.headers.get('set-cookie'),null);
  const token=pin.data.privateToken;
  assert.equal((await request(`/api/series/${series.id}/library`,{method:'PUT',body:{is_private:true},privateToken:token})).status,200);
  assert.deepEqual((await request('/api/series')).data,[]);
  assert.equal((await request('/api/series?scope=private')).status,423);
  const privateRows=await request('/api/series?scope=private',{privateToken:token});assert.equal(privateRows.data.length,1);
  assert.equal((await request('/api/series?scope=private',{user:'b',privateToken:token})).status,423);
  const cover=privateRows.data[0].coverUrl;
  assert.equal((await request(cover,{user:'b'})).data.error.code,'IMAGE_ACCOUNT_MISMATCH');
  assert.equal((await request(cover)).status,423);
  assert.equal((await request(oldCatalogCover)).status,423,'una portada emitida desde el catálogo comprueba si la obra ahora es privada');
  await request('/api/private/lock',{method:'POST',privateToken:token});assert.equal((await request('/api/series?scope=private',{privateToken:token})).status,423);
});
test('cuentas: escrituras simultáneas no pierden cambios y los reintentos son idempotentes',async t=>{
  const store=memoryAccountStore(),load=store.load;let loads=0,release;
  const barrier=new Promise(resolve=>release=resolve);
  store.load=async id=>{const snapshot=await load(id);if(++loads<=2){if(loads===2)release();await barrier;}return snapshot;};
  const {request}=await setup(t,store);const operation=randomUUID();
  const responses=await Promise.all([request('/api/folders',{method:'POST',body:{name:'A'},operation}),request('/api/folders',{method:'POST',body:{name:'B'},operation:randomUUID()})]);
  assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);
  const retried=await request('/api/folders',{method:'POST',body:{name:'A'},operation});assert.equal(retried.status,200);
  assert.equal((await request('/api/folders',{method:'POST',body:{name:'A'},operation})).status,200);
  assert.equal((await request('/api/folders',{method:'POST',body:{name:'Reutilizado'},operation})).data.error.code,'OPERATION_MISMATCH');
  await request('/api/folders',{method:'POST',body:{name:'B'}});assert.equal((await request('/api/folders')).data.length,2);
});

test('cuentas: un reintento mantiene el PIN y aplica la privacidad actual de la obra',async t=>{
  const {request,store}=await setup(t);
  const publicOperation=randomUUID();
  const series=(await request('/api/series',{method:'POST',body:favorite,operation:publicOperation})).data;
  const pin=(await request('/api/private/setup',{method:'POST',body:{pin:'1234'},operation:randomUUID()})).data;
  const token=pin.privateToken,privateOperation=randomUUID(),body={is_private:true};
  assert.equal((await request(`/api/series/${series.id}/library`,{method:'PUT',body,privateToken:token,operation:privateOperation})).status,200);
  await request('/api/private/lock',{method:'POST',privateToken:token});
  assert.equal((await request('/api/series',{method:'POST',body:favorite,operation:publicOperation})).status,423,'una respuesta antigua pública no expone la obra ahora privada');
  assert.equal((await request(`/api/series/${series.id}/library`,{method:'PUT',body,operation:privateOperation})).status,423,'repetir no evita el bloqueo');
  const renewed=(await request('/api/private/unlock',{method:'POST',body:{pin:'1234'}})).data.privateToken;
  assert.equal((await request(`/api/series/${series.id}/library`,{method:'PUT',body,privateToken:renewed,operation:privateOperation})).status,200);
  const snapshot=await store.load(USERS.a.id);assert.equal(snapshot.state.tables.Series[0].is_private,1);
});
test('cuentas: un fallo de PostgreSQL no se informa como guardado ni se conserva en memoria',async t=>{
  const store=memoryAccountStore();store.commit=async()=>{throw Object.assign(new Error('offline'),{status:503});};
  const {request}=await setup(t,store);
  assert.equal((await request('/api/series',{method:'POST',body:favorite})).status,500);
  assert.deepEqual((await request('/api/series')).data,[]);
});
test('importación: remapea IDs, combina sin duplicar y nunca exporta el hash del PIN',()=>{
  const from=openDatabase(':memory:'),to=openDatabase(':memory:');
  try {
    const series=from.saveFavorite(favorite),folder=from.saveFolder('Pendientes');from.updateLibrary(series.id,{folder_ids:[folder.id]});
    const [chapter]=from.saveChapters(series.id,[{title:'Extra',url:'https://example.test/extra',number:1.5}]);from.markChapterRead(chapter.id);
    from.savePrivateAccess('salt','hash');
    to.saveFavorite({...favorite,url_origen:'https://example.test/other'});
    const backup=from.exportLibrary();assert.equal(backup.tables.PrivateAccess,undefined);assert.ok(!JSON.stringify(backup).includes('pin_hash'));
    assert.equal(to.importLibrary(backup).seriesAdded,1);assert.equal(to.importLibrary(backup).seriesAdded,0);
    const saved=to.listSeries().find(row=>row.url_origen===favorite.url_origen);assert.notEqual(saved.id,series.id);assert.equal(saved.folder_ids.length,1);assert.equal(to.listChapters(saved.id)[0].estado_lectura,1);
    from.updateLibrary(series.id,{is_private:true});assert.equal(from.exportLibrary().tables.Series.length,0);
    assert.throws(()=>to.importLibrary(from.exportLibrary({includePrivate:true})),{code:'PRIVATE_LOCKED'});
  } finally {from.close();to.close();}
});
test('importación: archivos inválidos no alteran nada ni permiten tablas arbitrarias',()=>{
  const db=openDatabase(':memory:');try{db.saveFavorite(favorite);const before=db.exportState();
    for(const backup of [{format:'bad'}, {...db.exportLibrary(),tables:{...db.exportLibrary().tables,PrivateAccess:[]}}, {...db.exportLibrary(),tables:{...db.exportLibrary().tables,'Series; DROP TABLE Series;':[]}}, {...db.exportLibrary(),tables:{...db.exportLibrary().tables,Progress:[{id:1,serie_id:1,capitulo_id:999,scroll_position_y:0,timestamp:1,page_index:0,page_fraction:0}]}}])assert.throws(()=>db.importLibrary(backup));
    assert.deepEqual(db.exportState(),before);
  }finally{db.close();}
});

test('importación: un respaldo público antiguo no modifica una lectura ahora privada sin PIN',()=>{
  const db=openDatabase(':memory:');
  try {
    const series=db.saveFavorite(favorite),backup=db.exportLibrary();
    db.updateLibrary(series.id,{is_private:true});const before=db.exportState();
    assert.throws(()=>db.importLibrary(backup),{code:'PRIVATE_LOCKED'});
    assert.deepEqual(db.exportState(),before);
    assert.equal(db.importLibrary(backup,{allowPrivate:true}).seriesAdded,0);
    assert.equal(db.getSeries(series.id).is_private,1);
  }finally{db.close();}
});

test('importación: los JSON de metadatos no reemplazan IDs, fuentes ni el bloqueo privado',()=>{
  const from=openDatabase(':memory:'),to=openDatabase(':memory:');
  try {
    const series=from.saveFavorite(favorite);from.updateLibrary(series.id,{is_private:true});
    const backup=from.exportLibrary({includePrivate:true});
    backup.tables.Series[0].metadata_json=JSON.stringify({is_private:0,id:987,source:'evil',genres:['Action']});
    backup.tables.Works[0].feedback_json=JSON.stringify({rating:8,is_private:0,work_id:999});
    to.importLibrary(backup,{allowPrivate:true});
    const row=to.listSeries()[0];assert.equal(row.is_private,1);assert.equal(row.id,1);assert.equal(row.source,'test');assert.equal(row.rating,8);assert.deepEqual(row.genres,['Action']);
    assert.equal(to.listVisibleSeries().length,0);assert.ok(!to.exportState().tables.Series[0].metadata_json.includes('is_private'));
  }finally{from.close();to.close();}
});

test('cuentas: ocultar en otro dispositivo durante un scrape impide devolver el capítulo',async t=>{
  let started,release;
  const waiting=new Promise(resolve=>started=resolve),barrier=new Promise(resolve=>release=resolve);
  const original=source.scraper.getChapterImages;
  source.scraper.getChapterImages=async url=>{started();await barrier;return {chapter:{title:'Capítulo oculto',url},images:[{index:1,url:'https://images.example.test/page.png',referer:url}]};};
  t.after(()=>{source.scraper.getChapterImages=original;release();});
  const db=openDatabase(':memory:');const row=db.saveFavorite(favorite);
  const [chapter]=db.saveChapters(row.id,[{title:'Capítulo oculto',url:'https://example.test/chapter',number:1}]);
  const backup=db.exportLibrary();db.close();
  const {request}=await setup(t);await request('/api/library/import',{method:'POST',body:backup});
  const token=(await request('/api/private/setup',{method:'POST',body:{pin:'1234'}})).data.privateToken;
  const scraping=request(`/api/chapters/${chapter.id}/images`);await waiting;
  await request(`/api/series/${row.id}/library`,{method:'PUT',body:{is_private:true},privateToken:token});
  release();const result=await scraping;assert.equal(result.status,423);assert.ok(!JSON.stringify(result.data).includes('Capítulo oculto'));
});
test('configuración: producción falla cerrada y nunca publica una clave secreta',()=>{
  assert.throws(()=>readServerConfig({NODE_ENV:'production'}));
  const env={APP_MODE:'cloud',PUBLIC_API_ORIGIN:'https://api.example.test',FRONTEND_ORIGINS:'https://reader.example.test',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLIC_KEY:'sb_publishable_public',SUPABASE_SECRET_KEY:'sb_secret_private',IMAGE_TICKET_SECRET:'a'.repeat(64)};
  const config=readServerConfig(env);assert.ok(!JSON.stringify(config).includes('sb_secret_private'));
  const withoutSecret={...env};delete withoutSecret.SUPABASE_SECRET_KEY;assert.equal(readServerConfig(withoutSecret).cloud.secretKey,undefined);
  assert.throws(()=>readServerConfig({...env,SUPABASE_PUBLIC_KEY:'sb_secret_private'}));assert.throws(()=>readServerConfig({...env,PUBLIC_API_ORIGIN:'http://api.example.test'}));
});
test('Supabase: verifica al usuario en Auth y no acepta claims del navegador como identidad',async()=>{
  const headers=[];
  const store=createCloudStore({url:'https://project.supabase.co',publicKey:'public',secretKey:'secret',fetchImpl:async(url,options)=>{headers.push(options.headers);return new Response(JSON.stringify({message:'Invalid JWT'}),{status:401,headers:{'Content-Type':'application/json'}});}});
  await assert.rejects(store.authenticate('forged'),{code:'AUTH_REQUIRED'});assert.equal(headers.length,1);
});
test('Supabase: consultas generales usan el JWT del usuario y la clave pública, sin acceso a bóvedas',async()=>{
  const requests=[];
  const store=createCloudStore({url:'https://project.supabase.co',publicKey:'sb_publishable_test',secretKey:'NO_DEBE_USARSE',fetchImpl:async(url,options)=>{
    const headers=new Headers(options.headers);requests.push({url,authorization:headers.get('authorization'),apikey:headers.get('apikey')});
    const token=headers.get('authorization')?.slice(7),user=token==='token-a'?USERS.a:USERS.b;
    return new Response(JSON.stringify(String(url).includes('/auth/v1/user')?user:{revision:1,state:{}}),{headers:{'Content-Type':'application/json'}});
  }});
  const [a,b]=await Promise.all([store.authenticate('token-a'),store.authenticate('token-b')]);
  await Promise.all([store.forUser(a).load(a.id),store.forUser(b).load(b.id)]);
  assert.equal(requests.find(row=>row.url.includes(a.id)).authorization,'Bearer token-a');
  assert.equal(requests.find(row=>row.url.includes(b.id)).authorization,'Bearer token-b');
  assert.ok(requests.every(row=>row.apikey==='sb_publishable_test'));
  assert.ok(!JSON.stringify(requests).includes('NO_DEBE_USARSE'));
  assert.equal(store.loadVault,undefined);assert.equal(store.forUser(a).commitVault,undefined);
  await assert.rejects(store.forUser(a).load(b.id),{code:'ACCOUNT_MISMATCH'});
});

test('cuentas: las fichas vistas se sincronizan por propietario sin convertirse en favoritos',async t=>{
  const {request}=await setup(t),item={source:'test',title:'Ficha vista',url:'https://example.test/vista',genres:['Fantasy']};
  assert.equal((await request('/api/discovery/feedback',{method:'POST',body:{item,feedback:{seen:true}},operation:randomUUID()})).status,200);
  assert.equal((await request('/api/discovery')).data.feedback[0].seen,true);assert.equal((await request('/api/series')).data.length,0);
  assert.deepEqual((await request('/api/discovery',{user:'b'})).data.feedback,[]);
  await request('/api/discovery/feedback',{method:'POST',body:{item,feedback:{hidden:true}},operation:randomUUID()});
  assert.equal((await request('/api/discovery/seen',{method:'DELETE',operation:randomUUID()})).status,200);
  const feedback=(await request('/api/discovery')).data.feedback;assert.equal(feedback[0].hidden,true);assert.equal(feedback[0].seen,undefined);
});

test('lectura transitoria: firma recursos sin cargar ni escribir bibliotecas, con cuenta e invitado',async t=>{
  const original=source.scraper;
  source.scraper={...original,getChapters:async url=>({manga:{url},chapters:[{title:'Uno',number:1,url:'https://example.test/chapter/1'}]}),getChapterImages:async url=>({chapter:{title:'Uno',url},images:[{index:0,url:'https://images.example.test/1.png',referer:url}]})};
  t.after(()=>{source.scraper=original;});
  const store=memoryAccountStore();store.load=()=>{throw new Error('Una lectura de prueba no carga la biblioteca');};store.commit=()=>{throw new Error('Una lectura de prueba no la modifica');};
  const {request,tickets}=await setup(t,store);
  for(const guest of [false,true]){
    const prefix=guest?'/api/guest/vault':'/api/vault',user=guest?null:'a';
    const chapters=await request(prefix+'/chapters',{user,method:'POST',body:{source:'test',url:'https://example.test/manga'}});assert.equal(chapters.status,200);assert.equal(chapters.data.chapters.length,1);
    const images=await request(prefix+'/images',{user,method:'POST',body:{source:'test',url:chapters.data.chapters[0].url}});assert.equal(images.status,200);
    const ticket=new URL(images.data.images[0].url,'https://proxy.test').searchParams.get('ticket');assert.equal(tickets.verify(ticket).ownerId,guest?'guest':USERS.a.id);
    assert.equal((await request(prefix+'/images',{user,method:'POST',body:{source:'test',url:'https://evil.test/1'}})).status,403);
  }
  assert.equal(store.states.size,0);
});
