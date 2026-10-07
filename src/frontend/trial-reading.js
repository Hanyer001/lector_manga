export function trialChapters(items=[]) {
  return items.filter(item=>item&&typeof item.url==='string').map(item=>({...item,title:item.title??item.titulo??'Capítulo',number:item.number??item.numero??null,id:'trial:'+item.url})).sort((a,b)=>a.number===null&&b.number===null?0:a.number===null?1:b.number===null?-1:a.number-b.number);
}
export function matchingTrialChapter(items,number) {
  if(!Number.isFinite(number))return {index:null,message:''};
  const matches=items.map((item,index)=>({item,index})).filter(({item})=>item.number===number);
  return {index:matches.length===1?matches[0].index:null,message:matches.length===1?`Capítulo ${number} localizado. Comprueba su contenido: las traducciones pueden dividirlo de forma distinta. Empezarás desde el inicio.`:matches.length>1?`Hay varias versiones del capítulo ${number}. Elige y comprueba una manualmente.`:`No hay una coincidencia única para el capítulo ${number}. Elige y comprueba el capítulo manualmente.`};
}
