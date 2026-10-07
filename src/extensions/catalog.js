import { ScraperError } from '../core/ScraperError.js';
import { createGate, runOperation, operationContext } from '../core/operation.js';

// Registro único: identidad, política de red y cargador de cada fuente.
export const sourceDefinitions = [
  {
    id: 'sitio-ejemplo', name: 'Sitio de ejemplo', demo: true,
    baseUrl: 'https://example.com/', imageOrigins: ['https://example.com', 'https://cdn.example.com'],
    capabilities: { search: false, manga: true, chapters: true, images: true },
    load: () => import('./sitioEjemplo.js')
  },
  {
    id: 'manhwaweb', name: 'ManhwaWeb', baseUrl: 'https://manhwaweb.com/', languages: ['es'],
    pageOrigins: ['https://manhwaweb.com', 'https://www.manhwaweb.com'],
    apiBaseUrl: 'https://manhwawebbackend-production.up.railway.app/',
    imageOrigins: ['https://manhwaweb.com', 'https://img1mw.xyz', 'https://img2mw.xyz',
      'https://imagizer.imageshack.com', 'https://ccdn.lezhin.com'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true, adult: true },
    load: () => import('./manhwaweb.js')
  },
  {
    id: 'mangadex', name: 'MangaDex', baseUrl: 'https://mangadex.org/', languages: ['es', 'es-la'],
    pageOrigins: ['https://mangadex.org', 'https://www.mangadex.org'],
    apiBaseUrl: 'https://api.mangadex.org/', imageOrigins: ['https://uploads.mangadex.org'],
    imageHostSuffixes: ['mangadex.network'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true, adult: true },
    load: () => import('./mangadex.js')
  },
  {
    id: 'webtoon', name: 'WEBTOON Español', baseUrl: 'https://www.webtoons.com/', languages: ['es'],
    imageOrigins: ['https://webtoon-phinf.pstatic.net', 'https://swebtoon-phinf.pstatic.net'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true },
    note: 'Episodios publicados y accesibles en la web.', load: () => import('./webtoon.js')
  },
  {
    id: 'olympus', name: 'Olympus', baseUrl: 'https://olympusxyz.com/', languages: ['es'],
    apiBaseUrl: 'https://olympusxyz.com/', apiOrigins: ['https://panel.olympusxyz.com'], imageOrigins: ['https://media.imagesolymp.xyz'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true },
    note: 'Cómics públicos en español. No incluye novelas.', load: () => import('./olympus.js')
  },
  {
    id: 'inmanga', name: 'InManga', baseUrl: 'https://inmanga.com/', languages: ['es'],
    apiBaseUrl: 'https://inmanga.com/', imageOrigins: ['https://cdn1.intomanga.com'],
    capabilities: { search: true, manga: true, chapters: true, images: true },
    note: 'Búsqueda y capítulos públicos en español.', load: () => import('./inmanga.js')
  },
  {
    id: 'novelcool', name: 'NovelCool Español', baseUrl: 'https://es.novelcool.com/', languages: ['es'],
    recommendationCatalogOnly: true,
    imageOrigins: ['https://img.novelcool.com', 'https://es.novelcool.com'], imageHostSuffixes: ['movietop.cc'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true },
    note: 'Cómics en español. Recorre todas las páginas de cada capítulo; excluye novelas de texto.', load: () => import('./novelcool.js')
  },
  {
    id: 'tumanga', name: 'TuManga.net', baseUrl: 'https://tumanga.net/', languages: ['es'],
    recommendationCatalogOnly: true,
    imageOrigins: ['https://tumanga.net'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true },
    note: 'Catálogo independiente de zonatmo.com. Capítulos públicos sin sesión.', load: () => import('./tumanga.js')
  },
  {
    id: 'tmo', name: 'ZonaTMO', baseUrl: 'https://zonatmo.org/', languages: ['es'],
    unavailableIn: {render:'ZonaTMO rechaza las consultas desde Render con HTTP 403. El adaptador está disponible al ejecutar el servidor localmente.'},
    recommendationCatalogOnly: true,
    imageOrigins: ['https://zonatmo.org', 'https://storage.zonatmo.org', 'https://storage2.zonatmo.org'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true },
    note: 'Dominio zonatmo.org. Solo capítulos públicos; algunas obras siguen en restauración.', load: () => import('./zonatmo.js')
  },
  {
    id: 'senshimanga', name: 'SenshiManga · Capibara', baseUrl: 'https://capibaratraductor.com/senshimanga', languages: ['es'],
    apiBaseUrl: 'https://capibaratraductor.com/', recommendationCatalogOnly: true,
    imageOrigins: ['https://r2.capibaratraductor.com'],
    capabilities: { search: true, manga: true, chapters: true, images: true, recommend: true },
    note: 'Catálogo del grupo SenshiManga. Solo cómics públicos; no incluye capítulos de suscripción.', load: () => import('./senshimanga.js')
  },
  {
    id: 'asura', name: 'Asura Scans', baseUrl: 'https://asurascans.com/', languages: ['en'],
    imageOrigins: ['https://cdn.asurascans.com'],
    capabilities: { search: true, manga: true, chapters: true, images: true },
    note: 'El dominio indicado publica en inglés. Solo capítulos públicos.', load: () => import('./asura.js')
  },
  {
    id: 'tapas', name: 'Tapas', baseUrl: 'https://tapas.io/', apiBaseUrl: 'https://tapas.io/',
    imageOrigins: ['https://us-a.tapas.io', 'https://us-b.tapas.io'], imageHostSuffixes: ['tapas.io'],
    capabilities: { search: true, manga: true, chapters: true, images: true },
    note: 'Solo episodios gratuitos sin sesión. El idioma depende de cada obra.', load: () => import('./tapas.js')
  },
  ...[
    ['manhwa-latino', 'Manhwa Latino', 'https://manhwa-latino.com/', 'Acceso no verificado: HTTP 403 de Cloudflare y dominio bloqueado por la política de seguridad del navegador.'],
    ['yugen', 'YugenMangas', 'https://yugenmangas.lat/', 'No se pudo verificar una conexión segura con este dominio.'],
    ['bato', 'Bato.to', 'https://bato.to/', 'El dominio redirige a un aviso de cierre.'],
    ['lectormanga', 'LectorManga', 'https://lectormanga.com/', 'Se necesita confirmar el dominio activo de esta fuente.'],
    ['mangaplus', 'MANGA Plus', 'https://mangaplus.shueisha.co.jp/', 'Su API rechazó el acceso desde esta conexión; adaptador pendiente.'],
    ['mango', 'Mango Manga', 'https://mangomanga.co/', 'La página indicada promociona una aplicación y no expone un lector web.']
  ].map(([id, name, baseUrl, reason]) => ({ id, name, baseUrl, enabled: false, reason,
    capabilities: { search: false, manga: false, chapters: false, images: false } }))
];

