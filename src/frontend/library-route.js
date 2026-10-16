const views=new Set(['home','library','discover','explore','settings','private']);
export const libraryRouteFields={status:'reading-filter',source:'source-filter',q:'library-query',genre:'genre-filter',author:'author-filter',publication:'publication-filter',folder:'folder-filter',unread:'only-unread',sort:'library-sort'};
const reading=new Set(['planned','reading','on_hold','completed','abandoned']);
const publication=new Set(['ongoing','completed','hiatus','cancelled','unknown']);
export function parseLibraryRoute(hash='') {
  const [name,query='']=hash.replace(/^#/,'').split('?');
  const view=views.has(name)?name:'home',filters={};
  if(view!=='library')return {view,filters};
  const params=new URLSearchParams(query);
  for(const key of Object.keys(libraryRouteFields)){
    const value=params.get(key);if(!value||value.length>240)continue;
    if(key==='status'&&!reading.has(value)||key==='publication'&&!publication.has(value)||key==='source'&&!/^[a-z0-9-]+$/.test(value)||key==='folder'&&!/^[1-9]\d*$/.test(value)||key==='unread'&&value!=='1'||key==='sort'&&!['title','recent'].includes(value))continue;
    filters[key]=value;
  }
  return {view,filters};
}
export function libraryRouteHash(view,filters={}) {
  view=views.has(view)?view:'home';
  const params=new URLSearchParams();
  if(view==='library')for(const key of Object.keys(libraryRouteFields)){
    const value=filters[key];if(value&&!(key==='sort'&&value==='recent'))params.set(key,String(value));
  }
  const query=params.toString();return '#'+view+(query?'?'+query:'');
}
