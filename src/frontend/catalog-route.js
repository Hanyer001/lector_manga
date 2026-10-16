const sourceId=value=>/^[a-z0-9-]{1,80}$/.test(value);
const lists={genres:'genre',themes:'theme',excludeGenres:'excludeGenre',excludeThemes:'excludeTheme',sources:'catalog'};
export function parseCatalogRoute(hash=''){
  const [view,query='']=hash.replace(/^#/,'').split('?'),params=new URLSearchParams(query),filters={};
  if(!['explore','discover'].includes(view))return {view,filters};
  if(view==='explore'){
    const q=params.get('q'),source=params.get('source'),genre=params.get('genre'),sources=params.get('sources');
    if(q&&q.length<=200)filters.q=q;
    if(source&&(['all','selected'].includes(source)||sourceId(source)))filters.source=source;
    if(genre==='adult')filters.genre=genre;
    if(sources!==null&&sources.length<=1620){filters.sources=sources==='none'?[]:sources.split(',').filter(sourceId).slice(0,20);filters.source??='selected';}
    return {view,filters};
  }
  for(const [key,param] of Object.entries(lists)){const values=params.getAll(param).filter(value=>value.length>0&&value.length<=(key==='sources'?80:120)&&(key!=='sources'||sourceId(value))).slice(0,key==='sources'?20:10);if(values.length)filters[key]=[...new Set(values)];}
  for(const [key,values] of Object.entries({mode:['personal','recent','similar','diverse','genres'],collection:['recommendations','newest','completed'],country:['JP','KR','CN','TW'],status:['ongoing','completed','hiatus','cancelled'],sort:['title','source'],genreMatch:['all']}))if(values.includes(params.get(key)))filters[key]=params.get(key);
  const min=Number(params.get('minChapters'));if(Number.isInteger(min)&&min>0&&min<=1000)filters.minChapters=min;
  if(params.get('onlyNew')==='1')filters.onlyNew=true;
  if(params.get('q')?.length<=200)filters.q=params.get('q');
  if(sourceId(params.get('source')??''))filters.source=params.get('source');
  const seed=params.get('seed');if(seed&&seed.length<=2200&&(/^[1-9]\d*$/.test(seed)||/^feedback:[a-z0-9-]+\|https?:\/\//.test(seed)))filters.seed=seed;
  return {view,filters};
}
export function catalogRouteHash(view,filters={}){
  if(!['explore','discover'].includes(view))return '#'+view;
  const params=new URLSearchParams();
  if(view==='explore'){
    if(filters.q)params.set('q',filters.q);
    if(filters.source&&filters.source!=='selected')params.set('source',filters.source);
    if(filters.genre==='adult')params.set('genre','adult');
    if((filters.source??'selected')==='selected'&&Array.isArray(filters.sources))params.set('sources',filters.sources.length?filters.sources.join(','):'none');
  }else{
    for(const [key,param] of Object.entries(lists))for(const value of filters[key]??[])params.append(param,value);
    for(const key of ['mode','collection','country','status','minChapters','genreMatch','q','sort','source','seed']){
      const value=filters[key];if(value&&value!==({mode:'personal',collection:'recommendations',genreMatch:'any',sort:'affinity'})[key])params.set(key,String(value));
    }
    if(filters.onlyNew)params.set('onlyNew','1');
  }
  const query=params.toString();return '#'+view+(query?'?'+query:'');
}
