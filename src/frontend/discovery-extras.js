import {groupWorks,normalizeTag} from './discovery-core.js';
import {isPublicReading} from './content-policy.js';

const $=id=>document.getElementById(id);
const node=(tag,copy,className='')=>Object.assign(document.createElement(tag),{textContent:copy,className});

export function createDiscoveryExtras({api,state,filters,search,apply,onFavorites,navigate}) {
  let profile={savedSearches:[],favoriteWorkIds:[]},busy=false;
  const works=()=>groupWorks(state().series.filter(isPublicReading));
  const currentFavorites=()=>profile.favoriteWorkIds.filter(id=>works().some(work=>work.work_id===id));
  const preferences=()=>({...profile,favoriteWorkIds:currentFavorites()});
  function setBusy(value){
    busy=value;
    for(const button of document.querySelectorAll('#discovery-personal-tools button'))button.disabled=value;
  }
  async function save(patch) {
    setBusy(true);
    try{
      const saved=await api('/api/discovery',{method:'PUT',body:JSON.stringify({...filters(),...preferences(),...patch})});
      profile={savedSearches:saved.savedSearches??[],favoriteWorkIds:saved.favoriteWorkIds??[]};
      render();return true;
    }catch(error){$('rec-personal-status').textContent=error.message;return false;}
    finally{setBusy(false);}
  }
  function render(){
    const choices=works().sort((a,b)=>a.titulo.localeCompare(b.titulo,'es')),favorites=currentFavorites();
    for(let index=0;index<3;index++){
      const select=$('rec-favorite-'+(index+1));
      select.replaceChildren(new Option('Elige una obra de tu biblioteca',''),...choices.map(work=>new Option(work.titulo,work.work_id)));
      select.value=String(favorites[index]??'');select.disabled=!choices.length;
    }
    $('rec-favorite-count').textContent=`${favorites.length} de 3 elegidos`;
    $('rec-favorite-empty').hidden=choices.length>0;
    $('rec-favorite-save').hidden=!choices.length;
    $('rec-saved-count').textContent=`${profile.savedSearches.length} ${profile.savedSearches.length===1?'guardada':'guardadas'}`;
    const list=$('rec-saved-searches');list.replaceChildren();
    for(const saved of profile.savedSearches){
      const row=node('div','','saved-search');
      const load=node('button',saved.name,'tag-chip');load.type='button';load.setAttribute('aria-label','Aplicar búsqueda '+saved.name);
      load.addEventListener('click',()=>{if(!busy){apply(saved);$('rec-personal-status').textContent='Búsqueda aplicada: '+saved.name+'.';}});
      const remove=node('button','×','button subtle');remove.type='button';remove.setAttribute('aria-label','Eliminar búsqueda '+saved.name);
      remove.addEventListener('click',async()=>{if(!busy&&await save({savedSearches:profile.savedSearches.filter(item=>item.id!==saved.id)}))$('rec-personal-status').textContent='Búsqueda eliminada: '+saved.name+'.';});
      row.append(load,remove);list.append(row);
    }
    if(!profile.savedSearches.length)list.append(node('p','Guarda una combinación para volver a ella con un toque.','small muted'));
  }
  $('rec-save-search-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const name=$('rec-search-name').value.trim();
    if(!name){$('rec-personal-status').textContent='Escribe un nombre para esta búsqueda.';return;}
    const existing=profile.savedSearches.find(item=>normalizeTag(item.name)===normalizeTag(name));
    if(!existing&&profile.savedSearches.length>=12){$('rec-personal-status').textContent='Ya tienes doce búsquedas. Elimina una para guardar otra.';return;}
    const {favoriteWorkIds,savedSearches,...selectedFilters}=filters();
    const entry={id:existing?.id??crypto.randomUUID(),name,...search(),filters:selectedFilters};
    const entries=existing?profile.savedSearches.map(item=>item.id===existing.id?entry:item):[...profile.savedSearches,entry];
    if(await save({savedSearches:entries})){$('rec-search-name').value='';$('rec-personal-status').textContent=existing?'Búsqueda actualizada: '+name+'.':'Búsqueda guardada: '+name+'.';}
  });
  $('rec-favorite-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const ids=[1,2,3].map(index=>Number($('rec-favorite-'+index).value)).filter(Boolean);
    if(new Set(ids).size!==ids.length){$('rec-personal-status').textContent='Elige obras distintas para tus favoritos.';return;}
    if(await save({favoriteWorkIds:ids})){$('rec-personal-status').textContent=ids.length?'Favoritos guardados. «Para ti» les dará más peso.':'Favoritos retirados. Se mantienen tus valoraciones.';onFavorites();}
  });
  $('rec-favorite-library').addEventListener('click',()=>navigate('library'));
  return {
    preferences,
    update(value){profile={savedSearches:value.savedSearches??[],favoriteWorkIds:value.favoriteWorkIds??[]};render();},
    clear(){
      profile={savedSearches:[],favoriteWorkIds:[]};$('rec-search-name').value='';$('rec-personal-status').textContent='';
      $('rec-saved-searches').replaceChildren();$('rec-saved-count').textContent='0 guardadas';$('rec-favorite-count').textContent='0 de 3 elegidos';
      for(let index=1;index<=3;index++)$('rec-favorite-'+index).replaceChildren(new Option('Elige una obra de tu biblioteca',''));
      $('rec-favorites-panel').open=$('rec-searches-panel').open=false;
    }
  };
}
