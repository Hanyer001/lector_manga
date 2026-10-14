import {groupWorks} from './discovery-core.js';
import {isPublicReading} from './content-policy.js';
import {libraryProgress} from './library-progress.js';

export function homeModel(series,updates=[]) {
  const publicSeries=series.filter(isPublicReading),works=groupWorks(publicSeries);
  const state=item=>item.reading_state??(item.ultimo_capitulo_id?'reading':'planned');
  const recent=works.filter(item=>item.ultimo_capitulo_id&&!['completed','abandoned','on_hold'].includes(state(item)))
    .sort((a,b)=>(b.ultima_lectura??0)-(a.ultima_lectura??0));
  const planned=works.filter(item=>state(item)==='planned');
  const bySeries=new Map(publicSeries.map(item=>[String(item.id),item])),groups=new Map();
  for(const chapter of updates){
    const item=bySeries.get(String(chapter.serie_id));if(!item)continue;
    const key=item.work_id??item.id;
    if(!groups.has(key))groups.set(key,{work:works.find(work=>work.work_id===key),chapters:[]});
    groups.get(key).chapters.push(chapter);
  }
  const news=[...groups.values()].map(group=>{
    // Usa la edición más reciente y su primer capítulo nuevo, sin saltar al último.
    const edition=group.work.editions.find(item=>group.chapters.some(chapter=>String(chapter.serie_id)===String(item.id)));
    const chapters=group.chapters.filter(chapter=>String(chapter.serie_id)===String(edition.id))
      .sort((a,b)=>(a.numero??Infinity)-(b.numero??Infinity)||a.id-b.id);
    return {...group,chapter:chapters[0],count:chapters.length,detectedAt:Math.max(...group.chapters.map(chapter=>chapter.first_seen_at??0))};
  }).sort((a,b)=>b.detectedAt-a.detectedAt);
  return {works,recent,planned,hero:recent[0]??planned[0]??null,news,
    reading:works.filter(item=>state(item)==='reading').length,
    unread:works.filter(item=>libraryProgress(item).read<libraryProgress(item).total).length,
    lastSync:Math.max(0,...publicSeries.map(item=>Number(item.last_sync_at)||0))};
}
