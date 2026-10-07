import { ApiError } from './errors.js';
import { sourceFor, allowedPageUrl } from './sources.js';
import { validateDiscovery } from '../storage/discovery.js';
import { normalizeMetadata } from '../storage/metadata.js';
import { equivalentChapter, rankRecommendations, selectRecommendationSeeds, recommendationQueryTags, tagKey, itemKey } from '../frontend/discovery-core.js';
import { isAdult, isPublicReading } from '../frontend/content-policy.js';
import { createRecommendationCache } from './recommendation-cache.js';
export function mountDiscovery(app,{database,sources,consult,withCover,sourceTimeoutMs=12000,cacheOptions={}}) {
  const metadataCache=new Map();
  const catalogCache=createRecommendationCache(cacheOptions);
  const publicDiscovery=(adult=false)=>{const data=database.getDiscovery(),hidden=new Set(database.listSeries().filter(item=>item.is_private).flatMap(item=>[item.titulo,item.work_title,...(item.altTitles??[])]).filter(Boolean).map(tagKey));return {...data,feedback:data.feedback.filter(item=>(adult||!isAdult(item))&&!hidden.has(tagKey(item.title)))};};
  app.get('/api/discovery',(_req,res)=>res.json(publicDiscovery()));
  app.put('/api/discovery',(req,res)=>res.json(database.saveDiscovery(req.body)));
  app.delete('/api/discovery',(_req,res)=>res.json(database.resetDiscovery()));
  app.post('/api/discovery/feedback',(req,res)=>{
    const item=req.body?.item,source=sourceFor(sources,item?.source);
    allowedPageUrl(item?.url,source);
    res.json(database.saveRecommendationFeedback(item,req.body?.feedback));
  });
  app.delete('/api/discovery/feedback',(req,res)=>res.json(database.removeRecommendationFeedback(req.body?.key)));
  app.delete('/api/discovery/seen',(_req,res)=>res.json(database.resetSeenRecommendations()));
  app.get('/api/works/:id',(req,res)=>{const work=database.getWork(req.params.id);res.json({...work,editions:work.editions.map(item=>withCover(item,sources.get(item.source)??{},item.url_origen))});});
  app.put('/api/works/:id/feedback',(req,res)=>res.json(database.updateWorkFeedback(req.params.id,req.body)));
  app.post('/api/works/:id/editions',(req,res)=>res.json(database.linkSeries(req.params.id,req.body?.serie_id)));
  app.delete('/api/series/:id/edition',(req,res)=>res.json(database.unlinkSeries(req.params.id)));
  const transferInfo=(id,from,to)=>{
    const work=database.getWork(id),source=work.editions.find(e=>e.id===Number(from)),target=work.editions.find(e=>e.id===Number(to));
    if(!source||!target||source.id===target.id)throw new ApiError(400,'EDITION_MISMATCH','Elige dos fuentes distintas de esta obra.');
    const progress=database.getProgress(source.id),chapter=progress?database.getChapter(progress.capitulo_id):null;
    const match=equivalentChapter(database.listChapters(target.id),chapter?.numero);
    return {from:source.id,to:target.id,number:chapter?.numero??null,chapter:match.chapter,ambiguous:match.ambiguous,
      canTransfer:Boolean(match.chapter),message:match.chapter?'Número coincidente. La otra traducción puede dividir los capítulos de forma distinta; se empezará desde el inicio.':match.ambiguous?'Hay varias traducciones con este número. Elige el capítulo manualmente.':'No hay una correspondencia única. Actualiza la fuente o elige un capítulo manualmente.'};
  };
  app.get('/api/works/:id/transfer',(req,res)=>res.json(transferInfo(req.params.id,req.query.from,req.query.to)));
  app.post('/api/works/:id/transfer',(req,res)=>{
    const info=transferInfo(req.params.id,req.body?.from,req.body?.to);
    if(!info.canTransfer)throw new ApiError(409,'CHAPTER_EQUIVALENCE_REQUIRED',info.message);
    const progress=database.updateProgress({serie_id:info.to,capitulo_id:info.chapter.id,scroll_position_y:0,page_index:0,page_fraction:0});
    res.json({...info,progress});
  });
  app.post('/api/discovery/recommendations',async(req,res)=>{
    const started=Date.now(),stream=req.headers.accept?.includes('application/x-ndjson');
    const send=async(type,input)=>{if(type==='progress'||type==='complete')await database.refreshAccount?.();const data=typeof input==='function'?input():input;if(!req.operationSignal.aborted&&!res.writableEnded)res.write(JSON.stringify({type,...data})+'\n');};
    try {
    const body=req.body??{},mode=body.mode??'personal',pages=body.pages??null;
    if(pages&&(!pages||typeof pages!=='object'||Array.isArray(pages)||Object.keys(pages).length>20||Object.values(pages).some(value=>!Number.isSafeInteger(value)||value<0||value>100)))throw new ApiError(400,'INVALID_QUERY','Paginación inválida.');
    const nextPages={};
    if(!['personal','recent','similar','diverse','genres'].includes(mode))throw new ApiError(400,'INVALID_QUERY','Modo de recomendación inválido.');
    const preferences=database.getDiscovery().preferences,filters=validateDiscovery(body.filters??preferences),adult=filters.genres.some(genre=>tagKey(genre)==='adult'),discovery=publicDiscovery(adult),library=database.listSeries().filter(item=>!item.is_private&&(adult?isAdult(item):isPublicReading(item))),warnings=[];
    let seedWorkId=body.seedWorkId??null;const seedFeedbackKey=body.seedFeedbackKey??null;
    if(seedWorkId!==null){const seed=database.getWork(seedWorkId);if(seed.editions.some(item=>item.is_private||(!adult&&isAdult(item))))throw new ApiError(403,'PRIVATE_RECOMMENDATION','Esta lectura no se utiliza en recomendaciones generales.');seedWorkId=seed.id;}
    if(seedFeedbackKey!==null&&(typeof seedFeedbackKey!=='string'||!discovery.feedback.some(item=>itemKey(item)===seedFeedbackKey)))throw new ApiError(404,'SEED_NOT_FOUND','La sugerencia elegida ya no está disponible.');
    if(seedWorkId&&seedFeedbackKey)throw new ApiError(400,'INVALID_QUERY','Elige una sola obra para buscar similares.');
    if(mode==='similar'&&!seedWorkId&&!seedFeedbackKey)throw new ApiError(400,'INVALID_QUERY','Elige una obra para buscar similares.');
    const available=[...sources].filter(([id,source])=>source.enabled!==false&&!source.demo&&(!adult||source.capabilities?.adult)&&(source.capabilities?.recommend||(id==='mangadex'&&source.capabilities?.recommend!==false)));
    for(const id of filters.sources)if(!available.some(([key])=>key===id))throw new ApiError(400,'UNSUPPORTED_OPERATION','Una fuente elegida no admite recomendaciones.');
    const selected=available.filter(([id])=>(!filters.sources.length||filters.sources.includes(id))&&(!pages||Object.hasOwn(pages,id)));
    if(!selected.length)throw new ApiError(400,'UNSUPPORTED_OPERATION','No hay catálogos de recomendaciones disponibles.');
    if(stream){res.set('Content-Type','application/x-ndjson; charset=utf-8');res.set('X-Accel-Buffering','no');res.flushHeaders();send('start',{results:[],sources:selected.map(([id,source])=>({id,name:source.name??id,status:'pending',messages:[],count:0})),mode,elapsedMs:Date.now()-started});}
    // Completa las etiquetas faltantes para recomendar sin alterar la biblioteca.
    // La caché contiene solo metadatos en RAM y dura diez minutos.
    const metadataRows=mode==='genres'||mode==='diverse'?[]:library.filter(row=>(!row.genres?.length&&!row.themes?.length||mode==='similar'&&!row.themes?.length)&&(!seedWorkId||row.work_id===seedWorkId)&&(!seedFeedbackKey)&&(!(mode==='recent')||row.ultima_lectura)&&(mode==='similar'||row.reading_state!=='abandoned'&&row.sentiment!=='dislike')).sort((a,b)=>(b.ultima_lectura??0)-(a.ultima_lectura??0)).slice(0,3);
    await Promise.all(metadataRows.map(async row=>{
      const editionSource=sources.get(row.source);if(!editionSource?.capabilities?.manga||editionSource.enabled===false)return;
      const key=itemKey(row),cached=metadataCache.get(key);
      try{
        const metadata=cached&&cached.expires>Date.now()?cached.metadata:normalizeMetadata((await consult({operationSignal:AbortSignal.any([req.operationSignal,AbortSignal.timeout(4000)])},editionSource,'getManga',allowedPageUrl(row.url_origen,editionSource))).manga);
        if(metadataCache.size>=200&&!metadataCache.has(key))metadataCache.delete(metadataCache.keys().next().value);
        metadataCache.set(key,{metadata,expires:Date.now()+600000});
        for(const [field,value] of Object.entries(metadata))if(!row.manualFields?.includes(field)&&!(Array.isArray(value)&&!value.length&&row[field]?.length))row[field]=value;
      }catch(error){if(req.operationSignal.aborted)throw error;warnings.push(`No se pudieron completar etiquetas de ${row.titulo}: ${error.message}`);}
    }));
    const ranking={library,feedback:discovery.feedback,filters,mode,seedWorkId,seedFeedbackKey,limit:120};
    const seeds=selectRecommendationSeeds(ranking),personalized=seeds.some(s=>s.genres?.length||s.themes?.length||s.authors?.length);
    const excluded=new Set([...filters.excludeGenres,...filters.excludeThemes].map(tagKey));
    const learned=mode==='diverse'?[]:recommendationQueryTags(seeds).filter(item=>!excluded.has(item.key));
    const queries=filters.genres.length||filters.themes.length?[filters]:learned.length?learned.map(({kind,key})=>({...filters,genres:[],themes:[],[kind]:[key]})):[filters];
    const candidateMap=new Map();
    const providers=new Map(selected.map(([id,source])=>[id,{id,name:source.name??id,status:'pending',candidates:0,count:0,messages:[],cached:false}]));
    const coverCache=new Map();
    const safeCandidates=()=>{const hidden=new Set(database.listSeries().filter(item=>item.is_private||(!adult&&isAdult(item))).flatMap(item=>[item.titulo,item.work_title,...(item.altTitles??[])]).filter(Boolean).map(tagKey));return [...candidateMap.values()].filter(item=>isAdult(item)===adult&&![item.title,...(item.altTitles??[])].some(title=>hidden.has(tagKey(title))));};
    const snapshot=()=>{
      const hiddenRows=database.listSeries().filter(item=>item.is_private||(!adult&&isAdult(item))),hiddenIds=new Set(hiddenRows.map(item=>item.id)),hiddenTitles=hiddenRows.flatMap(item=>[item.titulo,item.work_title,...(item.altTitles??[])]).filter(Boolean);
      const currentRanking={...ranking,library:library.filter(item=>!hiddenIds.has(item.id)),feedback:publicDiscovery(adult).feedback};
      const currentSeeds=selectRecommendationSeeds(currentRanking),currentPersonalized=currentSeeds.some(s=>s.genres?.length||s.themes?.length||s.authors?.length);
      const results=rankRecommendations(safeCandidates(),currentRanking);
      return {nextPages,results:results.map(item=>{const key=itemKey(item);if(!coverCache.has(key))coverCache.set(key,withCover(item,sourceFor(sources,item.source),item.url));const cover=coverCache.get(key);return {...item,coverUrl:cover.coverUrl,coverVariants:cover.coverVariants};}),
        warnings:[...new Set([...[...providers.values()].flatMap(provider=>provider.messages.map(message=>`${provider.name}: ${message}`)),...warnings])].filter(message=>!hiddenTitles.some(title=>message.includes(title))),
        sources:[...providers.values()].map(provider=>({...provider,count:results.filter(item=>item.source===provider.id).length})),mode,personalized:currentPersonalized,candidateCount:candidateMap.size,elapsedMs:Date.now()-started,
        message:mode==='recent'&&!currentSeeds.length?'Aún no hay lecturas recientes para recomendar. Abre un capítulo o prueba Para ti.':mode==='similar'&&!currentPersonalized?'Esta obra necesita géneros, temas o autor para encontrar similares. Completa su ficha.':!results.length&&['similar','personal','recent'].includes(mode)&&currentPersonalized?'No encontramos coincidencias suficientes. Prueba otro catálogo o menos filtros.':''};
    };
    if(mode==='recent'&&!personalized||mode==='similar'&&!personalized){for(const provider of providers.values())provider.status='empty';await database.refreshAccount?.();const result=snapshot();if(stream){await send('complete',snapshot);res.end();}else res.json(result);return;}
    // Las inclusiones de temas siempre son conjuntas; los géneros pueden combinarse con O o Y.
    const sourceQueries=filters.genreMatch==='any'&&filters.genres.length>1?filters.genres.map(genre=>({...filters,genres:[genre]})):queries;
    await Promise.all(selected.map(async([id,source])=>{
      const providerStarted=Date.now(),provider=providers.get(id),items=new Map(),messages=[],budget=id==='tumanga'?Math.min(sourceTimeoutMs,8000):sourceTimeoutMs,signal=AbortSignal.any([req.operationSignal,AbortSignal.timeout(budget)]);
      let successes=0,failures=0,unsupported=0,partial=false,cached=0;
      provider.status='loading';
      const requests=source.recommendationCatalogOnly?[{adult}]:sourceQueries;
      await Promise.all(requests.map(async query=>{if(signal.aborted)return;try{
        const options={...query,page:pages?.[id]??0,adult,genres:(query.genres??[]).filter(genre=>tagKey(genre)!=='adult'),excludeGenres:(query.excludeGenres??[]).filter(genre=>tagKey(genre)!=='adult')};
        const cacheKey=JSON.stringify([id,...['genres','themes','excludeGenres','excludeThemes'].map(key=>(options[key]??[]).map(tagKey).sort()),options.country??'',options.status??'',adult,options.page]);
        const {value:result,cached:hit}=await catalogCache(cacheKey,async loadSignal=>{
          const result=await consult({operationSignal:AbortSignal.any([loadSignal,AbortSignal.timeout(budget)])},source,'recommend',options);
          if(!Array.isArray(result.results))throw new ApiError(502,'INVALID_RESPONSE','El catálogo devolvió resultados inválidos.');
          for(const item of result.results)allowedPageUrl(item.url,source);
          return result;
        },signal,{refresh:body.refresh===true});
        successes++;
        if(Number.isSafeInteger(result.nextPage)&&result.nextPage>options.page)nextPages[id]=result.nextPage;
        if(hit)cached++;
        if(result.partial)partial=true;
        for(const message of (result.warnings??[]).slice(0,5))if(typeof message==='string')messages.push(message);
        if(result.unavailableTags?.length){unsupported++;messages.push(`Géneros o temas no disponibles: ${result.unavailableTags.join(', ')}.`);}
        for(const item of result.results){const key=itemKey({...item,source:id}),previous=items.get(key),candidate={...previous,...item,source:id};
          for(const field of ['genres','themes','authors','altTitles'])if(previous?.[field]||item[field])candidate[field]=[...new Set([...(previous?.[field]??[]),...(item[field]??[])])];
          items.set(key,candidate);candidateMap.set(key,candidate);}
      }catch(error){if(req.operationSignal.aborted)throw error;failures++;messages.push(error.message);}
        Object.assign(provider,{candidates:items.size,messages:[...new Set(messages)],cached:cached===successes&&successes>0});
        if(stream)await send('progress',snapshot);
      }));
      if(signal.aborted&&!req.operationSignal.aborted&&!failures){failures++;messages.push('Tiempo de consulta agotado; se conservan los resultados obtenidos.');}
      Object.assign(provider,{status:failures?(successes?'partial':'error'):items.size?partial?'partial':'ok':unsupported===successes&&successes?'unsupported':'empty',candidates:items.size,messages:[...new Set(messages)],cached:cached===successes&&successes>0,durationMs:Date.now()-providerStarted});
      if(stream)await send('progress',snapshot);
    }));
    let candidates=safeCandidates();
    if(filters.minChapters>0){
      // La cantidad se verifica por capítulos únicos en español, no por el último número publicado.
      candidates=rankRecommendations(candidates,{...ranking,filters:{...filters,minChapters:0}}).slice(0,12);
      candidateMap.clear();for(const item of candidates)candidateMap.set(itemKey(item),item);
      let cursor=0,failures=0;
      const signal=AbortSignal.any([req.operationSignal,AbortSignal.timeout(15000)]);
      const worker=async()=>{while(cursor<candidates.length&&!signal.aborted){const item=candidates[cursor++];try{const {value}=await catalogCache('chapters|'+itemKey(item),async loadSignal=>{const result=await consult({operationSignal:AbortSignal.any([loadSignal,AbortSignal.timeout(15000)])},sourceFor(sources,item.source),'getChapters',item.url);return {count:new Set(result.chapters.map(c=>c.number==null?c.url:`number:${c.number}`)).size};},signal,{refresh:body.refresh===true});item.verified_chapters=value.count;if(stream)await send('progress',snapshot);}catch(error){if(req.operationSignal.aborted)throw error;failures++;}}};
      await Promise.all([worker(),worker()]);
      candidateMap.clear();for(const item of candidates)candidateMap.set(itemKey(item),item);
      warnings.push(`Se comprobó el mínimo en ${candidates.length} candidatas${failures?`; ${failures} no pudieron verificarse`:''}.`);
    }
    await database.refreshAccount?.();const result=snapshot();if(stream){await send('complete',snapshot);res.end();}else res.json(result);
    }catch(error){if(res.headersSent){await send('error',{error:{code:error.code??'DISCOVERY_ERROR',message:error.message}});res.end();}else throw error;}
  });
}
