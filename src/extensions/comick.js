import{BaseScraper}from'../core/BaseScraper.js';
import{ScraperError}from'../core/ScraperError.js';
import{definitionFor}from'./catalog.js';
import{validateSearch}from'./utils.js';
export default class ComicK extends BaseScraper{
 constructor(options={}){super({...definitionFor('comick'),...options});this.cache=new Map();}
 resource(value){const url=this.pageUrl(value),match=new URL(url).pathname.match(/^\/comic\/([a-z0-9-]+)\/?$/i);if(!match)throw new ScraperError('Enlace de ComicK inválido.',{code:'INVALID_URL'});return{slug:match[1],url:new URL('/comic/'+match[1],this.baseUrl).href};}
 manga(row){if(!row?.slug||!row.title||row.media_type&&row.media_type!=='manga')return null;return{title:row.title,url:this.resource('/comic/'+row.slug).url,cover:null,description:row.desc??null,altTitles:(row.md_titles??[]).map(item=>item.title).filter(Boolean),status:({1:'ongoing',2:'completed',3:'cancelled',4:'hiatus'})[row.status]??'unknown',country:row.country?.toUpperCase()??null,contentRating:['erotica','pornographic'].includes(row.content_rating)?'adult':'safe',metadataOnly:true};}
 async search(query,{page=0}={}){validateSearch(query,page);const data=await this.fetchJson('v1.0/search?'+new URLSearchParams({q:query.trim(),page:String(page+1),limit:'24'}));if(!Array.isArray(data))throw new ScraperError('Búsqueda de ComicK inválida.',{code:'INVALID_RESPONSE'});const results=data.map(row=>this.manga(row)).filter(Boolean);for(const manga of results){if(this.cache.size>200)this.cache.delete(this.cache.keys().next().value);this.cache.set(manga.url,{manga,expires:Date.now()+300000});}return{source:this.id,results,nextPage:data.length>=24?page+1:null};}
 async getManga(value){const{url,slug}=this.resource(value),cached=this.cache.get(url);if(cached?.expires>Date.now())return{source:this.id,manga:cached.manga};const result=await this.search(slug.replace(/^\d+-/,'').replaceAll('-',' '));const manga=result.results.find(item=>item.url===url);if(!manga)throw new ScraperError('No se pudo verificar esta ficha de ComicK.',{code:'EXTRACTION_EMPTY'});return{source:this.id,manga};}
 async getChapters(){throw new ScraperError('ComicK: búsqueda de fichas disponible; la API de capítulos respondió HTTP 403. Elige otra fuente de lectura.',{code:'UNSUPPORTED_OPERATION'});}
 async getChapterImages(){return this.getChapters();}
}
