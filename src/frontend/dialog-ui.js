const initialized=new WeakSet();
export function initializeDialog(dialog,{onClose}={}) {
  if(initialized.has(dialog))return;
  initialized.add(dialog);
  let startedOutside=false;
  const outside=event=>{const rect=dialog.getBoundingClientRect();return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;};
  dialog.addEventListener('pointerdown',event=>{startedOutside=event.target===dialog&&outside(event);});
  dialog.addEventListener('pointercancel',()=>{startedOutside=false;});
  dialog.addEventListener('click',event=>{
    if(startedOutside&&event.target===dialog&&outside(event))dialog.close();
    startedOutside=false;
  });
  // Escape y el foco los gestiona el navegador; la aplicación sincroniza su estado.
  dialog.addEventListener('close',()=>{if(!dialog.open)onClose?.();});
}

export function createDetailTabs() {
  const root=document.getElementById('chapter-controls'),list=root.querySelector('[role="tablist"]');
  const tabs=[...list.querySelectorAll('[role="tab"]')];
  let active='chapters';
  function select(name,{focus=false}={}) {
    active=name;
    for(const tab of tabs){
      const selected=tab.dataset.detailTab===name;
      tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden=!selected;
      if(selected&&focus)tab.focus({preventScroll:true});
    }
  }
  for(const tab of tabs)tab.addEventListener('click',()=>select(tab.dataset.detailTab));
  list.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const index=tabs.indexOf(document.activeElement);if(index<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    select(tabs[next].dataset.detailTab,{focus:true});
  });
  select(active);
  return {select,get active(){return active;}};
}
