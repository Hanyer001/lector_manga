import {orderedChapters} from './chapter-order.js';
import {createChapterBrowser} from './chapter-browser.js';
import {libraryProgress,publicationLabels} from './library-progress.js';
import {tagLabel} from './discovery-core.js';
import { renderSeriesCards, setGridLoading } from './library-view.js';
import { enhanceSelects, syncSelectControls } from './ui-controls.js';
import { initializeDialog, createDetailTabs } from './dialog-ui.js';
import { changeView } from './view-transitions.js';
import {parseLibraryRoute,libraryRouteHash,libraryRouteFields} from './library-route.js';
import {homeModel} from './home-model.js';
import { createShell } from './shell.js';
import { groupWorks } from './discovery-core.js';
import { readRecommendationStream } from './discovery-stream.js';
import { createReaderControls } from './reader-controls.js';
import { createPrivacyUI } from './privacy-ui.js';
import { isPublicReading, inLibraryScope } from './content-policy.js';
import { readingWindow, savedPageAnchor } from './reader-preferences.js';
import { filterSeries, debounce, imageProxyUrl, ProgressWriter } from './reader-core.js';
import {createSeriesPreview} from './series-preview.js';
import {createSourceAlternatives} from './source-alternatives.js';
import { createAccountUI } from './account-ui.js';
import { cloudMode, apiOrigin, apiFetch, apiUrl, accountUser, isGuest, receivePrivateStatus, isProxyUrl, setCover, clearTemporaryCovers } from './network.js';

const $ = id => document.getElementById(id);
enhanceSelects();
const pages = $('pages');
const viewportWidth = () => document.documentElement.clientWidth || innerWidth;
let CACHE_KEY = 'lector-manga.reader.v1';
const progressVersions = new Map();
let progressConflict = false;
let lastSaved = null;
let failedReading = null;
let pendingProgress = {};
const MAX_IN_FLIGHT = matchMedia('(max-width: 700px)').matches ? 2 : 3;
let checkpointAt=0,lastPage=0,lastPercent=-1;
const sendingProgress=new Map();
let current = null;
let series = [];
let libraryLoaded=false,libraryLoadVersion=0;
let sourceCatalog = [];
let chapters = [];
let generation = 0;
let chapterAbort;
let libraryGeneration = 0;
let libraryAbort;
let addAbort;
let heroSeries;
let libraryScrollY = 0;
let readerScrollY = 0;
let readerPoint = null;
const dialogOrigins = new Map();
const dialogs = ['add-panel','chapter-controls','folder-panel','more-panel'];
const detailTabs=createDetailTabs();
let pickedWorkKey;
for(const id of dialogs)initializeDialog($(id),{onClose:()=>syncDialogState(id,false)});
const chapterBrowser = createChapterBrowser($('chapter-browser'), {onChoose: chapter => openChapter(chapter.id)});
let pickedChapterId = null;
$('picked-read').addEventListener('click', () => { if (pickedChapterId != null) openChapter(pickedChapterId); });
$('show-more').addEventListener('click', () => setDialog('more-panel', true));
$('more-close').addEventListener('click', () => setDialog('more-panel', false));
for (const button of document.querySelectorAll('[data-more-view]')) button.addEventListener('click', () => navigateView(button.dataset.moreView));
$('more-account').addEventListener('click', () => { setDialog('more-panel', false); $('account-open').click(); });
for (const button of document.querySelectorAll('[data-welcome]')) button.addEventListener('click', () => {
  if(button.dataset.welcome==='add'){
    if($('add-toggle').disabled)return;
    openAddDialog(button);
  }else navigateView(button.dataset.welcome);
});
let shell;
let privacy;
let readerUI;
let pageIndex = 0;
let pageFraction = 0;
let reconciling = false;
let activeView = 'library';
const viewScroll = new Map();
let routesReady=false,restoringFilters=false,lastRestoredUrl='';
const queryRouteDebounced=debounce(()=>writeLibraryRoute(),350);
function currentLibraryFilters(){return Object.fromEntries(Object.entries(libraryRouteFields).map(([key,id])=>[key,$(id).type==='checkbox'?($(id).checked?'1':''):$(id).value]));}
function navigationUrl(hash){const params=new URLSearchParams(location.search);params.delete('chapter');return location.pathname+(params.size?'?'+params:'')+hash;}
function writeLibraryRoute(mode='push'){
  if(!routesReady||restoringFilters||activeView!=='library'||$('library').hidden)return;
  const hash=libraryRouteHash('library',currentLibraryFilters());
  if(location.hash!==hash){history[mode==='replace'?'replaceState':'pushState']({view:'library'},'',navigationUrl(hash));lastRestoredUrl=location.href;}
}
function restoreLibraryFilters(filters){
  restoringFilters=true;queryRouteDebounced.cancel();
  for(const [key,id] of Object.entries(libraryRouteFields)){
    const control=$(id),value=filters[key]??(key==='sort'?'recent':'');
    if(control.type==='checkbox')control.checked=value==='1';else control.value=value;
  }
  syncSelectControls('reading-filter');restoringFilters=false;
}
const queries = new Set();
function beginQuery() { const controller = new AbortController(); queries.add(controller); $('cancel-operation').hidden = false; return controller; }
function endQuery(controller) { queries.delete(controller); $('cancel-operation').hidden = !queries.size; }
let loadObserver;
let slots = [];
let queue = new Set();
let running = 0;
let dirty = false;
let restoring = false;
let frame;
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { /* almacenamiento opcional */ }
if (typeof cache !== 'object' || Array.isArray(cache)) cache = {};
history.scrollRestoration = 'manual';

async function api(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
  const headers={...(options.body?{'Content-Type':'application/json'}:{}),...options.headers};
  if(cloudMode&&['POST','PUT','DELETE'].includes(options.method)&&!headers['X-Operation-Id'])headers['X-Operation-Id']=crypto.randomUUID();
  try {
    for(let attempt=0;attempt<2;attempt++) {
      const response = await apiFetch(path, { ...options, headers, signal:controller.signal });
      if(response.ok&&response.headers.get('content-type')?.includes('application/x-ndjson')){
        const result=await readRecommendationStream(response,progress=>{window.lectorCatalogs?.record(path,progress);options.onProgress?.(progress);});return result;
      }
      const data=await response.json();
      window.lectorCatalogs?.record(path,data,response.ok);
      if(!response.ok) {
        if(cloudMode&&data.error?.code==='ACCOUNT_CHANGED'&&attempt===0)continue;
        const error=new Error(data.error?.message??`Error HTTP ${response.status}`);error.code=data.error?.code;
        if(error.code==='PRIVATE_LOCKED')window.dispatchEvent(new Event('private-locked'));
        throw error;
      }
      receivePrivateStatus(path,data);
      options.onRevision?.(Number(response.headers.get('X-Library-Revision') ?? 0));
      return data;
    }
  } catch(error) { if(!controller.signal.aborted||timedOut)window.lectorCatalogs?.record(path,null,false);if(timedOut)throw new Error('La consulta tardó demasiado. Puedes reintentar.');throw error; }
  finally { clearTimeout(timer);options.signal?.removeEventListener('abort',abort); }
}

function notice(message = '') {
  for (const id of ['notice', 'home-notice']) { $(id).textContent = message; $(id).hidden = !message; }
}
function setLibrary(open, options = {}) {
  if($('library').hidden===!open){applyLibrary(open,options);return Promise.resolve();}
  return changeView(()=>applyLibrary(open,options),{privateView:activeView==='private'||Boolean(current?.privateReading)});
}
function applyLibrary(open, { opening = false } = {}) {
  const wasOpen = !$('library').hidden;
  if (open && !wasOpen) {
    if (document.body.classList.contains('focus-mode')) focusMode(false);
    flushProgress(); readerScrollY = window.scrollY; readerPoint = anchor();
  } else if (!open && wasOpen) libraryScrollY = window.scrollY;
  $('library').hidden = !open;
  $('reader').hidden = open;
  $('startup-status').hidden = true;
  $('reader').classList.toggle('view-enter',!open);

  document.body.classList.toggle('library-open', open);
  const navigation=document.querySelector('nav[aria-label="Navegación principal"]');
  navigation.inert=!open;
  navigation.removeAttribute('aria-busy');
  if(open)navigation.removeAttribute('aria-hidden');else navigation.setAttribute('aria-hidden','true');
  readerUI?.activate(!open);
  if (open) for (const slot of slots) { slot.cancel?.(); unload(slot); }
  $('library-toggle').setAttribute('aria-expanded', String(open));
  $('library-toggle').hidden = open;
  $('library-close').hidden = !current;
  setDialog('chapter-controls', false);
  setDialog('add-panel', false);
  setDialog('folder-panel', false);
  setDialog('more-panel', false);
  if (open !== wasOpen) {
    restoring = true;
    window.scrollTo(0, open ? libraryScrollY : current ? readerScrollY : 0);
    if (!open && current) restoreAnchor(readerPoint);
    if (!opening) requestAnimationFrame(() => { restoring = false; if (!open && current) { observePages(); updatePosition(); } });
  }
  (open ? $('show-saved') : $('reader')).focus({ preventScroll: true });
}

