import {BaseScraper} from '../core/BaseScraper.js';
import {ScraperError} from '../core/ScraperError.js';
import {definitionFor} from './catalog.js';
import {validateSearch,numberOrNull} from './utils.js';
import {comicTags,cleanText} from './comic-metadata.js';
import {operationContext,runOperation} from '../core/operation.js';

export default class TuManga extends BaseScraper {
  constructor(options={}){const config=definitionFor('tumanga');super({...config,...options,id:config.id});this.metadataCache=new Map();this.catalogCovers=new Map();this.recommendationBudgetMs=options.recommendationBudgetMs??6500;this.recommendationPageTimeoutMs=options.recommendationPageTimeoutMs??2200;}
  resource(value,chapter=false){const url=new URL(this.pageUrl(value));
    if(!(chapter?/^\/[a-z0-9-]+\/(?:capitulo|chapter|episodio)-[a-z0-9.-]+\/?$/i:/^\/manga\/[a-z0-9-]+\/?$/i).test(url.pathname))throw new ScraperError('Enlace de TuManga.net inválido.',{code:'INVALID_URL'});
    url.search='';return url.href;
  }
  cards($,base){const items=new Map();$('.bsx a[href]').each((_,el)=>{const link=$(el);let url;try{url=this.resource(this.resolveUrl(link.attr('href'),base));}catch{return;}
    const title=cleanText(link.find('.tt').text())||cleanText(link.attr('title'));if(!title)return;
    const image=link.find('img').first(),cover=image.attr('data-src')??image.attr('src'),coverUrl=cover&&!/noimg|noimage/i.test(cover)?this.resolveUrl(cover,base):null;
    if(this.catalogCovers.size>=500)this.catalogCovers.delete(this.catalogCovers.keys().next().value);this.catalogCovers.set(url,coverUrl);
    items.set(url,{title,url,cover:coverUrl,language:'es'});});return [...items.values()];}
  async search(query,{page=0}={}){validateSearch(query,page);const target=new URL(page?`/page/${page+1}/`:'/',this.baseUrl);target.searchParams.set('s',query.trim());
    const {$,url}=await this.fetchDocument(target.href),results=this.cards($,url);
    if(!results.length&&!$('.notf,.not-found,.search-results,.listupd').length)throw new ScraperError('Respuesta de búsqueda de TuManga.net no reconocida.',{code:'INVALID_RESPONSE'});
    return {source:this.id,results,nextPage:$('a.next.page-numbers').length||$('.hpage a.r').length?page+1:null};}
  async getManga(value){const url=this.resource(value),cached=this.metadataCache.get(url);if(cached?.expires>Date.now())return {source:this.id,manga:cached.manga};
    const {$}=await this.fetchDocument(url),title=cleanText($('h1.entry-title').first().text());if(!title||!$('.main-info').length)throw new ScraperError('Ficha de TuManga.net no encontrada.',{code:'EXTRACTION_EMPTY'});
    let cover=$('meta[property="og:image"]').attr('content')??$('.main-info .thumb img').first().attr('src')??this.catalogCovers.get(url);
    if(!cover&&!this.catalogCovers.has(url)){await this.search(title);cover=this.catalogCovers.get(url);}
    const tags=comicTags($('.main-info .mgen a').map((_,el)=>$(el).text()).get());
    const type=cleanText($('.main-info .imptdt').filter((_,el)=>/^Tipo\b/i.test(cleanText($(el).text()))).text());
    const status=cleanText($('.main-info .imptdt').filter((_,el)=>/^Status\b/i.test(cleanText($(el).text()))).find('i').text());
    const manga={title,url,cover:cover?this.resolveUrl(cover,url):null,description:cleanText($('.main-info [itemprop="description"]').text())||null,...tags,
      country:/manhwa/i.test(type)?'KR':/manhua/i.test(type)?'CN':null,status:({ongoing:'ongoing',completed:'completed',finalizado:'completed'})[status.toLowerCase()]??null,language:'es'};
    if(this.metadataCache.size>=100)this.metadataCache.delete(this.metadataCache.keys().next().value);this.metadataCache.set(url,{manga,expires:Date.now()+300000});return {source:this.id,manga};
  }
  async getChapters(value){const url=this.resource(value),{manga}=await this.getManga(url),{$}=await this.fetchDocument(url),chapters=new Map();
    $('.eplister a[href]').each((_,el)=>{const link=$(el),chapterUrl=this.resource(this.resolveUrl(link.attr('href'),url),true),title=cleanText(link.find('.chapternum').text());if(!title)return;
      const number=numberOrNull(title.match(/(?:cap[ií]tulo|chapter|episodio)\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1]);chapters.set(chapterUrl,{title,number,url:chapterUrl});});
    if($('.eplister a.next,.eplister .pagination').length)throw new ScraperError('Lista de capítulos paginada no admitida; no se entrega incompleta.',{code:'PAGINATION_LIMIT'});
    if(!chapters.size)throw new ScraperError('Sin capítulos públicos.',{code:'EXTRACTION_EMPTY'});return {source:this.id,manga,chapters:[...chapters.values()]};
  }
  async getChapterImages(value){const url=this.resource(value,true),{$}=await this.fetchDocument(url);let data;
    for(const script of $('script:not([src])').toArray()){const match=$(script).text().match(/ts_reader\.run\(\s*(\{[\s\S]*?\})\s*\)\s*;?/);if(match){try{data=JSON.parse(match[1]);}catch{throw new ScraperError('Datos del lector inválidos.',{code:'INVALID_RESPONSE'});}break;}}
    const pages=data?.sources?.find(source=>Array.isArray(source.images)&&source.images.length)?.images;
    if(!pages?.length)throw new ScraperError('Capítulo sin imágenes públicas.',{code:'CHAPTER_UNAVAILABLE'});
    const images=pages.map((page,index)=>({index:index+1,url:this.resolveUrl(page,url),referer:url}));
    if(images.some(image=>new URL(image.url).origin!==new URL(this.baseUrl).origin))throw new ScraperError('Servidor de imágenes de TuManga.net no verificado.',{code:'CHAPTER_UNAVAILABLE'});
    return {source:this.id,chapter:{title:cleanText($('h1.entry-title').text())||'Capítulo',url},images};
  }
  async recommend(filters={}){const parent=operationContext()?.signal,signal=parent?AbortSignal.any([parent,AbortSignal.timeout(this.recommendationBudgetMs)]):AbortSignal.timeout(this.recommendationBudgetMs);
    const {$,url}=await runOperation(()=>this.fetchDocument('/'),{signal,timeoutMs:this.recommendationBudgetMs}),cards=this.cards($,url);if(!cards.length)throw new ScraperError('Catálogo de TuManga.net no reconocido.',{code:'EXTRACTION_EMPTY'});
    const found=new Map();let cursor=0,failed=0;const limit=Math.min(cards.length,20);
    const worker=async()=>{while(cursor<limit&&!signal.aborted){const index=cursor++,item=cards[index];try{const manga=(await runOperation(()=>this.getManga(item.url),{signal,timeoutMs:this.recommendationPageTimeoutMs})).manga;found.set(index,manga);}catch(error){if(parent?.aborted)throw error;failed++;}}};await Promise.all([worker(),worker()]);
    const results=[...found].sort((a,b)=>a[0]-b[0]).map(([,manga])=>manga),skipped=limit-cursor;
    if(!results.length)throw new ScraperError('No se pudieron consultar las fichas de TuManga.net.',{code:'EXTRACTION_EMPTY'});
    return {source:this.id,results,unavailableTags:[],partial:failed+skipped>0,warnings:[...(failed?[`${failed} ${failed===1?'ficha no pudo consultarse':'fichas no pudieron consultarse'}; se conservan las demás historias.`]:[]),...(skipped?[`${skipped} fichas pendientes por lentitud de TuManga.net. Puedes pulsar Actualizar para volver a consultar.`]:[])]};
  }
}
