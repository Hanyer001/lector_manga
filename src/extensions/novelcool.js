import {BaseScraper} from '../core/BaseScraper.js';
import {ScraperError} from '../core/ScraperError.js';
import {definitionFor} from './catalog.js';
import {validateSearch,numberOrNull} from './utils.js';
import {comicTags,cleanText} from './comic-metadata.js';

export default class NovelCool extends BaseScraper {
  constructor(options={}){const config=definitionFor('novelcool');super({...config,...options,id:config.id});this.maxPages=options.maxPages??100;this.metadataCache=new Map();}
  resource(value,chapter=false){const url=new URL(this.pageUrl(value)),match=url.pathname.match(chapter?/^\/chapter\/([^/]+)\/([1-9]\d*)(?:-\d+){0,2}(?:\.html|\/)$/i:/^\/novel\/([^/]+)\.html$/i);
    if(!match)throw new ScraperError('Enlace de NovelCool inválido.',{code:'INVALID_URL'});url.search='';if(chapter)url.pathname=`/chapter/${match[1]}/${match[2]}/`;return url.href;}
  cards($,base){const items=new Map();$('a[href*="/novel/"]').each((_,el)=>{const link=$(el),title=cleanText(link.attr('title')??link.find('.book-name').first().text());if(!title||/\b(?:novela|novel light|light novel)\b/i.test(title))return;
    let url;try{url=this.resource(this.resolveUrl(link.attr('href'),base));}catch{return;}
    const box=link.closest('.book-item,.book-item-list,.book-list-item'),image=link.find('img').first().length?link.find('img').first():box.find('img').first();
    const cover=image.attr('data-src')??image.attr('src'),tags=comicTags(box.find('.book-tag').map((_,e)=>$(e).text()).get());
    const previous=items.get(url);items.set(url,{...previous,title,url,cover:cover?this.resolveUrl(cover,base):previous?.cover??null,...tags,language:'es'});
  });return [...items.values()];}
  async search(query,{page=0}={}){validateSearch(query,page);const params=new URLSearchParams({name:query.trim(),page:`${page+1}.html`}),{$,url}=await this.fetchDocument(`/search/?${params}`),results=this.cards($,url);
    const later=$('a[href*="page="]').toArray().some(el=>Number(new URL(this.pageUrl($(el).attr('href'),url)).searchParams.get('page')?.replace('.html',''))>page+1);
    return {source:this.id,results,nextPage:later?page+1:null};}
  async getManga(value){const url=this.resource(value),cached=this.metadataCache.get(url);if(cached?.expires>Date.now())return {source:this.id,manga:cached.manga};
    const {$}=await this.fetchDocument(url),title=cleanText($('h1.bookinfo-title').first().text());if(!title)throw new ScraperError('Ficha de NovelCool no encontrada.',{code:'EXTRACTION_EMPTY'});
    if(!$('.book-type-manga').length||/\b(?:novela|novel light|light novel)\b/i.test(title))throw new ScraperError('Esta fuente admite cómics, no novelas de texto.',{code:'UNSUPPORTED_OPERATION'});
    const cover=$('.bookinfo-pic img').first().attr('src'),tags=comicTags($('[itemprop="keywords"] a').map((_,e)=>$(e).text()).get());
    const manga={title,url,cover:cover?this.resolveUrl(cover,url):null,...tags,description:cleanText($('.bookinfo-summary [itemprop="description"],.bk-summary-txt').first().text())||null,
      authors:[cleanText($('.bookinfo-author [itemprop="creator"]').first().text())].filter(Boolean),status:$('.bk-going').length?'ongoing':$('.bk-complete').length?'completed':null,language:'es'};
    if(this.metadataCache.size>=100)this.metadataCache.delete(this.metadataCache.keys().next().value);this.metadataCache.set(url,{manga,expires:Date.now()+300000});return {source:this.id,manga};}
  async getChapters(value){const url=this.resource(value),{manga}=await this.getManga(url),{$}=await this.fetchDocument(url),chapters=new Map();
    $('.chapter-item-list a[href*="/chapter/"]').each((_,el)=>{const link=$(el),title=cleanText(link.find('.chapter-item-headtitle').text());if(!title)return;const chapterUrl=this.resource(this.resolveUrl(link.attr('href'),url),true);
      chapters.set(chapterUrl,{title,number:numberOrNull(title.match(/cap[ií]tulo\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1]),url:chapterUrl});});
    if(!chapters.size)throw new ScraperError('Sin capítulos públicos.',{code:'EXTRACTION_EMPTY'});return {source:this.id,manga,chapters:[...chapters.values()]};}
  async getChapterImages(value){const url=this.resource(value,true);let document=await this.fetchDocument(url);
    if(!document.$('img.mangaread-manga-pic').length)throw new ScraperError('Capítulo sin imágenes públicas; puede ser una novela.',{code:'CHAPTER_UNAVAILABLE'});
    // El lector publica la opción de cargar diez imágenes por página. Solo se usa si existe en el HTML.
    if(document.$('.mangaread-pagenav option[value="-10-1.html"]').length)document=await this.fetchDocument(url.replace(/\/$/,'')+'-10-1.html');
    const pages=new Map([[document.url,document]]),targets=[];
    document.$('select.sl-page').first().find('option[value]').each((_,el)=>{const target=this.pageUrl(document.$(el).attr('value'),document.url);if(this.resource(target,true)!==url)throw new ScraperError('Paginación hacia otro capítulo.',{code:'INVALID_RESPONSE'});if(!pages.has(target))targets.push(target);});
    const unique=[...new Set(targets)];if(unique.length+1>this.maxPages)throw new ScraperError('Capítulo incompleto: límite de páginas.',{code:'PAGINATION_LIMIT'});
    let cursor=0;const worker=async()=>{while(cursor<unique.length){const target=unique[cursor++];pages.set(target,await this.fetchDocument(target));}};await Promise.all([worker(),worker()]);
    const ordered=[document,...unique.map(target=>pages.get(target))],images=[],seen=new Set();
    for(const page of ordered){const nodes=page.$('img.mangaread-manga-pic').toArray();if(!nodes.length)throw new ScraperError('Una página del capítulo no tiene imágenes.',{code:'CHAPTER_UNAVAILABLE'});
      for(const el of nodes){const node=page.$(el),imageUrl=this.resolveUrl(node.attr('data-src')??node.attr('src'),page.url),key=new URL(imageUrl).origin+new URL(imageUrl).pathname;
        const image=new URL(imageUrl);if(image.protocol!=='https:'||image.port||!(image.hostname==='img.novelcool.com'||image.hostname==='es.novelcool.com'||image.hostname.endsWith('.movietop.cc')))throw new ScraperError('Servidor de imágenes no verificado.',{code:'CHAPTER_UNAVAILABLE'});
        if(!seen.has(key)){seen.add(key);images.push({index:images.length+1,url:imageUrl,referer:page.url});}}
    }
    return {source:this.id,chapter:{title:cleanText(document.$('.mangaread-title').first().text())||'Capítulo',url},images};}
  async recommend(filters={}){const {$,url}=await this.fetchDocument('/category/popular.html'),cards=this.cards($,url),results=[];if(!cards.length)throw new ScraperError('Catálogo de NovelCool no reconocido.',{code:'EXTRACTION_EMPTY'});
    let cursor=0;const worker=async()=>{while(cursor<Math.min(cards.length,16)){const item=cards[cursor++];try{results.push((await this.getManga(item.url)).manga);}catch(error){if(error.code!=='UNSUPPORTED_OPERATION')throw error;}}};await Promise.all([worker(),worker()]);
    return {source:this.id,results,unavailableTags:[]};}
}
