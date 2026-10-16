export const catalogHealthKey='lector-manga.catalog-health.v1';
const validDate=value=>Number.isFinite(value)&&value>0&&value<=8640000000000000;
export function readCatalogHealth(value) {
  try{
    const rows=JSON.parse(value??'{}');if(!rows||Array.isArray(rows)||typeof rows!=='object')return {};
    return Object.fromEntries(Object.entries(rows).filter(([id,row])=>/^[a-z0-9-]{1,80}$/.test(id)&&row&&typeof row==='object').slice(0,40).map(([id,row])=>[id,{
      lastSuccess:validDate(row.lastSuccess)?row.lastSuccess:null,lastFailure:validDate(row.lastFailure)?row.lastFailure:null,
      history:Array.isArray(row.history)?row.history.filter(event=>event&&['ok','error'].includes(event.state)&&validDate(event.at)).slice(-5).map(({state,at})=>({state,at})):[]
    }]));
  }catch{return {};}
}
export function recordCatalogHealth(rows,id,state,at=Date.now()) {
  if(!/^[a-z0-9-]{1,80}$/.test(id)||!['ok','error'].includes(state))return rows;
  const row=rows[id]??{lastSuccess:null,lastFailure:null,history:[]},last=row.history.at(-1);
  // La capa de red y la búsqueda pueden informar la misma respuesta.
  const history=last?.state===state&&at-last.at<1000?row.history:[...row.history,{state,at}].slice(-5);
  return {...rows,[id]:{...row,[state==='ok'?'lastSuccess':'lastFailure']:at,history}};
}