function rememberDialogOrigin(id, element) {
  dialogOrigins.set(id,{element,label:element?.getAttribute('aria-label')});
}
function setDialog(id, open) {
  const panel = $(id);
  if (panel.open === open) return;
  if (open) {
    for (const other of dialogs) if (other !== id) setDialog(other, false);
    rememberDialogOrigin(id, document.activeElement);
  }
  if(open){panel.hidden=false;panel.showModal();}else panel.close();
  syncDialogState(id,open);
  if(open)(id==='add-panel'?$('series-url'):id==='folder-panel'?$('folder-name'):id==='more-panel'?$('more-close'):$('picker-close')).focus({preventScroll:true});
}
function syncDialogState(id,open) {
  $(id).hidden=!open;
  const modalOpen = dialogs.some(id => $(id).open);
  document.body.classList.toggle('modal-open', modalOpen);
  if (id === 'add-panel') $('add-toggle').setAttribute('aria-expanded', String(open));
  if (id === 'more-panel') $('show-more').setAttribute('aria-expanded', String(open));
  if(!open&&!modalOpen){
    const remembered=dialogOrigins.get(id);let origin=remembered?.element;
    // Guardar puede volver a dibujar la tarjeta: recupera su botón actual.
    if(!origin?.isConnected&&id==='chapter-controls')origin=[...document.querySelectorAll('#series-grid .series-choice,#private-library .series-choice')].find(button=>button.getAttribute('aria-label')===remembered?.label&&button.getClientRects().length);
    if(!origin?.isConnected||!origin.getClientRects().length)origin=document.querySelector('nav[aria-label="Navegación principal"] [aria-current="page"]');
    if(origin?.isConnected&&origin.getClientRects().length)origin.focus({preventScroll:true});
  }
}

function saveCache() {
  try {
    const recent = Object.entries(cache).sort((a, b) => (b[1].timestamp ?? 0) - (a[1].timestamp ?? 0)).slice(0, 10);
    cache = Object.fromEntries(recent);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* El guardado SQLite sigue disponible si localStorage está lleno. */ }
}

function anchor() {
  if (readerUI?.preferences.mode === 'paged') return slots.length ? { index:pageIndex,offset:0,fraction:pageFraction } : null;
  let low=0,high=slots.length-1;
  while(low<high){const middle=(low+high)>>1;if(slots[middle].element.getBoundingClientRect().bottom>0)high=middle;else low=middle+1;}
  const slot=slots[low];
  if (!slot) return null;
  const rect = slot.element.getBoundingClientRect();
  return { index: slot.index, offset: rect.top, fraction: Math.max(0, Math.min(1, -rect.top / rect.height)) };
}

function restoreAnchor(point) {
  if (readerUI?.preferences.mode === 'paged') return;
  const slot = slots[point?.index];
  if (!slot) return;
  const difference = slot.element.getBoundingClientRect().top - point.offset;
  if (Math.abs(difference) > .5) window.scrollBy(0, difference);
}

function snapshot() {
  if (!current || current.trial || !$('library').hidden || restoring || !dirty || progressConflict) return null;
  const knownSeries = series.find(item => item.id === current.serie_id);
  if (cloudMode && !knownSeries) return null;
  const point = anchor();
  const virtualY = readerUI?.preferences.mode === 'paged' ? slots.slice(0,pageIndex).reduce((height,slot)=>height+Math.min(viewportWidth(),readerUI.preferences.width)/slot.ratio,0) : window.scrollY;
  const payload = { serie_id: current.serie_id, capitulo_id: current.id, scroll_position_y: Math.max(0, virtualY),
    page_index:point?.index ?? 0,page_fraction:point?.fraction ?? 0,privateReading:Boolean(current.privateReading) };
    if(knownSeries && !knownSeries.is_private && !current.privateReading)cache[current.id] = { ...payload, timestamp: Date.now(), anchor: point,
    ratios: slots.map(slot => slot.ratio), naturalWidths:slots.map(slot=>slot.naturalWidth), width: pages.clientWidth };
  saveCache();
  const saved = series.find(item => item.id === current.serie_id);
  if (saved) { saved.ultimo_capitulo_id = current.id; saved.ultimo_capitulo = current.title; saved.ultima_lectura = Date.now(); }
  return payload;
}

