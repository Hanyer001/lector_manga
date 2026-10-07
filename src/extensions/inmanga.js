import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch, numberOrNull } from './utils.js';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const clean=value=>value.replace(/\s+/g,' ').trim();
export default class InManga extends BaseScraper {
  constructor(options={}){const config=definitionFor('inmanga');super({...config,...options,id:config.id});}
  resource(value,chapter=false){
    const url=this.pageUrl(value),match=new URL(url).pathname.match(new RegExp(chapter?`^/ver/manga/([^/]+)/([0-9]+(?:[.,][0-9]+)?)/(${uuid})/?$`:`^/ver/manga/([^/]+)/(${uuid})/?$`,'i'));
    if(!match)throw new ScraperError('Enlace de InManga inválido.',{code:'INVALID_URL',url});return {url,slug:match[1],id:match.at(-1).toLowerCase()};
  }
  async search(query,{page=0}={}){
    validateSearch(query,page);
    const { $,url }=await this.fetchDocument('/manga/getMangasConsultResult',{form:{'filter[queryString]':query.trim(),'filter[skip]':String(page*20),'filter[take]':'20','filter[generes][]':'-1','filter[sortby]':'0','filter[broadcastStatus]':'0','filter[onlyFavorites]':'false'}});
    if($('title').text().includes('404'))throw new ScraperError('El catálogo de InManga no está disponible.',{code:'INVALID_RESPONSE'});
    const results=[];$('a.manga-result').each((_,el)=>{const card=$(el),title=clean(card.find('h4').first().text()),cover=card.find('img').attr('data-src')??card.find('img').attr('src');
      if(title)results.push({title,url:this.resource(card.attr('href')).url,cover:cover?this.resolveUrl(cover,url):null,language:'es'});});
    return {source:this.id,results,nextPage:results.length===20?page+1:null};
  }
  async getManga(value){
    const {url,id}=this.resource(value),{$}=await this.fetchDocument(url),title=clean($('h1').first().text());
    if(!title||!$('#Identification').val())throw new ScraperError('Ficha de InManga no encontrada.',{code:'EXTRACTION_EMPTY'});
    const cover=$('.manga-index-detail-cover-photo-layout img').attr('src')??$(`img[src*="cdn1.intomanga.com/i/m/${id}/t/"]`).first().attr('src');
    return {source:this.id,manga:{title,url,cover:cover?this.resolveUrl(cover,url):null,description:clean($('.manga-index-sinopsis-detail-cover-photo-layout .panel-body').text())||null,
      status:({'1':'ongoing','2':'completed'})[$('#broadcastStatusInput').val()]??null,language:'es'}};
  }
  async getChapters(value){
    const {id,slug,url}=this.resource(value),{manga}=await this.getManga(url),wrapper=await this.fetchJson(`chapter/getall?mangaIdentification=${id}`);
    let result;try{result=typeof wrapper.data==='string'?JSON.parse(wrapper.data):wrapper.data;}catch{throw new ScraperError('Capítulos de InManga inválidos.',{code:'INVALID_RESPONSE'});}
    if(result?.success!==true||!Array.isArray(result.result))throw new ScraperError('Capítulos de InManga inválidos.',{code:'INVALID_RESPONSE'});
    const chapters=new Map();for(const item of result.result){if(!item.PagesCount||item.IsLocked||item.IsPremium)continue;
      const chapterUrl=this.resource(`/ver/manga/${slug}/${item.FriendlyChapterNumberUrl}/${item.Identification}`,true).url;
      chapters.set(chapterUrl,{title:`Capítulo ${item.Number}${item.Description?` · ${item.Description}`:''}`,number:numberOrNull(item.Number),url:chapterUrl});}
    if(!chapters.size)throw new ScraperError('Sin capítulos públicos.',{code:'EXTRACTION_EMPTY'});return {source:this.id,manga,chapters:[...chapters.values()]};
  }
  async getChapterImages(value){
    const {url,id}=this.resource(value,true),{$}=await this.fetchDocument(url);
    // Lee solo la plantilla de imágenes; no ejecuta scripts de la página.
    const scripts=$('script:not([src])').map((_,el)=>$(el).text()).get().join('\n'),template=scripts.match(/\bvar\s+pu\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if(!template||!template.includes('/identification.'))throw new ScraperError('Plantilla del lector no encontrada.',{code:'CHAPTER_UNAVAILABLE'});
    const parsed=new URL(this.resolveUrl(template,url));
    if(parsed.origin!=='https://cdn1.intomanga.com'||!parsed.pathname.toLowerCase().includes(`/c/${id}/`))throw new ScraperError('Origen o capítulo de imagen no autorizado.',{code:'INVALID_ORIGIN'});
    const { $:controls }=await this.fetchDocument(`chapter/chapterIndexControls?identification=${id}`),images=[];
    controls('#PageList option').each((_,el)=>{const page=controls(el).attr('value');if(new RegExp(`^${uuid}$`,'i').test(page??''))images.push({index:images.length+1,url:this.resolveUrl(template.replace('identification',page),url),referer:url});});
    if(!images.length)throw new ScraperError('Sin imágenes públicas.',{code:'CHAPTER_UNAVAILABLE'});return {source:this.id,chapter:{title:clean($('h1').text())||'Capítulo',url},images};
  }
}
