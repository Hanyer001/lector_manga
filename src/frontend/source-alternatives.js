import {normalizeTag,itemKey} from './discovery-core.js';
// Las coincidencias son candidatos, nunca enlaces o transferencias automáticos.
export function createSourceAlternatives({api,state,preview,select,sourceName}) {
  const dialog=document.createElement('dialog');dialog.className='source-alternatives';dialog.setAttribute('aria-labelledby','alternative-title');
  dialog.innerHTML='<div class="panel-heading"><h2 id="alternative-title">Otras fuentes</h2><button type="button" class="button" aria-label="Cerrar otras fuentes">✕</button></div><p data-note class="small muted"></p><div data-results class="alternative-list"></div><p data-status role="status" class="small muted"></p>';
  document.body.append(dialog);let controller;
  dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>controller?.abort());
  return async(item,{number=null}={})=>{
    if(item.is_private)return;controller?.abort();controller=new AbortController();const signal=controller.signal,results=dialog.querySelector('[data-results]'),status=dialog.querySelector('[data-status]');results.replaceChildren();
    dialog.querySelector('[data-note]').textContent=`${item.title??item.titulo} · Comprueba título, autor y capítulos antes de elegir otra traducción. El progreso de la fuente anterior se conserva.`;
    const seen=new Set([itemKey(item)]),privateRows=state().series.filter(row=>row.is_private),privateKeys=new Set(privateRows.map(itemKey)),privateTitles=new Set(privateRows.flatMap(row=>[row.titulo,...(row.altTitles??[])]).map(normalizeTag));
    const append=(candidate,saved=false)=>{
      if(seen.has(itemKey(candidate))||privateKeys.has(itemKey(candidate))||privateTitles.has(normalizeTag(candidate.title??candidate.titulo)))return;seen.add(itemKey(candidate));
      const row=document.createElement('div');row.className='alternative-row';const label=document.createElement('span');label.textContent=`${candidate.title??candidate.titulo} · ${sourceName(candidate.source)}${saved?' · edición vinculada':''}`;const button=document.createElement('button');button.className='button';button.type='button';button.textContent=saved?'Ver edición guardada':'Comprobar ficha';button.addEventListener('click',()=>{dialog.close();if(saved)select(candidate);else preview(candidate,{number});});row.append(label,button);results.append(row);
    };
    if(item.work_id)for(const candidate of state().series.filter(row=>row.work_id===item.work_id&&!row.is_private))append(candidate,true);
    if(!dialog.open)dialog.showModal();status.textContent='Buscando ediciones en otros catálogos…';
    const queue=state().sources.filter(source=>source.enabled&&!source.demo&&source.capabilities.search&&source.id!==item.source);let failures=0,total=queue.length;
    const query=(item.title??item.titulo??'').slice(0,200),titles=new Set([query,...(item.altTitles??[])].map(normalizeTag));
    await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length&&!signal.aborted){const source=queue.shift(),request=new AbortController(),abort=()=>request.abort(),timer=setTimeout(abort,8000);signal.addEventListener('abort',abort,{once:true});try{const data=await api(`/api/sources/${encodeURIComponent(source.id)}/search?`+new URLSearchParams({q:query}),{signal:request.signal});if(signal.aborted)return;const items=(data.results??[]).sort((a,b)=>Number(titles.has(normalizeTag(b.title)))-Number(titles.has(normalizeTag(a.title))));for(const candidate of items.slice(0,3))append(candidate);}catch{failures++;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}}}));
    if(!signal.aborted)status.textContent=`${results.children.length} posibles ediciones · ${total-failures} catálogos consultados${failures?` · ${failures} sin respuesta`:''}. No se han guardado ni vinculado obras.`;
  };
}