function persistPending() { if(!cloudMode)return;try{localStorage.setItem(CACHE_KEY+'.pending',JSON.stringify(pendingProgress));}catch{/* Guardado opcional del dispositivo. */} }
const writer = new ProgressWriter(async payload => {
  if(cloudMode&&progressConflict&&payload.serie_id===current?.serie_id)throw new Error('Resuelve primero el conflicto de progreso.');
  const send=async body=>api('/api/progress',{method:'POST',body:JSON.stringify(body),keepalive:true,
    ...(cloudMode?{headers:{'X-Operation-Id':body.operationId}}:{})});
  const id=payload.serie_id;
  try {
    // Si se perdió la respuesta, confirma primero la misma operación antes de
    // enviar la posición posterior. Sus IDs sobreviven a recargas y cierres.
    const previous=sendingProgress.get(id)??payload._previous;
    if(previous&&previous.operationId!==payload.operationId){const result=await send(previous);progressVersions.set(id,result.timestamp);sendingProgress.delete(id);}
    const {_previous,_attempted,...clean}=payload;
    const body=cloudMode?{...clean,expected_timestamp:_attempted?clean.expected_timestamp:progressVersions.get(id)??clean.expected_timestamp??null,operationId:clean.operationId??crypto.randomUUID()}:clean;
    sendingProgress.set(id,body);
    if(cloudMode&&!payload.privateReading){
      if(pendingProgress[id]?.operationId===body.operationId)pendingProgress[id]={...body,_attempted:true};
      else if(pendingProgress[id])pendingProgress[id]._previous=body;
      persistPending();
    }
    const result=await send(body);progressVersions.set(id,result.timestamp);sendingProgress.delete(id);
    if(cloudMode&&!payload.privateReading){
      if(pendingProgress[id]?.operationId===body.operationId)delete pendingProgress[id];
      else if(pendingProgress[id]){delete pendingProgress[id]._previous;pendingProgress[id].expected_timestamp=result.timestamp;}
      persistPending();
    }
    if(current?.id===payload.capitulo_id)lastSaved={...payload,timestamp:result.timestamp??Date.now()};
    return result;
  } catch(error) {
    if(['PROGRESS_CONFLICT','CHAPTER_NOT_FOUND','SERIES_NOT_FOUND','PRIVATE_LOCKED'].includes(error.code)) {
      delete pendingProgress[id];sendingProgress.delete(id);persistPending();
      if(error.code==='PROGRESS_CONFLICT'&&current?.serie_id===id){progressConflict=true;$('resume-synced').hidden=false;notice(error.message);}
    }
    throw error;
  }
}, (state, payload) => {
  if (current?.id !== payload.capitulo_id) return;
  const position=`${current.title||'Capítulo'} · imagen ${payload.page_index+1}`;
  const time=lastSaved?new Date(lastSaved.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
  $('save-status').textContent = progressConflict?'Progreso actualizado en otro dispositivo':state==='saved'?`${cloudMode&&!isGuest()?'Sincronizado':'Guardado en este dispositivo'} · ${position} · ${time}`:state==='saving'?`Guardando ${position}…`:`Pendiente de guardar · ${position}${lastSaved?` · último guardado ${time}`:''}`;
  $('retry-progress').hidden=state!=='error'||progressConflict;
  if (state === 'error') dirty = true;
});
function flushProgress() {
  saveDebounced.cancel();
  const payload = snapshot();
  if (!payload) return;
  dirty = false;checkpointAt=Date.now();
  return enqueueProgress(payload);
}
function enqueueProgress(payload){
  if(cloudMode&&!payload.privateReading){
    const previous=sendingProgress.get(payload.serie_id)??pendingProgress[payload.serie_id]?._previous;
    payload={...payload,operationId:crypto.randomUUID(),expected_timestamp:progressVersions.get(payload.serie_id)??null,...(previous?{_previous:previous}:{})};
    pendingProgress[payload.serie_id]=payload;persistPending();
  }
  return writer.enqueue(payload);
}
const saveDebounced = debounce(flushProgress, 700);

function updatePosition() {
  frame = null;
  if (!current || !$('library').hidden || !slots.length) return;
  const point = anchor();
  const rect = pages.getBoundingClientRect();
  const available = Math.max(1, pages.offsetHeight - innerHeight);
  const percent = readerUI.preferences.mode === 'paged' ? Math.round((pageIndex+1)/slots.length*100) : Math.round(Math.min(100, Math.max(0, -rect.top / available * 100)));
  lastPage=point?.index??0;
  const positionText=`Imagen ${lastPage+1} de ${slots.length}`;if($('page-position').textContent!==positionText)$('page-position').textContent=positionText;
  if(percent!==lastPercent){lastPercent=percent;$('reading-progress').value=percent;$('progress-label').textContent=`${percent}%`;}
  readerUI.update({index:point?.index ?? 0,total:slots.length,title:current.title||'Capítulo',series:$('series-title').textContent,
    previous:!$('previous').disabled,next:!$('next').disabled,read:chapters.find(item=>item.id===current.id)?.estado_lectura===1,busy:$('mark-read').disabled});
  reconcileImages();
}
window.addEventListener('scroll', () => {
  if (!frame) frame = requestAnimationFrame(updatePosition);
  if (!current || !$('library').hidden || restoring || readerUI.preferences.mode === 'paged') return;
  dirty = true;
  saveDebounced();if(Date.now()-checkpointAt>2500)flushProgress();
}, { passive: true });

function unload(slot) {
  clearTimeout(slot.retryTimer);slot.retryTimer=null;
  if(slot.blobUrl){URL.revokeObjectURL(slot.blobUrl);slot.blobUrl=null;}
  if (!['loaded','retrying'].includes(slot.state)) return;
  slot.img.removeAttribute('src');
  slot.state = 'idle';
  slot.element.dataset.state = 'idle';
  slot.message.textContent = 'La imagen se cargará al acercarte.';
}

function setRatio(slot, ratio) {
  const point = anchor();
  slot.ratio = ratio;
  slot.element.style.setProperty('--page-ratio', String(ratio));
  layoutPages();
  restoreAnchor(point);
}

function pump() {
  if (reconciling || restoring || !$('library').hidden || document.visibilityState === 'hidden') return;
  // Visibles primero; por defecto solo las siguientes tres, con concurrencia acotada.
  const candidates = [...queue].filter(slot => slot.near && slot.state === 'idle');
  for (const slot of candidates) {
    if (running >= MAX_IN_FLIGHT) break;
    queue.delete(slot);
    loadImage(slot);
  }
}

function loadImage(slot) {
  const version = generation;
  running++;
  slot.state = 'loading';
  slot.element.dataset.state = 'loading';
  slot.message.textContent = 'Cargando imagen…';
  slot.retry.hidden = true;
  let settled = false;
  let retryable=true;
  const controller = new AbortController();
  const finish = (outcome) => {
    if (settled) return;
    settled = true;
    if(outcome!=='loaded')controller.abort();
    clearTimeout(timer);
    slot.img.onload = slot.img.onerror = null;
    slot.cancel = null;
    if (version !== generation) return;
    running--;
    if (outcome === 'loaded' && slot.img.naturalWidth && slot.img.naturalHeight) {
      slot.failures=0;
      slot.naturalWidth = slot.img.naturalWidth;
      setRatio(slot, slot.img.naturalWidth / slot.img.naturalHeight);
      slot.state = 'loaded';
      slot.element.dataset.state = 'loaded';
      if(readerUI.preferences.mode==='paged'&&slot.index===pageIndex&&slot.pendingFraction!==undefined) {
        slot.element.scrollTop=slot.pendingFraction*slot.element.scrollHeight;delete slot.pendingFraction;
      }
      if (!slot.retain) unload(slot);
    } else if (outcome === 'cancel') {
      slot.img.removeAttribute('src');
      slot.state = 'idle';
      slot.element.dataset.state = 'idle';
      slot.message.textContent = 'La imagen se cargará al acercarte.';
    } else {
      slot.img.removeAttribute('src');
      if(slot.blobUrl){URL.revokeObjectURL(slot.blobUrl);slot.blobUrl=null;}
      const retry=retryable&&slot.failures<2&&slot.near&&document.visibilityState!=='hidden';
      slot.state=retry?'retrying':'error';slot.element.dataset.state=slot.state;
      const delay=1000*2**slot.failures;slot.failures++;
      slot.message.textContent=retry?`Conexión interrumpida. Reintentando en ${delay/1000} s…`:'No se pudo cargar esta página. Puedes reintentar sin cerrar el capítulo.';
      slot.retry.hidden = false;
      if(retry)slot.retryTimer=setTimeout(()=>{
        slot.retryTimer=null;
        if(version!==generation||!slot.near||!$('library').hidden||document.visibilityState==='hidden')return;
        slot.state='idle';queue.add(slot);pump();
      },delay);
    }
    updatePosition();
    pump();
  };
  const timer = setTimeout(() => finish('error'), 125000);
  slot.cancel = () => finish('cancel');
  slot.img.onload = () => finish('loaded');
  slot.img.onerror = () => finish('error');
  // La única descarga es la imagen firmada del proxy Node, en esta cola acotada.
  if(cloudMode)apiFetch(slot.url,{signal:controller.signal}).then(async response=>{
    if(!response.ok){retryable=response.status>=500||[408,429].includes(response.status);throw new Error('No se pudo cargar la imagen.');}
    const blob=await response.blob();if(settled||version!==generation)return;
    slot.blobUrl=URL.createObjectURL(blob);slot.img.src=slot.blobUrl;
  }).catch(()=>finish(controller.signal.aborted?'cancel':'error'));
  else slot.img.src = slot.url;
}

function observePages() {
  loadObserver?.disconnect();
  if (readerUI.preferences.mode === 'vertical') {
    if('IntersectionObserver' in window)loadObserver = new IntersectionObserver(reconcileImages, { rootMargin:'2000px 0px',threshold:0 });
    for(const slot of slots) loadObserver?.observe(slot.element);
  }
  reconcileImages();
}

function reconcileImages() {
  if(reconciling || restoring || !current || !$('library').hidden || document.visibilityState==='hidden' || !slots.length)return;
  reconciling=true;
  let first=pageIndex,last=pageIndex;
  if(readerUI.preferences.mode==='vertical') {
    first=anchor()?.index??0;last=first;while(last+1<slots.length&&slots[last+1].element.getBoundingClientRect().top<innerHeight)last++;
  }
  const window=readingWindow(slots.length,first,last,readerUI.preferences.prefetch);
  const retained=new Set(window.retain),wanted=new Set(window.load);
  queue.clear();
  for(const slot of slots) {
    slot.near=wanted.has(slot.index);slot.retain=retained.has(slot.index);
    if(!slot.retain){slot.cancel?.();unload(slot);}
  }
  for(const index of window.load)if(slots[index].state==='idle')queue.add(slots[index]);
  reconciling=false;pump();
}

function layoutPages() {
  if(!readerUI)return;
  const prefs=readerUI.preferences, paged=prefs.mode==='paged';
  document.body.classList.toggle('reader-paged',paged&&Boolean(current));
  const available=Math.min($('reader-stage').clientWidth||viewportWidth(),800);let maximum=available;
  for(const slot of slots) {
    const base=prefs.fit==='original' ? slot.naturalWidth||prefs.width : prefs.fit==='height' ? Math.min(available,Math.max(1,innerHeight-16)*slot.ratio) : Math.min(available,prefs.width);
    const width=Math.max(1,base*prefs.zoom/100);
    slot.element.style.width=width+'px';slot.element.style.setProperty('--image-width',width+'px');
    slot.element.hidden=paged&&slot.index!==pageIndex;maximum=Math.max(maximum,width);
  }
  pages.style.width=paged?'100%':maximum+'px';
}

function jumpToPage(index,{fraction=0,save=true}={}) {
  if(!current||!slots.length)return;
  index=Math.max(0,Math.min(slots.length-1,index));
  if(readerUI.preferences.mode==='paged') {
    pageIndex=index;pageFraction=fraction;layoutPages();
    const slot=slots[index];if(slot.state!=='loaded')slot.pendingFraction=fraction;
    slot.element.scrollTop=fraction*slot.element.scrollHeight;slot.element.scrollLeft=0;
  } else {
    const rect=slots[index].element.getBoundingClientRect();window.scrollTo(0,scrollY+rect.top+rect.height*fraction);
  }
  updatePosition();if(save&&!restoring){dirty=true;saveDebounced();}
}

function changeReaderSettings(next,previous) {
  if(!current)return;
  // anchor() sigue el modo anterior hasta tomar el punto visual que se conservará.
  const point=previous.mode==='paged' ? {index:pageIndex,fraction:pageFraction,offset:0} : (()=>{
    const slot=slots.find(item=>item.element.getBoundingClientRect().bottom>0)??slots.at(-1),rect=slot.element.getBoundingClientRect();
    return {index:slot.index,fraction:Math.max(0,Math.min(1,-rect.top/rect.height)),offset:rect.top};
  })();
  restoring=true;pageIndex=point.index;pageFraction=point.fraction;layoutPages();
  if(next.mode!==previous.mode || next.fit!==previous.fit || next.zoom!==previous.zoom || next.width!==previous.width) {
    if(next.mode==='paged')window.scrollTo(0,0);
    jumpToPage(point.index,{fraction:point.fraction,save:false});
  }
  requestAnimationFrame(()=>{restoring=false;observePages();updatePosition();dirty=true;saveDebounced();});
  $('chapter-meta').textContent=`${slots.length} imágenes · ${next.mode==='paged'?'Lectura paginada':'Lectura vertical'}`;
}

function disposePages() {
  loadObserver?.disconnect();
  queue.clear();
  // Invalidar primero para que cancelar peticiones no arranque tareas antiguas.
  generation++;
  for (const slot of slots) { slot.cancel?.(); unload(slot); slot.img.removeAttribute('src'); }
  running = 0;
  slots = [];
  pages.replaceChildren();
  pages.style.width='';
}

function renderPages(images, saved) {
  const fragment = document.createDocumentFragment();
  slots = images.map((image, index) => {
    const ratio = Number(saved?.ratios?.[index]);
    const element = document.createElement('div');
    element.className = 'page-slot';
    element.dataset.index = index;
    element.dataset.state = 'idle';
    const img = document.createElement('img');
    img.alt = `Imagen ${index + 1} del capítulo`;
    img.decoding = 'async';
    // IO y la cola ya controlan cuándo cargar: loading=lazy añadiría otro umbral.
    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    const number = document.createElement('span');
    number.className = 'page-number'; number.textContent = `IMAGEN ${String(index + 1).padStart(2, '0')}`;
    const message = document.createElement('p'); message.textContent = 'La imagen se cargará al acercarte.';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'button subtle'; retry.textContent = `Reintentar página ${index+1}`; retry.hidden = true;
    const slot = { element, img, message, retry, index, state: 'idle', near: false,
      failures:0,retryTimer:null,
      naturalWidth:Number(saved?.naturalWidths?.[index])||0,
      ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : .45, url: imageProxyUrl(image, apiOrigin) };
    element.style.setProperty('--page-ratio', String(slot.ratio));
    element.addEventListener('scroll',()=>{
      if(readerUI.preferences.mode!=='paged'||index!==pageIndex||restoring||!$('library').hidden)return;
      pageFraction=Math.min(1,element.scrollTop/Math.max(1,element.scrollHeight));dirty=true;updatePosition();saveDebounced();
    },{passive:true});
    retry.addEventListener('click', () => { clearTimeout(slot.retryTimer);slot.retryTimer=null;slot.failures=0;slot.state = 'idle';reconcileImages(); });
    placeholder.append(number, message, retry); element.append(img, placeholder); fragment.append(element);
    return slot;
  });
  pages.append(fragment);
  layoutPages();
}

async function openChapter(id,{trial=null}={}) {
  const origin=trial?.item??series.find(item=>item.id===chapters.find(chapter=>String(chapter.id)===String(id))?.serie_id)??series.find(item=>String(item.ultimo_capitulo_id)===String(id));
  let target=trial?trial.list.find(chapter=>chapter.id===id):chapters.find(chapter=>String(chapter.id)===String(id)),prefetchedList;
  const previousSave=flushProgress()??writer.running;
  chapterAbort?.abort();
  chapterAbort = new AbortController();
  const { signal } = chapterAbort;
  disposePages();
  current = null;
  lastSaved=null;failedReading=null;$('reader-failed-alternatives').hidden=true;$('retry-progress').hidden=true;$('reader-trial-ficha').hidden=true;$('reader-alternatives').hidden=true;
  pageIndex=0;pageFraction=0;document.body.classList.remove('reader-paged','reader-active');readerUI.activate(false);
  dirty = false;
  restoring = true;
  await setLibrary(false, { opening: true });
  if(signal.aborted)return;
  restoring = true;
  $('welcome').hidden = true;
  $('chapter-end').hidden = true;
  pages.setAttribute('aria-busy', 'true');
  $('chapter-title').textContent = 'Abriendo capítulo…';
  $('chapter-meta').textContent = 'Preparando la lectura';
  $('chapter-cancel').hidden = false;
  $('close-chapter').hidden = true;
  $('save-status').textContent = 'Guardado automático';
  notice();
  window.scrollTo(0, 0);
  try {
    if(!trial&&!target&&origin){prefetchedList=await api(`/api/series/${origin.id}/chapters`,{signal});target=prefetchedList.find(chapter=>String(chapter.id)===String(id));}
    const result = trial ? await api('/api/vault/images',{method:'POST',body:JSON.stringify({source:trial.item.source,url:target.url}),signal}) : await api(`/api/chapters/${encodeURIComponent(id)}/images`, { signal });
    if (signal.aborted) return;
    if (!Array.isArray(result.images) || !result.images.length) throw new Error('El capítulo no contiene imágenes.');
    if(previousSave)await Promise.race([previousSave,new Promise(resolve=>setTimeout(resolve,2000))]);
    const [savedProgress, list] = trial?[null,trial.list]:await Promise.all([
      api(`/api/series/${result.chapter.serie_id}/progress`, { signal }),
      prefetchedList??api(`/api/series/${result.chapter.serie_id}/chapters`, { signal })
    ]);
    if (signal.aborted) return;
    current = trial?{...result.chapter,...target,serie_id:null,trial}:result.chapter;
    current.privateReading=Boolean(result.chapter.privateReading || series.find(item=>item.id===current.serie_id)?.is_private);
    progressConflict=false;$('resume-synced').hidden=true;if(!trial&&!sendingProgress.has(current.serie_id))progressVersions.set(current.serie_id,savedProgress?.timestamp??null);
    $('reader-trial-ficha').hidden=!trial;
    $('reader-alternatives').hidden=Boolean(current.privateReading);
    if(trial)$('save-status').textContent='Lectura de prueba · no se guarda la obra ni su progreso';
    document.body.classList.add('reader-active');
    chapters = orderedChapters(list);
    const local = trial?null:cache[current.id];
    renderPages(result.images, local);
    $('series-title').textContent = trial?(trial.item.title??trial.item.titulo):series.find(item => item.id === current.serie_id)?.titulo ?? 'TU LECTURA';
    $('chapter-title').textContent = current.title || 'Capítulo';
    $('chapter-meta').textContent = `${slots.length} imágenes · ${readerUI.preferences.mode==='paged'?'Lectura paginada':'Lectura vertical'}`;
    document.title = series.find(item=>item.id===current.serie_id)?.is_private ? 'Lector · Lectura privada' : `${current.title || 'Capítulo'} · Lector Manga`;
    $('chapter-end').hidden = false;
    $('close-chapter').hidden = false;
    $('reload-chapter').hidden = false;
    updateNavigation();
    history.replaceState(null, '', trial?location.pathname+'#'+trial.returnView:series.find(item=>item.id===current.serie_id)?.is_private ? location.pathname+'#private' : `${location.pathname}?chapter=${current.id}`);
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (signal.aborted) return;
    const serverSaved = savedProgress?.capitulo_id === current.id ? savedProgress : null;
    const pending=pendingProgress[current.serie_id];
    const recoverLocal=(!cloudMode||pending?.capitulo_id===current.id)&&local;
    const useLocal = recoverLocal && (!serverSaved || local.timestamp >= serverSaved.timestamp - 3000);
    const savedAnchor=savedPageAnchor(recoverLocal,serverSaved,slots.length);
    if(savedAnchor) jumpToPage(savedAnchor.index,{fraction:savedAnchor.fraction,save:false});
    else if(readerUI.preferences.mode==='paged') {
      const y=useLocal?local.scroll_position_y:serverSaved?.scroll_position_y ?? 0;
      let height=0,index=0;
      while(index<slots.length-1 && height+Math.min(viewportWidth(),readerUI.preferences.width)/slots[index].ratio<y)height+=Math.min(viewportWidth(),readerUI.preferences.width)/slots[index++].ratio;
      jumpToPage(index,{save:false});
    } else if (useLocal && local.anchor && slots[local.anchor.index]) {
      const slot = slots[local.anchor.index];
      const rect = slot.element.getBoundingClientRect();
      if (local.scroll_position_y < pages.offsetTop) window.scrollTo(0, local.scroll_position_y);
      else window.scrollTo(0, scrollY + rect.top + rect.height * local.anchor.fraction);
    } else if (serverSaved) window.scrollTo(0, serverSaved.scroll_position_y);
    // Dos frames dejan pasar el evento scroll de restauración antes de guardar.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (signal.aborted) return;
    restoring = false;
    observePages();
    updatePosition();
    readerUI.activate(true);
    readerUI.showTouchGuide();
    dirty=true;flushProgress();
  } catch (error) {
    if (signal.aborted) return;
    current = null;
    document.body.classList.remove('reader-active','reader-paged');readerUI.activate(false);
    disposePages();
    $('welcome').hidden = false;
    $('chapter-title').textContent = 'No pudimos abrir el capítulo';
    failedReading=origin&&!origin.is_private?{item:origin,number:target?.number??target?.numero??null}:null;
    $('reader-failed-alternatives').hidden=!failedReading;
    notice(`${error.message} ${failedReading?'Puedes buscar otra fuente desde el lector.':'Puedes volver a abrirlo desde la biblioteca.'}`);
    restoring = false;
  } finally {
    if (!signal.aborted) { pages.setAttribute('aria-busy', 'false'); $('chapter-cancel').hidden = true; }
  }
}

function updateNavigation() {
  const index = chapters.findIndex(chapter => chapter.id === current?.id);
  $('previous').disabled = index <= 0;
  $('next').disabled = index < 0 || index >= chapters.length - 1;
  const read = chapters[index]?.estado_lectura === 1;
  $('mark-read').disabled = Boolean(current?.trial);
  $('mark-read').hidden=Boolean(current?.trial);$('reader-mark').hidden=Boolean(current?.trial);
  $('mark-read').textContent = read ? 'Leído ✓ · desmarcar' : 'Marcar como leído';
  updatePosition();
}

function fillChapters(list) {
  list=orderedChapters(list);
  const saved = series.find(item => String(item.id) === $('series-select').value);
  const resume = list.find(chapter => chapter.id === saved?.ultimo_capitulo_id);
  pickedChapterId = (resume ?? list.find(chapter => !chapter.estado_lectura) ?? list[0])?.id ?? null;
  $('picked-read').disabled = pickedChapterId == null;
  $('picked-read').textContent = resume ? 'Continuar · ' + (resume.titulo ?? resume.title) : 'Empezar a leer';
  chapterBrowser.update(list, {lastId: saved?.ultimo_capitulo_id});
  $('chapter-select').replaceChildren(new Option(list.length ? 'Seleccionar capítulo…' : 'Sin capítulos guardados', ''));
  for (const chapter of list) $('chapter-select').add(new Option(`${chapter.estado_lectura ? '✓ ' : ''}${chapter.titulo}`, chapter.id));
  $('chapter-select').disabled = !list.length;
  $('open-chapter').disabled = true;
}
async function loadLibraryChapters(sync = false) {
  const id = $('series-select').value;
  const version = ++libraryGeneration;
  libraryAbort?.abort(); libraryAbort = beginQuery();
  const controller = libraryAbort;
  $('open-chapter').disabled = true;
  $('chapter-select').disabled = true;
  $('sync-chapters').disabled = !id || sync;
  if (!id) { fillChapters([]); endQuery(controller); return; }
  $('library-status').textContent = sync ? 'Buscando capítulos en el sitio…' : 'Cargando capítulos…';
  $('picker-status').textContent = $('library-status').textContent;
  chapterBrowser.loading(); $('picked-read').disabled = true;
  try {
    const list = await api(`/api/series/${id}/${sync ? 'sync' : 'chapters'}`, sync ? { method: 'POST', signal: controller.signal } : { signal: controller.signal });
    if (version !== libraryGeneration) return;
    fillChapters(list);
    $('library-status').textContent = list.length ? `${list.length} capítulos disponibles` : 'Pulsa Actualizar capítulos para consultarlos en el sitio.';
    $('picker-status').textContent = $('library-status').textContent;
  } catch (error) { if (version === libraryGeneration) { $('library-status').textContent = controller.signal.aborted ? 'Consulta cancelada.' : error.message; $('picker-status').textContent = $('library-status').textContent; chapterBrowser.clear(); } }
  finally { endQuery(controller); if (version === libraryGeneration) $('sync-chapters').disabled = false; }
}
async function loadLibrary() {
  const loadingVersion=++libraryLoadVersion;
  $('series-grid').hidden=false;setGridLoading($('series-grid'),true);
  if(privacy?.unlocked())setGridLoading($('private-library'),true);
  try {
    const scopeVersion=activeView;
    const selectedSeries = $('series-select').value;
    let libraryRevision=0;
    const [publicSeries, sources] = await Promise.all([api('/api/series',{onRevision:value=>{libraryRevision=value;}}), api('/api/sources')]);
    const scope=privacy?.unlocked()?'private':null;
    const protectedSeries=scope?await api('/api/series?scope='+scope):[];
    if(loadingVersion!==libraryLoadVersion||scopeVersion!==activeView||(scope==='private'&&!privacy?.unlocked()))return;
    if(cloudMode) {
      const publicIds=new Set(publicSeries.map(item=>item.id));
      const removed=series.filter(item=>!item.is_private&&!publicIds.has(item.id));
      if(removed.length) {
        if(current&&removed.some(item=>item.id===current.serie_id)){current.privateReading=true;dirty=false;saveDebounced.cancel();}
        for(const item of removed)clearSensitive({onlySeries:item.id});
      }
    }
    if(cloudMode&&current) {
      const visible=[...publicSeries,...protectedSeries].find(item=>item.id===current.serie_id);
      if(!visible) {
        // Otro dispositivo pudo ocultar o eliminar la obra mientras se leía.
        current.privateReading=true;dirty=false;saveDebounced.cancel();
        clearSensitive({onlySeries:current.serie_id});
        notice('La lectura cambió en otro dispositivo. Ábrela de nuevo desde tu biblioteca.');
      } else current.privateReading=Boolean(visible.is_private);
    }
    series=[...publicSeries,...protectedSeries];sourceCatalog=sources;libraryLoaded=true;
    const selected = $('source-filter').value;
    $('source-filter').replaceChildren(new Option('Todas las fuentes', ''));
    for (const source of sourceCatalog.filter(source=>(source.enabled&&!source.demo)||series.some(item=>item.source===source.id))) $('source-filter').add(new Option(`${source.name}${source.enabled ? '' : ' · no disponible'}`, source.id));
    if (sourceCatalog.some(source => source.id === selected)) $('source-filter').value = selected;
    const previousSearchSource = $('search-source').value;
    $('search-source').replaceChildren(new Option('Fuentes seleccionadas','selected'),new Option('Todas las fuentes activas','all'),...sourceCatalog.filter(source => source.enabled && source.capabilities.search).map(source => new Option(source.name, source.id)));
    if ([...$('search-source').options].some(option => option.value === previousSearchSource)) $('search-source').value = previousSearchSource;
    await shell?.update();
    privacy?.render();
    filterLibrary(selectedSeries);
    renderHero();
    renderEmptyState();
    api('/api/storage').then(info => { $('storage-status').textContent = 'Lectura sin descargas guardadas · Base de datos: ' + (info.databaseBytes / 1024).toFixed(0) + ' KB · ' + info.chapters + ' enlaces de capítulos'; }).catch(() => {});
    const publicItems=series.filter(item=>!item.is_private),count=groupWorks(publicItems).length;
    $('library-status').textContent = count ? `${count} ${count === 1 ? 'obra' : 'obras'} · ${publicItems.length} fuentes guardadas` : 'Añade el enlace de una serie para comenzar.';
    if(cloudMode){const visible=new Set(publicSeries.map(item=>item.id));for(const [id,item] of Object.entries(cache))if(!visible.has(item.serie_id))delete cache[id];for(const id of Object.keys(pendingProgress))if(!visible.has(Number(id)))delete pendingProgress[id];saveCache();persistPending();}
    window.dispatchEvent(new CustomEvent('library-loaded',{detail:{revision:libraryRevision}}));
    if($('home-notice').textContent.startsWith('No se pudo cargar la biblioteca.'))notice();
    return true;
  } catch (error) { $('library-status').textContent = error.message; notice(cloudMode?'No se pudo cargar la biblioteca. Comprueba tu conexión e inicia sesión de nuevo si es necesario.':'No se pudo cargar la biblioteca. Comprueba que la API local esté disponible.');return false; }
  finally {if(loadingVersion===libraryLoadVersion){setGridLoading($('series-grid'),false);setGridLoading($('private-library'),false);renderEmptyState();}}
}

function renderEmptyState() {
  const empty=libraryLoaded&&!series.some(activeView==='home'?isPublicReading:item=>!item.is_private);
  $('library-welcome').hidden=!empty||!['home','library'].includes(activeView);
  $('home-content').hidden=empty;
  $('home-start-guide').hidden=!empty;
  $('series-grid').hidden=empty&&$('series-grid').getAttribute('aria-busy')!=='true';
}

function sourceName(id) { return sourceCatalog.find(source => source.id === id)?.name ?? id; }
function renderHero() {
  heroSeries = homeModel(series).hero;
  $('continue-hero').hidden = !heroSeries;
  if (!heroSeries) { for(const id of ['hero-title','hero-chapter','hero-source'])$(id).textContent='';for(const id of ['hero-action','hero-details'])$(id).removeAttribute('aria-label');$('hero-cover').removeAttribute('src');$('hero-backdrop').removeAttribute('src');$('hero-progress').hidden=true;return; }
  $('hero-title').textContent = heroSeries.titulo;
  const progress = libraryProgress(heroSeries);
  $('hero-progress').hidden = !progress.total; $('hero-progress-bar').value = progress.percent;
  $('hero-progress-copy').textContent = `${progress.read} de ${progress.total} capítulos marcados como leídos`;
  const backdrop = $('hero-backdrop'); backdrop.hidden = !isProxyUrl(heroSeries.coverUrl);
  if (!backdrop.hidden && (backdrop.dataset.cover ?? backdrop.getAttribute('src')) !== heroSeries.coverUrl) setCover(backdrop, heroSeries.coverUrl, heroSeries.coverKey);
  else if (backdrop.hidden) backdrop.removeAttribute('src');
  backdrop.onerror = () => { backdrop.hidden = true; };
  $('hero-label').textContent = heroSeries.ultimo_capitulo_id ? 'CONTINÚA DONDE LO DEJASTE' : 'UNA HISTORIA PARA EMPEZAR';
  $('hero-chapter').textContent = heroSeries.ultimo_capitulo ?? `${heroSeries.total_capitulos ?? 0} capítulos en tu biblioteca`;
  $('hero-source').textContent = sourceName(heroSeries.source);
  $('hero-action').replaceChildren(document.createTextNode(heroSeries.ultimo_capitulo_id ? 'Continuar lectura ↗' : 'Empezar esta historia ↗'));
  $('hero-action').setAttribute('aria-label',`${heroSeries.ultimo_capitulo_id?'Continuar':'Empezar'} ${heroSeries.titulo}`);
  $('hero-details').setAttribute('aria-label',`Elegir ${heroSeries.titulo}`);
  const cover = $('hero-cover');
  const validCover = isProxyUrl(heroSeries.coverUrl);
  cover.hidden = !validCover; $('hero-fallback').hidden = Boolean(validCover);
  if (validCover && (cover.dataset.cover??cover.getAttribute('src')) !== heroSeries.coverUrl) setCover(cover,heroSeries.coverUrl,heroSeries.coverKey);
  else if (!validCover) cover.removeAttribute('src');
  cover.onerror = () => { cover.hidden = true; $('hero-fallback').hidden = false; };
}
async function selectSeries(item) {
  const origin = document.activeElement;
  const workKey=item.work_id??item.id;
  if(pickedWorkKey!==workKey){pickedWorkKey=workKey;detailTabs.select('chapters');}
  if (!visibleSeries().some(series => series.id === item.id)) {
    $('source-filter').value = ''; $('library-query').value = ''; $('only-unread').checked = false;
    filterLibrary('');
    shell?.clearFilters();
  }
  if(![...$('series-select').options].some(option=>option.value===String(item.id)))$('series-select').add(new Option(item.titulo,item.id));
  $('series-select').value = String(item.id); cards();
  $('picked-title').textContent = item.work_title??item.titulo; $('picked-source').textContent = sourceName(item.source)+(item.work_title&&item.titulo!==item.work_title?` · ${item.titulo}`:'');
  shell?.organize(item);
  privacy?.organize(item);
  chapterBrowser.clear();
  $('picked-authors').textContent = item.authors?.length ? 'Autoría: ' + item.authors.join(', ') : 'Autoría no disponible';
  $('picked-publication').textContent = publicationLabels[item.status] ?? 'Estado de publicación no disponible';
  $('picked-tags').replaceChildren(...[...(item.genres ?? []), ...(item.themes ?? [])].map(value => Object.assign(document.createElement('span'), {className:'metadata-tag',textContent:tagLabel(value)})));
  const progress = libraryProgress(item);
  $('picked-progress').textContent = `${progress.label} · ${progress.read} de ${progress.total} capítulos marcados como leídos`;
  if (!$('picked-description').textContent) $('picked-description').textContent = 'Esta fuente no incluye una sinopsis.';
  const cover = $('picked-cover'); cover.hidden = !item.coverUrl;
  if (isProxyUrl(item.coverUrl)) setCover(cover,item.coverUrl,item.coverKey); else cover.removeAttribute('src');
  cover.onerror = () => { cover.hidden = true; };
  $('picker-status').textContent = 'Cargando capítulos…';
  setDialog('chapter-controls', true);
  rememberDialogOrigin('chapter-controls', origin?.isConnected ? origin : document.querySelector('#series-grid .series-card.selected .series-choice') ?? $('show-saved'));
  await loadLibraryChapters();
  if ($('chapter-controls').open&&detailTabs.active==='chapters') chapterBrowser.focus();
}
function visibleSeries() { return groupWorks(filterSeries(series.filter(item=>inLibraryScope(item,$('genre-filter').value==='adult'?'adult':'library')), { source: $('source-filter').value, query: $('library-query').value,
  unreadOnly: $('only-unread').checked, sort: $('library-sort').value,genre:$('genre-filter').value,author:$('author-filter').value,
  publication:$('publication-filter').value,reading:$('reading-filter').value,folder:$('folder-filter').value })); }
function cards() {
  const items = visibleSeries();
  $('library-count').textContent = items.length + ' de ' + groupWorks(series.filter(item=>inLibraryScope(item,$('genre-filter').value==='adult'?'adult':'library'))).length + ' obras';
  renderSeriesCards($('series-grid'), items, { selectedId: $('series-select').value, sourceName,
    onSelect: selectSeries,
    onResume: item => { $('series-select').value = String(item.id); cards(); openChapter(item.ultimo_capitulo_id); }, onRemove: async item => {
      try {
        const ids=new Set((item.editions??[item]).map(e=>e.id));
        for(const id of ids)await api('/api/series/' + id, { method: 'DELETE' });
        if (ids.has(current?.serie_id)) closeChapter();
        for (const [key, value] of Object.entries(cache)) if (ids.has(value.serie_id)) delete cache[key];
        saveCache(); await loadLibrary();
      } catch (error) { notice(error.message); }
    } });
}
function filterLibrary(selectedId = $('series-select').value) {
  libraryAbort?.abort(); libraryGeneration++;
  const sourceId = $('source-filter').value;
  const selected = sourceCatalog.find(source => source.id === sourceId);
  $('source-status').textContent = selected?.reason || selected?.note || '';
  $('series-select').replaceChildren(new Option('Seleccionar serie…', ''));
  const visibleWorks=new Set(visibleSeries().map(item=>item.work_id));
  const editions=series.filter(item=>visibleWorks.has(item.work_id));
  for (const item of editions) $('series-select').add(new Option(item.titulo + ' · ' + sourceName(item.source), item.id));
  if (editions.some(item => String(item.id) === String(selectedId))) $('series-select').value = String(selectedId);
  fillChapters([]); $('sync-chapters').disabled = !$('series-select').value;
  cards();
  shell?.renderChips();
  syncSelectControls('reading-filter');
  renderEmptyState();
  if ($('series-select').value) loadLibraryChapters();
}
function showSearch(show) {
  return navigateView(show ? 'explore' : 'library');
}
function navigateView(view, push = true) {
  queryRouteDebounced.cancel();
  if(push)writeLibraryRoute('replace');
  const destination=['home','library','discover','explore','settings','private'].includes(view)?view:'home';
  return changeView(()=>applyView(destination,push),{animate:push&&(activeView!==destination||$('library').hidden),privateView:activeView==='private'||destination==='private'||Boolean(current?.privateReading)});
}
function applyView(view,push) {
  if (!['home','library','discover','explore','settings','private'].includes(view)) view = 'home';
  if (!$('library').hidden) viewScroll.set(activeView, window.scrollY);
  applyLibrary(true); activeView = view;
  privacy?.leave(view);
  const sections = {home:'home-panel',library:'saved-panel',discover:'discover-panel',explore:'search-panel',settings:'settings-panel',private:'private-panel'};
  for (const [name,id] of Object.entries(sections)) {$(id).hidden = name !== view;$(id).classList.toggle('view-enter',name===view);}
  const title = {home:'Una historia más',library:'Mi biblioteca',discover:'Descubrir',explore:'Buscar',settings:'A tu manera',private:'Mi espacio privado'};
  const subtitle = {home:'Retoma tus historias y sigue sus actualizaciones.',library:'Todas tus historias, a tu ritmo.',discover:'Tu siguiente historia empieza aquí.',explore:'Elige tus fuentes y encuentra tu próxima lectura.',settings:'Tu tema, tu color, tu espacio.',private:'Tus historias, fuera de las vistas habituales.'};
  $('library-title').replaceChildren(document.createTextNode(title[view]),Object.assign(document.createElement('span'),{className:'heading-dot',textContent:'.'}));
  $('library-subtitle').textContent=subtitle[view];
  const buttons={home:'show-home',library:'show-saved',discover:'show-discover',explore:'show-search',settings:'show-settings',private:'show-private'};
  for (const [name,id] of Object.entries(buttons)) { $(id).setAttribute('aria-pressed',String(view===name));if(view===name)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');$(id).className='button '+(view===name?'primary':'subtle'); }
  $('show-more').setAttribute('aria-pressed', String(['settings','private'].includes(view)));
  renderEmptyState();
  (matchMedia('(max-width:767px)').matches && view==='explore' ? $('search-query') : $(buttons[view])).focus({preventScroll:true});window.scrollTo(0,viewScroll.get(view)??0);
  const hash=libraryRouteHash(view,currentLibraryFilters());
  if (push && location.hash !== hash) history.pushState({view},'',navigationUrl(hash));
  lastRestoredUrl=location.href;
  document.title=view==='private'?'Lector · Biblioteca privada':view==='discover'?'Lector · Descubrir':'Lector · Tu biblioteca';
  privacy?.enter(view);
  if(view==='library')filterLibrary();
  if (view==='home') {renderHero();shell?.renderHome();}
  if (view==='discover') shell?.enterDiscover();
}
async function addFavorite(url, options = {}) {
  addAbort?.abort(); const controller = addAbort = beginQuery();
  $('add-series').disabled = true;
  $('library-status').textContent = 'Consultando la serie…';
  $('add-status').textContent = 'Consultando la serie…';
  try {
    const favorite = await api('/api/series', { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url_origen: url, ...(options.is_private?{is_private:true}:{}) }) });
    if(favorite.is_adult||favorite.is_private||options.adult){
      $('series-url').value='';setDialog('add-panel',false);
      if(favorite.is_private)await navigateView('private');else {$('genre-filter').value='adult';await navigateView('library');}
      if(sourceCatalog.find(source=>source.id===favorite.source)?.capabilities.chapters)await api(`/api/series/${favorite.id}/sync`,{method:'POST',signal:controller.signal});
      await loadLibrary();notice(favorite.is_private?'Guardada en tu biblioteca privada.':'Guardada con el género +18.');const saved=series.find(item=>item.id===favorite.id);if(saved)await selectSeries(saved);
      return;
    }
    $('source-filter').value = ''; $('library-query').value = ''; $('only-unread').checked = false;
    shell?.clearFilters();
    await loadLibrary();
    controller.signal.throwIfAborted();
    $('series-select').value = String(favorite.id); cards();
    $('series-url').value = ''; await showSearch(false);
    setDialog('add-panel', false);
    await loadLibraryChapters(true);
    controller.signal.throwIfAborted();
    await loadLibrary();
    controller.signal.throwIfAborted();
    $('series-select').value = String(favorite.id); cards();
    await loadLibraryChapters();
    const saved = series.find(item => item.id === favorite.id);
    if (saved) await selectSeries(saved);
  } catch (error) { $('library-status').textContent = controller.signal.aborted ? 'Consulta cancelada.' : error.message; $('search-status').textContent = $('library-status').textContent; $('add-status').textContent = $('library-status').textContent; }
  finally { $('add-series').disabled = false; endQuery(controller); }
}
async function closeChapter() {
  const returnView=current?.trial?.returnView;
  flushProgress(); chapterAbort?.abort(); disposePages();
  current = null; dirty = false; restoring = false;
  document.body.classList.remove('reader-active','reader-paged');readerUI.activate(false);
  pages.setAttribute('aria-busy', 'false');
  $('welcome').hidden = false; $('chapter-end').hidden = true; $('chapter-cancel').hidden = true; $('close-chapter').hidden = true;
  $('reload-chapter').hidden = true;$('reader-trial-ficha').hidden=true;$('reader-alternatives').hidden=true;$('retry-progress').hidden=true;failedReading=null;$('reader-failed-alternatives').hidden=true;
  $('chapter-title').textContent = 'Una historia, sin interrupciones.';
  $('chapter-meta').textContent = 'Capítulo cerrado. Las imágenes se cargarán de nuevo cuando lo abras.';
  $('page-position').textContent = 'Listo para leer'; $('reading-progress').value = 0; $('progress-label').textContent = '0%';
  history.replaceState(null, '', location.pathname); document.title = 'Lector Manga'; window.scrollTo(0, 0);
  await navigateView(returnView??activeView);loadLibrary();
}

