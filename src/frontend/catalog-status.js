// Arranca desde el head, sin esperar la cuenta ni enviar datos de la biblioteca.
(()=>{
  const config=window.LECTOR_CONFIG??{},base=config.apiBase||location.origin;
  let phase='waking',sources=[],request,lastAttempt=0;
  const checks=new Map();
  function draw(){
    const root=document.getElementById('recommend-warnings');if(!root)return;
    root.hidden=false;root.dataset.connection=phase;
    document.getElementById('catalog-connection-label').textContent=phase==='waking'?'Despertando catálogos…':phase==='online'?'Catálogos en línea':navigator.onLine===false?'Sin conexión':'No se pudo conectar con los catálogos';
    document.getElementById('catalog-connection-copy').textContent=phase==='waking'?'La primera conexión puede tardar unos segundos.':phase==='online'?'El estado de cada fuente se actualiza al consultarla.':'Puedes reintentar sin recargar la página.';
    document.getElementById('catalog-retry').hidden=phase!=='offline';
    document.getElementById('catalog-source-status').replaceChildren(...sources.filter(source=>!source.demo).map(source=>{
      const check=checks.get(source.id),state=source.enabled===false?'unavailable':check===true||check==='ok'?'ok':check===false||check==='error'?'error':check==='loading'?'loading':'pending';
      const row=document.createElement('li');row.dataset.state=state;
      const dot=document.createElement('span');dot.className='catalog-dot';dot.setAttribute('aria-hidden','true');
      const name=document.createElement('strong');name.textContent=source.name;
      const status=document.createElement('span');status.textContent=state==='ok'?'Respondió correctamente':state==='error'?'Última consulta fallida':state==='loading'?'Consultando / reconectando…':state==='unavailable'?'No disponible':'Disponible · sin consultar';
      row.append(dot,name,status);return row;
    }));
  }
  async function wake({force=false}={}){
    if(request)return request;
    if(!force&&Date.now()-lastAttempt<60000)return;
    lastAttempt=Date.now();phase='waking';draw();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),70000);
    request=(async()=>{
      const options={signal:controller.signal,credentials:'omit',cache:'no-store'};
      const health=await fetch(new URL('/api/health',base),options);if(!health.ok||!(await health.json()).ok)throw new Error('offline');
      const response=await fetch(new URL(config.mode==='cloud'?'/api/guest/sources':'/api/sources',base),options);
      if(!response.ok)throw new Error('offline');const data=await response.json();if(!Array.isArray(data))throw new Error('offline');
      sources=data;phase='online';window.dispatchEvent(new CustomEvent('catalogs-ready',{detail:data}));
    })().catch(()=>{phase='offline';}).finally(()=>{clearTimeout(timer);request=null;draw();});
    return request;
  }
  window.lectorCatalogs={wake,recordSource(id,state){if(['ok','error','loading','pending'].includes(state)){checks.set(id,state);draw();}},record(path,data,ok=true){
    const id=path.match(/^\/api\/(?:guest\/)?sources\/([a-z0-9-]+)\/(?:search|manga|recommendations)/)?.[1];
    if(!id&&!path.startsWith('/api/discovery/recommendations'))return;
    if(id)checks.set(id,ok);
    if(path.startsWith('/api/discovery/recommendations'))for(const source of data?.sources??[])if(['pending','loading','ok','partial','empty','error'].includes(source.status))checks.set(source.id,['pending','loading'].includes(source.status)?source.status:source.status!=='error');
    draw();
  }};
  document.addEventListener('DOMContentLoaded',()=>{document.getElementById('catalog-retry')?.addEventListener('click',()=>wake({force:true}));draw();},{once:true});
  window.addEventListener('online',()=>{if(phase==='offline')wake({force:true});});
  wake();
})();