export function definitionFor(id, definitions = sourceDefinitions) {
  const definition = definitions.find(source => source.id === id);
  if (!definition) throw new ScraperError('Extensión desconocida.', { code: 'UNKNOWN_SOURCE' });
  return definition;
}

// Carga diferida: un error de importación afecta solo a la fuente solicitada.
export async function createScraper(id, options = {}, definitions = sourceDefinitions) {
  const definition = definitionFor(id, definitions);
  if (definition.enabled === false) throw new ScraperError(definition.reason, { code: 'SOURCE_UNAVAILABLE' });
  try {
    const { default: Extension } = await definition.load();
    return new Extension({ ...definition, ...options });
  } catch (cause) {
    throw new ScraperError(`No se pudo cargar la extensión ${definition.name}.`, {
      code: 'SOURCE_LOAD_ERROR', cause
    });
  }
}

export function createSources(definitions = sourceDefinitions, {environment = process.env.RENDER === 'true' ? 'render' : 'local'} = {}) {
  const runtimeDefinitions=definitions.map(definition=>definition.unavailableIn?.[environment]?{...definition,enabled:false,reason:definition.unavailableIn[environment]}:definition);
  return new Map(runtimeDefinitions.map(definition => {
    let instance;
    const enter = createGate(definition.transport === 'browser' ? 1 : 2);
    const get = () => instance ??= createScraper(definition.id, {}, runtimeDefinitions).catch(error => {
      instance = undefined;
      throw error;
    });
    const scraper = Object.fromEntries(['search', 'getManga', 'getChapters', 'getChapterImages', 'recommend'].map(method =>
      [method, async (...args) => runOperation(async () => {
        const release = await enter(operationContext().signal);
        try { return await (await get())[method](...args); }
        finally { release(); }
      }, { signal: operationContext()?.signal, timeoutMs: definition.operationTimeoutMs ?? 45000 })]));
    return [definition.id, { ...definition, pageOrigin: new URL(definition.baseUrl).origin,
      pageOrigins: definition.pageOrigins ?? [new URL(definition.baseUrl).origin],
      imageOrigins: definition.imageOrigins ?? [], userAgent: 'PersonalMangaReader/0.1', scraper }];
  }));
}

export function publicSource(id, source) {
  return { id, name: source.name ?? id, baseUrl: source.baseUrl ?? `${source.pageOrigin}/`,
    pageOrigins: source.pageOrigins ?? [source.pageOrigin], demo: Boolean(source.demo),
    enabled: source.enabled !== false, reason: source.reason ?? null, note: source.note ?? null,
    languages: source.languages ?? [],
    transport: source.transport ?? (source.apiBaseUrl ? 'api' : 'html'),
    capabilities: source.capabilities ?? { search: false, manga: false, chapters: true, images: true } };
}