$('library-toggle').addEventListener('click', () => navigateView('library'));
$('welcome-library').addEventListener('click', () => navigateView('library'));
$('library-close').addEventListener('click', () => { if (current) setLibrary(false); });
$('hero-action').addEventListener('click', () => { if (heroSeries) heroSeries.ultimo_capitulo_id ? openChapter(heroSeries.ultimo_capitulo_id) : selectSeries(heroSeries); });
$('hero-details').addEventListener('click',()=>{if(heroSeries)selectSeries(heroSeries);});
async function openAddDialog(origin=$('add-toggle')){await setLibrary(true);$('add-status').textContent='';setDialog('add-panel',true);rememberDialogOrigin('add-panel',origin);}
$('add-toggle').addEventListener('click',()=>openAddDialog());
$('add-close').addEventListener('click', () => setDialog('add-panel', false));
$('picker-close').addEventListener('click', () => setDialog('chapter-controls', false));
$('refresh-library').addEventListener('click', loadLibrary);
$('source-filter').addEventListener('change', () => {filterLibrary('');writeLibraryRoute();});
$('add-series-form').addEventListener('submit', event => { event.preventDefault(); addFavorite($('series-url').value.trim()); });
$('search-form').addEventListener('submit', event => { event.preventDefault(); shell.search(); });
$('show-search').addEventListener('click', () => showSearch(true));
$('show-discover').addEventListener('click',()=>navigateView('discover'));
$('show-saved').addEventListener('click', () => showSearch(false));
$('show-private').addEventListener('click',()=>navigateView('private'));
for (const id of ['library-query', 'library-sort', 'only-unread']) $(id).addEventListener(id === 'library-query' ? 'input' : 'change', () => {filterLibrary();if(id==='library-query')queryRouteDebounced();else writeLibraryRoute();});
$('genre-filter').addEventListener('change',()=>writeLibraryRoute());
$('cancel-operation').addEventListener('click', () => { for (const controller of queries) controller.abort(); });
$('close-chapter').addEventListener('click', closeChapter);
$('reload-chapter').addEventListener('click', () => { if (current) openChapter(current.id,{trial:current.trial}); });
$('cancel-chapter').addEventListener('click', closeChapter);
$('series-select').addEventListener('change', () => { cards(); loadLibraryChapters(); });
$('sync-chapters').addEventListener('click', () => loadLibraryChapters(true));
$('chapter-select').addEventListener('change', () => { $('open-chapter').disabled = !$('chapter-select').value; });
$('open-chapter').addEventListener('click', () => openChapter($('chapter-select').value));
for (const [button, direction] of [['previous', -1], ['next', 1]]) {
  $(button).addEventListener('click', () => {
    const index = chapters.findIndex(item => item.id === current?.id);
    if (chapters[index + direction]) openChapter(chapters[index + direction].id,{trial:current?.trial});
  });
}
$('mark-read').addEventListener('click', async () => {
  if (!current||current.trial) return;
  const chapterId = current.id;
  const read = chapters.find(item => item.id === chapterId)?.estado_lectura !== 1;
  $('mark-read').disabled = true;
  updatePosition();
  try {
    await api(`/api/chapters/${chapterId}/read`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read }) });
    if (current?.id !== chapterId) return;
    chapters.find(item => item.id === chapterId).estado_lectura = Number(read);
    updateNavigation();
    const saved = series.find(item => item.id === current.serie_id);
    if (saved) saved.pendientes = Math.max(0, (saved.pendientes ?? 1) + (read ? -1 : 1));
    cards();
  } catch (error) { if (current?.id === chapterId) { notice(error.message); $('mark-read').disabled = false;updatePosition(); } }
});
function focusMode(enabled) {
  readerUI?.setVisible(!enabled);
}
$('to-top').addEventListener('click', () => jumpToPage(0));
window.addEventListener('resize', debounce(() => { if (current) {
  const point=anchor();layoutPages();restoreAnchor(point);observePages();updatePosition();
} }, 150));
document.addEventListener('keydown', event => {
  if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&!$('library').hidden&&current)setLibrary(false);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushProgress();queue.clear();for (const slot of slots) { slot.cancel?.();unload(slot); } } else reconcileImages(); });
