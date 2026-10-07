import { normalizeReaderPreferences, readerDefaults, pageStep } from './reader-preferences.js';
const key='lector-manga.reading-options.v1';
export function createReaderControls({change,jump,step,library,close,active}) {
  const $=id=>document.getElementById(id);
  let preferences;
  try {preferences=normalizeReaderPreferences(JSON.parse(localStorage.getItem(key)||'{}'));} catch {preferences={...readerDefaults};}
  let visible=false, timer, pointer, lastUpdate;
  const bindings={mode:'reading-mode',direction:'reading-direction',fit:'reading-fit',zoom:'reading-zoom',width:'reader-width',brightness:'reading-brightness',warmth:'reading-warmth',prefetch:'reading-prefetch'};
  function refresh() {
    for(const [name,id] of Object.entries(bindings)) $(id).value=preferences[name];
    for(const [id,value] of Object.entries({'zoom-value':preferences.zoom+'%','width-value':preferences.width+' px','brightness-value':preferences.brightness+'%','warmth-value':preferences.warmth+'%'})) $(id).textContent=value;
    document.body.classList.toggle('reader-filtered',preferences.brightness!==100||preferences.warmth!==0);
    document.documentElement.style.setProperty('--reader-brightness',preferences.brightness/100);
    document.documentElement.style.setProperty('--reader-warmth',preferences.warmth/100);
    $('reading-direction').disabled=preferences.mode!=='paged';
    $('reader-tap-zones').dataset.zoomed=String(preferences.zoom>100||preferences.fit==='original');
    $('reader-help').textContent=preferences.mode==='paged' ? `Centro o C / Espacio: controles · ${preferences.direction==='rtl'?'← siguiente · → anterior':'→ siguiente · ← anterior'}` : 'Centro o C / Espacio: controles · Flechas: desplazamiento';
  }
  function save() {try{localStorage.setItem(key,JSON.stringify(preferences));}catch{/* Activo durante la sesión. */}}
  function scheduleHide() {
    clearTimeout(timer);
    if(visible && $('reader-options').hidden && !document.activeElement?.closest('#reader-overlay')) timer=setTimeout(()=>setVisible(false),4500);
  }
  function setVisible(show,{focus=false}={}) {
    visible=Boolean(show&&active());clearTimeout(timer);
    $('reader-overlay').hidden=!visible;
    $('reader-tap-zones').querySelector('[data-reader-tap="toggle"]').setAttribute('aria-expanded',String(visible));
    $('exit-focus').hidden=!active()||visible;
    $('exit-focus').setAttribute('aria-expanded',String(visible));
    if(!visible && document.activeElement?.closest('#reader-overlay')) $('exit-focus').focus({preventScroll:true});
    if(visible&&focus) $('focus-toggle').focus({preventScroll:true});
    else if(visible&&document.activeElement===$('exit-focus')) $('reader').focus({preventScroll:true});
    scheduleHide();
  }
  for(const [name,id] of Object.entries(bindings)) $(id).addEventListener($(id).tagName==='SELECT'?'change':'input',()=>{
    const previous=preferences;
    const value=['mode','direction','fit'].includes(name)?$(id).value:Number($(id).value);
    preferences=normalizeReaderPreferences({...preferences,[name]:value,...(name==='mode'?{fit:value==='paged'?'height':'width'}:{})});
    refresh();save();change(preferences,previous);scheduleHide();
  });
  $('reset-reader').addEventListener('click',()=>{const previous=preferences;preferences={...readerDefaults};refresh();save();change(preferences,previous);});
  $('reader-options-toggle').addEventListener('click',()=>{$('reader-options').hidden=!$('reader-options').hidden;$('reader-options-toggle').setAttribute('aria-expanded',String(!$('reader-options').hidden));scheduleHide();});
  $('reader-overlay').addEventListener('pointerdown',()=>clearTimeout(timer));
  $('reader-overlay').addEventListener('focusin',()=>clearTimeout(timer));
  $('reader-overlay').addEventListener('focusout',scheduleHide);
  $('reader-overlay').addEventListener('pointerleave',scheduleHide);
  $('reader-library').addEventListener('click',library);$('reader-close').addEventListener('click',close);
  $('focus-toggle').addEventListener('click',()=>setVisible(false));$('exit-focus').addEventListener('click',()=>setVisible(true,{focus:true}));
  $('page-back').addEventListener('click',()=>step(-1));$('page-forward').addEventListener('click',()=>step(1));
  $('page-jump').addEventListener('input',()=>jump(Number($('page-jump').value)-1));
  function tap(action){
    if(!active())return;
    if(action==='toggle'){setVisible(!visible);return;}
    const direction=action==='previous'?-1:1;
    if(preferences.mode==='paged'){
      const pageButton=$(direction<0?'page-back':'page-forward');
      if(!pageButton.disabled)step(direction);
      else $(direction<0?'previous-chapter':'next-chapter').click();
    }else window.scrollBy({top:direction*innerHeight*.8,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  for(const target of [$('reader-stage'),$('reader-tap-zones')]){
    target.addEventListener('pointerdown',event=>{pointer=event.isPrimary?{x:event.clientX,y:event.clientY,id:event.pointerId}:null;});
    target.addEventListener('pointermove',event=>{if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12)pointer=null;});
    target.addEventListener('pointercancel',()=>{pointer=null;});
    target.addEventListener('click',event=>{
      const down=pointer;pointer=null;
      if(!active()||event.target.closest('button,a,input,select')||!down||Math.hypot(event.clientX-down.x,event.clientY-down.y)>12)return;
      tap(event.target.dataset.readerTap??(event.clientY<innerHeight*.3?'previous':event.clientY>innerHeight*.7?'next':'toggle'));
    });
  }
  for(const zone of $('reader-tap-zones').children)zone.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();tap(zone.dataset.readerTap);}});
  document.addEventListener('keydown',event=>{
    if(!active()||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Escape'){event.preventDefault();setVisible(false);return;}
    if(/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)||event.target.isContentEditable || (event.key===' '&&event.target.tagName==='BUTTON'))return;
    if(['c','f',' '].includes(event.key.toLowerCase())){event.preventDefault();setVisible(!visible);}
    else if(preferences.mode==='paged'&&pageStep(event.key,preferences.direction)){event.preventDefault();step(pageStep(event.key,preferences.direction));}
  });
  refresh();
  return {get preferences(){return preferences;},setVisible,
    activate(show=true){document.body.classList.toggle('reader-active',active());setVisible(show);},
    update({index,total,title,series,previous,next,read,busy}) {
      const signature=JSON.stringify([index,total,title,series,previous,next,read,busy,preferences.mode,preferences.direction]);if(signature===lastUpdate)return;lastUpdate=signature;
      $('overlay-title').textContent=title;$('overlay-series').textContent=series;
      $('page-jump').max=total||1;$('page-jump').value=index+1;
      $('page-back').disabled=index<=0;$('page-forward').disabled=index>=total-1;
      $('previous-chapter').disabled=!previous;$('next-chapter').disabled=!next;
      $('reader-mark').textContent=read?'Leído ✓ · desmarcar':'Marcar como leído';
      $('reader-mark').disabled=Boolean(busy);
      $('page-back').textContent=preferences.direction==='rtl'&&preferences.mode==='paged'?'Anterior →':'← Anterior';
      $('page-forward').textContent=preferences.direction==='rtl'&&preferences.mode==='paged'?'← Siguiente':'Siguiente →';
    }
  };
}
