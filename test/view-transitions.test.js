import test from 'node:test';
import assert from 'node:assert/strict';
import {changeView} from '../src/frontend/view-transitions.js';

test('transiciones: ejecuta una vez, espera el cambio y degrada si falla la captura',async()=>{
  const previousDocument=globalThis.document,previousMatchMedia=globalThis.matchMedia;
  try{
    globalThis.matchMedia=()=>({matches:false});
    let updates=0;
    globalThis.document={visibilityState:'visible',startViewTransition(update){const done=Promise.resolve().then(update);return{skipTransition(){},ready:done,finished:done,updateCallbackDone:done};}};
    const done=changeView(()=>updates++);assert.equal(updates,0);await done;assert.equal(updates,1);
    document.startViewTransition=()=>{throw new Error('Captura no disponible');};
    await changeView(()=>updates++);assert.equal(updates,2);
  }finally{globalThis.document=previousDocument;globalThis.matchMedia=previousMatchMedia;}
});
test('transiciones: privada y movimiento reducido evitan capturar datos de la vista anterior',async()=>{
  const previousDocument=globalThis.document,previousMatchMedia=globalThis.matchMedia;
  try{
    let updates=0,captures=0;
    globalThis.document={visibilityState:'visible',startViewTransition(){captures++;throw new Error('No debe capturar');}};
    globalThis.matchMedia=()=>({matches:false});
    await changeView(()=>updates++,{privateView:true});
    globalThis.matchMedia=()=>({matches:true});await changeView(()=>updates++);
    assert.equal(updates,2);assert.equal(captures,0);
  }finally{globalThis.document=previousDocument;globalThis.matchMedia=previousMatchMedia;}
});
test('transiciones: una captura pendiente no vuelve a abrir una vista que ya fue abandonada',async()=>{
  const previousDocument=globalThis.document,previousMatchMedia=globalThis.matchMedia;
  try{
    globalThis.matchMedia=()=>({matches:false});
    let callback,resolve,view='',skipped=0;
    const done=new Promise(value=>{resolve=value;});
    globalThis.document={visibilityState:'visible',startViewTransition(update){callback=update;return{skipTransition(){skipped++;},ready:done,finished:done,updateCallbackDone:done};}};
    const first=changeView(()=>{view='primera';});
    await changeView(()=>{view='actual';},{privateView:true});
    callback();resolve();await first;
    assert.equal(view,'actual');assert.equal(skipped,1);
  }finally{globalThis.document=previousDocument;globalThis.matchMedia=previousMatchMedia;}
});