window.addEventListener('pagehide', () => {
  saveDebounced.cancel();
  const payload = snapshot();
  if (!payload) return;
  // No adelantar un beacon a una escritura anterior; la copia local permite recuperar.
  if(cloudMode){dirty=false;enqueueProgress(payload);}
  else if (!writer.running && navigator.sendBeacon(apiUrl('/api/progress'), new Blob([JSON.stringify(payload)], { type: 'application/json' }))) dirty = false;
});
async function replayPending(){for(const payload of Object.values(pendingProgress)){if(!sendingProgress.has(payload.serie_id))progressVersions.set(payload.serie_id,payload.expected_timestamp);await writer.enqueue(payload);}}
window.addEventListener('online', () => { if(cloudMode)replayPending();if (dirty) flushProgress(); });
$('resume-synced').addEventListener('click',async()=>{if(!current)return;try{const progress=await api(`/api/series/${current.serie_id}/progress`);if(progress)await openChapter(progress.capitulo_id);}catch(error){notice(error.message);}});
$('retry-progress').addEventListener('click',async()=>{if(current?.trial)return;$('retry-progress').disabled=true;try{if(cloudMode)await replayPending();dirty=true;await flushProgress();}finally{$('retry-progress').disabled=false;}});
readerUI=createReaderControls({change:changeReaderSettings,jump:jumpToPage,step:direction=>{const index=(anchor()?.index??0)+direction;if(index>=0&&index<slots.length)jumpToPage(index);},
  library:()=>navigateView(series.find(item=>item.id===current?.serie_id)?.is_private?'private':'library'),close:closeChapter,active:()=>Boolean(current&&$('library').hidden)});
