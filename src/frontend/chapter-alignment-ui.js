const $=id=>document.getElementById(id);
export function createChapterAlignment({api,reload,select,sourceName}) {
  let current=null,list=[],generation=0;
  const status=$('alignment-status'),picker=$('alignment-chapter'),number=$('alignment-number');
  function choose(){
    const chapter=list.find(row=>String(row.id)===picker.value);
    number.value=chapter?.aligned_number??chapter?.numero??'';
    $('alignment-save').disabled=!chapter;$('alignment-remove').disabled=chapter?.aligned_number===undefined;
  }
  async function update(item){
    current=item;list=[];const version=++generation;
    picker.replaceChildren(new Option('Cargando capítulos…',''));picker.disabled=true;
    $('alignment-save').disabled=$('alignment-remove').disabled=true;number.value='';
    status.textContent='';$('alignment-source').textContent=sourceName(item.source);
    try{
      const chapters=await api(`/api/series/${item.id}/chapters`);if(version!==generation)return;
      list=chapters;picker.replaceChildren(new Option('Elige un capítulo de esta fuente',''),...list.map(chapter=>new Option(`${chapter.titulo}${chapter.aligned_number!==undefined?` · común ${chapter.aligned_number}`:''}`,chapter.id)));
      picker.disabled=!list.length;
      const adjusted=list.filter(row=>row.aligned_number!==undefined).length;
      status.textContent=list.length?`${adjusted} ${adjusted===1?'ajuste guardado':'ajustes guardados'}.`:'Actualiza los capítulos antes de alinearlos.';
    }catch(error){if(version===generation)status.textContent=error.message;}
  }
  async function save(remove=false){
    const item=current,chapter=list.find(row=>String(row.id)===picker.value);if(!item||!chapter)return;
    const value=number.value.trim(),common=Number(value);
    if(!remove&&(!value||!Number.isFinite(common)||common<0||common>100000)){status.textContent='Escribe una numeración común entre 0 y 100000. Puedes usar decimales.';return;}
    if(!remove&&list.some(row=>row.id!==chapter.id&&(row.aligned_number??row.numero)===common)){status.textContent='Ese número común ya corresponde a otro capítulo de esta fuente. Ajusta primero ese capítulo para evitar una equivalencia ambigua.';return;}
    const entries=(item.chapterAlignment??[]).filter(entry=>entry.url!==chapter.url_origen);
    if(!remove)entries.push({url:chapter.url_origen,number:common});
    if(new TextEncoder().encode(JSON.stringify(entries)).length>28000){status.textContent='Se alcanzó el límite de ajustes de esta fuente. Retira equivalencias que ya no necesites antes de añadir más.';return;}
    $('alignment-save').disabled=$('alignment-remove').disabled=true;
    try{
      await api(`/api/series/${item.id}/library`,{method:'PUT',body:JSON.stringify({metadata:{chapterAlignment:entries}})});
      if(current?.id!==item.id)return;
      await reload();if(current?.id!==item.id)return;await select({...item,chapterAlignment:entries});
      status.textContent=remove?'Ajuste retirado. Se usa otra vez la numeración de la fuente.':`Guardado: ${chapter.titulo} corresponde al número común ${common}. El orden y las equivalencias usan este número.`;
    }catch(error){if(current?.id===item.id){status.textContent=error.message;choose();}}
  }
  picker.addEventListener('change',choose);
  $('alignment-form').addEventListener('submit',event=>{event.preventDefault();save();});
  $('alignment-remove').addEventListener('click',()=>save(true));
  return {update,clear(){current=null;list=[];generation++;picker.replaceChildren();number.value='';status.textContent='';$('alignment-editor').open=false;}};
}
