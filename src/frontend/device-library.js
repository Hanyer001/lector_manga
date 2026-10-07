import {loadPrivateDatabase} from './vault-database.js';
import {rankRecommendations,selectRecommendationSeeds,recommendationQueryTags,equivalentChapter} from './discovery-core.js';
import {readRecommendationStream} from './discovery-stream.js';

const fail=(message,code='DEVICE_STORAGE',status=503)=>Object.assign(new Error(message),{code,status});
const response=(data,revision=0)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','X-Library-Revision':String(revision)}});

// Un documento transaccional: los traslados a la bóveda y la biblioteca general
// se confirman juntos. Sólo el ciphertext privado se escribe en IndexedDB.
export function openDeviceStorage() {
  let opening;
  const connect=()=>opening??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('lector-device-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('library');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(fail('No se pudo abrir el almacenamiento de este navegador.'));
  });
  const update=async change=>{
    const database=await connect();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('library','readwrite'),store=tx.objectStore('library'),request=store.get('main');let result,error;
      request.onsuccess=()=>{try{const previous=request.result??{owner:crypto.randomUUID(),revision:0,state:null,vault:{revision:0,envelope:null}};result=change(previous);store.put(result,'main');}catch(cause){error=cause;tx.abort();}};
      tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(error??fail('No se pudo guardar. Comprueba el espacio disponible en este navegador.'));
    });
  };
  return {read:()=>update(value=>value),update};
}