for(const [id,original] of [['previous-chapter','previous'],['next-chapter','next'],['reader-mark','mark-read']])$(id).addEventListener('click',()=>$(original).click());
function clearSensitive({onlySeries}={}) {
  clearTemporaryCovers();
  const target=series.find(item=>item.id===onlySeries),sensitiveIds=new Set(series.filter(item=>item.is_private||(target&&item.work_id===target.work_id)).map(item=>item.id));
  if(current?.privateReading&&!onlySeries)sensitiveIds.add(current.serie_id);
  if(onlySeries)sensitiveIds.add(onlySeries);
  if(current&&sensitiveIds.has(current.serie_id))current.privateReading=true;
  const saved=flushProgress();
  if(current&&sensitiveIds.has(current.serie_id)){
    chapterAbort?.abort();disposePages();current=null;dirty=false;readerUI.activate(false);
    document.body.classList.remove('reader-active','reader-paged');
    $('chapter-title').textContent='Tu próxima página.';$('series-title').textContent='TU LECTURA';$('chapter-meta').textContent='Lectura cerrada.';
    $('welcome').hidden=false;$('chapter-end').hidden=true;$('close-chapter').hidden=true;$('library-close').hidden=true;$('reload-chapter').hidden=true;
    $('page-position').textContent='Listo para leer';$('reading-progress').value=0;$('progress-label').textContent='0%';$('save-status').textContent='Guardado automático';
    $('overlay-series').textContent='';$('overlay-title').textContent='Lectura cerrada';
    setLibrary(true);
  }
  series=series.filter(item=>!sensitiveIds.has(item.id));
  if(!current){$('overlay-series').textContent='';$('overlay-title').textContent='Lectura cerrada';$('series-title').textContent='TU LECTURA';}
  for(const [id,item] of Object.entries(cache))if(sensitiveIds.has(item.serie_id))delete cache[id];saveCache();
  for(const id of sensitiveIds)delete pendingProgress[id];persistPending();
  setDialog('chapter-controls',false);$('picked-title').textContent='Elige un capítulo';$('picked-description').textContent=$('picked-source').textContent='';
  for (const id of ['picked-authors','picked-publication','picked-progress']) $(id).textContent='';
  $('picked-tags').replaceChildren(); chapterBrowser.clear(); pickedChapterId=null; $('picked-read').disabled=true;$('picked-cover').removeAttribute('src');
  for(const id of ['edition-select','edition-from','edition-existing'])$(id).replaceChildren();
  $('series-select').replaceChildren();fillChapters([]);filterLibrary();renderHero();shell?.renderHome();shell?.clearDiscovery();shell?.clearSearch();
  shell?.clearPrivate();
  history.replaceState({view:activeView},'',navigationUrl(libraryRouteHash(activeView,currentLibraryFilters())));document.title='Lector · Tu biblioteca';
  return saved;
}
let alternatives;
const preview=createSeriesPreview({api,add:addFavorite,select:selectSeries,sourceName,alternatives:(...args)=>alternatives(...args),read:(item,chapter,list,options)=>options?.saved ? openChapter(item.ultimo_capitulo_id) : openChapter(chapter.id,{trial:{item,list,returnView:activeView}}),findSaved:item=>series.find(row=>!row.is_private&&row.source===item.source&&row.url_origen===(item.url??item.url_origen))});
alternatives=createSourceAlternatives({api,state:()=>({series,sources:sourceCatalog}),preview,select:selectSeries,sourceName});
$('reader-trial-ficha').addEventListener('click',async()=>{if(!current?.trial)return;const {item,returnView}=current.trial;await navigateView(returnView);preview(item);});
$('reader-failed-alternatives').addEventListener('click',()=>$('reader-alternatives').click());
$('reader-alternatives').addEventListener('click',()=>{const info=failedReading??(current?{item:current.trial?.item??series.find(item=>item.id===current.serie_id),number:current.number??current.numero??null}:null);if(info?.item&&!info.item.is_private)alternatives(info.item,{number:info.number});});
shell=createShell({preview,api,state:()=>({series,sources:sourceCatalog,view:activeView,privateUnlocked:privacy?.unlocked()??false}),navigate:navigateView,select:selectSeries,
  resume:item=>openChapter(item.ultimo_capitulo_id),add:addFavorite,filter:()=>{filterLibrary();writeLibraryRoute();},reload:loadLibrary,
  dialog:setDialog,beginQuery,endQuery});
