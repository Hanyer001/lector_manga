import { cancellationError } from '../core/operation.js';

// Solo catálogos públicos sin ranking, portadas firmadas ni datos de la biblioteca.
export function createRecommendationCache({ttlMs=300000,maxEntries=128,now=Date.now}={}){
  const entries=new Map();
  return async function get(key,load,signal,{refresh=false}={}){
    if(signal?.aborted)throw cancellationError(signal);
    let entry=entries.get(key);
    if(entry?.value&&(!refresh&&entry.expires>now()))return {value:structuredClone(entry.value),cached:true};
    if(entry?.value){entries.delete(key);entry=null;}
    if(!entry){
      if(entries.size>=maxEntries){const old=[...entries].find(([,item])=>item.value);if(old)entries.delete(old[0]);}
      const controller=new AbortController();entry={controller,users:new Set()};if(entries.size<maxEntries)entries.set(key,entry);
      entry.promise=Promise.resolve().then(()=>load(controller.signal)).then(value=>{
        if(!controller.signal.aborted){entry.value=structuredClone(value);entry.expires=now()+(value.partial?Math.min(ttlMs,30000):ttlMs);}
        return value;
      }).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
    }
    const user={};entry.users.add(user);
    return new Promise((resolve,reject)=>{
      const release=()=>{signal?.removeEventListener('abort',abort);entry.users.delete(user);};
      const abort=()=>{release();if(!entry.value&&!entry.users.size){entry.controller.abort();if(entries.get(key)===entry)entries.delete(key);}reject(cancellationError(signal));};
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)return abort();
      entry.promise.then(value=>{if(!entry.users.has(user))return;release();resolve({value:structuredClone(value),cached:false});},error=>{if(!entry.users.has(user))return;release();reject(error);});
    });
  };
}
