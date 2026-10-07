import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { openDatabase } from '../storage/database.js';
import { ApiError } from './errors.js';

const mutations = new Set(['removeFavorite', 'saveFavorite', 'updateSourceMetadata', 'updateLibrary', 'saveFolder', 'removeFolder', 'saveChapters', 'updateProgress', 'markChapterRead', 'savePrivateAccess', 'replacePrivateAccess', 'linkSeries', 'unlinkSeries', 'updateWorkFeedback', 'saveDiscovery', 'saveRecommendationFeedback', 'removeRecommendationFeedback', 'resetSeenRecommendations', 'resetDiscovery', 'importLibrary']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function createAccountContext({ localDatabase, store, tickets, privateAccess }) {
  const context = new AsyncLocalStorage();
  const database = new Proxy({}, { get(_target, name) {
    const current = context.getStore();
    if (name === 'ownerId') return current?.user?.id ?? null;
    if(name==='refreshAccount')return async()=>{
      if(!current?.store||current.closed||current.dirty)return;
      const latest=await current.store.load(current.user.id);
      if(!current.closed&&latest.state&&latest.revision!==current.revision){current.database.restoreState(latest.state);current.revision=latest.revision;}
    };
    const db = current?.database ?? localDatabase;
    if (!db) throw new Error('No hay contexto de cuenta para esta operación.');
    const member = db[name];
    if (typeof member !== 'function') return member;
    return (...args) => { const result = member.apply(db, args); if (current && mutations.has(name)) current.dirty = true; return result; };
  } });

  const middleware = async (req, res, next) => {
    let db;
    try {
      if(req.guest){
        const user={id:'guest'};req.user=user;
        if(req.path==='/image'&&tickets.verify(req.query.ticket).ownerId!=='guest')throw new ApiError(403,'IMAGE_ACCOUNT_MISMATCH','La imagen requiere su cuenta.');
        const publicOnly={getSeries:()=>({is_private:0}),listSeries:()=>[],getDiscovery:()=>({preferences:{},feedback:[]})};
        return context.run({database:publicOnly,user},next);
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const user = await store.authenticate(token);
      const scoped=store.forUser?store.forUser(user):store;
      req.user = { id: user.id, email: user.email, user_metadata: user.user_metadata };
      // Catálogos y estado no necesitan reconstruir SQLite ni descargar la biblioteca.
      if(req.path.startsWith('/sources')||req.path==='/diagnostics')return context.run({database:{},user},next);
      if(req.path==='/account'){const loaded=await scoped.load(user.id);res.set('X-Library-Revision',String(loaded.revision));return context.run({database:{},user},next);}
      if (req.path === '/image') {
        const image = tickets.verify(req.query.ticket);
        if (image.ownerId !== user.id) throw new ApiError(403, 'IMAGE_ACCOUNT_MISMATCH', 'La imagen pertenece a otra cuenta.');
        const access = await scoped.mediaAccess(user.id, image.seriesId, { source: image.source, url: image.libraryUrl });
        const lightweight = { getSeries: () => ({ is_private: Number(access.isPrivate) }), getPrivateAccess: () => access.pin };
        return context.run({ database: lightweight, user }, next);
      }
      const requestedId = req.headers['x-operation-id'];
      if (requestedId !== undefined && !uuid(requestedId)) throw new ApiError(400, 'INVALID_OPERATION_ID', 'Identificador de operación inválido.');
      // No registrar un hash rápido del PIN ni almacenar un token de desbloqueo.
      const pinOperation = req.path.startsWith('/private/');
      const id = pinOperation ? undefined : requestedId;
      const fingerprint = pinOperation ? randomUUID() : createHash('sha256').update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
      const readOnly = ['/discovery/recommendations','/adult/catalog'].includes(req.path);
      let saved;
      if (id && !readOnly) {
        saved = await scoped.operation(user.id, id);
        if (saved) {
          if (saved.fingerprint !== fingerprint) throw new ApiError(409, 'OPERATION_MISMATCH', 'Este identificador ya se usó para otra operación.');
        }
      }
      const loaded = await scoped.load(user.id);
      db = openDatabase(':memory:');
      if (loaded.state) db.restoreState(loaded.state);
      const state = { database: db, store:scoped,user, dirty: false, revision: loaded.revision };
      const seriesRefs = new Set();
      const addSeries = value => { if (Number.isSafeInteger(Number(value)) && Number(value) > 0) seriesRefs.add(Number(value)); };
      const collectReferences = () => {
        const pathSeries = req.path.match(/^\/series\/(\d+)(?:\/|$)/), pathChapter = req.path.match(/^\/chapters\/(\d+)(?:\/|$)/), pathWork = req.path.match(/^\/works\/(\d+)(?:\/|$)/);
        if (pathSeries) addSeries(pathSeries[1]);
        addSeries(req.body?.serie_id);
        for (const chapterId of [pathChapter?.[1], req.body?.capitulo_id]) if (chapterId) {
          try { addSeries(db.getChapter(chapterId).serie_id); } catch { /* El controlador validará referencias inexistentes. */ }
        }
        for (const workId of [pathWork?.[1], req.body?.work_id]) if (workId) {
          try { db.getWork(workId).editions.forEach(item => addSeries(item.id)); } catch { /* Validación en el controlador. */ }
        }
        const targetUrl = req.body?.url_origen ?? req.body?.item?.url;
        if (targetUrl) db.listSeries().filter(item => item.url_origen === targetUrl).forEach(item => addSeries(item.id));
      };
      collectReferences();
      const original = res.json.bind(res);
      res.set('X-Library-Revision', String(loaded.revision));
      res.json = data => {
        if (!state.dirty || res.statusCode >= 400) return original(data);
        state.dirty = false;
        // Confirmar PostgreSQL antes de informar «guardado» o devolver IDs nuevos.
        for (const item of Array.isArray(data) ? data : [data]) {
          if (item?.serie_id) addSeries(item.serie_id);
          if (item?.source && item?.url_origen) addSeries(item.id);
        }
        const response = { __lectorOperation: 1, data: pinOperation ? { updated: true } : data,
          requiresPrivate: privateAccess().unlocked(req), seriesRefs: [...seriesRefs] };
        scoped.commit(user.id, loaded.revision, db.exportState(), { id: id ?? randomUUID(), fingerprint, response }).then(revision => {
          if (res.destroyed) return;
          res.set('X-Library-Revision', String(revision)); original(data);
        }).catch(next);
        return res;
      };
      const close = () => { state.closed=true;if (db) { db.close(); db = null; } };
      res.once('finish', close); res.once('close', close);
      context.run(state, () => {
        if (!saved) return next();
        const stored = saved.response;
        if (stored?.__lectorOperation !== 1) throw new ApiError(409, 'OPERATION_EXPIRED', 'Actualiza la biblioteca y vuelve a intentarlo.');
        // El bloqueo y la privacidad actuales se comprueban también al repetir una escritura.
        if (stored.requiresPrivate) privateAccess().requireAccess(req);
        for (const seriesId of stored.seriesRefs ?? []) {
          let row;
          try { row = db.getSeries(seriesId); } catch (error) { if (error.code !== 'SERIES_NOT_FOUND') throw error; }
          if (row?.is_private) privateAccess().requireAccess(req);
        }
        return original(stored.data);
      });
    } catch (error) { if (db) db.close(); next(error); }
  };
  return { database, middleware };
}
