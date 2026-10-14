import { renderSeriesCards } from './library-view.js';
import { syncSelectControls } from './ui-controls.js';
import { groupWorks } from './discovery-core.js';
import { filterSeries } from './reader-core.js';
import { inLibraryScope } from './content-policy.js';
import {encryptedPrivate,setPrivateScope} from './network.js';
import {configureVaultInputs,showRecoveryKey,initializeRecoveryDownload} from './vault-ui.js';
import {createPrivateSession,normalizePrivateSession,privateSessionStorageKey} from './private-session.js';

const $ = id => document.getElementById(id);
const node = (tag, copy, cls='') => Object.assign(document.createElement(tag), {textContent:copy,className:cls});
export function createPrivacyUI({api,state,navigate,reload,select,resume,add,clearSensitive,hidePrivate,dialog,beginQuery,endQuery}) {
  configureVaultInputs(encryptedPrivate);initializeRecoveryDownload();
  let configured=false, unlocked=false, pendingMove=null, idleTimer, hardTimer, heartbeat, locking=null, inPrivateView=false;
  let preferences;try{preferences=normalizePrivateSession(JSON.parse(localStorage.getItem(privateSessionStorageKey)||'{}'));}catch{preferences=normalizePrivateSession();}
  const session=createPrivateSession({lock:()=>lock(),preferences,mask:hidden=>document.body.classList.toggle('vault-background-hidden',hidden)});
  $('private-session-settings').hidden=!encryptedPrivate;
  $('private-idle-minutes').value=String(preferences.idleMinutes);
  $('private-background-minutes').value=String(preferences.backgroundMinutes);
  for(const id of ['private-idle-minutes','private-background-minutes'])$(id).addEventListener('change',()=>{
    preferences=session.configure({idleMinutes:Number($('private-idle-minutes').value),backgroundMinutes:Number($('private-background-minutes').value)});
    try{localStorage.setItem(privateSessionStorageKey,JSON.stringify(preferences));}catch{/* Preferencias de esta sesión. */}
    $('private-session-status').textContent='Tiempos aplicados en este navegador.';
  });
  $('private-settings-lock').addEventListener('click',()=>lock());
  const sourceName=id=>state().sources.find(s=>s.id===id)?.name??id;
  const options=()=>({sourceName,onSelect:select,onResume:resume});
  const filterIds=['private-source-filter','private-genre-filter','private-author-filter','private-publication-filter','private-reading-filter','private-folder-filter'];
  function fillFilter(id,values,placeholder,unknown=false) {
    const previous=$(id).value;
    $(id).replaceChildren(new Option(placeholder,''),...values.map(value=>new Option(value.name??value,value.id??value)));
    if(unknown)$(id).add(new Option('Sin datos','__unknown'));
    if([...$(id).options].some(option=>option.value===previous))$(id).value=previous;
  }
  function clearPrivateView() {
    $('private-query').value='';$('private-only-unread').checked=false;$('private-library-sort').value='recent';
    for(const id of filterIds)$(id).value='';
    for(const [id,label] of [['private-source-filter','Todas las fuentes'],['private-genre-filter','Todos los géneros'],['private-author-filter','Todos los autores'],['private-folder-filter','Todas las historias']])fillFilter(id,[],label);
    renderSeriesCards($('private-library'),[],{...options(),retainCards:false});
    for(const id of ['private-library','private-filter-chips'])$(id).replaceChildren();
    $('private-count').textContent='';$('private-options').open=false;
    syncSelectControls('private-reading-filter');
  }
  function drawFilters(rows) {
    syncSelectControls('private-reading-filter');
    const values=field=>[...new Set(rows.flatMap(row=>row[field]??[]))].sort((a,b)=>a.localeCompare(b,'es'));
    fillFilter('private-source-filter',[...new Set(rows.map(row=>row.source))].map(id=>({id,name:sourceName(id)})),'Todas las fuentes');
    fillFilter('private-genre-filter',[...values('genres'),{id:'adult',name:'+18'}],'Todos los géneros',true);
    fillFilter('private-author-filter',values('authors'),'Todos los autores',true);
    fillFilter('private-folder-filter',state().folders??[],'Todas las historias');
    $('private-filter-chips').replaceChildren();
    for(const id of ['private-query',...filterIds,'private-only-unread']) {
      const input=$(id),active=input.type==='checkbox'?input.checked:Boolean(input.value);if(!active)continue;
      const label=input.type==='checkbox'?'Con capítulos pendientes':input.tagName==='SELECT'?input.selectedOptions[0].textContent:input.value;
      const button=node('button',label+' ×','tag-chip active-filter');button.type='button';button.setAttribute('aria-label','Quitar filtro '+label);
      button.addEventListener('click',()=>{if(input.type==='checkbox')input.checked=false;else input.value='';render();});$('private-filter-chips').append(button);
    }
  }
  function gate() {
    $('private-gate').hidden=unlocked; $('private-content').hidden=!unlocked;
    $('private-gate-title').textContent=configured?'Biblioteca bloqueada':'Crea tu espacio privado';
    $('private-confirm-label').hidden=configured;
    $('private-pin-confirm').required=!configured;
    $('private-unlock').textContent=configured?'Desbloquear':encryptedPrivate?'Crear bóveda cifrada':'Crear PIN y entrar';
    $('private-recovery-label').hidden=!encryptedPrivate||!configured;
    $('private-recovery').disabled=!configured;
    $('private-settings-lock').disabled=!unlocked;
  }
  function render() {
    if(!unlocked||!inPrivateView){clearPrivateView();gate();return;}
    const rows=state().series.filter(s=>inLibraryScope(s,'private'));drawFilters(rows);
    const privateItems=groupWorks(filterSeries(rows,{query:$('private-query').value,source:$('private-source-filter').value,genre:$('private-genre-filter').value,author:$('private-author-filter').value,publication:$('private-publication-filter').value,reading:$('private-reading-filter').value,folder:$('private-folder-filter').value,unreadOnly:$('private-only-unread').checked,sort:$('private-library-sort').value}));
    renderSeriesCards($('private-library'),privateItems,options());
    $('private-count').textContent=`${privateItems.length} de ${groupWorks(rows).length} lecturas privadas`;
    if(!privateItems.length)$('private-library').replaceChildren(node('p',rows.length?'No hay lecturas con estos filtros. Prueba a limpiarlos.':'Para ocultar una lectura, abre su ficha y pulsa «Mover a privada».','privacy-empty'));
    gate();
  }
  function clearPrivate() {
    setPrivateScope(false);
    unlocked=false; clearTimeout(idleTimer);clearTimeout(hardTimer);clearInterval(heartbeat);
    session.stop();
    $('private-pin').value=$('private-pin-confirm').value=$('private-new-pin').value=$('private-new-confirm').value=$('private-query').value='';
    clearPrivateView();
    const saving=clearSensitive();selected=undefined;gate();return saving;
  }
  function lock({remote=true}={}) {
    if(locking)return locking;
    const saving=clearPrivate();
    locking=(async()=>{
      if(saving)try{await saving;}catch{/* El bloqueo no espera una fuente remota. */}
      if(remote)try{await api('/api/private/lock',{method:'POST',keepalive:true});}catch{/* El servidor también vence las sesiones. */}
      $('private-status').textContent='Biblioteca bloqueada.';
    })().finally(()=>{locking=null;});
    return locking;
  }
  function activity() {
    if(!unlocked)return;if(encryptedPrivate){session.activity();return;}clearTimeout(idleTimer);idleTimer=setTimeout(()=>lock(),10*60*1000);
  }
  for(const event of ['pointerdown','keydown','scroll'])document.addEventListener(event,activity,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!unlocked)return;if(encryptedPrivate)session.visibility(document.visibilityState==='hidden');else if(document.visibilityState==='hidden')lock();});
  window.addEventListener('pagehide',()=>{if(unlocked)lock();});
  window.addEventListener('private-locked',()=>lock({remote:false}));
  async function enterPrivate() {
    if(locking)await locking;
    $('private-status').textContent='';
    try{const info=await api('/api/private/status');configured=info.configured;unlocked=info.unlocked;gate();if(unlocked){activity();await reload();}}
    catch(error){$('private-status').textContent=error.message;}
  }
  $('private-access-form').addEventListener('submit',async event=>{
    event.preventDefault();$('private-unlock').disabled=true;
    try{
      const pin=$('private-pin').value;if(!configured&&pin!==$('private-pin-confirm').value)throw new Error(encryptedPrivate?'Las contraseñas no coinciden.':'Los PIN no coinciden.');
      const info=await api('/api/private/'+(configured?'unlock':'setup'),{method:'POST',body:JSON.stringify({pin,recovery:encryptedPrivate&&$('private-recovery').checked})});
      configured=info.configured;unlocked=info.unlocked;$('private-pin').value=$('private-pin-confirm').value='';gate();activity();
      setPrivateScope(true);if(encryptedPrivate)session.start({isHidden:document.visibilityState==='hidden'});else hardTimer=setTimeout(()=>lock(),60*60*1000);
      if(!await showRecoveryKey(info.recoveryKey)){await lock();throw new Error('Se ocultó la clave de recuperación al salir de la página. Puedes desbloquear con tu contraseña y generar otra al cambiarla.');}
      clearInterval(heartbeat);heartbeat=setInterval(async()=>{if(!unlocked)return;try{const status=await api('/api/private/status');if(!status.unlocked)await lock({remote:false});}catch{/* La siguiente consulta comprobará el bloqueo. */}},60000);
      if(pendingMove){const id=pendingMove;pendingMove=null;await api(`/api/series/${id}/library`,{method:'PUT',body:JSON.stringify({is_private:true})});clearSensitive({onlySeries:id});}
      await reload();
    }catch(error){$('private-status').textContent=error.message;}
    finally{$('private-pin').value=$('private-pin-confirm').value='';$('private-unlock').disabled=false;}
  });
  $('private-lock').addEventListener('click',()=>lock());
  $('private-manage-folders').addEventListener('click',()=>$('manage-folders').click());
  $('private-query').addEventListener('input',render);
  for(const id of [...filterIds,'private-only-unread','private-library-sort'])$(id).addEventListener('change',render);
  $('private-clear-filters').addEventListener('click',()=>{clearPrivateView();render();});
  $('private-refresh').addEventListener('click',reload);
  $('private-change-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{if($('private-new-pin').value!==$('private-new-confirm').value)throw new Error('Las contraseñas no coinciden.');const info=await api('/api/private/pin',{method:'PUT',body:JSON.stringify({pin:$('private-new-pin').value})});await showRecoveryKey(info.recoveryKey);await lock({remote:false});$('private-status').textContent=encryptedPrivate?'Cifrado actualizado. Desbloquea con la nueva contraseña.':'PIN actualizado. Desbloquea con el nuevo PIN.';}
    catch(error){$('private-change-status').textContent=error.message;}
  });
  let selected;
  function organize(item) {
    selected=item;$('series-private-toggle').textContent=item.is_private?'Hacer visible':'Mover a privada';
    $('series-adult-toggle').textContent=item.is_adult?'Quitar clasificación +18':'Marcar como +18';
    $('series-privacy-status').textContent=item.is_private?'Privada · solo visible tras desbloquear.':item.is_adult?'+18 · disponible al filtrar este género.':'Visible en la biblioteca general.';
    $('work-similar').disabled=Boolean(item.is_private||item.is_adult);
  }
  async function toggle(field) {
    if(!selected)return;const item=selected;
    if(field==='is_private'&&!item.is_private&&!unlocked){pendingMove=item.id;dialog('chapter-controls',false);navigate('private');$('private-status').textContent=encryptedPrivate?'Crea o introduce tu contraseña de cifrado para mover esta lectura.':'Crea o introduce tu PIN para mover esta lectura a la privada.';return;}
    try{await api(`/api/series/${item.id}/library`,{method:'PUT',body:JSON.stringify({[field]:!Boolean(item[field])})});dialog('chapter-controls',false);clearSensitive({onlySeries:item.id});if(field==='is_adult'&&!item.is_private)$('genre-filter').value=item.is_adult?'':'adult';await reload();}
    catch(error){$('series-privacy-status').textContent=error.message;}
  }
  $('series-private-toggle').addEventListener('click',()=>toggle('is_private'));
  $('series-adult-toggle').addEventListener('click',()=>toggle('is_adult'));
  return {render,organize,unlocked:()=>unlocked,
    enter: view=>{inPrivateView=view==='private';setPrivateScope(inPrivateView);if(inPrivateView)enterPrivate();},
    leave(view){if(view!=='private'){setPrivateScope(false);pendingMove=null;clearPrivateView();if(unlocked&&!encryptedPrivate)lock();else if(inPrivateView)hidePrivate?.();}},
    lock};
}
