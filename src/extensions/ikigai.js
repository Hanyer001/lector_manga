import{BaseScraper}from'../core/BaseScraper.js';
import{ScraperError}from'../core/ScraperError.js';
import{definitionFor}from'./catalog.js';
import{numberOrNull,validateSearch}from'./utils.js';
import{comicTags,cleanText}from'./comic-metadata.js';
import{orderedChapters}from'../frontend/chapter-order.js';
const fail=(message,code='INVALID_RESPONSE')=>new ScraperError(message,{code});
export function qwikData($){const raw=$('script[type="qwik/json"]').text();let data;try{data=JSON.parse(raw.replace(/\\x([0-9a-f]{2})/gi,'\\u00$1'));}catch{throw fail('Datos de Ikigai no reconocidos.');}if(!Array.isArray(data.objs))throw fail('Datos de Ikigai inválidos.');const get=ref=>typeof ref==='string'&&/^[a-z0-9]+$/.test(ref)?data.objs[parseInt(ref,36)]:undefined;return{objects:data.objs,get};}
export default class Ikigai extends BaseScraper{
 constructor(options={}){super({...definitionFor('ikigai'),...options});}
 resource(value,chapter=false){const parsed=new URL(this.pageUrl(value));if(!(chapter?/^\/capitulo\/[1-9]\d*\/?$/:/^\/series\/[a-z0-9-]+\/?$/i).test(parsed.pathname))throw fail('Enlace de Ikigai inválido.','INVALID_URL');return new URL(parsed.pathname.replace(/\/?$/,'/'),this.baseUrl).href;}
 image(value,base){const url=new URL(this.resolveUrl(value,base));if(!definitionFor('ikigai').imageOrigins.includes(url.origin)||url.protocol!=='https:')throw fail('Servidor de imágenes de Ikigai no verificado.','INVALID_ORIGIN');return url.href;}
 metadata($,url){const title=cleanText($('main h1').first().text());if(!title)throw fail('No se encontró la ficha de Ikigai.','EXTRACTION_EMPTY');const box=$('main h1').first().parent().parent();if(/novela/i.test(box.text().slice(0,60)))throw fail('Esta fuente solo admite cómics, no novelas.','UNSUPPORTED_OPERATION');const image=$('main img').first().attr('src'),tags=comicTags(box.find('a[href*="generos"]').map((_,el)=>$(el).text()).get());return{title,url,cover:image?this.image(image,url):null,description:$('meta[name="description"]').attr('content')??null,...tags,status:/en curso/i.test(box.text())?'ongoing':/finalizad|completad/i.test(box.text())?'completed':'unknown',language:'es'};}
 async getManga(value){const url=this.resource(value),{$}=await this.fetchDocument(url);return{source:this.id,manga:this.metadata($,url)};}
 async getChapters(value){const url=this.resource(value),chapters=new Map();let manga;
  for(let page=1;page<=100;page++){const target=new URL(url);target.searchParams.set('pagina',String(page));const{$}=await this.fetchDocument(target.href);manga??=this.metadata($,url);const before=chapters.size;
   $('main a[href*="/capitulo/"]').each((_,el)=>{const link=$(el),title=cleanText(link.find('h3').first().text());if(!title)return;const number=numberOrNull(title.match(/^Cap[ií]tulo\s*(\d+(?:[.,]\d+)?)/i)?.[1]);const chapterUrl=this.resource(this.resolveUrl(link.attr('href'),url),true);chapters.set(chapterUrl,{title,number,url:chapterUrl});});
   const pages=$('main a[href*="pagina="]').toArray().map(el=>new URL(this.pageUrl($(el).attr('href'),url))).filter(link=>link.pathname===new URL(url).pathname&&link.searchParams.has('pagina')).map(link=>Number(link.searchParams.get('pagina')));
   if(!pages.some(number=>number>page)){if(!chapters.size)throw fail('No hay capítulos públicos.','EXTRACTION_EMPTY');return{source:this.id,manga,chapters:orderedChapters([...chapters.values()])};}
   if(chapters.size===before)throw fail('Ikigai repitió una página de capítulos.','INVALID_RESPONSE');
  }throw fail('Lista de capítulos incompleta: límite de páginas.','PAGINATION_LIMIT');
 }
 async getChapterImages(value){const url=this.resource(value,true),{$}=await this.fetchDocument(url),{objects,get}=qwikData($),state=objects.find(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.chapter&&Object.hasOwn(row,'locked'));
  if(!state||get(state.locked)!==false||get(state.is_scheduled)!==false)throw fail('Capítulo restringido o todavía sin publicar.','CHAPTER_UNAVAILABLE');
  const chapter=get(state.chapter),id=String(get(chapter?.id)??'').replace(/^\u0018/,'');if(id!==new URL(url).pathname.split('/')[2])throw fail('Ikigai devolvió otro capítulo.');
  const pages=get(chapter.pages),seriesId=String(get(chapter.series_id)??'').replace(/^\u0018/,'');if(!Array.isArray(pages)||!pages.length)throw fail('Capítulo sin páginas públicas.','CHAPTER_UNAVAILABLE');
  const images=[...new Set(pages.map(get))].filter(page=>typeof page!=='string'||!new URL(this.image(page,url)).pathname.startsWith('/posts/misc/')).map((page,index)=>{if(typeof page!=='string')throw fail('Página inválida.');const image=this.image(page,url);if(!new URL(image).pathname.startsWith(`/series/${seriesId}/${id}/`))throw fail('Las páginas pertenecen a otro capítulo.');return{index:index+1,url:image,referer:url};});
  if(!images.length)throw fail('Capítulo sin páginas públicas.','CHAPTER_UNAVAILABLE');
  return{source:this.id,chapter:{title:`Capítulo ${get(chapter.name)}`,url},images};
 }
 async recommend(filters={}){const page=filters.page??0;validateSearch('catalog',page);const target=new URL('/series/',this.baseUrl);target.search=new URLSearchParams({'tipos[]':'comic',pagina:String(page+1)});const{$,url}=await this.fetchDocument(target.href),results=new Map();
  $('main a[href*="/series/"]').each((_,el)=>{const link=$(el),title=cleanText(link.find('h3').first().text()),image=link.find('img').first().attr('src');if(!title||/novela|novel/i.test(title))return;let mangaUrl;try{mangaUrl=this.resource(this.resolveUrl(link.attr('href'),url));}catch{return;}results.set(mangaUrl,{title,url:mangaUrl,cover:image?this.image(image,url):null,language:'es'});});
  const hasNext=$('main a[href*="pagina="]').toArray().some(el=>Number(new URL(this.pageUrl($(el).attr('href'),url)).searchParams.get('pagina'))>page+1);
  if(!results.size&&!$('main').length)throw fail('Catálogo de Ikigai no reconocido.');
  const enriched=[],items=[...results.values()].slice(0,12);let cursor=0,failures=0;
  await Promise.all([1,2].map(async()=>{while(cursor<items.length){const index=cursor++,item=items[index];try{enriched[index]=(await this.getManga(item.url)).manga;}catch{failures++;enriched[index]=item;}}}));
  return{source:this.id,results:enriched,nextPage:hasNext?page+1:null,partial:Boolean(failures),warnings:['Ikigai: explora el catálogo o añade una obra por enlace.',...(failures?['Algunas fichas no pudieron completarse.']:[])]};
 }
}
