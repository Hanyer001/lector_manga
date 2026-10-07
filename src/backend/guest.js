import {ApiError} from './errors.js';

// Sólo recursos públicos de las fuentes. Nunca abre una cuenta de Supabase.
export function guestResources({now=Date.now}={}) {
  const clients=new Map();let active=0;
  return (req,res,next)=>{
    if(!req.url.startsWith('/api/guest/'))return next();
    const path=req.url.slice('/api/guest'.length).split('?')[0];
    const allowed=req.method==='GET'&&(/^\/sources(?:\/[a-z0-9-]+(?:\/(?:search|manga|recommendations))?)?$/.test(path)||path==='/image')||
      req.method==='POST'&&['/vault/covers','/vault/chapters','/vault/images','/discovery/recommendations','/adult/catalog'].includes(path);
    if(!allowed)return next(new ApiError(404,'NOT_FOUND','Recurso público no disponible.'));
    const time=now(),key=req.ip??req.socket.remoteAddress;
    for(const [id,value] of clients)if(value.reset<=time&&!value.active)clients.delete(id);
    if(!clients.has(key)&&clients.size>=5000)return next(new ApiError(429,'BUSY','Servidor ocupado. Reintenta en un momento.'));
    const state=clients.get(key)??{reset:time+60000,images:0,queries:0,active:0};clients.set(key,state);
    if(state.reset<=time){state.reset=time+60000;state.images=state.queries=0;}
    const kind=path==='/image'?'images':'queries',limit=kind==='images'?240:60;
    if(++state[kind]>limit||state.active>=8||active>=48){res.set('Retry-After','10');return next(new ApiError(429,'RATE_LIMIT','Demasiadas consultas. Reintenta en unos segundos.'));}
    state.active++;active++;let released=false;
    const release=()=>{if(!released){released=true;state.active--;active--;}};res.once('finish',release);res.once('close',release);
    req.guest=true;req.url='/api'+req.url.slice('/api/guest'.length);next();
  };
}
