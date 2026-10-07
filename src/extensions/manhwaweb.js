import { BaseScraper } from '../core/BaseScraper.js';
import { ScraperError } from '../core/ScraperError.js';
import { definitionFor } from './catalog.js';
import { validateSearch, numberOrNull } from './utils.js';
import { tagKey } from '../frontend/discovery-core.js';
import { genreKeys } from '../frontend/discovery-tags.js';

// IDs publicados por la biblioteca de ManhwaWeb, también usados en sus fichas.
const categories = new Map([[3,'Acción'],[29,'Aventura'],[18,'Comedia'],[1,'Drama'],[42,'Vida cotidiana'],[2,'Romance'],[5,'Venganza'],[6,'Harem'],[23,'Fantasía'],[31,'Sobrenatural'],[25,'Tragedia'],[43,'Psicológico'],[32,'Terror'],[44,'Suspenso'],[28,'Historias cortas'],[30,'Ecchi'],[34,'Gore'],[27,'Girls Love'],[45,'Boys Love'],[41,'Reencarnación'],[37,'Sistema de niveles'],[33,'Ciencia ficción'],[38,'Apocalíptico'],[39,'Artes marciales'],[40,'Superpoderes'],[35,'Cultivación']]);
function names(values) {
  if(!Array.isArray(values))return [];
  const labels=values.flatMap(value=>{
    if(typeof value==='number')return categories.get(value)??[];
    if(typeof value==='string')return value.split(/\s*\|\s*/);
    if(!value||typeof value!=='object')return [];
    const name=value.name??value._name??value.nombre;
    if(typeof name==='string')return [name];
    return Object.entries(value).filter(([key,label])=>/^\d+$/.test(key)&&typeof label==='string').map(([,label])=>label);
  });
  return [...new Set(labels.map(value=>value.trim()).filter(Boolean))].slice(0,30);
}

export default class ManhwaWeb extends BaseScraper {
  constructor(options = {}) {
    const config = definitionFor('manhwaweb');
    super({ ...config, ...options, id: config.id });
  }

  resource(value, kind) {
    const url = this.pageUrl(value);
    const pattern = kind === 'manga' ? /^\/(?:manhwa|manga)\/([^/]+)\/?$/ : /^\/(?:leer|leer_18)\/([^/]+)\/?$/;
    const match = new URL(url).pathname.match(pattern);
    if (!match) throw new ScraperError('Enlace de ManhwaWeb no reconocido.', { code: 'INVALID_URL', url });
    const id = decodeURIComponent(match[1]);
    if (!id || id.length > 500 || /[\/\x00-\x20]/.test(id)) throw new ScraperError('Identificador inválido.', { code: 'INVALID_URL', url });
    return { id, url: new URL(`/${kind === 'manga' ? 'manhwa' : 'leer'}/${encodeURIComponent(id)}`, this.baseUrl).href };
  }

  manga(data, fallbackId) {
    if (!data || typeof data !== 'object') throw new ScraperError('Ficha de ManhwaWeb inválida.', { code: 'INVALID_RESPONSE' });
    const id = data.real_id ?? data._id ?? fallbackId;
    const title = (data.name_esp || data.the_real_name || data._name || '').trim();
    if (!id || !title) throw new ScraperError('La ficha no contiene título o identificador.', { code: 'INVALID_RESPONSE' });
    const tags=names(data._categoris);
    return { title, url: new URL(`/manhwa/${encodeURIComponent(id)}`, this.baseUrl).href,
      cover: data._imagen ? this.resolveUrl(data._imagen) : null,
      description: data._sinopsis?.trim() || null,
      contentRating: data._erotico === 'si' ? 'adult' : 'safe',
      genres:tags.filter(tag=>genreKeys.has(tagKey(tag))),themes:tags.filter(tag=>!genreKeys.has(tagKey(tag))),
      authors:names(data.autor),altTitles:names(data.others_name),
      country:({manhwa:'KR',manga:'JP',manhua:'CN'})[data._tipo]??null,
      status:({publicandose:'ongoing',finalizado:'completed',pausado:'hiatus',cancelado:'cancelled'})[data._status]??data._status??null,language:'es' };
  }

