import { ApiError, positiveId, httpUrl } from '../backend/errors.js';
import { normalizeMetadata } from './metadata.js';
import { itemKey } from '../frontend/discovery-core.js';
export const defaultDiscovery = () => ({genres:[],themes:[],excludeGenres:[],excludeThemes:[],country:'',status:'',minChapters:0,genreMatch:'any',sources:[],onlyNew:false});
export function validateDiscovery(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'INVALID_PREFERENCES','Preferencias inválidas.');
  const result=defaultDiscovery();
  for(const key of ['genres','themes','excludeGenres','excludeThemes']) {
    const values=input[key]??[];
    if(!Array.isArray(values)||values.length>10||values.some(v=>typeof v!=='string'||!v.trim()||v.length>120))throw new ApiError(400,'INVALID_PREFERENCES','Usa hasta diez etiquetas de 120 caracteres por filtro.');
    result[key]=[...new Set(values.map(v=>v.trim()))];
  }
  if(input.country!==undefined&&!['','JP','KR','CN','TW'].includes(input.country))throw new ApiError(400,'INVALID_PREFERENCES','Origen inválido.');
  if(input.status!==undefined&&!['','ongoing','completed','hiatus','cancelled'].includes(input.status))throw new ApiError(400,'INVALID_PREFERENCES','Estado de publicación inválido.');
  result.country=input.country??'';result.status=input.status??'';result.minChapters=input.minChapters??0;
  if(input.genreMatch!==undefined&&!['any','all'].includes(input.genreMatch))throw new ApiError(400,'INVALID_PREFERENCES','Combinación de géneros inválida.');
  result.genreMatch=input.genreMatch??'any';
  if(input.onlyNew!==undefined&&typeof input.onlyNew!=='boolean')throw new ApiError(400,'INVALID_PREFERENCES','Filtro de novedades inválido.');
  result.onlyNew=input.onlyNew??false;
  if(input.sources!==undefined&&(!Array.isArray(input.sources)||input.sources.length>20||input.sources.some(id=>typeof id!=='string'||!/^[a-z0-9-]{1,80}$/.test(id))))throw new ApiError(400,'INVALID_PREFERENCES','Fuentes inválidas.');
  result.sources=[...new Set(input.sources??[])];
  if(!Number.isSafeInteger(result.minChapters)||result.minChapters<0||result.minChapters>1000)throw new ApiError(400,'INVALID_PREFERENCES','El mínimo debe ser un entero entre 0 y 1000.');
  return result;
}
export function validateFeedback(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'INVALID_FEEDBACK','Valoración inválida.');
  const patch={};
  if(input.sentiment!==undefined){if(!['neutral','like','dislike'].includes(input.sentiment))throw new ApiError(400,'INVALID_FEEDBACK','Gusto inválido.');patch.sentiment=input.sentiment;}
  if(input.rating!==undefined){if(input.rating!==null&&(!Number.isInteger(input.rating)||input.rating<1||input.rating>10))throw new ApiError(400,'INVALID_FEEDBACK','La nota debe estar entre 1 y 10.');patch.rating=input.rating;}
  for(const key of ['hidden','already_read','more_like','seen'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new ApiError(400,'INVALID_FEEDBACK','Preferencia inválida.');patch[key]=input[key];}
  if(!Object.keys(patch).length)throw new ApiError(400,'INVALID_FEEDBACK','Indica una preferencia.');
  return patch;
}
export function createDiscoveryStore(db,getSeries) {
  const getWork = id => {
    const row=db.prepare('SELECT * FROM Works WHERE id=?').get(positiveId(id));
    if(!row)throw new ApiError(404,'WORK_NOT_FOUND','Obra no encontrada.');
    return {...JSON.parse(row.feedback_json),...row,editions:db.prepare('SELECT id FROM Series WHERE work_id=? ORDER BY id').all(row.id).map(r=>getSeries(r.id))};
  };
  const clean = id => db.prepare('DELETE FROM Works WHERE id=? AND NOT EXISTS(SELECT 1 FROM Series WHERE work_id=Works.id)').run(id);
  return {
    getWork,
    linkSeries:db.transaction((targetWorkId,seriesId)=>{
      const target=getWork(targetWorkId),series=getSeries(seriesId);
      if(series.work_id===target.id)return target;
      // Se vincula únicamente la edición elegida; otros enlaces de su ficha se conservan.
      const privateFlag = Number(Boolean(series.is_private || target.editions.some(e => e.is_private)));
      const adultFlag = Number(Boolean(series.is_adult || target.editions.some(e => e.is_adult)));
      db.prepare('UPDATE Series SET work_id=?,reading_state=?,is_private=?,is_adult=? WHERE id=?').run(target.id,target.editions[0]?.reading_state??'planned',privateFlag,adultFlag,series.id);
      db.prepare('UPDATE Series SET is_private=?,is_adult=? WHERE work_id=?').run(privateFlag,adultFlag,target.id);clean(series.work_id);
      return getWork(target.id);
    }),
    unlinkSeries:db.transaction(id=>{
      const series=getSeries(id),old=getWork(series.work_id);
      if(old.editions.length===1)return old;
      const work=db.prepare('INSERT INTO Works(title,feedback_json) VALUES (?,?) RETURNING id').get(series.titulo,old.feedback_json);
      db.prepare('UPDATE Series SET work_id=? WHERE id=?').run(work.id,series.id);
      return getWork(work.id);
    }),
    updateWorkFeedback(id,input) {
      const work=getWork(id),patch=validateFeedback(input);
      db.prepare('UPDATE Works SET feedback_json=? WHERE id=?').run(JSON.stringify({...JSON.parse(work.feedback_json),...patch}),work.id);
      return getWork(work.id);
    },
    getDiscovery() {
      return {preferences:{...defaultDiscovery(),...JSON.parse(db.prepare('SELECT value_json FROM DiscoveryPreferences WHERE id=1').get().value_json)},
        feedback:db.prepare('SELECT * FROM RecommendationFeedback ORDER BY updated_at DESC').all().map(r=>({...JSON.parse(r.item_json),...JSON.parse(r.feedback_json)}))};
    },
    saveDiscovery(input) {const preferences=validateDiscovery(input);db.prepare('UPDATE DiscoveryPreferences SET value_json=? WHERE id=1').run(JSON.stringify(preferences));return preferences;},
    saveRecommendationFeedback(item,input) {
      if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.title!=='string'||!item.title.trim()||item.title.length>2000||typeof item.source!=='string'||item.source.length>100)throw new ApiError(400,'INVALID_FEEDBACK','Ficha inválida.');
      const metadata=normalizeMetadata(item,true),safe={source:item.source,title:item.title.trim(),url:httpUrl(item.url),...metadata};
      const key=itemKey(safe),patch=validateFeedback(input);
      const saved=db.prepare('SELECT work_id FROM Series WHERE source=? AND url_origen=?').get(safe.source,safe.url);
      if(saved)return this.updateWorkFeedback(saved.work_id,patch);
      const row=db.prepare('SELECT feedback_json FROM RecommendationFeedback WHERE item_key=?').get(key);
      const feedback={...JSON.parse(row?.feedback_json??'{}'),...patch};
      db.prepare(`INSERT INTO RecommendationFeedback VALUES (?,?,?,?) ON CONFLICT(item_key) DO UPDATE SET item_json=excluded.item_json,feedback_json=excluded.feedback_json,updated_at=excluded.updated_at`).run(key,JSON.stringify(safe),JSON.stringify(feedback),Date.now());
      if(patch.seen){const viewed=db.prepare('SELECT item_key,feedback_json FROM RecommendationFeedback ORDER BY updated_at DESC').all().filter(row=>{const f=JSON.parse(row.feedback_json);return f.seen&&!f.hidden&&!f.already_read&&!f.more_like&&!f.rating&&(!f.sentiment||f.sentiment==='neutral');});for(const row of viewed.slice(1000))db.prepare('DELETE FROM RecommendationFeedback WHERE item_key=?').run(row.item_key);}
      return {...safe,...feedback};
    },
    resetSeenRecommendations:db.transaction(()=>{
      for(const row of db.prepare('SELECT item_key,feedback_json FROM RecommendationFeedback').all()){const feedback=JSON.parse(row.feedback_json);if(!feedback.seen)continue;delete feedback.seen;if(Object.keys(feedback).length)db.prepare('UPDATE RecommendationFeedback SET feedback_json=? WHERE item_key=?').run(JSON.stringify(feedback),row.item_key);else db.prepare('DELETE FROM RecommendationFeedback WHERE item_key=?').run(row.item_key);}
      return {reset:true};
    }),
    removeRecommendationFeedback(key) {
      if(typeof key!=='string'||key.length>2200)throw new ApiError(400,'INVALID_FEEDBACK','Identificador inválido.');
      db.prepare('DELETE FROM RecommendationFeedback WHERE item_key=?').run(key);return {deleted:true};
    },
    resetDiscovery:db.transaction(()=>{db.prepare("UPDATE Works SET feedback_json='{}'").run();db.prepare('DELETE FROM RecommendationFeedback').run();db.prepare("UPDATE DiscoveryPreferences SET value_json='{}' WHERE id=1").run();return {reset:true};})
  };
}
