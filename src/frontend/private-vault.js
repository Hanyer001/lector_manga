import {PRIVATE_ID_BASE} from './vault-envelope.js';
import {createVaultEncryption,openVaultEncryption,encryptVaultState,decryptVaultState} from './vault-crypto.js';
import {loadPrivateDatabase} from './vault-database.js';
import {equivalentChapter,normalizeTag,itemKey} from './discovery-core.js';
const isPrivate=id=>Number(id)>=PRIVATE_ID_BASE;
const failure=(code,message,status=423)=>Object.assign(new Error(message),{code,status});
export function selectBackup(backup,ids,{privateRows=true,preserveUnlinkedFolders=!privateRows}={}) {
  const tables=structuredClone(backup.tables),selected=new Set(ids),all=tables.Series;
  tables.Series=all.filter(row=>selected.has(row.id)).map(row=>({...row,is_private:Number(privateRows)}));
  const works=new Set(tables.Series.map(row=>row.work_id));tables.Works=tables.Works.filter(row=>works.has(row.id));
  const linkedFolders=new Set(tables.SeriesFolders.map(row=>row.folder_id));
  for(const name of ['Chapters','Progress','SeriesFolders'])tables[name]=tables[name].filter(row=>selected.has(row.serie_id));
  const folders=new Set(tables.SeriesFolders.map(row=>row.folder_id));tables.Folders=tables.Folders.filter(row=>folders.has(row.id)||preserveUnlinkedFolders&&!linkedFolders.has(row.id));
  const hidden=new Set(all.filter(row=>!selected.has(row.id)).map(row=>row.url_origen));
  const hiddenTitles=new Set(all.filter(row=>!selected.has(row.id)).flatMap(row=>[row.titulo,...(JSON.parse(row.metadata_json??'{}').altTitles??[])]).map(normalizeTag));
  tables.RecommendationFeedback=tables.RecommendationFeedback.filter(row=>{const item=JSON.parse(row.item_json);return !hidden.has(item.url)&&![item.title,...(item.altTitles??[])].some(title=>hiddenTitles.has(normalizeTag(title)));});
  if(privateRows){tables.DiscoveryPreferences=[{id:1,value_json:'{}'}];tables.RecommendationFeedback=[];}
  delete tables.PrivateAccess;
  return {format:'lector-manga-library',version:1,exportedAt:new Date().toISOString(),includesPrivate:privateRows&&tables.Series.length>0,tables};
}
export function createPrivateVault({transport,sync,owner,openStore=loadPrivateDatabase}) {
  let db,keys,envelope,vaultRevision=0,identity,scope=false,tail=Promise.resolve(),generation=0;
  const raw=async(path,options={})=>{
    const response=await transport(path,options),data=await response.json();
    if(!response.ok)throw failure(data.error?.code??'VAULT_UNAVAILABLE',data.error?.message??'No se pudo sincronizar la bóveda.',response.status);
    return {data,revision:Number(response.headers.get('X-Library-Revision')??0)};
  };
  const send=(path,body)=>raw(path,{method:'POST',body:JSON.stringify(body)});
  function clear(){generation++;sync.cancel?.();keys?.rawKey.fill(0);keys=null;db?.close();db=null;envelope=null;vaultRevision=0;scope=false;}
  const unlocked=()=>Boolean(db&&keys);
  function requireKey(){if(!unlocked())throw failure('PRIVATE_LOCKED','Desbloquea tu biblioteca con la contraseña de cifrado.');}
  const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  async function refresh() {
    requireKey();const current=generation,loaded=await sync.load();
    if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
    if(!loaded.envelope||loaded.envelope.vaultId!==envelope.vaultId){clear();throw failure('PRIVATE_LOCKED','La clave de cifrado cambió en otro dispositivo. Desbloquea de nuevo.');}
    if(loaded.revision!==vaultRevision){const state=await decryptVaultState(loaded.envelope,keys.key,identity);if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');db.restoreState(state);envelope=loaded.envelope;vaultRevision=loaded.revision;}
  }
  async function mutate(action,{account={},expectedLocalRevision}={}) {
    await refresh();const before=db.exportState(),current=generation;
    if(expectedLocalRevision!==undefined&&expectedLocalRevision!==vaultRevision)throw failure('VAULT_CHANGED','La biblioteca privada cambió mientras preparabas el traslado. Vuelve a intentarlo.',409);
    try {
      const value=await action(),next=await encryptVaultState(db.exportState(),keys.key,identity,envelope);
      if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
      const body={expectedRevision:vaultRevision,envelope:next,operationId:crypto.randomUUID()};
      let saved;
      try{saved=await sync.commit(body,account);}
      catch(error){
        // Un corte tras guardar no debe duplicar una importación ni perder el ancla.
        const latest=await sync.load().catch(()=>null);
        if(latest?.envelope?.payload.ciphertext!==next.payload.ciphertext)throw error;
        saved={revision:latest.revision};
      }
      if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
      envelope=next;vaultRevision=saved.revision;return value;
    }catch(error){if(current===generation&&db)db.restoreState(before);throw error;}
  }
  async function covers(items) {
    const result=(await send('/api/vault/covers',{items:items.filter(row=>row.portada).map(row=>({id:row.id,source:row.source,url:row.url_origen,cover:row.portada}))})).data;
    const byId=new Map(result.map(row=>[row.id,row.coverUrl]));return items.map(row=>({...row,coverUrl:byId.get(row.id)??null}));
  }
  async function move(id) {
    requireKey();const current=generation,loaded=await sync.account(),factory=await openStore(),general=factory({privateIds:false});
    try {
      if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
      if(loaded.state)general.restoreState(loaded.state);
      const backup=general.exportLibrary(),item=general.getSeries(id),editions=general.listSeries().filter(row=>row.work_id===item.work_id);
      const ids=editions.map(row=>row.id),part=selectBackup(backup,ids),otherFolders=new Set(backup.tables.SeriesFolders.filter(row=>!ids.includes(row.serie_id)).map(row=>row.folder_id));
      const hiddenTitles=new Set(editions.flatMap(row=>[row.titulo,row.work_title,...(row.altTitles??[])]).filter(Boolean).map(normalizeTag));
      for(const feedback of general.getDiscovery().feedback)if([feedback.title,...(feedback.altTitles??[])].some(title=>hiddenTitles.has(normalizeTag(title))))general.removeRecommendationFeedback(itemKey(feedback));
      for(const edition of editions)general.removeFavorite(edition.id);
      for(const folder of part.tables.Folders)if(!otherFolders.has(folder.id))general.removeFolder(folder.id);
      return await mutate(()=>{db.importLibrary(part,{allowPrivate:true});return db.listSeries().find(row=>row.source===item.source&&row.url_origen===item.url_origen);},{account:{revision:loaded.revision,state:general.exportState()}});
    }finally{general.close();}
  }
  async function reveal(id) {
    requireKey();await refresh();const item=db.getSeries(id),ids=db.listSeries().filter(row=>row.work_id===item.work_id).map(row=>row.id),backup=selectBackup(db.exportLibrary({includePrivate:true}),ids,{privateRows:false});
    const preparedRevision=vaultRevision,current=generation,account=await sync.account(),factory=await openStore(),general=factory({privateIds:false});
    try{
      if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
      if(account.state)general.restoreState(account.state);general.importLibrary(backup);
      return await mutate(()=>{for(const seriesId of ids)db.removeFavorite(seriesId);return {visible:true};},{expectedLocalRevision:preparedRevision,account:{revision:account.revision,state:general.exportState()}});
    }finally{general.close();}
  }
  async function importLibrary(backup,secret,{recovery=false}={}) {
    const hasPrivate=backup?.privateVault||backup?.tables?.Series?.some(row=>row.is_private);
    if(!hasPrivate&&!(await sync.load()).envelope)return null;
    requireKey();const factory=await openStore(),staged=factory();
    try {
      let privatePart;
      if(backup.privateVault) {
        const encrypted=backup.privateVault;
        let state;
        try{if(encrypted.envelope.vaultId===envelope.vaultId&&encrypted.owner===identity)state=await decryptVaultState(encrypted.envelope,keys.key,identity);else{const opened=await openVaultEncryption(encrypted.envelope,secret,encrypted.owner,{recovery});try{state=opened.state;}finally{opened.rawKey.fill(0);}}}
        catch{throw failure('BACKUP_PASSWORD_REQUIRED','Introduce la contraseña de cifrado que protegía este archivo.',400);}
        staged.restoreState(state);const canonical=staged.exportLibrary({includePrivate:true});privatePart=selectBackup(canonical,canonical.tables.Series.map(row=>row.id),{preserveUnlinkedFolders:true});
      } else {
        staged.importLibrary(backup,{allowPrivate:true});const canonical=staged.exportLibrary({includePrivate:true});
        const hidden=new Set(db.listSeries().map(row=>row.source+'|'+row.url_origen)),privateWorks=new Set(canonical.tables.Series.filter(row=>row.is_private||hidden.has(row.source+'|'+row.url_origen)).map(row=>row.work_id));
        for(const row of canonical.tables.Series)if(privateWorks.has(row.work_id))row.is_private=1;
        privatePart=selectBackup(canonical,canonical.tables.Series.filter(row=>row.is_private).map(row=>row.id));
        backup=canonical;
      }
      const publicPart=backup.privateVault?{...backup,format:'lector-manga-library',version:1}:selectBackup(backup,backup.tables.Series.filter(row=>!row.is_private).map(row=>row.id),{privateRows:false});
      delete publicPart.privateVault;
      // La parte privada se confirma primero; nunca se envía sin cifrar a la API.
      const privateCounts=await mutate(()=>db.importLibrary(privatePart,{allowPrivate:true}));
      const general=(await send('/api/library/import',publicPart)).data;
      return Object.fromEntries(['seriesAdded','chaptersAdded','foldersAdded','progressImported'].map(key=>[key,(privateCounts[key]??0)+(general[key]??0)]));
    }finally{staged.close();}
  }
  async function handlePrivate(path,options) {
    const url=new URL(path,'https://reader.invalid'),method=options.method??'GET',body=options.body?JSON.parse(options.body):{},route=url.pathname;
    if(route==='/api/private/status'){const revision=await sync.revision();if(unlocked()&&revision!==vaultRevision)await refresh();return {configured:revision>0,unlocked:unlocked(),encrypted:true,idleMs:600000};}
    if(route==='/api/private/lock'){clear();return {configured:true,unlocked:false,encrypted:true};}
    if(route==='/api/private/setup'||route==='/api/private/unlock') {
      const current=generation,loaded=await sync.load(),factory=await openStore();let opened;
      try {
      if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
      if(route.endsWith('/setup')) {
        if(loaded.envelope)throw failure('PIN_EXISTS','La bóveda ya está configurada.',409);
        const blank=factory();try{opened=await createVaultEncryption(blank.exportState(),body.pin,identity);}finally{blank.close();}
        if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');
        const saved=await sync.commit({expectedRevision:0,envelope:opened.envelope,operationId:crypto.randomUUID()});
        vaultRevision=saved.revision;envelope=opened.envelope;opened.state=await decryptVaultState(envelope,opened.key,identity);
      }else{
        if(!loaded.envelope)throw failure('PIN_REQUIRED','Primero crea una contraseña de cifrado.',409);
        opened=await openVaultEncryption(loaded.envelope,body.pin,identity,{recovery:Boolean(body.recovery)});envelope=loaded.envelope;vaultRevision=loaded.revision;
      }
      if(current!==generation){opened.rawKey.fill(0);throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');}
      db?.close();keys?.rawKey.fill(0);keys=opened;db=factory();db.restoreState(opened.state);delete opened.state;
      const recoveryKey=opened.recoveryKey;delete opened.recoveryKey;
      return {configured:true,unlocked:true,encrypted:true,...(recoveryKey?{recoveryKey}:{})};
      }finally{opened?.rawKey.fill(0);}
    }
    if(route==='/api/private/pin') {
      requireKey();await refresh();const current=generation,changed=await createVaultEncryption(db.exportState(),body.pin,identity);
      try{if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');const saved=await sync.commit({expectedRevision:vaultRevision,envelope:changed.envelope,operationId:crypto.randomUUID()});if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');const recoveryKey=changed.recoveryKey;clear();return {configured:true,unlocked:false,encrypted:true,recoveryKey,revision:saved.revision};}finally{changed.rawKey.fill(0);}
    }
    if(route==='/api/private/import-backup')return importLibrary(body.backup,body.secret,{recovery:Boolean(body.recovery)});
    if(route==='/api/library/import')return await importLibrary(body)??(await send('/api/library/import',body)).data;
    if(route==='/api/library/export') {
      requireKey();await refresh();const backup=(await raw('/api/library/export')).data;
      return {...backup,version:2,includesPrivate:true,privateVault:{owner:identity,envelope}};
    }
    const seriesRoute=route.match(/^\/api\/series\/(\d+)(?:\/(.+))?$/),chapterRoute=route.match(/^\/api\/chapters\/(\d+)\/(.+)$/),workRoute=route.match(/^\/api\/works\/(\d+)(?:\/(.+))?$/),folderRoute=route.match(/^\/api\/folders(?:\/(\d+))?$/);
    if(seriesRoute&&method==='PUT'&&body.is_private===true&&!isPrivate(seriesRoute[1]))return move(seriesRoute[1]);
    requireKey();
    if(route==='/api/series'&&method==='GET'){await refresh();return covers(db.listSeries());}
    if(route==='/api/series'&&method==='POST')return mutate(async()=>{
      let details=body.metadata??{},title=body.titulo,cover=body.portada,url=body.url_origen;
      if(!body.source)body.source=(await raw('/api/sources/detect?url='+encodeURIComponent(url))).data.id;
      if(!title){details=(await raw(`/api/sources/${encodeURIComponent(body.source)}/manga?url=${encodeURIComponent(url)}`)).data.manga;title=details.title;cover??=details.cover;url=details.url;}
      const row=db.saveFavorite({...body,titulo:title,portada:cover,url_origen:url,metadata:details});return db.updateLibrary(row.id,{is_private:true});
    });
    if(folderRoute) {
      if(method==='GET')return db.listFolders().map(folder=>({...folder,count:db.listSeries().filter(row=>row.folder_ids.includes(folder.id)).length}));
      return mutate(()=>method==='DELETE'?db.removeFolder(folderRoute[1]):db.saveFolder(body.name,folderRoute[1]));
    }
    if(seriesRoute) {
      const id=Number(seriesRoute[1]),action=seriesRoute[2];
      if(method==='DELETE'&&!action)return mutate(()=>db.removeFavorite(id));
      if(action==='library')return body.is_private===false?reveal(id):mutate(()=>db.updateLibrary(id,body));
      if(action==='chapters'){await refresh();return db.listChapters(id);}
      if(action==='sync')return mutate(async()=>{const row=db.getSeries(id),result=(await send('/api/vault/chapters',{source:row.source,url:row.url_origen})).data;if(result.manga)db.updateSourceMetadata(id,result.manga);return db.saveChapters(id,result.chapters);});
      if(action==='progress')return method==='GET'?db.getProgress(id):mutate(()=>db.updateProgress({...body,serie_id:id}));
      if(action==='edition'&&method==='DELETE')return mutate(()=>db.unlinkSeries(id));
    }
    if(route==='/api/progress')return mutate(()=>db.updateProgress(body));
    if(chapterRoute) {
      const id=Number(chapterRoute[1]);
      if(chapterRoute[2]==='read')return mutate(()=>db.markChapterRead(id,body.read??true));
      if(chapterRoute[2]==='images') {await refresh();const chapter=db.getChapter(id),series=db.getSeries(chapter.serie_id),result=(await send('/api/vault/images',{source:series.source,url:chapter.url_origen})).data;return {...result,source:series.source,chapter:{...result.chapter,id,serie_id:series.id,privateReading:true}};}
    }
    if(workRoute) {
      const id=Number(workRoute[1]),action=workRoute[2];
      if(!action){const work=db.getWork(id);return {...work,editions:await covers(work.editions)};}
      if(action==='feedback')return mutate(()=>db.updateWorkFeedback(id,body));
      if(action==='editions') {if(!isPrivate(body.serie_id))throw failure('EDITION_MISMATCH','Mueve primero esa fuente a tu biblioteca privada.',400);return mutate(()=>db.linkSeries(id,body.serie_id));}
      if(action==='transfer') {
        const from=Number(body.from??url.searchParams.get('from')),to=Number(body.to??url.searchParams.get('to')),work=db.getWork(id);
        if(from===to||![from,to].every(seriesId=>work.editions.some(row=>row.id===seriesId)))throw failure('EDITION_MISMATCH','Elige dos fuentes distintas de esta obra.',400);
        const progress=db.getProgress(from),chapter=progress?db.getChapter(progress.capitulo_id):null,match=equivalentChapter(db.listChapters(to),chapter?.numero),info={from,to,number:chapter?.numero??null,chapter:match.chapter,ambiguous:match.ambiguous,canTransfer:Boolean(match.chapter),message:match.chapter?'Se continuará desde el capítulo equivalente.':'No hay una correspondencia única.'};
        if(method==='GET')return info;if(!info.canTransfer)throw failure('CHAPTER_EQUIVALENCE_REQUIRED',info.message,409);
        return mutate(()=>({...info,progress:db.updateProgress({serie_id:to,capitulo_id:info.chapter.id,scroll_position_y:0,page_index:0,page_fraction:0})}));
      }
    }
    throw failure('NOT_FOUND','Operación privada no disponible.',404);
  }
  return {
    setScope(value){scope=Boolean(value);},clear,unlocked,
    handle(path,options={}) {
      const user=owner();if(user!==identity){clear();identity=user;}
      const url=new URL(path,'https://reader.invalid'),body=options.body?JSON.parse(options.body):{},route=url.pathname;
      if(route==='/api/private/lock'){clear();return Promise.resolve(response({configured:true,unlocked:false,encrypted:true}));}
      const local=route.startsWith('/api/private/')||url.searchParams.get('scope')==='private'||/^\/api\/(?:series|chapters|works|folders)\/(\d+)/.test(route)&&isPrivate(route.match(/\/(\d+)/)[1])||isPrivate(body.serie_id)||isPrivate(body.work_id)||body.is_private===true||route==='/api/library/export'&&url.searchParams.get('private')==='1'||route==='/api/library/import'||scope&&route==='/api/folders';
      if(!local)return Promise.resolve(null);
      const current=generation;
      const task=tail.then(async()=>{try{if(current!==generation)throw failure('PRIVATE_LOCKED','La biblioteca se ha bloqueado.');return response(await handlePrivate(path,options));}catch(error){return new Response(JSON.stringify({error:{code:error.code??'VAULT_ERROR',message:error.message}}),{status:error.status??400,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}});
      tail=task.catch(()=>{});return task;
    }
  };
}
