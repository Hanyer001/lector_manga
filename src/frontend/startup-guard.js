// Independiente del módulo principal: también funciona si un import falla.
(()=>{
  let ready=false,degraded=false,timer;
  const $=id=>document.getElementById(id);
  const sections={home:'home-panel',library:'saved-panel',discover:'discover-panel',explore:'search-panel',settings:'settings-panel',private:'private-panel'};
  const buttons={home:'show-home',library:'show-saved',discover:'show-discover',explore:'show-search',settings:'show-settings',private:'show-private'};
  function release(message){
    if(ready||!$('startup-status'))return;
    degraded=true;clearTimeout(timer);
    $('startup-status').hidden=false;$('startup-status').textContent=message;
    $('startup-retry').hidden=false;
    const nav=document.querySelector('.library-tabs');nav.inert=false;nav.removeAttribute('aria-busy');
    $('reader').hidden=true;$('library').hidden=false;
    for(const id of ['home-content','home-start-guide','library-welcome'])$(id).hidden=true;
    showView(location.hash.slice(1).split('?')[0]);
  }
  function showView(view){
    if(!sections[view])view='home';
    for(const [key,id] of Object.entries(sections))$(id).hidden=key!==view;
    for(const [key,id] of Object.entries(buttons)){$(id).setAttribute('aria-pressed',String(key===view));if(key===view)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');}
    $('library-title').textContent={home:'Inicio',library:'Mi biblioteca',discover:'Descubrir',explore:'Buscar',settings:'Ajustes',private:'Mi espacio privado'}[view]+'.';
    $('library-subtitle').textContent='La biblioteca todavía no está lista. Puedes revisar las secciones o reintentar la carga.';
  }
  window.lectorStartup={ready(){ready=true;degraded=false;clearTimeout(timer);$('startup-status').hidden=true;$('startup-retry').hidden=true;},failed(){release('No se pudo iniciar la aplicación. Reintenta la carga; tus lecturas guardadas se conservan.');}};
  function start(){
    $('startup-retry').addEventListener('click',()=>location.reload());
    document.querySelector('.library-tabs').addEventListener('click',event=>{
      if(!degraded||ready)return;
      const target=event.target.closest('button'),view=Object.keys(buttons).find(key=>buttons[key]===target?.id);
      if(!view)return;event.preventDefault();event.stopImmediatePropagation();history.replaceState(null,'',location.pathname+location.search+'#'+view);showView(view);
    },true);
    if(!ready&&!degraded)timer=setTimeout(()=>release('La biblioteca está tardando más de lo habitual. Puedes cambiar de sección o reintentar sin borrar tus lecturas.'),8000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('error',event=>{if(event.error)window.lectorStartup.failed();});
  window.addEventListener('unhandledrejection',()=>window.lectorStartup.failed());
})();