export function createDeviceLibrary({transport,storage=openDeviceStorage(),openStore=loadPrivateDatabase}={}) {
  let db,document,ready,tail=Promise.resolve();
  const init=()=>ready??=(async()=>{document=await storage.read();const factory=await openStore();db=factory({privateIds:false});if(document.state)db.restoreState(document.state);return document;})().catch(error=>{ready=null;throw error;});
  const reload=async()=>{await init();const next=await storage.read();if(next.revision!==document.revision&&next.state)db.restoreState(next.state);document=next;return next;};
  const read=async(path,options)=>{const result=await transport(path,options);if(result.headers.get('Content-Type')?.includes('application/x-ndjson'))return readRecommendationStream(result);const data=await result.json();if(!result.ok)throw fail(data.error?.message??'No se pudo consultar la fuente.',data.error?.code,result.status);return data;};
  const send=(path,body,options={})=>read(path,{...options,method:'POST',body:JSON.stringify(body)});
  const decorate=async(items,options)=>{
    const withImages=items.filter(row=>row.portada);if(!withImages.length)return items;
    const covers=await send('/api/vault/covers',{items:withImages.map(row=>({id:row.id,source:row.source,url:row.url_origen,cover:row.portada}))},options).catch(()=>[]);
    const mapped=new Map(covers.map(item=>[item.id,item.coverUrl]));return items.map(item=>({...item,coverKey:item.source+'|'+item.portada,coverUrl:mapped.get(item.id)??null}));
  };
  const save=async action=>{
    const before=db.exportState(),expected=document.revision;
    try{const data=await action(),state=db.exportState();document=await storage.update(current=>{if(current.revision!==expected)throw fail('La biblioteca cambió en otra pestaña. Actualiza y reintenta.','ACCOUNT_CHANGED',409);return {...current,state,revision:expected+1};});return data;}
    catch(error){db.restoreState(before);throw error;}
  };
  async function handle(path,options={}) {
    await reload();const url=new URL(path,'https://device.invalid'),route=url.pathname,method=options.method??'GET',body=options.body?JSON.parse(options.body):{};
    const series=route.match(/^\/api\/series\/(\d+)(?:\/(.+))?$/),chapter=route.match(/^\/api\/chapters\/(\d+)\/(.+)$/),folder=route.match(/^\/api\/folders(?:\/(\d+))?$/),work=route.match(/^\/api\/works\/(\d+)(?:\/(.+))?$/);
    if(route==='/api/account')return {mode:'guest',revision:document.revision};
    if(route==='/api/storage')return db.storageInfo();
    if(route==='/api/series'&&method==='GET')return decorate(db.listVisibleSeries(url.searchParams.get('scope')??'library'),options);
    if(route==='/api/series'&&method==='POST'){
      const source=body.source??(await read('/api/sources/detect?url='+encodeURIComponent(body.url_origen),{signal:options.signal})).id;
      const details=body.titulo?{title:body.titulo,url:body.url_origen,cover:body.portada,...body.metadata}:(await read(`/api/sources/${source}/manga?url=${encodeURIComponent(body.url_origen)}`,{signal:options.signal})).manga;
      return save(()=>db.saveFavorite({source,titulo:details.title,url_origen:details.url,portada:details.cover,metadata:details}));
    }
    if(route==='/api/library/export')return db.exportLibrary();
    if(route==='/api/library/import')return save(()=>db.importLibrary(body));
    if(route==='/api/updates')return decorate(db.listUpdates(),options);
    if(folder){if(method==='GET')return db.listFolders();return save(()=>method==='DELETE'?db.removeFolder(folder[1]):db.saveFolder(body.name,folder[1]));}
    if(route==='/api/progress')return save(()=>db.updateProgress(body));
    if(series){const id=Number(series[1]),action=series[2];
      if(method==='DELETE'&&!action)return save(()=>db.removeFavorite(id));
      if(action==='library')return save(()=>db.updateLibrary(id,body));
      if(action==='chapters')return db.listChapters(id);
      if(action==='progress')return method==='GET'?db.getProgress(id):save(()=>db.updateProgress({...body,serie_id:id}));
      if(action==='edition')return save(()=>db.unlinkSeries(id));
      if(action==='sync'){const row=db.getSeries(id),result=await send('/api/vault/chapters',{source:row.source,url:row.url_origen},options);return save(()=>{if(result.manga)db.updateSourceMetadata(id,result.manga);return db.saveChapters(id,result.chapters);});}
    }
    if(chapter){const id=Number(chapter[1]);if(chapter[2]==='read')return save(()=>db.markChapterRead(id,body.read??true));
      if(chapter[2]==='images'){const row=db.getChapter(id),item=db.getSeries(row.serie_id),data=await send('/api/vault/images',{source:item.source,url:row.url_origen},options);return {...data,source:item.source,chapter:{...data.chapter,id,serie_id:item.id}};}
    }
    if(route==='/api/discovery'){if(method==='GET')return db.getDiscovery();return save(()=>method==='DELETE'?db.resetDiscovery():db.saveDiscovery(body));}
    if(route==='/api/discovery/feedback')return save(()=>method==='DELETE'?db.removeRecommendationFeedback(body.key):db.saveRecommendationFeedback(body.item,body.feedback));
    if(route==='/api/discovery/seen'&&method==='DELETE')return save(()=>db.resetSeenRecommendations());
    if(route==='/api/discovery/recommendations'){
      const discovery=db.getDiscovery(),ranking={...body,library:db.listSeries(),feedback:discovery.feedback,filters:body.filters??discovery.preferences},seeds=selectRecommendationSeeds(ranking);
      let filters=ranking.filters;
      if(!filters.genres.length&&!filters.themes.length){const tags=recommendationQueryTags(seeds);filters={...filters,genres:tags.filter(t=>t.kind==='genres').slice(0,3).map(t=>t.key),themes:tags.filter(t=>t.kind==='themes').slice(0,2).map(t=>t.key)};}
      const data=await send(route,{mode:'genres',filters,refresh:body.refresh,pages:body.pages},options);
      return {...data,mode:body.mode,personalized:seeds.length>0,results:rankRecommendations(data.results,{...ranking,limit:120})};
    }
    if(work){const id=Number(work[1]),action=work[2];
      if(!action){const value=db.getWork(id);return {...value,editions:await decorate(value.editions,options)};}
      if(action==='feedback')return save(()=>db.updateWorkFeedback(id,body));
      if(action==='editions')return save(()=>db.linkSeries(id,body.serie_id));
      if(action==='transfer'){const from=Number(body.from??url.searchParams.get('from')),to=Number(body.to??url.searchParams.get('to')),value=db.getWork(id);if(from===to||![from,to].every(id=>value.editions.some(row=>row.id===id)))throw fail('Elige dos ediciones de esta obra.','EDITION_MISMATCH',400);const progress=db.getProgress(from),match=equivalentChapter(db.listChapters(to),progress?db.getChapter(progress.capitulo_id).numero:null),info={from,to,chapter:match.chapter,canTransfer:Boolean(match.chapter),ambiguous:match.ambiguous};if(method==='GET')return info;if(!info.canTransfer)throw fail('No hay un capítulo equivalente.','CHAPTER_EQUIVALENCE_REQUIRED',409);return save(()=>({...info,progress:db.updateProgress({serie_id:to,capitulo_id:info.chapter.id,scroll_position_y:0,page_index:0,page_fraction:0})}));}
    }
    return read(path,options);
  }
  return {
    ready:init,owner:()=>document?.owner,
    async backup(){await reload();const backup=db.exportLibrary();return document.vault?.envelope?{...backup,version:2,includesPrivate:true,privateVault:{owner:document.owner,envelope:document.vault.envelope}}:backup;},
    handle(path,options={}){const run=async()=>{try{return response(await handle(path,options),document.revision);}catch(error){return new Response(JSON.stringify({error:{code:error.code??'DEVICE_ERROR',message:error.message}}),{status:error.status??400,headers:{'Content-Type':'application/json'}});}};if((options.method??'GET')==='GET'||path==='/api/discovery/recommendations'||path.startsWith('/api/vault/'))return tail.then(run);const task=tail.then(run);tail=task.catch(()=>{});return task;},
    sync:{cancel(){},async load(){return (await storage.read()).vault;},async revision(){return (await storage.read()).vault.revision;},async account(){const row=await storage.read();return {revision:row.revision,state:row.state};},async commit({expectedRevision,envelope},account={}){const next=await storage.update(row=>{if(row.vault.revision!==expectedRevision||account.state&&row.revision!==account.revision)throw fail('La bóveda cambió en otra pestaña.','VAULT_CHANGED',409);return {...row,...(account.state?{state:account.state,revision:row.revision+1}:{}),vault:{revision:expectedRevision+1,envelope}};});return {revision:next.vault.revision,accountRevision:next.revision};}}
  };
}
