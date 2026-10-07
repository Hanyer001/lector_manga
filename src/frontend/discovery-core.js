import { discoveryTags } from './discovery-tags.js';
// Compartido por el servidor y la interfaz. No necesita imágenes ni servicios de IA.
export const normalizeTag = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const aliases = {
  accion:'action',aventura:'adventure',comedia:'comedy',drama:'drama',fantasia:'fantasy',romance:'romance',terror:'horror',
  misterio:'mystery',deportes:'sports','ciencia ficcion':'sci-fi','vida cotidiana':'slice of life',
  reencarnacion:'reincarnation',regresion:'regression',venganza:'revenge','artes marciales':'martial arts',
  'sistema de niveles':'leveling system',sistema:'leveling system','pantallas de sistemas':'leveling system',mazmorras:'dungeons',villana:'villainess',sobrenatural:'supernatural',magia:'magic',monstruos:'monsters',supervivencia:'survival',
  psicologico:'psychological',suspenso:'thriller',historico:'historical',historia:'historical',tragedia:'tragedy',crimen:'crime',filosofico:'philosophical',superheroes:'superhero',
  'recuentos de la vida':'slice of life','recuento de la vida':'slice of life',deporte:'sports',
  'cultivacion (cultivo)':'cultivation',cultivacion:'cultivation',apocaliptico:'apocalyptic','vida escolar':'school life',superpoderes:'superpowers',
  'realidad virtual':'virtual reality',juego:'video games',videojuegos:'video games',demonios:'demons',vampiros:'vampires',zombis:'zombies',
  'viajes en el tiempo':'time travel',cocina:'cooking',musica:'music',familia:'family',antiheroe:'antihero','anti-heroe':'antihero',
  'artes marcial':'martial arts',militar:'military',shonen:'shounen',shojo:'shoujo',yuri:'girls love',yaoi:'boys love',
  retornado:'regression',ciberpunk:'cyberpunk',"girls' love":'girls love',"boys' love":'boys love'
};
export const tagKey = value => ['+18','18+','adultos','adult'].includes(normalizeTag(value)) ? 'adult' : aliases[normalizeTag(value)] ?? normalizeTag(value);
const labels={action:'acción',adventure:'aventura',comedy:'comedia',fantasy:'fantasía',horror:'terror',mystery:'misterio',sports:'deportes','sci-fi':'ciencia ficción','slice of life':'vida cotidiana',reincarnation:'reencarnación',regression:'regresión',revenge:'venganza','martial arts':'artes marciales','leveling system':'sistema de niveles',dungeons:'mazmorras',villainess:'villana'};
export const tagLabel=value=>Object.values(discoveryTags).flat().find(([key])=>key===tagKey(value))?.[1]??labels[tagKey(value)]??value;
export const itemKey = item => `${item.source}|${item.url_origen ?? item.url}`;
export function groupWorks(rows) {
  const groups = new Map();
  for (const row of rows) { const id=row.work_id ?? row.id; if(!groups.has(id))groups.set(id,[]); groups.get(id).push(row); }
  return [...groups].map(([work_id,editions])=>{
    editions.sort((a,b)=>(b.ultima_lectura??0)-(a.ultima_lectura??0)||a.id-b.id);
    const main=editions[0],cover=[...editions].sort((a,b)=>a.id-b.id).find(item=>item.coverUrl)||main;
    return {...main,coverUrl:cover.coverUrl,coverKey:cover.coverKey,coverVariants:cover.coverVariants,titulo:main.work_title??main.titulo,work_id,editions,genres:[...new Set(editions.flatMap(e=>e.genres??[]))],
      themes:[...new Set(editions.flatMap(e=>e.themes??[]))],authors:[...new Set(editions.flatMap(e=>e.authors??[]))],
      folder_ids:[...new Set(editions.flatMap(e=>e.folder_ids??[]))],
      total_capitulos:Math.max(...editions.map(e=>e.total_capitulos??0)),nuevos:Math.max(...editions.map(e=>e.nuevos??0))};
  });
}
const keys = values => new Set((values??[]).map(tagKey));
export function matchesDiscovery(item, filters={}) {
  const genres=keys(item.genres),themes=keys(item.themes);
  if(item.is_adult||['erotica','pornographic','adult'].includes(item.contentRating))genres.add('adult');
  if((filters.genres??[]).some(v=>tagKey(v)==='adult')&&!genres.has('adult'))return false;
  const requested=(filters.genres??[]).filter(v=>tagKey(v)!=='adult');
  if(requested.length&&(filters.genreMatch==='any'?!requested.some(v=>genres.has(tagKey(v))):requested.some(v=>!genres.has(tagKey(v)))))return false;
  if((filters.themes??[]).some(v=>!themes.has(tagKey(v))))return false;
  if((filters.excludeGenres??[]).some(v=>genres.has(tagKey(v))) || (filters.excludeThemes??[]).some(v=>themes.has(tagKey(v))))return false;
  if(filters.country && item.country!==filters.country || filters.status && item.status!==filters.status)return false;
  if(filters.minChapters>0 && !(item.verified_chapters>=filters.minChapters))return false;
  return true;
}
const genreWeights={action:.6,adventure:.7,drama:.35,fantasy:1,comedy:.8,romance:1,'slice of life':.8,horror:1.6,psychological:1.6,thriller:1.6,tragedy:1.4};
const features=item=>new Map([...(item.genres??[]).map(value=>[tagKey(value),genreWeights[tagKey(value)]??1.2]),...(item.themes??[]).map(value=>[tagKey(value),['school life','magic'].includes(tagKey(value))?1.3:2.4])].filter(([key])=>key!=='adult'));
const titleKey=value=>normalizeTag(value).replace(/\s*\(\s*\d{4}\s*\)\s*$/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const usable=seed=>seed.sentiment!=='dislike'&&!seed.hidden&&seed.reading_state!=='abandoned'&&!(seed.rating&&seed.rating<=4);
export function selectRecommendationSeeds({library=[],feedback=[],mode='personal',seedWorkId=null,seedFeedbackKey=null}={}){
  const works=groupWorks(library);
  if(mode==='genres')return [];
  if(mode==='similar')return seedFeedbackKey?feedback.filter(item=>itemKey(item)===seedFeedbackKey):works.filter(item=>String(item.work_id)===String(seedWorkId));
  const seeds=works.filter(usable);
  if(mode==='recent')return seeds.filter(item=>item.ultima_lectura).sort((a,b)=>b.ultima_lectura-a.ultima_lectura).slice(0,5);
  return [...seeds,...feedback.filter(item=>usable(item)&&(item.sentiment==='like'||item.more_like))];
}
export function recommendationQueryTags(seeds){
  const totals=new Map();
  for(const seed of seeds){const weight=seed.more_like?4:seed.sentiment==='like'||seed.rating>=8?3:seed.ultima_lectura?1:.35;
    for(const [key,value] of features(seed)){const kind=keys(seed.themes).has(key)?'themes':'genres',id=kind+'|'+key;totals.set(id,{kind,key,weight:(totals.get(id)?.weight??0)+value*weight});}}
  return [...totals.values()].sort((a,b)=>b.weight-a.weight||a.key.localeCompare(b.key)).slice(0,3);
}
function affinity(item,seed){
  const a=features(item),b=features(seed),shared=[...b.keys()].filter(key=>a.has(key));
  const common=shared.reduce((sum,key)=>sum+Math.min(a.get(key),b.get(key)),0),totalA=[...a.values()].reduce((a,b)=>a+b,0),totalB=[...b.values()].reduce((a,b)=>a+b,0);
  const authors=(item.authors??[]).filter(author=>(seed.authors??[]).some(value=>normalizeTag(value)===normalizeTag(author)));
  const coverage=totalB?common/totalB:0,dice=totalA+totalB?2*common/(totalA+totalB):0;
  const romance=['romance','boys love','girls love'],dark=['horror','psychological','thriller','tragedy'];
  const conflicting=romance.some(key=>a.has(key))&&!romance.some(key=>b.has(key))&&!shared.some(key=>dark.includes(key))&&!authors.length;
  const defining=[...b].filter(([,weight])=>weight>=1.4).map(([key])=>key),sharesDefining=!defining.length||defining.some(key=>a.has(key));
  const strong=Boolean(authors.length)||(!conflicting&&sharesDefining&&(common>=1.8||coverage>=.75&&common>=1)&&coverage>=.3&&dice>=.28&&(shared.length>=2||b.size===1));
  const related=strong||(!conflicting&&common>=1.5&&coverage>=.25&&dice>=.22)||(!conflicting&&b.size===1&&common>=.8&&dice>=.4);
  return {shared,authors,strong,related,score:dice*60+coverage*20+authors.length*15};
}
export function rankRecommendations(candidates,{library=[],feedback=[],filters={},mode='personal',seedWorkId=null,seedFeedbackKey=null,limit=24}={}) {
  const works=groupWorks(library),savedKeys=new Set(library.map(itemKey));
  const savedTitles=new Set(library.flatMap(item=>[item.titulo,...(item.altTitles??[])]).map(titleKey));
  const blockedTitles=new Set(feedback.filter(x=>x.hidden||x.already_read||x.sentiment==='dislike').flatMap(x=>[x.title,...(x.altTitles??[])]).map(titleKey));
  const external=new Map(feedback.map(x=>[itemKey(x),x]));
  const seeds=selectRecommendationSeeds({library,feedback,mode,seedWorkId,seedFeedbackKey});
  const informative=seeds.some(seed=>features(seed).size||seed.authors?.length);
  const negative=[...works,...feedback].filter(seed=>seed.sentiment==='dislike'||seed.reading_state==='abandoned'||seed.rating&&seed.rating<=4);
  if(mode==='similar')for(const seed of seeds)blockedTitles.add(titleKey(seed.titulo??seed.title));
  const seen=new Set(),ranked=[];
  for(const item of candidates) {
    const key=itemKey(item),titles=[item.title??item.titulo,...(item.altTitles??[])].map(titleKey),own=external.get(key);
    if(savedKeys.has(key)||titles.some(title=>savedTitles.has(title)||blockedTitles.has(title))||own?.hidden||own?.already_read||own?.sentiment==='dislike'||!matchesDiscovery(item,filters)||seen.has(key))continue;
    seen.add(key);
    let score=0,best=0,bestMatch=null,bestSeed=null,reason='Descubre una historia fuera de tu biblioteca.';
    for(const [index,seed] of seeds.entries()) {
      const match=affinity(item,seed),eligible=mode==='similar'?match.strong:match.related;
      const weight=mode==='similar'?1:mode==='recent'?1/(1+index*.35):seed.more_like?3:seed.sentiment==='like'||seed.rating>=8?2.5:seed.ultima_lectura?1:.35;
      const similarity=eligible?match.score*weight:0;
      score+=similarity;
      if(similarity>best){best=similarity;bestMatch=match;bestSeed=seed;}
    }
    if(mode==='similar'&&!best)continue;
    if(mode==='recent'&&(!informative||!best))continue;
    if(mode==='personal'&&informative&&!best)continue;
    if(['personal','recent'].includes(mode)&&negative.some(seed=>{const match=affinity(item,seed);return match.strong&&match.score>(bestMatch?.score??0);}))continue;
    if(bestSeed){const shared=bestMatch.shared.slice().sort((a,b)=>(features(bestSeed).get(b)??0)-(features(bestSeed).get(a)??0)).slice(0,3).map(tagLabel);
      reason=`${mode==='similar'?'Similar a':mode==='recent'?'Por tu lectura de':bestSeed.sentiment==='like'||bestSeed.rating>=8?'Porque te gustó':'Por tu biblioteca de'} ${bestSeed.titulo??bestSeed.title}${shared.length?`: ${shared.join(', ')}`:''}${bestMatch.authors.length?' · comparte autor':''}.`;}
    if(mode==='diverse'){const novelty=[...features(item).keys()].filter(key=>!seeds.some(seed=>features(seed).has(key)));score=novelty.length*5-Math.max(0,...seeds.map(seed=>affinity(item,seed).score));reason=novelty.length?`Para salir de lo habitual: ${novelty.slice(0,3).map(tagLabel).join(', ')}.`:'Una alternativa a tus lecturas habituales.';}
    const matchedFilters=[...(filters.genres??[]).filter(value=>keys(item.genres).has(tagKey(value))),...(filters.themes??[]).filter(value=>keys(item.themes).has(tagKey(value)))].map(tagLabel);
    if(filters.genres?.length||filters.themes?.length) {score+=5;if(!bestSeed&&mode!=='diverse')reason=`Coincide con tus filtros: ${matchedFilters.join(', ')||'clasificación del catálogo'}.`;}
    if(mode==='personal'&&(own?.more_like||own?.sentiment==='like'))score+=3;
    ranked.push({...item,score,reason,explanation:{mode,seedTitle:bestSeed?.titulo??bestSeed?.title??null,sharedTags:(bestMatch?.shared??[]).map(tagLabel),sharedAuthors:bestMatch?.authors??[],matchedFilters}});
  }
  ranked.sort((a,b)=>b.score-a.score||normalizeTag(a.title).localeCompare(normalizeTag(b.title)));
  // Intercala los mejores resultados de cada catálogo. Ninguna fuente monopoliza la primera fila.
  const buckets=new Map();
  for(const item of ranked){if(!buckets.has(item.source))buckets.set(item.source,[]);buckets.get(item.source).push(item);}
  const balanced=[],seenTitles=new Set();
  while(balanced.length<Math.min(240,Math.max(1,limit))&&[...buckets.values()].some(items=>items.length))for(const items of buckets.values()){
    while(items.length){const item=items.shift(),titles=[item.title??item.titulo,...(item.altTitles??[])].map(titleKey);if(titles.some(title=>seenTitles.has(title)))continue;for(const title of titles)seenTitles.add(title);balanced.push(item);break;}
    if(balanced.length>=Math.min(240,Math.max(1,limit)))break;
  }
  return balanced;
}
export function equivalentChapter(chapters, number) {
  if(typeof number!=='number'||!Number.isFinite(number))return {chapter:null,ambiguous:false};
  const matches=chapters.filter(c=>c.numero===number);
  return {chapter:matches.length===1?matches[0]:null,ambiguous:matches.length>1};
}
