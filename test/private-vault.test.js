import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createVaultEncryption,openVaultEncryption,encryptVaultState} from '../src/frontend/vault-crypto.js';
import {createPrivateVault,selectBackup} from '../src/frontend/private-vault.js';
import {PRIVATE_ID_BASE} from '../src/frontend/vault-envelope.js';
import {sqliteAdapter} from '../src/frontend/vault-database.js';
import {createDatabaseStore} from '../src/storage/database-core.js';
import {openDatabase} from '../src/storage/database.js';
import {createApp} from '../src/backend/app.js';
import {memoryAccountStore,USERS} from './helpers/account-store.js';
import {memorySupabase} from './helpers/supabase-vault.js';
import {createVaultSync} from '../src/frontend/vault-sync.js';
const secret='Una frase extensa y única para las pruebas 29';
const favorite={source:'test',titulo:'Lectura secreta de prueba',url_origen:'https://example.test/hidden',portada:'https://images.example.test/cover.png'};
let factory;
async function privateFactory() {
  if(factory)return factory;
  const SQL=await createRequire(import.meta.url)('sql.js')(),schemas=await Promise.all(['schema','library-migration','reader-migration','discovery-migration','privacy-migration'].map(name=>readFile(new URL('../src/storage/'+name+'.sql',import.meta.url),'utf8')));
  factory=({privateIds=true}={})=>{const db=sqliteAdapter(new SQL.Database());db.pragma('foreign_keys=ON');for(const schema of schemas)db.exec(schema.replaceAll('id INTEGER PRIMARY KEY,','id INTEGER PRIMARY KEY AUTOINCREMENT,'));if(privateIds)for(const table of ['Series','Chapters','Progress','Folders','Works'])db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table,PRIVATE_ID_BASE);return createDatabaseStore(db,()=>factory({privateIds}));};return factory;
}
async function harness(t) {
  const store=memoryAccountStore(),db=openDatabase(':memory:');
  const item=db.saveFavorite({...favorite,metadata:{altTitles:['Otra edición confidencial']}}),folder=db.saveFolder('Carpeta confidencial');db.updateLibrary(item.id,{folder_ids:[folder.id],reading_state:'reading'});
  db.saveRecommendationFeedback({source:'test',title:'Otra edición confidencial',url:'https://example.test/hidden-alias'},{sentiment:'like'});
  const [chapter]=db.saveChapters(item.id,[{title:'Capítulo privado 1',number:1,url:'https://example.test/chapter/1'}]);db.markChapterRead(chapter.id);db.updateProgress({serie_id:item.id,capitulo_id:chapter.id,scroll_position_y:70,page_index:2,page_fraction:.3});
  store.states.set(USERS.a.id,{revision:1,state:db.exportState()});db.close();
  const source={id:'test',name:'Prueba',pageOrigin:'https://example.test',imageOrigins:['https://images.example.test'],capabilities:{manga:true,chapters:true,images:true},scraper:{async getChapters(){return {chapters:[{title:'Capítulo privado 1',number:1,url:'https://example.test/chapter/1'},{title:'Capítulo privado 2',number:2,url:'https://example.test/chapter/2'}]};},async getChapterImages(url){return {chapter:{title:'Capítulo privado',url},images:[{index:0,url:'https://images.example.test/page.png',referer:url}]};}}};
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  server.on('request',createApp({cloudStore:store,publicConfig:{mode:'cloud',privateEncryption:'e2ee'},apiOrigin:origin.replace('http:','https:'),frontendOrigins:['https://reader.example.test'],sources:new Map([['test',source]]),logger:{warn(){},error(){}}}));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const calls=[],transport=(user='a')=>async(path,options={})=>{calls.push({path,body:options.body});return fetch(origin+path,{...options,headers:{'X-Forwarded-Proto':'https',Origin:'https://reader.example.test',Authorization:'Bearer '+user,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});};
  const supabaseCalls=[],sdk=user=>memorySupabase(store,USERS[user],supabaseCalls);
  const sync=user=>createVaultSync({client:()=>sdk(user),owner:()=>USERS[user].id});
  const vault=()=>createPrivateVault({transport:transport(),sync:sync('a'),owner:()=>USERS.a.id,openStore:privateFactory});
  const call=async(client,path,body,method=body?'POST':'GET')=>{const response=await client.handle(path,{method,...(body?{body:JSON.stringify(body)}:{})});assert.ok(response,'la operación privada se procesa en el navegador');return {status:response.status,data:await response.json()};};
  return {store,transport,calls,supabaseCalls,sdk,sync,vault,call,item};
}
test('cifrado: claves aleatorias, contraseña fuerte, autenticación del contenido y vinculación a la cuenta',async()=>{
  const state={title:favorite.titulo,folders:['Carpeta confidencial'],progress:2},created=await createVaultEncryption(state,secret,USERS.a.id);
  try {
    assert.equal(JSON.stringify(created.envelope).includes(state.title),false);
    assert.deepEqual((await openVaultEncryption(created.envelope,secret,USERS.a.id)).state,state);
    await assert.rejects(openVaultEncryption(created.envelope,'Otra contraseña errónea',USERS.a.id));
    await assert.rejects(openVaultEncryption(created.envelope,secret,USERS.b.id));
    const altered=structuredClone(created.envelope);altered.payload.ciphertext=(altered.payload.ciphertext[0]==='A'?'B':'A')+altered.payload.ciphertext.slice(1);await assert.rejects(openVaultEncryption(altered,secret,USERS.a.id));
    const second=await encryptVaultState(state,created.key,USERS.a.id,created.envelope);assert.notEqual(second.payload.iv,created.envelope.payload.iv);
    assert.deepEqual((await openVaultEncryption(created.envelope,created.recoveryKey,USERS.a.id,{recovery:true})).state,state);
    await assert.rejects(createVaultEncryption(state,'123456789012',USERS.a.id));
  }finally{created.rawKey.fill(0);}
});
test('bóveda: títulos, carpetas, capítulos leídos y ancla quedan cifrados; la clave no se transmite',async t=>{
  const {store,vault,call,item,calls,transport}=await harness(t),client=vault();t.after(()=>client.clear());
  const setup=await call(client,'/api/private/setup',{pin:secret});assert.equal(setup.status,200);assert.ok(setup.data.recoveryKey);
  const moved=await call(client,`/api/series/${item.id}/library`,{is_private:true},'PUT');assert.equal(moved.status,200);assert.ok(moved.data.id>PRIVATE_ID_BASE);
  const plain=JSON.stringify(store.states.get(USERS.a.id));assert.equal(plain.includes(favorite.titulo),false);assert.equal(plain.includes('Carpeta confidencial'),false);
  assert.equal(plain.includes('Otra edición confidencial'),false,'las valoraciones de otras ediciones tampoco quedan en el perfil general');
  const stored=JSON.stringify(store.vaults.get(USERS.a.id));assert.equal(stored.includes(favorite.titulo),false);assert.equal(stored.includes(secret),false);assert.equal(stored.includes(setup.data.recoveryKey),false);
  assert.equal(calls.some(row=>row.body?.includes(secret)||row.body?.includes(setup.data.recoveryKey)),false);
  const chapters=(await call(client,`/api/series/${moved.data.id}/chapters`)).data;assert.equal(chapters[0].estado_lectura,1);
  const progress=(await call(client,`/api/series/${moved.data.id}/progress`)).data;assert.equal(progress.page_index,2);assert.equal(progress.page_fraction,.3);
  assert.equal((await transport()('/api/private/setup',{method:'POST',body:JSON.stringify({pin:'1234'})})).status,426,'el servidor rechaza el sistema antiguo que guardaba lecturas privadas sin cifrar');
  assert.equal(calls.some(row=>['/api/vault','/api/vault/move','/api/vault/reveal'].includes(row.path)),false,'la sincronización privada no utiliza Render');
  const other=await transport('b')('/api/vault');assert.equal(other.status,426);
  assert.equal(calls.some(row=>row.body?.includes('ciphertext')),false,'ningún bloque cifrado se envía al proxy');
  await call(client,'/api/private/lock',{});assert.equal((await call(client,`/api/series/${moved.data.id}/chapters`)).status,423);
  assert.equal((await call(client,'/api/private/unlock',{pin:'Contraseña equivocada'})).status,400);
  assert.equal((await call(client,'/api/private/unlock',{pin:setup.data.recoveryKey,recovery:true})).status,200);
  const restored=(await call(client,'/api/series?scope=private')).data;assert.equal(restored[0].titulo,favorite.titulo);
});
test('bóveda: bloquear cancela un desbloqueo en curso y las operaciones en cola',async t=>{
  const {vault,call}=await harness(t),client=vault();t.after(()=>client.clear());
  await call(client,'/api/private/setup',{pin:secret});await call(client,'/api/private/lock',{});
  const opening=call(client,'/api/private/unlock',{pin:secret});
  // Permite que la derivación comience; el bloqueo se resuelve sin esperar la cola.
  await new Promise(resolve=>setTimeout(resolve,15));
  await call(client,'/api/private/lock',{});
  assert.equal((await opening).data.error.code,'PRIVATE_LOCKED');
  assert.equal((await call(client,'/api/private/status')).data.unlocked,false);
});
test('bóveda: otro dispositivo sincroniza el ancla; un conflicto no sobreescribe el progreso',async t=>{
  const {vault,call,item}=await harness(t),a=vault(),b=vault();t.after(()=>{a.clear();b.clear();});
  await call(a,'/api/private/setup',{pin:secret});const moved=(await call(a,`/api/series/${item.id}/library`,{is_private:true},'PUT')).data;
  await call(b,'/api/private/unlock',{pin:secret});const previous=(await call(b,`/api/series/${moved.id}/progress`)).data;
  const body={serie_id:moved.id,capitulo_id:previous.capitulo_id,scroll_position_y:90,page_index:3,page_fraction:.5,expected_timestamp:previous.timestamp};
  assert.equal((await call(a,'/api/progress',body)).status,200);
  const stale=await call(b,'/api/progress',{...body,page_index:0});assert.equal(stale.data.error.code,'PROGRESS_CONFLICT');
  const chapterResult=(await call(b,`/api/chapters/${previous.capitulo_id}/images`)).data;assert.equal(chapterResult.chapter.privateReading,true);assert.equal(chapterResult.images.length,1);
  assert.equal((await call(b,`/api/series/${moved.id}/progress`)).data.page_index,3);
  const rotated=await call(a,'/api/private/pin',{pin:'Otra contraseña extensa para rotar 63'},'PUT');assert.ok(rotated.data.recoveryKey);
  assert.equal((await call(b,'/api/series?scope=private')).data.error.code,'PRIVATE_LOCKED');
  assert.equal((await call(a,'/api/private/unlock',{pin:secret})).status,400);
  assert.equal((await call(a,'/api/private/unlock',{pin:'Otra contraseña extensa para rotar 63'})).status,200);
});
test('bóveda: exportación cifrada, importación local y traslado explícito a la biblioteca general',async t=>{
  const {vault,call,item,store,transport}=await harness(t),client=vault();t.after(()=>client.clear());
  await call(client,'/api/private/setup',{pin:secret});const moved=(await call(client,`/api/series/${item.id}/library`,{is_private:true},'PUT')).data;
  const backup=(await call(client,'/api/library/export?private=1')).data;assert.equal(backup.version,2);assert.equal(JSON.stringify(backup).includes(favorite.titulo),false);assert.ok(backup.privateVault.envelope);
  const local=openDatabase(':memory:');const row=local.saveFavorite({...favorite,titulo:'Lectura oculta importada',url_origen:'https://example.test/imported'});local.updateLibrary(row.id,{is_private:true});const imported=local.exportLibrary({includePrivate:true});local.close();
  assert.equal((await call(client,'/api/library/import',imported)).status,200);
  assert.equal(JSON.stringify(store.states.get(USERS.a.id)).includes('Lectura oculta importada'),false);
  const revealed=await call(client,`/api/series/${moved.id}/library`,{is_private:false},'PUT');assert.equal(revealed.status,200);
  const visible=await transport()('/api/series');assert.equal((await visible.json())[0].titulo,favorite.titulo);
  assert.ok((await (await transport()('/api/series')).json())[0].id<PRIVATE_ID_BASE,'la edición revelada conserva el espacio de IDs público');
  const privateRows=(await call(client,'/api/series?scope=private')).data;assert.equal(privateRows.length,1);assert.equal(privateRows[0].titulo,'Lectura oculta importada');
});
test('bóveda: una copia pública antigua no vuelve a mostrar lecturas ocultas; repetir el traslado no lo duplica',async t=>{
  const {vault,call,item,transport,supabaseCalls,sdk,store}=await harness(t),client=vault();t.after(()=>client.clear());
  const oldBackup=await (await transport()('/api/library/export')).json();
  await call(client,'/api/private/setup',{pin:secret});await call(client,`/api/series/${item.id}/library`,{is_private:true},'PUT');
  const moveRequest=supabaseCalls.find(row=>row.name==='reader_vault_commit_owned'&&row.body.p_account_state);
  assert.equal((await sdk('a').rpc(moveRequest.name,moveRequest.body)).data[0].committed,true,'un reintento del mismo traslado devuelve su resultado original');
  await call(client,'/api/private/lock',{});
  assert.equal((await call(client,'/api/library/import',oldBackup)).status,423);
  await call(client,'/api/private/unlock',{pin:secret});assert.equal((await call(client,'/api/library/import',oldBackup)).status,200);
  assert.deepEqual(await (await transport()('/api/series')).json(),[]);
  assert.equal(JSON.stringify(store.states.get(USERS.a.id)).includes('Otra edición confidencial'),false);
  assert.equal((await call(client,'/api/series?scope=private')).data.length,1);
});

test('importación mixta conserva carpetas vacías públicas y no expone las carpetas privadas',()=>{
  const db=openDatabase(':memory:');try{
    const hidden=db.saveFavorite(favorite),privateFolder=db.saveFolder('Privada'),empty=db.saveFolder('Pendientes');
    db.updateLibrary(hidden.id,{is_private:true,folder_ids:[privateFolder.id]});
    const part=selectBackup(db.exportLibrary({includePrivate:true}),[],{privateRows:false});
    assert.deepEqual(part.tables.Folders.map(row=>row.name),[empty.name]);
  }finally{db.close();}
});

test('respaldo cifrado de otra cuenta se abre solo con su clave y conserva carpetas privadas vacías',async t=>{
  const {vault,call,item,transport,sync,store}=await harness(t),a=vault(),b=createPrivateVault({transport:transport('b'),sync:sync('b'),owner:()=>USERS.b.id,openStore:privateFactory});
  t.after(()=>{a.clear();b.clear();});
  const setup=await call(a,'/api/private/setup',{pin:secret});await call(a,`/api/series/${item.id}/library`,{is_private:true},'PUT');
  await call(a,'/api/folders?scope=private',{name:'Carpeta privada vacía'});
  const backup=(await call(a,'/api/library/export?private=1')).data;
  await call(b,'/api/private/setup',{pin:'Otra frase independiente de destino 48'});
  assert.equal((await call(b,'/api/library/import',backup)).data.error.code,'BACKUP_PASSWORD_REQUIRED');
  const imported=await call(b,'/api/private/import-backup',{backup,secret:setup.data.recoveryKey,recovery:true});assert.equal(imported.status,200);
  assert.equal((await call(b,'/api/series?scope=private')).data[0].titulo,favorite.titulo);
  assert.ok((await call(b,'/api/folders?scope=private')).data.some(row=>row.name==='Carpeta privada vacía'));
  assert.equal(JSON.stringify(store.states.get(USERS.b.id)).includes(favorite.titulo),false);
});
