// Los selects siguen siendo la fuente de verdad para filtros y preferencias.
const controls=new Map();
export function syncSelectControls(id) {
  for(const [select,{host,buttons}] of controls){
    if(id&&select.id!==id)continue;
    for(const button of buttons){
      const selected=button.dataset.value===select.value;
      button.setAttribute('aria-pressed',String(selected));
      button.disabled=select.disabled||Boolean([...select.options].find(option=>option.value===button.dataset.value)?.disabled);
      if(button.dataset.value==='custom')button.style.setProperty('--swatch',document.getElementById('appearance-custom').value);
    }
    host.dataset.value=select.value;
  }
}
export function enhanceSelects() {
  for(const select of document.querySelectorAll('select[data-control]')){
    if(controls.has(select))continue;
    const kind=select.dataset.control;
    const host=document.getElementById(select.dataset.controlTarget)||document.createElement('div');
    host.className='select-control '+kind+'-control';host.setAttribute('role','group');
    host.setAttribute('aria-label',select.dataset.controlLabel||select.labels[0]?.textContent.trim()||'Opciones');
    host.dataset.select=select.id;
    if(!host.isConnected)select.after(host);
    const buttons=[...select.options].map(option=>{
      const button=document.createElement('button');button.type='button';button.className='control-option';button.dataset.value=option.value;
      button.textContent=kind==='rating'&&option.value?option.value:option.textContent;
      if(kind==='rating'&&option.value)button.setAttribute('aria-label','Valorar '+option.value+' de 10');
      if(kind==='swatches')button.style.setProperty('--swatch',({violet:'#a78bfa',cyan:'#22d3ee',crimson:'#fb7185'})[option.value]||'#a78bfa');
      button.addEventListener('click',()=>{
        if(select.disabled)return;
        select.value=option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        syncSelectControls(select.id);
      });
      host.append(button);return button;
    });
    host.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const enabled=buttons.filter(button=>!button.disabled),index=enabled.indexOf(document.activeElement);
      if(index<0)return;event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+(event.key==='ArrowRight'?1:-1)+enabled.length)%enabled.length;
      enabled[next].focus({preventScroll:true});enabled[next].click();
    });
    controls.set(select,{host,buttons});
    select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    if(select.dataset.controlTarget)for(const label of select.labels)label.classList.add('sr-only');
    select.addEventListener('change',()=>syncSelectControls(select.id));
  }
  window.addEventListener('appearancechange',()=>syncSelectControls());
  syncSelectControls();
}
