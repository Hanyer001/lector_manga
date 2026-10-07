import {BaseScraper} from '../core/BaseScraper.js';
import {ScraperError} from '../core/ScraperError.js';
import {definitionFor} from './catalog.js';
import {validateSearch,numberOrNull} from './utils.js';
import {comicTags,cleanText} from './comic-metadata.js';
import {normalizeTag} from '../frontend/discovery-core.js';
import {load} from 'cheerio';
import {operationContext} from '../core/operation.js';
const fail=(message,code='INVALID_RESPONSE')=>new ScraperError(message,{code});

// Astro publica datos tipados como JSON en el HTML. Se decodifican sin ejecutar scripts.
export function decodeSenshiProps(value,depth=0){
  if(depth>64||!Array.isArray(value)||value.length!==2)throw fail('Datos de SenshiManga inválidos.');
  const [type,data]=value;if(type===1&&Array.isArray(data))return data.map(item=>decodeSenshiProps(item,depth+1));
  if(type===0){if(data&&typeof data==='object'&&!Array.isArray(data))return Object.fromEntries(Object.entries(data).map(([key,item])=>[key,decodeSenshiProps(item,depth+1)]));if(data===null||['string','number','boolean'].includes(typeof data))return data;}
  throw fail('Tipo de datos de SenshiManga no reconocido.');
}
export default class SenshiManga extends BaseScraper {
  constructor(options={}){const config=definitionFor('senshimanga'),fetchImpl=options.fetchImpl??globalThis.fetch;super({...config,...options,id:config.id,fetchImpl:(url,request)=>fetchImpl(url,{...request,headers:{...request.headers,'X-Organization':'senshimanga'}})});this.cache=new Map();this.catalog=null;this.catalogLoading=null;this.maxCatalogPages=options.maxCatalogPages??10;}
  // El sitio declara UTF-8 después del primer KB y omite charset en las cabeceras.
  async fetchDocument(input,options={}){const {buffer,url}=await this.fetchContent(input,{...options,signal:operationContext()?.signal});return {$:load(buffer.toString('utf8')),url};}
  resource(value,chapter=false){const url=new URL(this.pageUrl(value)),pattern=chapter?/^\/senshimanga\/manga\/([a-z0-9-]+)\/chapters\/(\d+(?:\.\d+)?)\/?$/i:/^\/senshimanga\/manga\/([a-z0-9-]+)\/?$/i;if(!pattern.test(url.pathname))throw fail('Enlace de SenshiManga inválido.','INVALID_URL');url.search='';return url.href;}
  image(value){const url=new URL(this.resolveUrl(value));if(url.protocol!=='https:'||url.port||!definitionFor(this.id).imageOrigins.includes(url.origin))throw fail('Alojamiento de SenshiManga no verificado.','INVALID_ORIGIN');return url.href;}
  props($,chapter=false){let result;for(const el of $('astro-island[props]').toArray()){let raw;try{raw=JSON.parse($(el).attr('props'));}catch{throw fail('JSON de SenshiManga inválido.');}if(!Object.hasOwn(raw,'manga')||chapter&&!Object.hasOwn(raw,'chapter'))continue;result=Object.fromEntries(Object.entries(raw).map(([key,item])=>[key,decodeSenshiProps(item)]));break;}
    if(!result?.manga||result.organization?.slug!=='senshimanga')throw fail('Ficha de SenshiManga no encontrada.','EXTRACTION_EMPTY');return result;
  }
  metadata(row,url){const core=row.manga??{},type=core.bookType?.code??row.workType;
    if(/novel|writing|lightnovel|novela/i.test(type??''))throw fail('SenshiManga admite aquí cómics, no novelas de texto.','UNSUPPORTED_OPERATION');
    const title=cleanText(row.title);if(!title)throw fail('Título de SenshiManga inválido.');
    const tags=comicTags([...(row.genres??[]).map(tag=>typeof tag==='string'?tag:tag.name??tag.genre?.name),core.demography?.name].filter(Boolean));
    const cover=row.imageUrl??core.imageUrl;let image=null;try{if(cover)image=this.image(cover);}catch{/* Mantiene la ficha sin admitir un host desconocido. */}
    return {title,url,cover:image,description:cleanText(row.description??core.description??row.shortDescription)||null,...tags,contentRating:row.isNSFW?'adult':tags.contentRating,
      authors:(core.authors??[]).map(author=>cleanText(author.name)).filter(Boolean),altTitles:[cleanText(row.alternativeTitle)].filter(Boolean),country:({manga:'JP',manhwa:'KR',manhua:'CN'})[type]??null,status:['ongoing','completed','hiatus','cancelled'].includes(row.status)?row.status:null,language:'es'};
  }
  async details(value){const url=this.resource(value),cached=this.cache.get(url);if(cached?.expires>Date.now())return cached.data;const {$}=await this.fetchDocument(url),data=this.props($);
    if(this.cache.size>=20&&!this.cache.has(url))this.cache.delete(this.cache.keys().next().value);this.cache.set(url,{data,expires:Date.now()+300000});return data;
  }
  async getManga(value){const url=this.resource(value),data=await this.details(url);return {source:this.id,manga:this.metadata(data.manga,url)};}
  async getChapters(value){const url=this.resource(value),data=await this.details(url),row=data.manga;
    if(row.requireLogin||row.loggedInOnly||row.isPublic===false||row.visibility&&row.visibility!=='public')throw fail('Esta obra requiere acceso desde la fuente.','CHAPTER_UNAVAILABLE');
    if(!Array.isArray(row.chapters))throw fail('Lista de capítulos no reconocida.');const chapters=new Map();
    for(const chapter of row.chapters){const number=numberOrNull(chapter.number);if(chapter.isUnreleased||chapter.deletedAt||chapter.hasAccess===false||chapter.releasedAt&&Date.parse(chapter.releasedAt)>Date.now()||number===null||number<0)continue;
      const chapterUrl=this.resource(url.replace(/\/$/,'')+'/chapters/'+number,true),title=`Capítulo ${number}${chapter.title?' · '+cleanText(chapter.title):''}`;chapters.set(chapterUrl,{title,number,url:chapterUrl});}
    if(!chapters.size)throw fail('Sin capítulos públicos publicados.','EXTRACTION_EMPTY');return {source:this.id,manga:this.metadata(row,url),chapters:[...chapters.values()]};
  }
  async getChapterImages(value){const url=this.resource(value,true),{$}=await this.fetchDocument(url),data=this.props($,true),chapter=data.chapter;
    if(data.hasAccess!==true||chapter?.hasAccess!==true||chapter.isUnreleased||chapter.deletedAt)throw fail('Capítulo restringido o no publicado.','CHAPTER_UNAVAILABLE');
    const [,slug,number]=new URL(url).pathname.match(/\/manga\/([^/]+)\/chapters\/([^/]+)\/?$/);if(Number(chapter.number)!==Number(number))throw fail('El lector devolvió otro capítulo.');
    const response=await this.fetchJson(`/api/manga-custom/${encodeURIComponent(slug)}/chapter/${number}/pages`),pages=response?.status===true?response.data:null;
    if(!Array.isArray(pages)||!pages.length)throw fail('Capítulo sin imágenes públicas.','CHAPTER_UNAVAILABLE');
    const ordered=pages.slice().sort((a,b)=>a.number-b.number);if(ordered.some((page,index)=>!Number.isSafeInteger(page.number)||page.number!==index+1||Number(page.chapterId)!==Number(chapter.id)))throw fail('Páginas incompletas o de otro capítulo.');
    return {source:this.id,chapter:{title:`Capítulo ${number}${chapter.title?' · '+cleanText(chapter.title):''}`,url},images:ordered.map((page,index)=>({index:index+1,url:this.image(page.imageUrl),referer:url}))};
  }
  async catalogRows(){if(this.catalog?.expires>Date.now())return this.catalog.rows;if(this.catalogLoading)return this.catalogLoading;
    this.catalogLoading=(async()=>{const rows=new Map();let maxPage=1;for(let page=1;page<=maxPage;page++){
      const response=await this.fetchJson(`/api/manga-custom?order=popular&limit=100&page=${page}&nsfw=false&contentKind=manga`),data=response?.status===true?response.data:null;
      if(!Array.isArray(data?.items)||!Number.isSafeInteger(data.maxPage)||data.maxPage<1)throw fail('Catálogo de SenshiManga no reconocido.');maxPage=data.maxPage;if(maxPage>this.maxCatalogPages)throw fail('Catálogo incompleto: límite de páginas.','PAGINATION_LIMIT');
      let added=0;for(const row of data.items){if(row.organization?.slug!=='senshimanga'||row.isNSFW||row.isPublic===false||row.visibility&&row.visibility!=='public'||row.requireLogin||row.loggedInOnly)continue;
        const slug=row.slug??row.manga?.slug??String(row.id),url=this.resource(`/senshimanga/manga/${slug}`);try{const manga=this.metadata(row,url);if(!rows.has(url))added++;rows.set(url,manga);}catch(error){if(error.code!=='UNSUPPORTED_OPERATION')throw error;}}
      if(page>1&&!added)throw fail('La paginación de SenshiManga no avanza.');
    }const result=[...rows.values()];this.catalog={rows:result,expires:Date.now()+300000};return result;})().finally(()=>{this.catalogLoading=null;});return this.catalogLoading;
  }
  async search(query,{page=0}={}){validateSearch(query,page);const key=normalizeTag(query),rows=(await this.catalogRows()).filter(row=>[row.title,...row.altTitles].some(title=>normalizeTag(title).includes(key))),offset=page*24;return {source:this.id,results:rows.slice(offset,offset+24),nextPage:offset+24<rows.length?page+1:null};}
  async recommend({page=0}={}){validateSearch('catálogo',page);const rows=await this.catalogRows(),offset=page*24,results=rows.slice(offset,offset+24);return {source:this.id,results,nextPage:offset+24<rows.length?page+1:null,warnings:results.some(row=>!row.genres.length)?['SenshiManga no declara géneros en algunas fichas; no se les atribuyen etiquetas por su título.']:[]};}
}
