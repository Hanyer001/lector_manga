import { renderSeriesCards } from './library-view.js';
import { setCover } from './network.js';
import { createDiscoveryUI } from './discovery-ui.js';
import { groupWorks } from './discovery-core.js';
import { isPublicReading } from './content-policy.js';

const $ = id => document.getElementById(id);
const text = (tag, value, className = '') => Object.assign(document.createElement(tag), { textContent:value, className });
const sameWork = (a,b) => a.source === b.source && (a.url_origen ?? a.url) === (b.url_origen ?? b.url);
const filterIds = ['library-query','source-filter','genre-filter','author-filter','publication-filter','reading-filter','folder-filter','only-unread'];

export function createShell({ preview, api, state, navigate, select, resume, add, filter, reload, dialog, beginQuery, endQuery }) {
  let folders=[],updates=[],folderEditing,updateGeneration=0,searchGeneration=0,searchAbort,syncAbort;
  let selectedItem,metadataOriginal,searchGroups=[],searchTimer;
  const sourceName = id => state().sources.find(source=>source.id===id)?.name ?? id;
  const hasFavorite = item => state().series.some(saved=>sameWork(saved,item));
  const cardOptions = () => ({ sourceName,onSelect:preview,onResume:resume,onAdd:item=>add(item.url),hasFavorite });
  const discovery=createDiscoveryUI({preview,api,state,reload,select,add,navigate,beginQuery,endQuery,sourceName});
  function fill(id, values, placeholder, unknown=false) {
    const previous=$(id).value;
    $(id).replaceChildren(new Option(placeholder,''),...values.map(value=>new Option(value.name??value,value.id??value)));
    if(unknown) $(id).add(new Option('Sin datos','__unknown'));
    if([...$(id).options].some(option=>option.value===previous)) $(id).value=previous;
  }
  function appearanceForm() {
    const preferences=window.LectorAppearance.get();
    for(const key of ['theme','accent','custom','density']) $('appearance-'+key).value=preferences[key];
    for(const key of ['flags','glass']) $('appearance-'+key).checked=preferences[key];
  }
  appearanceForm();
  for(const key of ['theme','accent','custom','density','flags','glass']) $('appearance-'+key).addEventListener('input',()=>{
    const control=$('appearance-'+key);
    window.LectorAppearance.set({ [key]:control.type==='checkbox'?control.checked:control.value,...(key==='custom'?{accent:'custom'}:{}) });
    appearanceForm(); $('appearance-status').textContent='Apariencia guardada en este navegador.';
  });
  window.addEventListener('appearancechange',appearanceForm);
  $('reset-appearance').addEventListener('click',()=>{window.LectorAppearance.reset();appearanceForm();$('appearance-status').textContent='Apariencia restaurada.';});
  $('discover-explore').addEventListener('click',()=>navigate('explore'));
  $('show-home').addEventListener('click',()=>navigate('home'));
  $('show-settings').addEventListener('click',()=>navigate('settings'));
  for(const id of ['continue-prev','continue-next']) $(id).addEventListener('click',()=>{
    $('continue-carousel').scrollBy({left:(id==='continue-prev'?-1:1)*400,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  function renderHome() {
    const recent=groupWorks(state().series.filter(isPublicReading)).filter(item=>item.ultimo_capitulo_id).sort((a,b)=>(b.ultima_lectura??0)-(a.ultima_lectura??0)).slice(0,10);
    renderSeriesCards($('continue-carousel'),recent,{sourceName,onSelect:select,onResume:resume});
    if(!recent.length) $('continue-carousel').replaceChildren(text('p','Tus últimas lecturas aparecerán aquí.','series-empty'));
    $('continue-prev').disabled=$('continue-next').disabled=recent.length<2;
    $('updates-list').replaceChildren();
    if(!updates.length) $('updates-list').append(text('p','No hay novedades detectadas. Actualiza tus series para comprobarlas.','series-empty'));
    for(const update of updates) {
      const row=document.createElement('article');row.className='update-card';
      if(update.coverUrl) {const image=document.createElement('img');image.alt='';image.loading='lazy';row.append(image);setCover(image,update.coverUrl);}
      const copy=document.createElement('div');copy.append(text('h3',update.titulo),text('p',update.chapter_title),
        text('p',`${sourceName(update.source)} · Detectado ${new Date(update.first_seen_at).toLocaleDateString('es')}`));
      const button=text('button','Leer ↗','button primary');button.type='button';button.addEventListener('click',()=>resume({...update,ultimo_capitulo_id:update.id}));
      row.append(copy,button);$('updates-list').append(row);
    }
  }
  $('sync-library').addEventListener('click',async()=>{
    const saved=state().series.filter(item=>isPublicReading(item)&&state().sources.some(source=>source.id===item.source&&source.enabled));
    if(!saved.length){$('updates-status').textContent='Añade una serie de una fuente activa para actualizarla.';return;}
    syncAbort?.abort();const controller=syncAbort=beginQuery();$('sync-library').disabled=true;
    let cursor=0,finished=0;const failures=[];
    const worker=async()=>{while(cursor<saved.length&&!controller.signal.aborted){const item=saved[cursor++];try{await api(`/api/series/${item.id}/sync`,{method:'POST',signal:controller.signal});}catch(error){if(!controller.signal.aborted)failures.push(`${item.titulo}: ${error.message}`);}finished++;if(!controller.signal.aborted)$('updates-status').textContent=`Actualizando ${finished}/${saved.length} series…`;}};
    await Promise.all(Array.from({length:Math.min(3,saved.length)},worker));
    await reload();
    $('updates-status').textContent=controller.signal.aborted?'Actualización cancelada.':failures.length?`${finished-failures.length} series actualizadas. ${failures.join(' · ')}`:`${finished} series actualizadas. Se consultaron los enlaces de capítulos.`;
    $('sync-library').disabled=false;endQuery(controller);
  });
  function renderFolders() {
    $('folder-list').replaceChildren();
    for(const folder of folders) {
      const row=document.createElement('div');row.className='folder-row';row.append(text('span',`${folder.name} · ${folder.count??0}`));
      const rename=text('button','Renombrar','button subtle');rename.type='button';rename.addEventListener('click',()=>{folderEditing=folder.id;$('folder-name').value=folder.name;$('folder-save').textContent='Guardar nombre';$('folder-cancel-edit').hidden=false;$('folder-name').focus();});
      const remove=text('button','Quitar','button subtle');remove.type='button';remove.setAttribute('aria-label',`Quitar carpeta ${folder.name}`);
      remove.addEventListener('click',async()=>{if(remove.dataset.confirm!=='yes'){remove.dataset.confirm='yes';remove.textContent='Confirmar';$('folder-status').textContent='Solo se quitará la carpeta. Sus series se conservarán.';return;}remove.disabled=true;try{await api('/api/folders/'+folder.id,{method:'DELETE'});resetFolderEdit();await reload();$('folder-status').textContent='Carpeta quitada; tus series se conservaron.';}catch(error){$('folder-status').textContent=error.message;remove.disabled=false;}});
      row.append(rename,remove);$('folder-list').append(row);
    }
  }
  function resetFolderEdit(){folderEditing=undefined;$('folder-name').value='';$('folder-save').textContent='Crear carpeta';$('folder-cancel-edit').hidden=true;}
  $('manage-folders').addEventListener('click',()=>{resetFolderEdit();renderFolders();dialog('folder-panel',true);});
  $('folder-close').addEventListener('click',()=>dialog('folder-panel',false));
  $('folder-cancel-edit').addEventListener('click',resetFolderEdit);
  $('folder-form').addEventListener('submit',async event=>{
    event.preventDefault();$('folder-save').disabled=true;
    try{await api('/api/folders'+(folderEditing?'/'+folderEditing:''),{method:folderEditing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('folder-name').value.trim()})});resetFolderEdit();await reload();$('folder-status').textContent='Carpeta guardada.';}catch(error){$('folder-status').textContent=error.message;}
    finally{$('folder-save').disabled=false;}
  });
  function organize(item) {
    selectedItem=item;discovery.organize(item);metadataOriginal={genres:item.genres??[],themes:item.themes??[],authors:item.authors??[],status:item.status??'unknown',country:item.country??null};
    $('series-reading-state').value=item.reading_state??'planned';$('series-genres').value=metadataOriginal.genres.join(', ');$('series-authors').value=metadataOriginal.authors.join(', ');
    $('series-themes').value=metadataOriginal.themes.join(', ');
    $('series-publication').value=metadataOriginal.status;$('series-country').value=metadataOriginal.country??'';
    if(metadataOriginal.country&&!$('series-country').value){$('series-country').add(new Option(metadataOriginal.country,metadataOriginal.country));$('series-country').value=metadataOriginal.country;}
    $('picked-description').textContent=item.description??'';$('series-edit-status').textContent='';
    $('series-folders').replaceChildren(text('legend','Carpetas'));
    for(const folder of folders){const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=folder.id;input.checked=item.folder_ids?.includes(folder.id);label.append(input,document.createTextNode(folder.name));$('series-folders').append(label);}
    if(!folders.length)$('series-folders').append(text('p','Crea carpetas desde la biblioteca.','small muted'));
  }
  $('series-library-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!selectedItem)return;const id=selectedItem.id;
    const list=value=>[...new Set(value.split(',').map(v=>v.trim()).filter(Boolean))];
    const next={genres:list($('series-genres').value),themes:list($('series-themes').value),authors:list($('series-authors').value),status:$('series-publication').value,country:$('series-country').value||null};
    const metadata={};for(const [key,value] of Object.entries(next))if(JSON.stringify(value)!==JSON.stringify(metadataOriginal[key]))metadata[key]=value;
    $('save-series-library').disabled=true;
    try{await api(`/api/series/${id}/library`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({metadata,reading_state:$('series-reading-state').value,folder_ids:[...$('series-folders').querySelectorAll('input:checked')].map(input=>Number(input.value))})});await reload();const saved=state().series.find(item=>item.id===id);if(saved)organize(saved);$('series-edit-status').textContent='Organización guardada.';}catch(error){$('series-edit-status').textContent=error.message;}
    finally{$('save-series-library').disabled=false;}
  });
  function renderChips() {
    $('filter-chips').replaceChildren();
    for(const id of filterIds){const control=$(id);if(control.type==='checkbox'?!control.checked:!control.value)continue;
      const label=control.type==='checkbox'?'Sin leer':control.tagName==='SELECT'?control.selectedOptions[0].textContent:control.value;
      const chip=text('button',`${label} ×`,'button');chip.type='button';chip.setAttribute('aria-label',`Quitar filtro ${label}`);chip.addEventListener('click',()=>{if(control.type==='checkbox')control.checked=false;else control.value='';filter();});$('filter-chips').append(chip);
    }
  }
  function clearFilters(){for(const id of filterIds){if($(id).type==='checkbox')$(id).checked=false;else $(id).value='';}filter();}
  $('clear-filters').addEventListener('click',clearFilters);
  $('genre-filter').addEventListener('change',reload);
  for(const id of ['author-filter','publication-filter','reading-filter','folder-filter'])$(id).addEventListener('change',filter);
  function renderSources() {
    const checked=new Set([...$('source-hub').querySelectorAll('input:checked')].map(input=>input.value));
    const first=!$('source-hub').childElementCount;
    $('source-hub').replaceChildren();
    for(const source of state().sources.filter(source=>source.enabled&&!source.demo&&source.capabilities.search)){const label=document.createElement('label');label.className='source-tile';
      const input=document.createElement('input');input.type='checkbox';input.value=source.id;input.disabled=!source.enabled||!source.capabilities.search;input.checked=!input.disabled&&(first?source.languages?.some(language=>language==='es'||language==='es-la'):checked.has(source.id));
      const languages=(source.languages??[]).map(code=>({es:'Español','es-la':'Español latino',en:'Inglés'})[code]??code).join(' / ');
      label.append(input,text('span',source.name),text('p',source.enabled?[(source.note||'Catálogo activo · búsqueda por título'),languages].filter(Boolean).join(' · '):(source.reason||'Pendiente de integración')));
      $('source-hub').append(label);
    }
  }
  function renderSearchGroup(group) {
    if(!group.element.isConnected)return;
    group.status.textContent=group.error??(group.loading?'Buscando…':`${group.items.length} resultados`);
    renderSeriesCards(group.grid,group.items,cardOptions());
    if(group.loading&&!group.items.length)group.grid.replaceChildren(text('p','Consultando el catálogo…','series-empty'));
    if(group.error&&!group.items.length)group.grid.replaceChildren();
    group.more.hidden=group.nextPage===null||group.nextPage===undefined;
    group.more.disabled=group.loading;
    group.retry.hidden=!group.error;
  }
  async function fetchGroup(group,controller,more=false) {
    group.loading=true;group.error=null;renderSearchGroup(group);
    try {const result=group.adult?(await api('/api/adult/catalog',{method:'POST',body:JSON.stringify({query:group.query,source:group.source,page:more?group.nextPage:0}),signal:controller.signal})).sources[0]:await api('/api/sources/'+encodeURIComponent(group.source)+'/search?'+new URLSearchParams({q:group.query,page:more?group.nextPage:0}),{signal:controller.signal});
      if(result.error)throw new Error(result.error);
      if(controller.signal.aborted||group.generation!==searchGeneration)return;
      const existing=new Set(more?group.items.map(item=>item.url):[]);group.items=[...(more?group.items:[]),...result.results.filter(item=>!existing.has(item.url))];group.nextPage=result.nextPage;
    }catch(error){if(group.generation===searchGeneration)group.error=controller.signal.aborted?'Consulta cancelada.':error.message;}
    finally{if(group.generation===searchGeneration){group.loading=false;renderSearchGroup(group);}}
  }
  async function search() {
    searchAbort?.abort();const generation=++searchGeneration;const controller=searchAbort=beginQuery();
    const query=$('search-query').value.trim();const selection=$('search-source').value,adult=$('search-genre').value==='adult';
    const active=state().sources.filter(source=>source.enabled&&source.capabilities.search&&(!adult||source.capabilities.adult));
    const ids=(selection==='all'?active.map(s=>s.id):selection==='selected'?[...$('source-hub').querySelectorAll('input:checked')].map(input=>input.value):[selection]).filter(id=>active.some(s=>s.id===id));
    if((!query&&!adult)||!ids.length){$('search-status').textContent=adult?'Selecciona MangaDex o ManhwaWeb para buscar +18.':'Escribe un título y selecciona al menos una fuente.';endQuery(controller);return;}
    $('search-results').replaceChildren();$('search-results').classList.add('multi-results');$('search-more').hidden=true;
    searchGroups=ids.map(source=>{const element=document.createElement('section');element.className='search-group';const status=text('p','En espera…','small muted');status.setAttribute('role','status');const grid=document.createElement('div');grid.className='series-grid';
      const more=text('button','Más resultados de '+sourceName(source),'button');more.type='button';more.hidden=true;const retry=text('button','Reintentar '+sourceName(source),'button');retry.type='button';retry.hidden=true;
      const group={source,query,adult,generation,element,status,grid,more,retry,items:[],nextPage:null};
      const run=async isMore=>{const operation=beginQuery(),abort=()=>operation.abort();if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});try{await fetchGroup(group,operation,isMore);}finally{controller.signal.removeEventListener('abort',abort);endQuery(operation);}};
      more.addEventListener('click',()=>run(true));retry.addEventListener('click',()=>run(false));element.append(text('h3',sourceName(source)),status,grid,more,retry);$('search-results').append(element);return group;});
    let cursor=0;
    $('search-status').textContent=`Buscando en ${ids.length} ${ids.length===1?'fuente':'fuentes'}…`;
    const worker=async()=>{while(cursor<searchGroups.length&&!controller.signal.aborted){const group=searchGroups[cursor++];await fetchGroup(group,controller);}};
    await Promise.all(Array.from({length:Math.min(3,searchGroups.length)},worker));
    if(generation===searchGeneration){for(const group of searchGroups)if(!group.loading&&group.items.length===0&&controller.signal.aborted){group.error='Consulta cancelada.';renderSearchGroup(group);}
      const errors=searchGroups.filter(g=>g.error).length;
      $('search-status').textContent=controller.signal.aborted?'Búsqueda cancelada.':`${searchGroups.reduce((n,g)=>n+g.items.length,0)} resultados · ${errors} ${errors===1?'fuente':'fuentes'} con error.`;}
    endQuery(controller);
  }
  function scheduleSearch() {
    clearTimeout(searchTimer);searchAbort?.abort();
    if($('search-query').value.trim().length<2){searchGeneration++;$('search-status').textContent='Escribe al menos dos caracteres o pulsa Buscar.';return;}
    searchTimer=setTimeout(search,350);
  }
  $('search-query').addEventListener('input',scheduleSearch);
  $('search-source').addEventListener('change',scheduleSearch);
  $('search-genre').addEventListener('change',()=>{$('search-genre-note').hidden=$('search-genre').value!=='adult';searchAbort?.abort();searchGeneration++;searchGroups=[];$('search-results').replaceChildren();$('search-status').textContent=$('search-genre').value==='adult'?'Género +18 seleccionado. Escribe un título o pulsa Buscar para descubrir.':'Catálogo general seleccionado.';});
  $('source-hub').addEventListener('change',()=>{$('search-source').value='selected';scheduleSearch();});
  async function update() {
    const generation=++updateGeneration;
    const [folderData,updateData]=await Promise.all([api('/api/folders'),api('/api/updates')]);
    if(generation!==updateGeneration)return;
    folders=folderData;updates=updateData;
    fill('folder-filter',folders.map(f=>({id:f.id,name:`${f.name} (${f.count})`})),'Todas las historias');
    fill('genre-filter',[...[...new Set(state().series.filter(item=>!item.is_private).flatMap(item=>item.genres??[]))].sort(),{id:'adult',name:'+18'}],'Todos los géneros',true);
    fill('author-filter',[...new Set(state().series.filter(item=>!item.is_private).flatMap(item=>item.authors??[]))].sort(),'Todos los autores',true);
    renderSources();renderFolders();renderHome();renderChips();
    await discovery.update();
    for(const group of searchGroups)renderSearchGroup(group);
  }
  return { update,organize,renderHome,renderChips,clearFilters,enterDiscover:()=>discovery.activate(),clearDiscovery:()=>discovery.clear(),search:()=>{clearTimeout(searchTimer);return search();},hasFavorite,
    clearPrivate(){updateGeneration++;selectedItem=undefined;metadataOriginal=undefined;folders=[];folderEditing=undefined;for(const id of ['folder-list','series-folders'])$(id).replaceChildren();for(const id of ['folder-name','series-genres','series-authors','series-themes','edition-url']){const input=$(id);if(input)input.value='';}fill('folder-filter',[],'Todas las historias');},
    clearSearch(){searchAbort?.abort();searchGeneration++;searchGroups=[];$('search-results').replaceChildren();},
    cancelSearch(){searchAbort?.abort();searchGeneration++;},
    cancelAll(){searchAbort?.abort();discovery.abort();syncAbort?.abort();} };
}