  async search(query, { page = 0, adult = false } = {}) {
    validateSearch(query, page);
    const params = new URLSearchParams({ buscar: query.trim(), page, estado: '', tipo: '', erotico: adult ? 'si' : 'no',
      demografia: '', order_item: 'alfabetico', order_dir: 'asc', generes: '' });
    const data = await this.fetchJson(`manhwa/library?${params}`);
    if (!Array.isArray(data.data)) throw new ScraperError('Resultados de ManhwaWeb inválidos.', { code: 'INVALID_RESPONSE' });
    return { source: this.id, results: data.data.map(item => this.manga(item)),
      nextPage: data.next === true ? page + 1 : null };
  }

  async getManga(mangaUrl) {
    const { id } = this.resource(mangaUrl, 'manga');
    const data = await this.fetchJson(`manhwa/see/${encodeURIComponent(id)}`);
    return { source: this.id, manga: this.manga(data, id) };
  }

  async recommend(filters={}) {
    const selected=[...(filters.genres??[]),...(filters.themes??[])];
    const ids=selected.map(tag=>[...categories].find(([,label])=>tagKey(label)===tagKey(tag))?.[0]);
    const unavailableTags=selected.filter((_,index)=>ids[index]===undefined);
    if(unavailableTags.length)return {source:this.id,results:[],unavailableTags};
    const params=new URLSearchParams({buscar:'',page:String(filters.page??0),estado:({ongoing:'publicandose',completed:'finalizado',hiatus:'pausado',cancelled:'cancelado'})[filters.status]??'',
      tipo:({KR:'manhwa',JP:'manga',CN:'manhua'})[filters.country]??'',erotico:filters.adult?'si':'no',demografia:'',order_item:'popularidad',order_dir:'desc',generes:ids.join('a')});
    const data=await this.fetchJson(`manhwa/library?${params}`);
    if(!Array.isArray(data.data))throw new ScraperError('Catálogo de ManhwaWeb inválido.',{code:'INVALID_RESPONSE'});
    return {source:this.id,results:data.data.filter(item=>filters.adult?item._erotico==='si':item._erotico!=='si').map(item=>this.manga(item)),nextPage:data.next===true?(filters.page??0)+1:null,unavailableTags:[]};
  }

  async getChapters(mangaUrl) {
    const { id, url } = this.resource(mangaUrl, 'manga');
    const data = await this.fetchJson(`manhwa/see/${encodeURIComponent(id)}`);
    if (!Array.isArray(data.chapters)) throw new ScraperError('Lista de capítulos inválida.', { code: 'INVALID_RESPONSE', url });
    const chapters = [];
    const seen = new Set();
    for (const item of data.chapters) {
      const versions = item.versions?.length ? item.versions : [item];
      for (const version of versions) {
        if (!version.link) continue;
        let chapterUrl;
        try { chapterUrl = this.resource(version.link, 'chapter').url; }
        catch (error) { if (['INVALID_URL', 'INVALID_ORIGIN'].includes(error.code)) continue; throw error; }
        if (seen.has(chapterUrl)) continue;
        seen.add(chapterUrl);
        const number = numberOrNull(item.chapter);
        const group = version.joint?.map(group => group.name).filter(Boolean).join(', ');
        chapters.push({ title: `Capítulo ${item.chapter ?? 'extra'}${group ? ` · ${group}` : ''}`, number, url: chapterUrl });
      }
    }
    if (!chapters.length) throw new ScraperError('Esta serie no tiene capítulos públicos alojados en ManhwaWeb.', { code: 'EXTRACTION_EMPTY', url });
    return { source: this.id, manga: this.manga(data, id), chapters };
  }

  async getChapterImages(chapterUrl) {
    const { id, url } = this.resource(chapterUrl, 'chapter');
    const data = await this.fetchJson(`chapters/see/${encodeURIComponent(id)}`);
    if (!Array.isArray(data.chapter?.img)) throw new ScraperError('Respuesta de imágenes inválida.', { code: 'INVALID_RESPONSE', url });
    // Algunas listas públicas terminan con una entrada vacía; no es una página del capítulo.
    const images = [...new Set(data.chapter.img.filter(image => image != null && (typeof image !== 'string' || image.trim())).map(image => this.resolveUrl(image, url)))].map((image, index) =>
      ({ index: index + 1, url: image, referer: url }));
    if (!images.length) throw new ScraperError('El capítulo no tiene imágenes públicas.', { code: 'EXTRACTION_EMPTY', url });
    return { source: this.id, chapter: { title: `Capítulo ${data.chapter.chapter ?? ''} · ${data.name ?? ''}`.trim(), url }, images };
  }
}