privacy=createPrivacyUI({api,state:()=>({series,sources:sourceCatalog,folders:shell?.folders()??[]}),navigate:navigateView,reload:loadLibrary,select:selectSeries,resume:item=>openChapter(item.ultimo_capitulo_id),add:addFavorite,clearSensitive,hidePrivate:()=>{setDialog('chapter-controls',false);setDialog('folder-panel',false);shell?.clearPrivate();shell?.update().catch(()=>{});},dialog:setDialog,beginQuery,endQuery});
function restoreRoute(){
  if(!routesReady||location.href===lastRestoredUrl)return;lastRestoredUrl=location.href;
  if(!location.hash&&current){setLibrary(false);return;}
  const route=parseLibraryRoute(location.hash);
  if(route.view==='library')restoreLibraryFilters(route.filters);
  navigateView(route.view,false);
}
window.addEventListener('popstate',restoreRoute);
window.addEventListener('hashchange',restoreRoute);
document.querySelector('.skip-link').addEventListener('click',event=>{
  event.preventDefault();
  const target=$('reader').hidden ? document.querySelector('#library > section:not([hidden])') ?? $('main-content') : $('reader');
  target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});
});
const accountUI=createAccountUI({api,reload:loadLibrary,navigate:navigateView,lockPrivate:()=>privacy.lock(),beforeSignOut:async()=>{await flushProgress();if(writer.running)await writer.running;await privacy.lock();}});
const canLoad=await accountUI.start();
if(cloudMode) {
  CACHE_KEY+='.'+(accountUser()?.id??'device');
  cache={};try{cache=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');pendingProgress=JSON.parse(localStorage.getItem(CACHE_KEY+'.pending')||'{}');}catch{cache={};pendingProgress={};}
  if(!cache||typeof cache!=='object'||Array.isArray(cache))cache={};
  if(!pendingProgress||typeof pendingProgress!=='object'||Array.isArray(pendingProgress))pendingProgress={};
}
if(canLoad)await loadLibrary();
if(cloudMode&&canLoad)await replayPending();
const initial = new URLSearchParams(location.search).get('chapter');
const initialRoute=parseLibraryRoute(location.hash),hasInitialHash=Boolean(location.hash);
if(initialRoute.view==='library')restoreLibraryFilters(initialRoute.filters);
routesReady=true;
if (canLoad && initial && /^[1-9]\d*$/.test(initial)) { await openChapter(initial); if (hasInitialHash) { await navigateView(initialRoute.view,false); history.replaceState({view:activeView},'',navigationUrl(libraryRouteHash(activeView,currentLibraryFilters()))); } }
else await navigateView(initialRoute.view,false);
lastRestoredUrl=location.href;
$('add-toggle').disabled=!canLoad;
if(cloudMode&&canLoad&&accountUser())accountUI.synchronize();
if(cloudMode&&'serviceWorker' in navigator)navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{scope:new URL('./',import.meta.url).pathname}).catch(()=>{});
