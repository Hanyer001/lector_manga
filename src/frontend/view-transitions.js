let previous,generation=0;
export function changeView(update,{animate=true,privateView=false}={}) {
  const version=++generation;
  previous?.skipTransition();
  if(!animate||privateView||!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches||document.visibilityState!=='visible'){
    update();return Promise.resolve();
  }
  let applied=false;
  const apply=()=>{if(!applied){applied=true;if(version===generation)update();}};
  try{
    const transition=document.startViewTransition(apply);previous=transition;
    transition.ready.catch(()=>{});
    transition.finished.catch(()=>{}).finally(()=>{if(previous===transition)previous=undefined;});
    return transition.updateCallbackDone.catch(error=>{if(applied)throw error;apply();});
  }catch(error){if(applied)throw error;apply();return Promise.resolve();}
}
