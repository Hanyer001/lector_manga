import {createChapterBrowser} from './chapter-browser.js';
import {initializeDialog} from './dialog-ui.js';
import {setCover,clearCover,isProxyUrl} from './network.js';
import {tagLabel} from './discovery-core.js';
import {trialChapters,matchingTrialChapter} from './trial-reading.js';
const statuses={ongoing:'En emisión',completed:'Finalizado',hiatus:'En pausa',cancelled:'Cancelado'};
export function createSeriesPreview({api,add,select,findSaved,read,alternatives,sourceName=id=>id}) {
  const dialog=document.createElement('dialog');dialog.className='series-preview';dialog.setAttribute('aria-labelledby','preview-title');
  dialog.innerHTML='<div class="panel-heading"><p class="eyebrow">VISTA PREVIA</p><button type="button" class="button" aria-label="Cerrar vista previa">✕</button></div><div class="picked-series"><img alt="" decoding="async"><div><h2 id="preview-title"></h2><p class="small muted" data-source-name></p><p class="small muted" data-authors></p><p class="small muted" data-publication></p></div></div><p data-tags class="preview-tags"></p><p data-description class="preview-description"></p><div class="preview-primary-actions"><button type="button" class="button primary" data-start>Leer primer capítulo</button><button type="button" class="button" data-save>Guardar en biblioteca</button></div><aside data-reason class="preview-reason" hidden><p class="eyebrow">POR QUÉ TE LA SUGERIMOS</p><p data-explanation></p><p data-matches class="small"></p><div class="panel-actions"><button type="button" class="button" data-dislike>No me interesa</button><button type="button" class="button subtle" data-adjust>Ajustar mis filtros</button></div><p class="small muted">Coincidencias del catálogo; no garantizan el mismo tono o calidad. Puedes ajustar tus géneros y descartar sugerencias.</p></aside><p class="small muted" data-status role="status"></p><section class="preview-chapters"><button type="button" class="button" data-chapters>Consultar capítulos</button><div data-chapter-picker hidden><div data-browser></div><label hidden>Capítulo para probar<select data-chapter-select aria-label="Capítulo para probar"></select></label><label data-equivalence hidden><input type="checkbox" data-confirm> He comprobado que el capítulo corresponde a la otra edición</label><p class="small muted" data-chapter-note></p><button type="button" class="button primary" data-read disabled>Leer sin guardar</button></div></section><div class="panel-actions"><button type="button" class="button primary" data-add>Añadir a biblioteca</button><button type="button" class="button" data-alternatives>Buscar otras fuentes</button><a class="button" target="_blank" rel="noopener noreferrer" data-source>Abrir en la fuente ↗</a></div>';
  document.body.append(dialog);
  initializeDialog(dialog);
  const $=name=>dialog.querySelector('[data-'+name+']'),image=dialog.querySelector('img'),title=dialog.querySelector('h2');
  let current,controller,list=[],requestedNumber=null,loading=false,options={};
  const browser = createChapterBrowser($('browser'), {temporary:true,onChoose:(_chapter,index)=>{ $('chapter-select').value=String(index); updateRead(); }});
  $('save').addEventListener('click',()=>$('add').click());
  $('start').addEventListener('click',async()=>{ if (!current) return;if(current.metadataOnly){$('alternatives').click();return;} const saved=findSaved(current); if(saved){dialog.close();if(saved.ultimo_capitulo_id)read?.(saved,null,null,{saved:true});else await select(saved);return;} const loaded=await loadChapters(); if(!loaded||!current||!list.length||requestedNumber!==null)return; const item=current,chapter=list[0],chapters=list; dialog.close(); read?.(item,chapter,chapters); });
  const showMetadata=details=>{
    $('tags').textContent=[...(details.genres??[]),...(details.themes??[])].map(tagLabel).join(' · ')||'Sin etiquetas disponibles';
    $('description').textContent=details.description||'Esta fuente no incluye una sinopsis.';
    $('authors').textContent=details.authors?.length?'Autoría: '+details.authors.join(', '):'Autoría no disponible';
    $('publication').textContent=[statuses[details.status]??'Estado no disponible',details.country].filter(Boolean).join(' · ');
  };
  const updateRead=()=>{$('read').disabled=!$('chapter-select').value||(!$('equivalence').hidden&&!$('confirm').checked);};
  dialog.querySelector('[aria-label]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{controller?.abort();clearCover(image);browser.clear();current=null;list=[];});
  $('dislike').addEventListener('click',()=>{const item=current,feedback=options.feedback;dialog.close();feedback?.(item,'hidden');});$('adjust').addEventListener('click',()=>{const adjust=options.adjust;dialog.close();adjust?.();});
  $('chapter-select').addEventListener('change',updateRead);$('confirm').addEventListener('change',updateRead);
  $('add').addEventListener('click',async()=>{const item=current;if(!item)return;const saved=findSaved(item);dialog.close();if(saved)await select(saved);else await add(item.url??item.url_origen);});
  $('alternatives').addEventListener('click',()=>{const item=current;if(!item)return;dialog.close();alternatives?.(item,{number:requestedNumber});});
  async function loadChapters(){
    if(!current||loading)return;const item=current,signal=controller.signal;loading=true;$('chapters').disabled=true;$('start').disabled=true;browser.loading();$('status').textContent='Consultando capítulos…';
    try{
      const result=await api('/api/vault/chapters',{method:'POST',body:JSON.stringify({source:item.source,url:item.url??item.url_origen}),signal});
      if(signal.aborted||current!==item)return;
      list=trialChapters(result.chapters);$('chapter-select').replaceChildren(...list.map((chapter,index)=>new Option(chapter.title,String(index))));
      const match=matchingTrialChapter(list,requestedNumber);if(match.index!==null)$('chapter-select').value=String(match.index);
      $('equivalence').hidden=requestedNumber===null;$('confirm').checked=false;
      $('chapter-note').textContent=requestedNumber!==null?match.message:'La lectura es temporal. Solo se guarda la obra al pulsar Añadir a biblioteca.';
      browser.update(list,{reset:true,selectedId:list[Number($('chapter-select').value)]?.id});
      $('chapter-picker').hidden=false;$('chapters').textContent=`Actualizar capítulos (${list.length})`;
      $('status').textContent=list.length?`${list.length} capítulos disponibles · ${sourceName(item.source)}`:'La fuente no devolvió capítulos.';updateRead();return true;
    }catch(error){if(!signal.aborted)$('status').textContent=error.message;return false;}
    finally{if(!signal.aborted&&current===item){loading=false;$('chapters').disabled=false;$('start').disabled=false;}}
  }
  $('chapters').addEventListener('click',loadChapters);
  $('read').addEventListener('click',()=>{if($('read').disabled||!current)return;const item=current,chapter=list[Number($('chapter-select').value)],chapters=list;dialog.close();read?.(item,chapter,chapters);});
  return async (item,settings={})=>{
    const {number=null}=settings;options=settings;
    controller?.abort();controller=new AbortController();const signal=controller.signal;current=item;list=[];requestedNumber=Number.isFinite(number)?number:null;loading=false;
    title.textContent=item.title??item.titulo;$('source-name').textContent=sourceName(item.source);showMetadata(item);
    const saved=findSaved(item);
    $('add').textContent=saved?'Ver capítulos guardados':'Añadir a biblioteca';
    $('save').textContent=saved?'En tu biblioteca · ver ficha':'Guardar en biblioteca';
    $('start').textContent=saved?.ultimo_capitulo_id?'Continuar lectura':'Leer primer capítulo';
    $('start').disabled=false;$('start').hidden=requestedNumber!==null;browser.clear();$('status').textContent='Consultar o probar esta obra no la añade a tu biblioteca.';
    $('chapter-picker').hidden=true;$('chapters').disabled=false;$('chapters').textContent='Consultar capítulos';$('read').disabled=true;
    $('add').hidden=$('save').hidden=Boolean(item.metadataOnly);$('chapters').closest('section').hidden=Boolean(item.metadataOnly);
    if(item.metadataOnly){$('start').textContent='Buscar dónde leer';$('status').textContent='Catálogo de fichas: no aloja capítulos. Las sinopsis pueden estar en otro idioma. Busca una edición en tus fuentes de lectura.';}
    $('reason').hidden=!item.reason;$('explanation').textContent=item.reason??'';
    $('matches').textContent=[item.explanation?.sharedTags?.length?'Etiquetas compartidas: '+item.explanation.sharedTags.join(', '):'',item.explanation?.sharedAuthors?.length?'Autoría compartida: '+item.explanation.sharedAuthors.join(', '):''].filter(Boolean).join(' · ');
    $('dislike').hidden=!options.feedback;$('adjust').hidden=!options.adjust;
    image.hidden=!isProxyUrl(item.coverUrl);clearCover(image);if(!image.hidden)setCover(image,item.coverUrl,item.coverKey);
    try{const url=new URL(item.url??item.url_origen);$('source').hidden=!['http:','https:'].includes(url.protocol);if(!$('source').hidden)$('source').href=url.href;}catch{$('source').hidden=true;}
    if(!dialog.open)dialog.showModal();
    try{const result=await api(`/api/sources/${encodeURIComponent(item.source)}/manga?url=${encodeURIComponent(item.url??item.url_origen)}`,{signal});if(signal.aborted||current!==item)return;showMetadata({...item,...result.manga});}
    catch(error){if(!signal.aborted&&current===item)$('status').textContent='No se pudieron completar los detalles. Puedes consultar los capítulos o volver a abrir la ficha.';}
  };
}
