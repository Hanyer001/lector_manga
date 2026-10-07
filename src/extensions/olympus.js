import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch, numberOrNull } from './utils.js';
import { normalizeTag, tagKey } from '../frontend/discovery-core.js';
import { genreKeys } from '../frontend/discovery-tags.js';

export default class Olympus extends BaseScraper {
  constructor(options={}){const config=definitionFor('olympus');super({...config,...options,id:config.id});this.metadataCache=new Map();}
  resource(value,chapter=false){
    const url=this.pageUrl(value),match=new URL(url).pathname.match(chapter?/^\/capitulo\/([1-9]\d*)\/comic-([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/:/^\/series\/comic-([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
    if(!match)throw new ScraperError('Enlace de cómic de Olympus inválido.',{code:'INVALID_URL',url});
    return {url:new URL(chapter?`/capitulo/${match[1]}/comic-${match[2]}`:`/series/comic-${match[1]}`,this.baseUrl).href,slug:chapter?match[2]:match[1],id:chapter?match[1]:null};
  }
  manga(data){
    if(!data?.slug||!data.name||data.type&&data.type!=='comic')throw new ScraperError('Ficha de Olympus inválida.',{code:'INVALID_RESPONSE'});
    const tags=(data.genres??[]).map(tag=>tag.name?.trim()).filter(Boolean);
    return {title:data.name.trim(),url:this.resource(`/series/comic-${data.slug}`).url,cover:data.cover?this.resolveUrl(data.cover):null,
      description:data.summary??null,genres:tags.filter(tag=>genreKeys.has(tagKey(tag))),themes:tags.filter(tag=>!genreKeys.has(tagKey(tag))),
      status:({1:'ongoing',3:'hiatus',4:'completed',5:'cancelled'})[data.status?.id]??null,language:'es'};
  }
  async search(query,{page=0}={}){
    validateSearch(query,page);
    if(!this.listCache||this.listCache.expires<Date.now()){
      const result=await this.fetchJson('api/series/list');if(!Array.isArray(result.data))throw new ScraperError('Índice de Olympus inválido.',{code:'INVALID_RESPONSE'});
      this.listCache={expires:Date.now()+300000,items:result.data.filter(item=>item.type==='comic')};
    }
    const matches=this.listCache.items.filter(item=>normalizeTag(item.name).includes(normalizeTag(query))),start=page*24;
    return {source:this.id,results:matches.slice(start,start+24).map(item=>this.manga(item)),nextPage:start+24<matches.length?page+1:null};
  }
  async getManga(value){
    const {slug,url}=this.resource(value),cached=this.metadataCache.get(url);
    if(cached&&cached.expires>Date.now())return {source:this.id,manga:cached.manga};
    const result=await this.fetchJson(`api/series/${slug}?type=comic`),manga=this.manga(result.data);
    if(this.metadataCache.size>=200)this.metadataCache.delete(this.metadataCache.keys().next().value);
    this.metadataCache.set(url,{manga,expires:Date.now()+300000});return {source:this.id,manga};
  }
  async getChapters(value){
    const {slug,url}=this.resource(value),{manga}=await this.getManga(url),chapters=new Map();
    for(let page=1;page<=200;page++){
      const result=await this.fetchJson(`https://panel.olympusxyz.com/api/series/${slug}/chapters?type=comic&page=${page}&direction=asc`);
      if(!Array.isArray(result.data)||!result.meta)throw new ScraperError('Lista de capítulos de Olympus inválida.',{code:'INVALID_RESPONSE'});
      const before=chapters.size;
      for(const item of result.data){if(item.is_locked||item.locked||item.is_premium||item.available===false)continue;
        const chapterUrl=this.resource(`/capitulo/${item.id}/comic-${slug}`,true).url;
        chapters.set(chapterUrl,{title:`Capítulo ${item.name}${item.title?` · ${item.title}`:''}`,number:numberOrNull(item.name),url:chapterUrl});}
      if(Number(result.meta.current_page)!==page)throw new ScraperError('La paginación de Olympus no avanzó.',{code:'INVALID_RESPONSE'});
      if(page>=Number(result.meta.last_page)){if(!chapters.size)throw new ScraperError('Sin capítulos públicos.',{code:'EXTRACTION_EMPTY'});return {source:this.id,manga,chapters:[...chapters.values()]};}
      if(chapters.size===before)throw new ScraperError('La paginación no avanzó.',{code:'INVALID_RESPONSE'});
    }
    throw new ScraperError('Lista incompleta: límite de páginas.',{code:'PAGINATION_LIMIT'});
  }
  async getChapterImages(value){
    const {slug,id,url}=this.resource(value,true),result=await this.fetchJson(`api/capitulo/${slug}/${id}?type=comic`);
    if(!Array.isArray(result.chapter?.pages)||!result.chapter.pages.length)throw new ScraperError('Este capítulo no tiene imágenes públicas.',{code:'CHAPTER_UNAVAILABLE'});
    const images=result.chapter.pages.map((page,index)=>({index:index+1,url:this.resolveUrl(page,url),referer:url}));
    if(images.some(image=>new URL(image.url).origin!=='https://media.imagesolymp.xyz'))throw new ScraperError('Olympus no ofreció imágenes del capítulo.',{code:'CHAPTER_UNAVAILABLE'});
    return {source:this.id,chapter:{title:`Capítulo ${result.chapter.name}`,url},images};
  }
  async recommend(filters={}){
    if(!this.tagsCache||this.tagsCache.expires<Date.now()){const tags=await this.fetchJson('api/genres-statuses');if(!Array.isArray(tags.genres))throw new ScraperError('Etiquetas de Olympus inválidas.',{code:'INVALID_RESPONSE'});this.tagsCache={tags:tags.genres,expires:Date.now()+3600000};}
    const selected=[...(filters.genres??[]),...(filters.themes??[])],ids=selected.map(tag=>this.tagsCache.tags.find(item=>tagKey(item.name)===tagKey(tag))?.id),unavailableTags=selected.filter((_,i)=>ids[i]===undefined);
    if(unavailableTags.length)return {source:this.id,results:[],unavailableTags};
    const params=new URLSearchParams({type:'comic',page:'1',direction:'desc'});
    if(ids.length)params.set('genres',String(ids[0]));
    let items;
    if(ids.length){const data=await this.fetchJson(`api/series?${params}`);items=data.data?.series?.data;}
    else{const data=await this.fetchJson('api/homepage');items=data.data?.popular_comics;}
    if(typeof items==='string')try{items=JSON.parse(items);}catch{items=null;}
    if(!Array.isArray(items))throw new ScraperError('Recomendaciones de Olympus inválidas.',{code:'INVALID_RESPONSE'});
    // Las fichas aportan todas las etiquetas para aplicar inclusiones y exclusiones reales.
    const results=[];let cursor=0;
    const worker=async()=>{while(cursor<Math.min(items.length,16)){const item=items[cursor++];results.push((await this.getManga(this.manga(item).url)).manga);}};
    await Promise.all([worker(),worker()]);return {source:this.id,results,unavailableTags:[]};
  }
}
