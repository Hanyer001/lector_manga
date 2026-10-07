import { groupWorks, itemKey, normalizeTag, tagKey, tagLabel } from './discovery-core.js';
import { discoveryTags } from './discovery-tags.js';
import { renderSeriesCards } from './library-view.js';
import { isPublicReading, isAdult } from './content-policy.js';
const $=id=>document.getElementById(id);
const text=(tag,value,className='')=>Object.assign(document.createElement(tag),{textContent:value,className});
export function createDiscoveryUI({preview,api,state,reload,select,add,navigate,beginQuery,endQuery,sourceName}) {
  let discovery={preferences:{},feedback:[]},selected=null,results=[],request=null,generation=0,transfer=null,sourceSelection=null,resultSource='',providers=[],phase='idle',attempted=false;
  let visibleLimit=24,visibleCount=0,nextPages={},appending=false,baseResults=[];
  const modeCache=new Map();let profileVersion='',lastMessage='';
  const viewed=new Map();let hiddenViewed=new Set();
  const seenKeys=item=>[itemKey(item),...[item.title??item.titulo,...(item.altTitles??[])].filter(Boolean).map(value=>'title:'+normalizeTag(value))];
  const captureViewed=()=>{hiddenViewed=new Set([...viewed.values()].flatMap(seenKeys));};
  const hasOpinion=item=>item.hidden||item.already_read||item.more_like||item.rating||item.sentiment&&item.sentiment!=='neutral';
  const tags={genres:new Set(),themes:new Set(),excludeGenres:new Set(),excludeThemes:new Set()};
  const availableSources=()=>state().sources.filter(s=>s.enabled&&s.capabilities.recommend&&!s.demo&&(!tags.genres.has('adult')||s.capabilities.adult));
  const filters=()=>({genres:[...tags.genres],themes:[...tags.themes],excludeGenres:[...tags.excludeGenres],excludeThemes:[...tags.excludeThemes],country:$('rec-country').value,status:$('rec-status').value,minChapters:Number($('rec-min-chapters').value),genreMatch:$('rec-genre-match').value,sources:sourceSelection?[...sourceSelection]:[],onlyNew:$('rec-only-new').checked});
  const changed=()=>{abort();visibleLimit=24;nextPages={};appending=false;results=[];providers=[];phase='idle';lastMessage='';$('recommend-warnings').hidden=true;render();drawSources();$('recommend-reason').textContent=tags.genres.has('adult')?'Género +18 seleccionado · MangaDex y ManhwaWeb. Pulsa Descubrir historias.':'Filtros preparados. Pulsa Descubrir historias para actualizar las sugerencias.';};
  const modeDescriptions={personal:'Prioriza tus gustos y valoraciones, con coincidencias reales en géneros, temas o autor.',recent:'Relaciona las cinco historias que has leído más recientemente y da prioridad a la última.',similar:'Busca coincidencias concretas con la obra elegida. Compartir solo Drama o Acción no es suficiente.',genres:'Combina géneros y temas, y excluye lo que prefieras evitar.',diverse:'Busca géneros y temas fuera de tus lecturas habituales, respetando tus filtros.'};
  function drawMode(){const mode=$('rec-mode').value;$('rec-seed-label').hidden=mode!=='similar';$('rec-mode-description').textContent=modeDescriptions[mode];if(mode==='genres')$('rec-customize').open=true;for(const button of document.querySelectorAll('[data-rec-mode]'))button.setAttribute('aria-pressed',String(button.dataset.recMode===mode));}
  const prepareSimilar=()=>{tags.genres=new Set([...tags.genres].filter(key=>key==='adult'));tags.themes.clear();drawTags();};
  for(const button of document.querySelectorAll('[data-rec-mode]'))button.addEventListener('click',()=>{if(button.dataset.recMode==='similar'&&$('rec-mode').value!=='similar')prepareSimilar();$('rec-mode').value=button.dataset.recMode;drawMode();changed();if($('rec-mode').value==='similar'&&!$('rec-seed').value){$('recommend-reason').textContent='Elige una historia para buscar obras similares.';$('rec-seed').focus();}else recommend();});
  function drawTags(){
    const intent=$('rec-tag-intent').value,query=normalizeTag($('rec-tag-search').value);let visible=0;
    for(const button of document.querySelectorAll('[data-discovery-tag]')){
      const kind=button.dataset.kind,key=button.dataset.discoveryTag,exclude=button.dataset.quick?false:intent==='exclude';
      const field=exclude?(kind==='genres'?'excludeGenres':'excludeThemes'):kind,active=tags[field].has(key);
      button.setAttribute('aria-pressed',String(active));button.classList.toggle('excluded',exclude&&active);
      button.hidden=!button.dataset.quick&&!normalizeTag(`${button.textContent} ${key}`).includes(query);if(!button.dataset.quick&&!button.hidden)visible++;
    }
    $('rec-tag-empty').hidden=visible>0;$('rec-selected-tags').replaceChildren();
    for(const [kind,values] of Object.entries(tags))for(const key of values){const excluded=kind.startsWith('exclude'),button=text('button',`${excluded?'Evitar: ':''}${tagLabel(key)} ×`,'tag-chip active-filter'+(excluded?' excluded':''));button.type='button';button.setAttribute('aria-label',`Quitar filtro ${tagLabel(key)}`);button.addEventListener('click',()=>{values.delete(key);drawTags();changed();});$('rec-selected-tags').append(button);}
    $('rec-selected-tags').hidden=!Object.values(tags).some(set=>set.size);
  }
  function toggleTag(kind,key,quick=false){
    const exclude=!quick&&$('rec-tag-intent').value==='exclude',field=exclude?(kind==='genres'?'excludeGenres':'excludeThemes'):kind,opposite=exclude?kind:(kind==='genres'?'excludeGenres':'excludeThemes');
    if(tags[field].has(key))tags[field].delete(key);
    else{if(tags[field].size>=10){$('recommend-reason').textContent='Puedes elegir hasta diez etiquetas por filtro.';return;}tags[field].add(key);tags[opposite].delete(key);}
    drawTags();changed();
  }
  for(const [kind,values] of Object.entries(discoveryTags))for(const [key,label] of values){
    const create=quick=>{const button=text('button',label,'tag-chip');button.type='button';button.dataset.discoveryTag=key;button.dataset.kind=kind;if(quick)button.dataset.quick='yes';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>toggleTag(kind,key,quick));return button;};
    $('rec-all-'+kind).append(create(false));if(kind==='genres'&&(values.findIndex(([value])=>value===key)<6||key==='adult'))$('rec-quick-genres').append(create(true));
  }
  $('rec-tag-search').addEventListener('input',drawTags);$('rec-tag-intent').addEventListener('change',drawTags);
  function drawSources(){
    $('rec-sources').replaceChildren();const sources=availableSources();
    if(sourceSelection){sourceSelection=new Set([...sourceSelection].filter(id=>sources.some(s=>s.id===id)));if(!sourceSelection.size)sourceSelection=null;}
    for(const source of sources){const button=text('button',source.name,'tag-chip source-chip');button.type='button';button.setAttribute('aria-pressed',String(!sourceSelection||sourceSelection.has(source.id)));button.addEventListener('click',()=>{sourceSelection??=new Set(sources.map(s=>s.id));if(sourceSelection.has(source.id)){if(sourceSelection.size===1){$('recommend-reason').textContent='Selecciona al menos un catálogo.';return;}sourceSelection.delete(source.id);}else sourceSelection.add(source.id);drawSources();changed();});$('rec-sources').append(button);}
    const count=sourceSelection?.size??sources.length;$('discover-catalog-count').textContent=`${count} ${count===1?'catálogo activo':'catálogos activos'}`;
    const active=Object.values(tags).reduce((sum,set)=>sum+set.size,0)+Number(Boolean($('rec-country').value))+Number(Boolean($('rec-status').value))+Number(Number($('rec-min-chapters').value)>0);
    $('rec-filter-summary').textContent=active?`${active} ${active===1?'filtro activo':'filtros activos'}`:'Catálogos, géneros y filtros';
  }
  const writeFilters=preferences=>{for(const key of Object.keys(tags))tags[key]=new Set((preferences[key]??[]).map(tagKey));sourceSelection=preferences.sources?.length?new Set(preferences.sources):null;$('rec-country').value=preferences.country??'';$('rec-status').value=preferences.status??'';$('rec-min-chapters').value=preferences.minChapters??0;$('rec-genre-match').value=preferences.genreMatch??'any';drawTags();drawSources();};
  const hasFavorite=item=>state().series.some(saved=>itemKey(saved)===itemKey(item)||[saved.titulo,...(saved.altTitles??[])].some(title=>normalizeTag(title)===normalizeTag(item.title)));
  async function openPreview(item){
    preview(item,{feedback,adjust:()=>{$('rec-customize').open=true;$('rec-tag-search').focus();}});
    viewed.set(itemKey(item),item);
    try{await api('/api/discovery/feedback',{method:'POST',body:JSON.stringify({item,feedback:{seen:true}})});$('rec-seen-status').textContent='Ficha recordada. Abrirla no cuenta como lectura ni valoración.';}
    catch{$('rec-seen-status').textContent='Ficha recordada durante esta sesión; falta guardar el historial de vistas.';}
  }
  const cardOptions=()=>({sourceName,onSelect:openPreview,onAdd:item=>add(item.url),hasFavorite,onFeedback:feedback,retainCards:true});
  const render=()=>{
    if(resultSource&&!results.some(item=>item.source===resultSource))resultSource='';
    const query=normalizeTag($('rec-result-query').value),sort=$('rec-result-sort').value;
    const visible=results.filter(item=>(!$('rec-only-new').checked||!seenKeys(item).some(key=>hiddenViewed.has(key)))&&(!resultSource||item.source===resultSource)&&(!query||normalizeTag([item.title,...(item.altTitles??[]),...(item.genres??[]).map(tagLabel),...(item.themes??[]).map(tagLabel)].join(' ')).includes(query)));
    visibleCount=visible.length;
    if(sort==='title')visible.sort((a,b)=>a.title.localeCompare(b.title,'es'));
    if(sort==='source')visible.sort((a,b)=>sourceName(a.source).localeCompare(sourceName(b.source),'es')||a.title.localeCompare(b.title,'es'));
    renderSeriesCards($('recommend-results'),visible.slice(0,visibleLimit),cardOptions());
    $('recommend-more').hidden=phase!=='complete'||(visible.length<=visibleLimit&&!Object.keys(nextPages).length);
    $('recommend-more').disabled=phase==='loading';
    $('recommend-more').textContent=visible.length>visibleLimit?'Mostrar más recomendaciones':'Buscar más recomendaciones';
    $('recommend-tools').hidden=!results.length;$('recommend-count').textContent=visible.length===results.length?String(results.length):`${visible.length} / ${results.length}`;
    if(!visible.length){
      if(phase==='loading'){
        const placeholders=Array.from({length:6},()=>{const card=text('div','','discovery-skeleton');card.setAttribute('aria-hidden','true');card.append(text('div','','skeleton-cover'),text('div','','skeleton-line'),text('div','','skeleton-line short'));return card;});
        $('recommend-results').replaceChildren(...placeholders);
      }else{
        const empty=text('div','','discovery-empty');empty.append(text('span','✦','empty-symbol'),text('h3',results.length?'Prueba otra búsqueda':phase==='error'?'No pudimos cargar las sugerencias':phase==='complete'?'Todavía hay más por descubrir':'Una historia para cada gusto'));
        empty.append(text('p',results.length?'Cambia el título o selecciona otro catálogo.':phase==='error'?'Pulsa Actualizar para volver a intentarlo.':phase==='complete'?lastMessage||'Prueba menos temas, otro género o más catálogos.':'Elige cómo quieres descubrir y pulsa Descubrir historias.','muted'));
        if(results.length){const clear=text('button','Mostrar todas las historias','button subtle');clear.type='button';clear.addEventListener('click',()=>{$('rec-result-query').value='';resultSource='';$('rec-only-new').checked=false;render();});empty.append(clear);}
        $('recommend-results').replaceChildren(empty);
      }
    }
    const container=$('recommend-source-results');container.replaceChildren();container.hidden=!providers.length;
    for(const [id,label] of [['',`Todos · ${results.length}`],...providers.map(p=>{const count=results.filter(item=>item.source===p.id).length;return [p.id,`${p.name} · ${count||({pending:'en espera',loading:'consultando…',error:'error de consulta',unsupported:'filtro no disponible'})[p.status]||'sin coincidencias'}`];})]){const button=text('button',label,'tag-chip');button.type='button';button.setAttribute('aria-pressed',String(resultSource===id));button.disabled=Boolean(id&&!results.some(item=>item.source===id));const provider=providers.find(p=>p.id===id);if(provider)button.title=provider.messages.join(' ')||(['pending','loading'].includes(provider.status)?'Consultando este catálogo. Las otras fuentes pueden mostrarse antes.':'La fuente respondió, pero no hay sugerencias con estos filtros.');button.addEventListener('click',()=>{resultSource=id;render();});container.append(button);}
  };
  $('rec-result-query').addEventListener('input',render);$('rec-result-sort').addEventListener('change',render);
  $('rec-only-new').addEventListener('change',async()=>{captureViewed();render();try{await api('/api/discovery',{method:'PUT',body:JSON.stringify(filters())});}catch(error){$('rec-seen-status').textContent=error.message;}});
  $('rec-reset-seen').addEventListener('click',async()=>{$('rec-reset-seen').disabled=true;try{await api('/api/discovery/seen',{method:'DELETE'});viewed.clear();captureViewed();render();$('rec-seen-status').textContent='Historial de vistas reiniciado. Tus gustos y descartes se conservan.';}catch(error){$('rec-seen-status').textContent=error.message;}finally{$('rec-reset-seen').disabled=false;}});
  function abort(){generation++;request?.abort();$('load-recommendations').disabled=$('recommend-submit').disabled=!availableSources().length;$('recommend-results').setAttribute('aria-busy','false');if(phase==='loading'){phase=results.length?'complete':'idle';render();}}
  function applyResult(result){
    results=[...new Map([...(appending?baseResults:[]),...result.results].filter(item=>!hasFavorite(item)).map(item=>[itemKey(item),item])).values()];nextPages=result.nextPages??{};providers=result.sources??[];lastMessage=result.message??'';render();
    const contributing=new Set(results.map(item=>item.source)).size,waiting=providers.filter(p=>['pending','loading'].includes(p.status)).length;
    const labels={personal:result.personalized?'Según tus gustos y biblioteca.':'Selección general para empezar.',recent:'A partir de tus lecturas recientes.',similar:'Coincidencias con la historia elegida.',genres:'Según los filtros que elegiste.',diverse:'Para salir de tus lecturas habituales.'};
    $('recommend-reason').textContent=waiting?`${results.length?`${results.length} historias disponibles · `:''}consultando ${waiting} ${waiting===1?'catálogo':'catálogos'}…`:lastMessage||`${results.length} historias · ${contributing} ${contributing===1?'catálogo':'catálogos'}. ${labels[$('rec-mode').value]}`;
    $('recommend-warnings').hidden=!result.warnings?.length;$('recommend-warnings-list').replaceChildren(...(result.warnings??[]).map(message=>text('p',message,'small muted')));
  }
  async function recommend(event,{more=false}={}) {
    event?.preventDefault();
    captureViewed();
    if(more&&visibleLimit<visibleCount){visibleLimit+=24;render();return;}
    const requestedPages=more?{...nextPages}:undefined;
    if(more&&!Object.keys(requestedPages).length)return;
    appending=more;baseResults=more?[...results]:[];if(more)visibleLimit=visibleCount+24;else {visibleLimit=24;nextPages={};}
    abort();
    if($('rec-mode').value==='similar'&&!$('rec-seed').value){$('recommend-reason').textContent='Elige primero una obra guardada para encontrar historias similares.';$('rec-seed').focus();return;}
    if(!availableSources().length){$('recommend-reason').textContent='No hay catálogos disponibles para estos filtros.';return;}
    const preferences=filters(),seedValue=$('rec-seed').value,mode=$('rec-mode').value;
    const seedWorkId=mode==='similar'&&!seedValue.startsWith('feedback:')?Number(seedValue)||null:null,seedFeedbackKey=mode==='similar'&&seedValue.startsWith('feedback:')?seedValue.slice(9):null;
    const cacheKey=JSON.stringify([mode,mode==='similar'?seedValue:'',preferences,profileVersion]),cached=modeCache.get(cacheKey),refresh=event?.currentTarget?.id==='load-recommendations';
    attempted=true;
    if(!more&&!refresh&&event?.type!=='submit'&&cached?.expires>Date.now()){phase='complete';applyResult(cached.result);return;}
    phase='loading';lastMessage='';const version=generation,controller=request=beginQuery();
    $('load-recommendations').disabled=true;$('recommend-submit').disabled=true;$('recommend-results').setAttribute('aria-busy','true');$('recommend-reason').textContent=`Buscando en ${sourceSelection?.size??availableSources().length} catálogos en español…`;
    $('recommend-warnings').hidden=true;render();
    try {
      if(event?.type==='submit')await api('/api/discovery',{method:'PUT',body:JSON.stringify(preferences),signal:controller.signal});
      if(!more){resultSource='';$('rec-result-query').value='';}
      const result=await api('/api/discovery/recommendations',{method:'POST',headers:{Accept:'application/x-ndjson'},body:JSON.stringify({mode,seedWorkId,seedFeedbackKey,filters:preferences,refresh,pages:requestedPages}),signal:controller.signal,onProgress:result=>{if(version!==generation||controller.signal.aborted)return;if(result.type==='complete')phase='complete';applyResult(result);}});
      if(version!==generation||controller.signal.aborted)return;
      discovery.preferences=preferences;phase='complete';applyResult(result);if(modeCache.size>=10)modeCache.delete(modeCache.keys().next().value);modeCache.set(cacheKey,{result:{...result,results},expires:Date.now()+120000});
    }catch(error){if(version===generation){phase=controller.signal.aborted?'idle':'error';render();$('recommend-reason').textContent=controller.signal.aborted?'Consulta cancelada.':error.message;}}
    finally{endQuery(controller);if(version===generation){$('load-recommendations').disabled=false;$('recommend-submit').disabled=false;$('recommend-results').setAttribute('aria-busy','false');}}
  }
  async function feedback(item,kind) {
    abort();
    const patch=kind==='hidden'?{hidden:true}:kind==='already_read'?{already_read:true}:kind==='more_like'?{more_like:true,sentiment:'like'}:{sentiment:kind};
    try{await api('/api/discovery/feedback',{method:'POST',body:JSON.stringify({item,feedback:patch})});
      if(kind==='hidden'||kind==='already_read'||kind==='dislike'){results=results.filter(r=>itemKey(r)!==itemKey(item));render();}
      await update();if(kind==='more_like'){prepareSimilar();$('rec-mode').value='similar';$('rec-seed').value='feedback:'+itemKey(item);drawMode();changed();recommend();}else $('recommend-reason').textContent='Preferencia guardada. Se aplicará a las próximas sugerencias.';
    }catch(error){$('recommend-reason').textContent=error.message;}
  }
  $('recommend-more').addEventListener('click',event=>recommend(event,{more:true}));
  $('recommend-form').addEventListener('submit',recommend);$('load-recommendations').addEventListener('click',recommend);
  $('rec-mode').addEventListener('change',drawMode);
  for(const id of ['rec-country','rec-status','rec-min-chapters','rec-genre-match','rec-mode'])$(id).addEventListener('change',changed);
  $('rec-seed').addEventListener('change',()=>{changed();if($('rec-seed').value)recommend();});
  $('recommend-clear').addEventListener('click',async()=>{abort();writeFilters({});changed();try{await api('/api/discovery',{method:'PUT',body:JSON.stringify(filters())});$('recommend-reason').textContent='Filtros limpiados; tus valoraciones se conservan.';}catch(error){$('recommend-reason').textContent=error.message;}finally{$('load-recommendations').disabled=$('recommend-submit').disabled=!availableSources().length;}});
  $('recommend-reset').addEventListener('click',async()=>{
    if($('recommend-reset').dataset.confirm!=='yes'){$('recommend-reset').dataset.confirm='yes';$('recommend-reset').textContent='Confirmar reinicio de gustos';$('recommend-reason').textContent='Se borrarán notas, gustos y descartes. Tu biblioteca, estados de lectura y progreso se conservarán.';return;}
    abort();try{await api('/api/discovery',{method:'DELETE'});viewed.clear();captureViewed();results=[];providers=[];phase='idle';$('recommend-warnings').hidden=true;writeFilters({});render();await reload();$('recommend-reason').textContent='Gustos y descartes reiniciados. Tus lecturas se conservan.';}catch(error){$('recommend-reason').textContent=error.message;}finally{$('recommend-reset').dataset.confirm='';$('recommend-reset').textContent='Reiniciar mis gustos';$('load-recommendations').disabled=false;$('recommend-submit').disabled=false;}
  });
  function renderFeedback() {
    $('recommend-feedback-list').replaceChildren();
    for(const item of discovery.feedback.filter(hasOpinion)){const row=text('div','','feedback-row');row.append(text('span',`${item.title} · ${item.hidden?'No me interesa':item.already_read?'Ya leído':item.more_like?'Más como este':item.sentiment==='like'?'Me gustó':'No me gustó'}`));const button=text('button','Deshacer','button subtle');button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/discovery/feedback',{method:'DELETE',body:JSON.stringify({key:itemKey(item)})});await update();$('recommend-reason').textContent='Preferencia retirada; puedes volver a buscar.';}catch(error){$('recommend-reason').textContent=error.message;button.disabled=false;}});row.append(button);$('recommend-feedback-list').append(row);}
    if(!discovery.feedback.some(hasOpinion))$('recommend-feedback-list').append(text('p','Aquí podrás recuperar sugerencias descartadas.','small muted'));
  }
  let initialized=false;
  async function update() {
    discovery=await api('/api/discovery');
    viewed.clear();for(const item of discovery.feedback.filter(item=>item.seen))viewed.set(itemKey(item),item);captureViewed();
    const profile=JSON.stringify([state().series.map(({id,work_id,titulo,altTitles,genres,themes,authors,sentiment,rating,reading_state,ultima_lectura,is_private,is_adult})=>({id,work_id,titulo,altTitles,genres,themes,authors,sentiment,rating,reading_state,ultima_lectura,is_private,is_adult})),discovery.feedback.filter(hasOpinion)]);
    if(profile!==profileVersion){modeCache.clear();profileVersion=profile;}
    if(!initialized){writeFilters(discovery.preferences);$('rec-only-new').checked=Boolean(discovery.preferences.onlyNew);initialized=true;}
    const previous=$('rec-seed').value,works=groupWorks(state().series.filter(isPublicReading));
    $('rec-seed').replaceChildren(new Option('Elige una historia',''),...works.map(work=>new Option(work.titulo,work.work_id)),...discovery.feedback.filter(item=>item.more_like||item.sentiment==='like').map(item=>new Option(item.title+' · sugerencia','feedback:'+itemKey(item))));
    if([...$('rec-seed').options].some(o=>o.value===previous))$('rec-seed').value=previous;
    drawSources();drawMode();$('load-recommendations').disabled=$('recommend-submit').disabled=phase==='loading'||!availableSources().length;renderFeedback();
    results=results.filter(item=>!hasFavorite(item));render();
  }
  async function saveTaste(patch) {
    if(!selected)return;const id=selected.id,workId=selected.work_id;
    try{await api(`/api/works/${workId}/feedback`,{method:'PUT',body:JSON.stringify(patch)});await reload();const saved=state().series.find(s=>s.id===id);if(selected?.id===id&&saved){await organize(saved);$('work-status').textContent='Tus gustos se guardaron para todas las fuentes de esta obra.';}}catch(error){if(selected?.id===id)$('work-status').textContent=error.message;}
  }
  for(const kind of ['like','dislike','neutral'])$('work-'+kind).addEventListener('click',()=>saveTaste({sentiment:kind}));
  $('work-rating').addEventListener('change',()=>saveTaste({rating:$('work-rating').value?Number($('work-rating').value):null}));
  $('work-similar').addEventListener('click',()=>{if(!selected)return;prepareSimilar();$('rec-mode').value='similar';$('rec-seed').value=selected.work_id;drawMode();changed();$('picker-close').click();navigate('discover');recommend();});
  function resetTransfer(){transfer=null;$('edition-transfer').hidden=true;$('edition-status').textContent='';}
  async function organize(item) {
    selected=item;resetTransfer();const works=groupWorks(state().series),work=works.find(w=>w.work_id===item.work_id);
    $('edition-link').dataset.confirm='';$('edition-link').textContent='Vincular edición';
    const editions=work?.editions??[item];
    $('work-rating').value=item.rating??'';
    for(const kind of ['like','dislike','neutral'])$('work-'+kind).setAttribute('aria-pressed',String((item.sentiment??'neutral')===kind));
    $('work-status').textContent='';
    $('edition-select').replaceChildren(...editions.map(e=>new Option(`${sourceName(e.source)} · ${e.total_capitulos} capítulos`,e.id)));$('edition-select').value=item.id;
    $('edition-unlink').hidden=editions.length<2;
    $('edition-existing').replaceChildren(new Option('Elige una edición guardada',''),...state().series.filter(s=>s.work_id!==item.work_id).map(s=>new Option(`${s.titulo} · ${sourceName(s.source)}`,s.id)));
    $('edition-from').replaceChildren(new Option('Elige una lectura anterior',''),...editions.filter(e=>e.id!==item.id&&e.ultimo_capitulo_id).map(e=>new Option(`${sourceName(e.source)} · ${e.ultimo_capitulo}`,e.id)));
    $('edition-from-label').hidden=$('edition-from').options.length<2;
  }
  $('edition-select').addEventListener('change',async()=>{const item=state().series.find(s=>s.id===Number($('edition-select').value));if(item)await select(item);});
  $('edition-from').addEventListener('change',async()=>{
    resetTransfer();if(!selected||!$('edition-from').value)return;
    const id=selected.id;try{const info=await api(`/api/works/${selected.work_id}/transfer?`+new URLSearchParams({from:$('edition-from').value,to:id}));if(selected?.id!==id||$('edition-from').value!==String(info.from))return;transfer=info;$('edition-status').textContent=info.message;$('edition-transfer').hidden=!info.canTransfer;$('edition-transfer').textContent=`Continuar aquí: capítulo ${info.number}`;}catch(error){if(selected?.id===id)$('edition-status').textContent=error.message;}
  });
  $('edition-transfer').addEventListener('click',async()=>{
    if(!selected||!transfer)return;const info=transfer;const workId=selected.work_id;
    $('edition-transfer').disabled=true;try{const result=await api(`/api/works/${workId}/transfer`,{method:'POST',body:JSON.stringify({from:info.from,to:info.to})});await reload();const item=state().series.find(s=>s.id===info.to);if(item){await select(item);$('chapter-select').value=result.chapter.id;$('open-chapter').disabled=false;$('edition-status').textContent='Continuación preparada desde el inicio del capítulo; pulsa Leer capítulo.';}}catch(error){$('edition-status').textContent=error.message;}finally{$('edition-transfer').disabled=false;}
  });
  $('edition-link').addEventListener('click',async()=>{
    if(!selected||!$('edition-existing').value)return;
    if($('edition-link').dataset.confirm!=='yes'){$('edition-link').dataset.confirm='yes';$('edition-link').textContent='Confirmar: es la misma obra';$('edition-status').textContent='Comprueba título, autor y portada. Se conservarán capítulos y progreso de cada fuente; los gustos se tomarán de esta ficha.';return;}
    const id=selected.id;try{await api(`/api/works/${selected.work_id}/editions`,{method:'POST',body:JSON.stringify({serie_id:Number($('edition-existing').value)})});await reload();await select(state().series.find(s=>s.id===id));$('edition-status').textContent='Fuentes vinculadas en una sola ficha.';}catch(error){$('edition-status').textContent=error.message;}finally{$('edition-link').dataset.confirm='';$('edition-link').textContent='Vincular edición';}
  });
  $('edition-existing').addEventListener('change',()=>{$('edition-link').dataset.confirm='';$('edition-link').textContent='Vincular edición';});
  $('edition-unlink').addEventListener('click',async()=>{if(!selected)return;const id=selected.id;try{await api(`/api/series/${id}/edition`,{method:'DELETE'});await reload();await select(state().series.find(s=>s.id===id));$('edition-status').textContent='Fuente separada. Conserva sus capítulos, progreso y valoración.';}catch(error){$('edition-status').textContent=error.message;}});
  $('edition-add-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!selected)return;const id=selected.id,workId=selected.work_id;$('edition-add').disabled=true;
    try{await api('/api/series',{method:'POST',body:JSON.stringify({url_origen:$('edition-url').value,work_id:workId})});$('edition-url').value='';await reload();await select(state().series.find(s=>s.id===id));$('edition-status').textContent='Nueva fuente vinculada. Selecciónala y actualiza sus capítulos.';}catch(error){$('edition-status').textContent=error.message;}finally{$('edition-add').disabled=false;}
  });
  return {update,organize,abort,activate(){if(!attempted&&$('rec-mode').value!=='similar')recommend();},clear(){abort();viewed.clear();hiddenViewed.clear();$('rec-only-new').checked=false;initialized=false;selected=null;transfer=null;modeCache.clear();profileVersion='';attempted=false;phase='idle';results=[];providers=[];$('rec-result-query').value='';$('recommend-warnings').hidden=true;$('recommend-warnings-list').replaceChildren();render();$('recommend-feedback-list').replaceChildren();$('recommend-reason').textContent='Elige tus géneros o descubre historias a partir de tus lecturas.';}};
}
