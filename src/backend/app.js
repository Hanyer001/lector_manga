import express from 'express';
import { runOperation, cancellationError } from '../core/operation.js';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors.js';
import { createImageTickets } from './imageTickets.js';
import { createImageProxy } from './imageProxy.js';
import { mountDiscovery } from './discovery.js';
import { createPrivateAccess } from './privacy.js';
import { isAdult } from '../frontend/content-policy.js';
import { publicSource } from '../extensions/catalog.js';
import { createAccountContext } from './account-context.js';
import { mountVault } from './vault.js';
import {guestResources} from './guest.js';
import { sources as defaultSources, sourceFor, allowedPageUrl, allowedImageUrl,
  detectSource, listSources } from './sources.js';

export function createApp({ database: localDatabase, sources = defaultSources, tickets = createImageTickets(), cloudStore,
  apiOrigin, publicConfig = { mode: 'local', apiBase: '' }, frontendOrigins = [], proxyOptions = {}, discoveryOptions = {}, logger = console, operationTimeoutMs = 45000 }) {
  const app = express();
  const accounts = createAccountContext({ localDatabase, store: cloudStore, tickets, privateAccess: () => privateAccess });
  const database = cloudStore ? accounts.database : localDatabase;
  const encryptedPrivate = Boolean(cloudStore && publicConfig.privateEncryption === 'e2ee');
  if (cloudStore) app.set('trust proxy', 1);
  const privateAccess = createPrivateAccess(database);
  const diagnostics = new Map();
  const withCover = (item, source, referer) => {
    if (!item.cover && !item.portada) return { ...item, coverUrl: null };
    try {
      const url = allowedImageUrl(item.cover ?? item.portada, source);
      const signedCover = original => (database.ownerId==='guest'?'/api/guest/image?ticket=':'/api/image?ticket=') + encodeURIComponent(tickets.issue({ source: item.source ?? source.id,
        url: allowedImageUrl(original, source), referer: allowedPageUrl(referer, source), seriesId: item.serie_id ?? (item.url_origen ? item.id : null), ...(cloudStore ? { ownerId: database.ownerId, libraryUrl: allowedPageUrl(referer, source) } : {}) }));
      const dexCover = new URL(url).hostname === 'uploads.mangadex.org' && /\.(256|512)\.jpg$/.test(url);
      const coverVariants = dexCover ? [256,512].map(width => ({ width,url:signedCover(url.replace(/\.(256|512)\.jpg$/,`.${width}.jpg`)) })) : [];
      return { ...item, coverKey: (item.source??source.id)+'|'+url, coverUrl: signedCover(dexCover ? url.replace(/\.512\.jpg$/,'.256.jpg') : url), coverVariants };
    } catch { return { ...item, coverUrl: null }; }
  };
  const consult = async (req, source, method, ...args) => {
    const id = source.id ?? [...sources].find(([, value]) => value === source)?.[0];
    const started = Date.now();
    try {
      const result = await runOperation(() => source.scraper[method](...args), { signal: req.operationSignal, timeoutMs: operationTimeoutMs });
      diagnostics.set(id, { source: id, operation: method, ok: true, durationMs: Date.now() - started, timestamp: Date.now() });
      return result;
    } catch (error) {
      diagnostics.set(id, { source: id, operation: method, ok: false, code: error.code ?? 'SCRAPER_ERROR', durationMs: Date.now() - started, timestamp: Date.now() });
      if (error.code !== 'CANCELLED') logger.warn?.('Consulta de fuente fallida', diagnostics.get(id));
      throw error;
    }
  };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const localOrigin = `http://127.0.0.1:${req.socket.localPort}`;
    const validHost = cloudStore ? req.headers.host === new URL(apiOrigin).host : req.headers.host === `127.0.0.1:${req.socket.localPort}`;
    if (!validHost && !(cloudStore && req.path === '/api/health')) {
      return next(new ApiError(403, 'INVALID_HOST', 'Usa la dirección 127.0.0.1 del servidor.'));
    }
    if (cloudStore && !req.secure && req.path !== '/api/health') return next(new ApiError(403, 'HTTPS_REQUIRED', 'La conexión con tu cuenta debe usar HTTPS.'));
    const origin = req.headers.origin;
    if ((origin && origin !== (cloudStore ? apiOrigin : localOrigin) && !frontendOrigins.includes(origin)) ||
        (!origin && req.headers['sec-fetch-site'] === 'cross-site')) {
      return next(new ApiError(403, 'INVALID_ORIGIN', 'Origen del frontend no autorizado.'));
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Private-Token,X-Operation-Id');
      res.set('Access-Control-Expose-Headers', 'X-Library-Revision');
    }
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  if(cloudStore)app.use(guestResources());
  // Rechaza la sincronización antigua antes de interpretar cualquier ciphertext.
  if(encryptedPrivate)app.use('/api/vault',(req,res,next)=>{
    if(req.path==='/'||['/move','/reveal'].includes(req.path))return res.status(426).set('Cache-Control','no-store').json({error:{code:'VAULT_DIRECT_REQUIRED',message:'Actualiza la página: la bóveda se sincroniza directamente con Supabase.'}});
    next();
  });
  app.use('/api/vault', express.json({limit:'256kb'}));
  app.use('/api/library/import', express.json({ limit: '13mb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    req.operationSignal = controller.signal;
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    const cleanup = () => { req.off('aborted', disconnect); res.off('close', disconnect); };
    req.once('aborted', disconnect); res.once('close', disconnect); res.once('finish', cleanup);
    res.once('close', cleanup);
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  mountVault(app,{store:cloudStore,sources,tickets,consult});
  if (cloudStore) app.use('/api', accounts.middleware);
  if(encryptedPrivate)app.use('/api',(req,_res,next)=>{
    const privateImport=req.path==='/library/import'&&(req.body?.privateVault||req.body?.tables?.Series?.some(row=>row.is_private));
    if(req.path.startsWith('/private/')||req.query.scope==='private'||req.body?.is_private===true||privateImport)return next(new ApiError(426,'E2EE_REQUIRED','Actualiza la página: la biblioteca privada se cifra y desbloquea únicamente en tu navegador.'));
    next();
  });
  app.get('/config.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-store').send('window.LECTOR_CONFIG = ' + JSON.stringify(publicConfig).replaceAll('<', '\\u003c') + ';'));
  app.get('/api/account', (req, res) => res.json({ mode: cloudStore ? 'cloud' : 'local', user: req.user ? { id: req.user.id, email: req.user.email, name: req.user.user_metadata?.full_name ?? req.user.email } : null, revision: Number(res.get('X-Library-Revision') ?? 0) }));
  app.get('/api/library/export', (req, res) => {
    const includePrivate = req.query.private === '1';
    if (includePrivate) privateAccess.requireAccess(req);
    res.json(database.exportLibrary({ includePrivate }));
  });
  app.post('/api/library/import', (req, res) => {
    if (Array.isArray(req.body?.tables?.Series) && req.body.tables.Series.some(row => row?.is_private)) privateAccess.requireAccess(req);
    res.json(database.importLibrary(req.body, {
      allowPrivate: privateAccess.unlocked(req),
      validateSeries(row) {
        const source = sources.get(row.source);
        if (!source) throw new ApiError(400, 'UNKNOWN_IMPORT_SOURCE', 'Una serie del archivo usa una fuente desconocida.');
        allowedPageUrl(row.url_origen, source); if (row.portada) allowedImageUrl(row.portada, source);
      },
      validateChapter(row, series) { allowedPageUrl(row.url_origen, sources.get(series.source)); }
    }));
  });
  app.get('/api/storage', (_req, res) => res.json(database.storageInfo()));
  app.get('/api/diagnostics', (_req, res) => res.json({ operationTimeoutMs, sources: [...diagnostics.values()] }));
  app.get('/api/private/status', (req,res) => res.json(privateAccess.status(req)));
  app.post('/api/private/setup', (req,res) => res.json(privateAccess.setup(req,res,req.body?.pin)));
  app.post('/api/private/unlock', (req,res) => res.json(privateAccess.unlock(req,res,req.body?.pin)));
  app.post('/api/private/lock', (req,res) => res.json(privateAccess.lock(req,res)));
  app.put('/api/private/pin', (req,res) => res.json(privateAccess.change(req,req.body?.pin)));
  app.use('/api', (req,_res,next) => {
    try {
      if(cloudStore&&(req.path==='/progress'||/^\/series\/\d+\/progress$/.test(req.path))&&['POST','PUT'].includes(req.method)&&
        (req.body?.expected_timestamp===undefined||(req.body.expected_timestamp!==null&&(!Number.isSafeInteger(req.body.expected_timestamp)||req.body.expected_timestamp<0))))throw new ApiError(428,'PROGRESS_VERSION_REQUIRED','Abre el capítulo antes de guardar para recuperar la versión actual del progreso.');
      const checkSeries = id => { if (database.getSeries(id).is_private) privateAccess.requireAccess(req); };
      const seriesRoute = req.path.match(/^\/series\/(\d+)(?:\/|$)/);
      const chapterRoute = req.path.match(/^\/chapters\/(\d+)(?:\/|$)/);
      const workRoute = req.path.match(/^\/works\/(\d+)(?:\/|$)/);
      if (seriesRoute) checkSeries(seriesRoute[1]);
      if (chapterRoute) checkSeries(database.getChapter(chapterRoute[1]).serie_id);
      if (workRoute && database.getWork(workRoute[1]).editions.some(e=>e.is_private)) privateAccess.requireAccess(req);
      if (req.path === '/progress') { checkSeries(req.body?.serie_id); if(req.body?.capitulo_id)checkSeries(database.getChapter(req.body.capitulo_id).serie_id); }
      if (req.body?.serie_id && workRoute) checkSeries(req.body.serie_id);
      if (req.body?.work_id && database.getWork(req.body.work_id).editions.some(e=>e.is_private)) privateAccess.requireAccess(req);
      if (req.body?.is_private === true) privateAccess.requireAccess(req);
      if (req.path === '/series' && req.method === 'POST') {
        const existing=database.listSeries().find(s=>s.url_origen===req.body?.url_origen);
        if(existing?.is_private)privateAccess.requireAccess(req);
      }
      if(req.path === '/discovery/feedback' && req.body?.item) {
        const existing=database.listSeries().find(s=>s.source===req.body.item.source && s.url_origen===req.body.item.url);
        if(existing?.is_private)privateAccess.requireAccess(req);
      }
      next();
    } catch(error) { next(error); }
  });
  app.get('/api/sources', (_req, res) => res.json(listSources(sources)));
  app.get('/api/sources/detect', (req, res) => {
    const { id } = detectSource(sources, req.query.url);
    res.json(publicSource(id,sourceFor(sources,id)));
  });
  app.get('/api/sources/:id/search', async (req, res) => {
    const source = sourceFor(sources, req.params.id);
    if (!source.capabilities?.search) throw new ApiError(400, 'UNSUPPORTED_OPERATION', 'Esta fuente no admite búsquedas.');
    const page = req.query.page === undefined ? 0 : Number(req.query.page);
    if (typeof req.query.q !== 'string' || !req.query.q.trim() || req.query.q.length > 200 ||
        !Number.isSafeInteger(page) || page < 0 || page > 10000) {
      throw new ApiError(400, 'INVALID_QUERY', 'Consulta o página inválida.');
    }
    const result = await consult(req, source, 'search', req.query.q, { page });
    res.json({ ...result, results: result.results.filter(item=>!isAdult(item)).map(item => withCover({ ...item, source: req.params.id }, source, item.url)) });
  });
  app.get('/api/sources/:id/manga', async (req, res) => {
    const source = sourceFor(sources, req.params.id);
    if (!source.capabilities?.manga) throw new ApiError(400, 'UNSUPPORTED_OPERATION', 'Esta fuente no admite fichas.');
    const url = allowedPageUrl(req.query.url, source);
    res.json(await consult(req, source, 'getManga', url));
  });
  app.get('/api/sources/mangadex/recommendations', async (req, res) => {
    const source = sourceFor(sources, 'mangadex');
    const genre = req.query.genre;
    if (typeof genre !== 'string' || !genre.trim() || genre.length > 120) throw new ApiError(400, 'INVALID_QUERY', 'Género inválido.');
    const result = await consult(req, source, 'recommend', genre);
    res.json({ ...result, results: result.results.filter(item=>!isAdult(item)).map(item => withCover({ ...item, source: 'mangadex' }, source, item.url)) });
  });
  app.get('/api/image', createImageProxy({ ...proxyOptions, tickets, sources, logger, authorize(req,image) {
    if (cloudStore && image.ownerId !== req.user.id) throw new ApiError(403, 'IMAGE_ACCOUNT_MISMATCH', 'La imagen pertenece a otra cuenta.');
    // Se comprueba el estado actual, incluso si el ticket se emitió antes de ocultar la obra.
    if ((image.seriesId || cloudStore) && database.getSeries(image.seriesId).is_private) privateAccess.requireAccess(req);
  } }));
  mountDiscovery(app,{database,sources,consult,withCover,...discoveryOptions});
  app.get('/api/series', (req, res) => {
    const scope=req.query.scope??'library';
    if(!['library','adult','private'].includes(scope))throw new ApiError(400,'INVALID_SCOPE','Biblioteca inválida.');
    if(scope==='private')privateAccess.requireAccess(req);
    res.json(database.listVisibleSeries(scope).map(item=>withCover(item,sources.get(item.source)??{},item.url_origen)));
  });
  app.post('/api/adult/catalog', async(req,res) => {
    const query=req.body?.query??'',page=req.body?.page??0,id=req.body?.source??'all';
    if(typeof query!=='string'||query.length>200||!Number.isSafeInteger(page)||page<0||page>10000)throw new ApiError(400,'INVALID_QUERY','Consulta inválida.');
    const available=[...sources].filter(([,s])=>s.enabled!==false&&s.capabilities?.adult);
    const selected=available.filter(([key])=>id==='all'||key===id);
    if(!selected.length)throw new ApiError(400,'UNSUPPORTED_OPERATION','Esta fuente no admite catálogo +18.');
    const providers=await Promise.all(selected.map(async([sourceId,source])=>{
      try {
        const result=await consult(req,source,query.trim()?'search':'recommend',query.trim()||{adult:true},...(query.trim()?[{page,adult:true}]:[]));
        return {id:sourceId,name:source.name,results:result.results.filter(isAdult).map(item=>withCover({...item,source:sourceId},source,item.url)),nextPage:query.trim()?result.nextPage:null};
      }catch(error){if(req.operationSignal.aborted)throw error;return {id:sourceId,name:source.name,results:[],nextPage:null,error:error.message};}
    }));
    res.json({sources:providers});
  });
  app.delete('/api/series/:id', (req, res) => res.json(database.removeFavorite(req.params.id)));
  app.put('/api/series/:id/library', (req, res) => res.json(database.updateLibrary(req.params.id, req.body ?? {})));
  app.get('/api/folders', (_req, res) => res.json(database.listFolders()));
  app.post('/api/folders', (req, res) => res.json(database.saveFolder(req.body?.name)));
  app.put('/api/folders/:id', (req, res) => res.json(database.saveFolder(req.body?.name, req.params.id)));
  app.delete('/api/folders/:id', (req, res) => res.json(database.removeFolder(req.params.id)));
  app.get('/api/updates', (_req, res) => res.json(database.listUpdates().map(item =>
    withCover(item, sources.get(item.source) ?? {}, item.url_origen))));
  app.post('/api/series', async (req, res) => {
    const body = req.body ?? {};
    const id = body.source ?? detectSource(sources, body.url_origen).id;
    const source = sourceFor(sources, id);
    let url = allowedPageUrl(body.url_origen, source);
    let titulo = body.titulo;
    let portada = body.portada;
    let metadata = {};
    if (titulo === undefined) {
      if (!source.capabilities?.manga) throw new ApiError(400, 'INVALID_FIELD', 'Debes indicar el título.');
      const { manga } = await consult(req, source, 'getManga', url);
      titulo = manga.title;
      portada ??= manga.cover;
      metadata = manga;
      url = allowedPageUrl(manga.url, source);
    }
    if (portada != null) allowedImageUrl(portada, source);
    if (req.operationSignal.aborted) throw cancellationError(req.operationSignal);
    const existing=database.listSeries().find(s=>s.source===id&&s.url_origen===url);
    if(existing?.is_private)privateAccess.requireAccess(req);
    const favorite=database.saveFavorite({ source: id, titulo, url_origen: url, portada, metadata, work_id:body.work_id });
    res.json(body.is_private===true?database.updateLibrary(favorite.id,{is_private:true}):favorite);
  });
  app.get('/api/series/:id/chapters', (req, res) => res.json(database.listChapters(req.params.id)));
  app.post('/api/series/:id/sync', async (req, res) => {
    const series = database.getSeries(req.params.id);
    const source = sourceFor(sources, series.source);
    allowedPageUrl(series.url_origen, source);
    const result = await consult(req, source, 'getChapters', series.url_origen);
    for (const chapter of result.chapters) allowedPageUrl(chapter.url, source);
    if (req.operationSignal.aborted) throw cancellationError(req.operationSignal);
    if (result.manga) database.updateSourceMetadata(series.id, result.manga);
    res.json(database.saveChapters(series.id, result.chapters));
  });
  app.get('/api/chapters/:id/images', async (req, res) => {
    const chapter = database.getChapter(req.params.id);
    const series = database.getSeries(chapter.serie_id);
    const source = sourceFor(sources, series.source);
    allowedPageUrl(chapter.url_origen, source);
    const result = await consult(req, source, 'getChapterImages', chapter.url_origen);
    if (cloudStore) {
      await database.refreshAccount();
      database.getChapter(chapter.id);
      if (database.getSeries(series.id).is_private) privateAccess.requireAccess(req);
    }
    const images = result.images.map(image => {
      const url = allowedImageUrl(image.url, source);
      const referer = allowedPageUrl(image.referer, source);
      const ticket = tickets.issue({ source: series.source, url, referer, seriesId: series.id, ...(cloudStore ? { ownerId: req.user.id } : {}) });
      return { index: image.index, originalUrl: url, referer,
        url: `/api/image?ticket=${encodeURIComponent(ticket)}` };
    });
    res.json({ source: series.source, chapter: { ...result.chapter, id: chapter.id, serie_id: series.id,
      privateReading: Boolean(database.getSeries(series.id).is_private) }, images });
  });
  app.get('/api/series/:id/progress', (req, res) => res.json(database.getProgress(req.params.id)));
  app.post('/api/progress', (req, res) => res.json(database.updateProgress({
    serie_id: req.body?.serie_id, capitulo_id: req.body?.capitulo_id,
    scroll_position_y: req.body?.scroll_position_y, page_index: req.body?.page_index, page_fraction: req.body?.page_fraction,
    expected_timestamp: cloudStore ? req.body?.expected_timestamp : undefined
  })));
  app.put('/api/series/:id/progress', (req, res) => res.json(database.updateProgress({
    serie_id: req.params.id, capitulo_id: req.body?.capitulo_id, scroll_position_y: req.body?.scroll_position_y,
    page_index: req.body?.page_index, page_fraction: req.body?.page_fraction,
    expected_timestamp: cloudStore ? req.body?.expected_timestamp : undefined
  })));
  app.put('/api/chapters/:id/read', (req, res) => res.json(database.markChapterRead(
    req.params.id, req.body?.read === undefined ? true : req.body.read
  )));
  app.use(express.static(fileURLToPath(new URL('../frontend/', import.meta.url)), {
    index: 'index.html', dotfiles: 'deny', maxAge: 0
  }));
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint no encontrado.')));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.destroy();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Error interno del servidor.';
    if (error instanceof ApiError) ({ status, code, message } = error);
    else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      status = error.type === 'entity.too.large' ? 413 : 400;
      code = 'INVALID_BODY'; message = 'Cuerpo JSON inválido o demasiado grande.';
    } else if (error.code === 'SQLITE_BUSY') {
      status = 503; code = 'DATABASE_BUSY'; message = 'Base de datos ocupada; vuelve a intentarlo.';
    } else if (error.name === 'ScraperError') {
      status = error.code === 'CANCELLED' ? 499 : error.code === 'TIMEOUT' ? 504 : ['INVALID_URL', 'INVALID_QUERY', 'UNSUPPORTED_OPERATION'].includes(error.code) ? 400 : 502;
      code = error.code; message = error.message;
    } else logger.error?.('Error de API', error);
    res.status(status).json({ error: { code, message } });
  });
  return app;
}
