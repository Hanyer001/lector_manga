import {ApiError,positiveId} from './errors.js';
import {sourceFor,allowedPageUrl,allowedImageUrl} from './sources.js';
// El proxy solo resuelve recursos de fuentes; la bóveda usa Supabase directamente.
export function mountVault(app,{store,sources,tickets,consult}) {
  app.use('/api/vault',async(req,_res,next)=>{try{req.vaultUser=req.guest?{id:'guest'}:store?await store.authenticate(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]):{id:'local'};next();}catch(error){next(error);}});
  // Consultas de lectura transitorias: sus respuestas no se guardan en la biblioteca.
  const signed=(user,source,image,referer)=>(user.id==='guest'?'/api/guest/image?ticket=':'/api/image?ticket=')+encodeURIComponent(tickets.issue({source:source.id,url:allowedImageUrl(image,source),referer:allowedPageUrl(referer,source),ownerId:user.id}));
  app.post('/api/vault/covers',(req,res)=>{
    if(!Array.isArray(req.body?.items)||req.body.items.length>1000)throw new ApiError(400,'INVALID_QUERY','Portadas inválidas.');
    res.json(req.body.items.map(item=>{const source=sourceFor(sources,item.source);return {id:positiveId(item.id),coverUrl:item.cover?signed(req.vaultUser,source,item.cover,item.url):null};}));
  });
  app.post('/api/vault/chapters',async(req,res)=>{
    const source=sourceFor(sources,req.body?.source),url=allowedPageUrl(req.body?.url,source);
    if(!source.capabilities?.chapters)throw new ApiError(400,'UNSUPPORTED_OPERATION','La fuente no permite consultar capítulos.');
    const result=await consult(req,source,'getChapters',url);
    for(const chapter of result.chapters)allowedPageUrl(chapter.url,source);res.json(result);
  });
  app.post('/api/vault/images',async(req,res)=>{
    const source=sourceFor(sources,req.body?.source),url=allowedPageUrl(req.body?.url,source);
    if(!source.capabilities?.images)throw new ApiError(400,'UNSUPPORTED_OPERATION','La fuente no permite leer imágenes.');
    const result=await consult(req,source,'getChapterImages',url);
    res.json({...result,images:result.images.map(image=>({...image,originalUrl:allowedImageUrl(image.url,source),url:signed(req.vaultUser,source,image.url,image.referer)}))});
  });
}
