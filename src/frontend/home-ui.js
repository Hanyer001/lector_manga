import {homeModel} from './home-model.js';
import {renderSeriesCards} from './library-view.js';
import {setCover,isProxyUrl} from './network.js';

const $=id=>document.getElementById(id);
const node=(tag,value,className='')=>Object.assign(document.createElement(tag),{textContent:value,className});
export function createHomeUI({state,select,resume,sourceName,openLibrary}) {
  let newsLimit=3,lastUpdates=[],lastError='';
  for(const button of document.querySelectorAll('[data-home-library]'))button.addEventListener('click',()=>openLibrary(button.dataset.homeLibrary));
  $('home-news-more').addEventListener('click',()=>{newsLimit+=3;render(lastUpdates,lastError);});
  function render(updates,updatesError='') {
    lastUpdates=updates;lastError=updatesError;
    const model=homeModel(state().series,updates);
    for(const [name,value] of Object.entries({total:model.works.length,reading:model.reading,planned:model.planned.length,unread:model.unread}))$('home-'+name+'-count').textContent=String(value);
    $('home-summary-copy').textContent=model.recent.length?'Tu última lectura está lista para continuar.':model.planned.length?'Tienes historias guardadas esperando su primera página.':'Encuentra algo nuevo o vuelve a una historia de tu biblioteca.';
    $('home-recent').hidden=model.recent.length<2;
    renderSeriesCards($('continue-carousel'),model.recent.slice(1,9),{sourceName,onSelect:select,onResume:resume});
    $('continue-prev').disabled=$('continue-next').disabled=model.recent.length<3;
    const planned=model.planned.filter(item=>item.work_id!==model.hero?.work_id).slice(0,4);
    $('home-planned-section').hidden=!planned.length;
    renderSeriesCards($('home-planned-grid'),planned,{sourceName,onSelect:select});
    $('home-planned-copy').textContent=`${model.planned.length} ${model.planned.length===1?'historia guardada':'historias guardadas'} para empezar cuando quieras.`;
    $('home-rest').hidden=Boolean(model.hero);
    $('library-updated').textContent=model.lastSync?'Última consulta: '+new Date(model.lastSync).toLocaleString('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Consulta tus fuentes para detectar capítulos nuevos.';
    $('home-news-count').textContent=model.news.length?`${model.news.length} ${model.news.length===1?'obra con novedades':'obras con novedades'}`:'Sin novedades detectadas';
    $('updates-list').replaceChildren();
    const visible=model.news.slice(0,newsLimit);
    $('home-news-more').hidden=model.news.length<=newsLimit;
    $('home-news-more').textContent=`Ver más novedades (${Math.max(0,model.news.length-newsLimit)} obras)`;
    for(const entry of visible){
      const row=node('article','','home-update');
      if(isProxyUrl(entry.work.coverUrl)){const image=document.createElement('img');image.alt='';image.loading='lazy';image.addEventListener('error',()=>{image.hidden=true;});row.append(image);setCover(image,entry.work.coverUrl,entry.work.coverKey);}
      const copy=node('div','','home-update-copy');
      copy.append(node('h3',entry.work.titulo),node('p',entry.chapter.chapter_title),node('span',`${entry.count} ${entry.count===1?'nuevo':'nuevos'} · ${sourceName(entry.chapter.source)}`,'small muted'));
      const action=node('button','Leer capítulo','button');action.type='button';action.setAttribute('aria-label',`Leer ${entry.chapter.chapter_title} de ${entry.work.titulo}`);action.addEventListener('click',()=>resume({...entry.work,ultimo_capitulo_id:entry.chapter.id}));
      row.append(copy,action);$('updates-list').append(row);
    }
    $('home-news-empty').hidden=Boolean(visible.length);
    $('home-news-empty-title').textContent=updatesError?'No pudimos consultar las novedades':model.lastSync?'Aún no hay novedades detectadas':'Consulta tus series cuando quieras';
    $('home-news-empty-copy').textContent=updatesError?'Puedes volver a intentarlo con «Actualizar mis series».':model.lastSync?'Al actualizar, los capítulos nuevos de tus historias aparecerán aquí.':'No se consultan los catálogos automáticamente. Actualiza para comprobar si publicaron capítulos.';
    $('sync-library').disabled=$('sync-library').dataset.syncing==='true'||!state().series.some(item=>model.works.some(work=>work.editions.some(edition=>edition.id===item.id))&&state().sources.some(source=>source.id===item.source&&source.enabled));
    return model;
  }
  return {render};
}
