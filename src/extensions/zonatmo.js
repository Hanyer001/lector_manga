import {BaseScraper} from '../core/BaseScraper.js';
import {ScraperError} from '../core/ScraperError.js';
import {definitionFor} from './catalog.js';
import {validateSearch,numberOrNull} from './utils.js';
import {comicTags,cleanText} from './comic-metadata.js';
import {operationContext,runOperation} from '../core/operation.js';
const fail=(message,code='INVALID_RESPONSE')=>new ScraperError(message,{code});
const country=type=>({manga:'JP',manhwa:'KR',manhua:'CN'})[type]??null;
const status=value=>/public[aá]ndose|emisi[oó]n|ongoing/i.test(value)?'ongoing':/completado|finalizado|completed/i.test(value)?'completed':/pausa|hiatus/i.test(value)?'hiatus':/cancelado/i.test(value)?'cancelled':null;

export default class ZonaTMO extends BaseScraper {
  constructor(options={}){const config=definitionFor('tmo');super({...config,...options,id:config.id});this.cache=new Map();this.recommendationBudgetMs=options.recommendationBudgetMs??6500;}
  resource(value,chapter=false){const url=new URL(this.pageUrl(value));
    if(!(chapter?/^\/view_uploads\/[1-9]\d*\/?$/:/^\/library\/(manga|manhwa|manhua|webtoon|comic|one-shot|oneshot|doujinshi|oel)\/[1-9]\d*\/[^/]+\/?$/i).test(url.pathname))throw fail('Enlace de ZonaTMO inválido.','INVALID_URL');url.search='';return url.href;
  }
  image(value,base){const url=new URL(this.resolveUrl(value,base));if(url.protocol!=='https:'||url.port||!definitionFor(this.id).imageOrigins.includes(url.origin))throw fail('Alojamiento de imágenes de ZonaTMO no verificado.','INVALID_ORIGIN');return url.href;}
  cards($,base){const items=new Map();$('a[href*="/library/"]').each((_,el)=>{const link=$(el);let url;try{url=this.resource(this.resolveUrl(link.attr('href'),base));}catch{return;}
    const title=cleanText(link.find('.thumbnail-title h4').first().text());if(!title)return;const box=link.find('.thumbnail.book'),cover=box.find('img.cover-bg-img').attr('src')??box.attr('data-bg');let image=null;try{if(cover)image=this.image(cover,base);}catch{/* Una portada externa no autoriza un nuevo servidor. */}
    items.set(url,{title,url,cover:image,country:country(new URL(url).pathname.split('/')[2]),status:status(box.find('.book-meta-status').text()),...comicTags([box.find('.demography').text()]),language:'es'});
  });return [...items.values()];}
  next($,page,base){return $('.pagination a[href],a[rel="next"]').toArray().some(el=>{const target=new URL(this.pageUrl($(el).attr('href'),base));return Number(target.searchParams.get('page')??target.searchParams.get('_pg'))>page+1;})?page+1:null;}
  async search(query,{page=0}={}){validateSearch(query,page);const target=new URL('/biblioteca',this.baseUrl);target.search=new URLSearchParams({title:query.trim(),page:String(page+1),_pg:'1'});
    const {$,url}=await this.fetchDocument(target.href);if(!$('form[action$="/biblioteca"]').length)throw fail('Búsqueda de ZonaTMO no reconocida.');return {source:this.id,results:this.cards($,url),nextPage:this.next($,page,url)};
  }
  metadata($,url){const heading=$('h1.element-title').first().clone();heading.find('small').remove();const title=cleanText(heading.text());if(!title)throw fail('Ficha de ZonaTMO no encontrada.','EXTRACTION_EMPTY');
    const tags=comicTags($('.element-header-content a[href*="/tag/"]').map((_,el)=>$(el).text()).get()),authors=[...new Set($('.element-header-content a[href*="filter_by=author"]').map((_,el)=>cleanText($(el).text())).get().filter(Boolean))];
    let description=cleanText($('.element-description').text());const duplicate=description.match(/^(.*?)\.\.\.\s+(.+)$/);if(duplicate&&duplicate[2].startsWith(duplicate[1]))description=duplicate[2];
    const cover=$('img.book-thumbnail').first().attr('src');let image=null;try{if(cover)image=this.image(cover,url);}catch{/* Conserva la ficha con una portada pendiente. */}
    const manga={title,url,cover:image,description:description||null,authors,...tags,country:country(new URL(url).pathname.split('/')[2]),status:status($('.element-subtitle').filter((_,el)=>/^Estado$/i.test(cleanText($(el).text()))).next().text()),language:'es'};
    if(this.cache.size>=100&&!this.cache.has(url))this.cache.delete(this.cache.keys().next().value);this.cache.set(url,{manga,expires:Date.now()+300000});return manga;
  }
  async getManga(value){const url=this.resource(value),cached=this.cache.get(url);if(cached?.expires>Date.now())return {source:this.id,manga:cached.manga};const {$}=await this.fetchDocument(url);return {source:this.id,manga:this.metadata($,url)};}
  async getChapters(value){const url=this.resource(value),{$}=await this.fetchDocument(url),manga=this.metadata($,url),chapters=new Map();
    $('.element-chapters .list-chapters li.upload-link').each((_,el)=>{const row=$(el),label=row.find('.chapter-number').first(),number=numberOrNull(label.attr('data-number')),title=cleanText(label.text())||'Capítulo';
      row.find('a[href*="/view_uploads/"]').each((_,link)=>{const entry=$(link),chapterUrl=this.resource(this.resolveUrl(entry.attr('href'),url),true),group=cleanText(entry.parent().find('a[href*="/groups/"]').first().text());chapters.set(chapterUrl,{title:group?`${title} · ${group}`:title,number,url:chapterUrl});});});
    if($('.element-chapters .pagination,.element-chapters a[rel="next"]').length)throw fail('Lista de capítulos incompleta: paginación no reconocida.','PAGINATION_LIMIT');
    if(!chapters.size)throw fail('Esta obra todavía no tiene capítulos públicos disponibles en ZonaTMO.','EXTRACTION_EMPTY');return {source:this.id,manga,chapters:[...chapters.values()]};
  }
  async getChapterImages(value){const url=this.resource(value,true),{$}=await this.fetchDocument(url),images=[],seen=new Set();
    $('img.reader-image').each((_,el)=>{const image=$(el),target=this.image(image.attr('data-src')??image.attr('src'),url);if(!seen.has(target)){seen.add(target);images.push({index:images.length+1,url:target,referer:url});}});
    if(!images.length)throw fail('Capítulo sin imágenes públicas.','CHAPTER_UNAVAILABLE');return {source:this.id,chapter:{title:cleanText($('title').text()).replace(/\s*[—|]\s*ZonaTMO$/,'')||'Capítulo',url},images};
  }
  async recommend({page=0}={}){validateSearch('catálogo',page);const parent=operationContext()?.signal,signal=parent?AbortSignal.any([parent,AbortSignal.timeout(this.recommendationBudgetMs)]):AbortSignal.timeout(this.recommendationBudgetMs),target=new URL('/biblioteca',this.baseUrl);target.searchParams.set('page',String(page+1));
    const {$,url}=await runOperation(()=>this.fetchDocument(target.href),{signal,timeoutMs:this.recommendationBudgetMs}),cards=this.cards($,url);if(!cards.length)throw fail('Catálogo de ZonaTMO vacío.','EXTRACTION_EMPTY');
    const found=new Map();let cursor=0;const worker=async()=>{while(cursor<cards.length&&!signal.aborted){const index=cursor++;try{found.set(index,(await runOperation(()=>this.getManga(cards[index].url),{signal,timeoutMs:2200})).manga);}catch(error){if(parent?.aborted)throw error;}}};await Promise.all([worker(),worker()]);
    const results=[...found].sort((a,b)=>a[0]-b[0]).map(([,manga])=>manga);if(!results.length)throw fail('No se pudieron consultar las fichas de ZonaTMO.','EXTRACTION_EMPTY');return {source:this.id,results,nextPage:this.next($,page,url),partial:results.length<cards.length,warnings:results.length<cards.length?['Algunas fichas de ZonaTMO no pudieron consultarse a tiempo.']:[]};
  }
}
