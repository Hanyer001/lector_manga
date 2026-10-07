import { ApiError, httpUrl, positiveId } from '../backend/errors.js';
import { normalizeMetadata } from './metadata.js';
import { validateDiscovery, validateFeedback } from './discovery.js';

const tables = ['Works', 'Folders', 'Series', 'Chapters', 'Progress', 'SeriesFolders', 'DiscoveryPreferences', 'RecommendationFeedback', 'PrivateAccess'];
export const MAX_LIBRARY_BYTES = 12 * 1024 * 1024;
const invalid = message => new ApiError(400, 'INVALID_LIBRARY_BACKUP', message);
const text = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Solo el backend usa este formato interno. Nunca se exportan hashes del PIN al cliente.
export function createSnapshotTools(db) {
  return {
    exportState() { return { version: 1, tables: Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()])) }; },
    restoreState(state) {
      if (!state || state.version !== 1 || !state.tables || Object.keys(state.tables).some(name => !tables.includes(name))) throw invalid('Formato de biblioteca no compatible.');
      if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_LIBRARY_BYTES) throw invalid('La biblioteca supera los 12 MB de metadatos.');
      db.transaction(() => {
        db.pragma('defer_foreign_keys = ON');
        for (const name of [...tables].reverse()) db.prepare(`DELETE FROM ${name}`).run();
        for (const name of tables) {
          const rows = state.tables[name] ?? [];
          if (!Array.isArray(rows) || rows.length > 100000) throw invalid('Demasiadas filas o tabla inválida.');
          const columns = db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name);
          for (const row of rows) {
            if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).some(key => !columns.includes(key))) throw invalid('Campos de biblioteca inválidos.');
            const keys = Object.keys(row);
            if (!keys.length || Object.values(row).some(value => value !== null && !['string', 'number'].includes(typeof value))) throw invalid('Valores de biblioteca inválidos.');
            db.prepare(`INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
          }
        }
        if (!db.prepare('SELECT id FROM DiscoveryPreferences WHERE id=1').get()) db.prepare('INSERT INTO DiscoveryPreferences(id) VALUES(1)').run();
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw invalid('Hay enlaces de capítulos o carpetas inválidos.');
      })();
    }
  };
}

export function createLibraryTransfer(db, openDatabase) {
  const snapshots = createSnapshotTools(db);
  return {
    exportLibrary({ includePrivate = false } = {}) {
      const state = snapshots.exportState();
      const hidden = state.tables.Series.filter(row => row.is_private);
      if (!includePrivate) state.tables.Series = state.tables.Series.filter(row => !row.is_private);
      const seriesIds = new Set(state.tables.Series.map(row => row.id)), workIds = new Set(state.tables.Series.map(row => row.work_id));
      state.tables.Works = state.tables.Works.filter(row => workIds.has(row.id));
      for (const name of ['Chapters', 'Progress', 'SeriesFolders']) state.tables[name] = state.tables[name].filter(row => seriesIds.has(row.serie_id));
      const hiddenTitles = new Set(hidden.map(row => row.titulo.toLowerCase()));
      if (!includePrivate) state.tables.RecommendationFeedback = state.tables.RecommendationFeedback.filter(row => !hiddenTitles.has(JSON.parse(row.item_json).title?.toLowerCase()));
      delete state.tables.PrivateAccess;
      return { format: 'lector-manga-library', version: 1, exportedAt: new Date().toISOString(), includesPrivate: includePrivate && hidden.length > 0, tables: state.tables };
    },
    importLibrary(backup, { validateSeries = () => {}, validateChapter = () => {}, allowPrivate = false } = {}) {
      if (!backup || backup.format !== 'lector-manga-library' || backup.version !== 1 || !backup.tables || Object.hasOwn(backup.tables, 'PrivateAccess')) throw invalid('Selecciona una exportación JSON de Lector Manga.');
      const staged = openDatabase(':memory:');
      let rows;
      try {
        staged.restoreState({ version: 1, tables: { ...backup.tables, PrivateAccess: [] } });
        rows = staged.exportState().tables;
        if (rows.Series.some(row => row.is_private) && !allowPrivate) throw new ApiError(423, 'PRIVATE_LOCKED', 'Configura y desbloquea la biblioteca privada antes de importar lecturas ocultas.');
        for (const row of rows.Works) { positiveId(row.id); if (!text(row.title)) throw invalid('Título de obra inválido.'); const feedback = JSON.parse(row.feedback_json); row.feedback_json=JSON.stringify(Object.keys(feedback).length?validateFeedback(feedback):{}); }
        for (const row of rows.Folders) { positiveId(row.id); if (!text(row.name, 80)) throw invalid('Carpeta inválida.'); }
        const byId = new Map(rows.Series.map(row => [row.id, row]));
        for (const row of rows.Series) {
          positiveId(row.id);positiveId(row.work_id); if (!text(row.titulo) || !text(row.source, 80) || !['planned', 'reading', 'on_hold', 'completed', 'abandoned'].includes(row.reading_state)) throw invalid('Ficha de serie inválida.');
          httpUrl(row.url_origen); if (row.portada) httpUrl(row.portada);
          const metadata = JSON.parse(row.metadata_json), safeMetadata=normalizeMetadata(metadata, true);
          const metadataFields=['genres','themes','authors','altTitles','status','country','description','language','contentRating'];
          if (metadata.manualFields && (!Array.isArray(metadata.manualFields) || metadata.manualFields.some(field => !metadataFields.includes(field)))) throw invalid('Metadatos inválidos.');
          row.metadata_json=JSON.stringify({...safeMetadata,manualFields:[...new Set(metadata.manualFields??[])]});
          validateSeries(row);
        }
        for (const row of rows.Chapters) {
          positiveId(row.id); if (!text(row.titulo) || row.numero !== null && !Number.isFinite(row.numero)) throw invalid('Capítulo inválido.');
          httpUrl(row.url_origen); validateChapter(row, byId.get(row.serie_id));
        }
        for (const row of rows.Progress) {
          const chapter=rows.Chapters.find(item=>item.id===row.capitulo_id);
          if (!chapter || chapter.serie_id!==row.serie_id) throw invalid('El progreso pertenece a un capítulo de otra serie.');
          if (!Number.isSafeInteger(row.timestamp) || row.timestamp < 0 || !Number.isFinite(row.scroll_position_y) || row.scroll_position_y < 0 ||
              (row.page_index !== null && (!Number.isSafeInteger(row.page_index) || row.page_index < 0)) ||
              (row.page_fraction !== null && (!Number.isFinite(row.page_fraction) || row.page_fraction < 0 || row.page_fraction > 1)) ||
              (row.page_index === null) !== (row.page_fraction === null)) throw invalid('Posición de lectura inválida.');
        }
        rows.DiscoveryPreferences[0].value_json=JSON.stringify(validateDiscovery(JSON.parse(rows.DiscoveryPreferences[0].value_json)));
        for (const row of rows.RecommendationFeedback) {
          const item = JSON.parse(row.item_json); httpUrl(item.url); if (!text(item.title) || !text(item.source, 80)) throw invalid('Valoración inválida.');
          row.item_json=JSON.stringify({source:item.source,title:item.title.trim(),url:httpUrl(item.url),...normalizeMetadata(item,true)});
          row.item_key=`${item.source}|${httpUrl(item.url)}`;
          row.feedback_json=JSON.stringify(validateFeedback(JSON.parse(row.feedback_json)));
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw invalid('El archivo contiene datos inválidos o referencias incompletas.');
      } finally { staged.close(); }

      if (!allowPrivate) {
        const targets = [...rows.Series.map(row => ({ source: row.source, url: row.url_origen })),
          ...rows.RecommendationFeedback.map(row => JSON.parse(row.item_json))];
        const privateMatch = db.prepare(`SELECT 1 FROM Series s WHERE s.source=? AND s.url_origen=?
          AND (s.is_private=1 OR EXISTS(SELECT 1 FROM Series e WHERE e.work_id=s.work_id AND e.is_private=1))`);
        if (targets.some(item => privateMatch.get(item.source, item.url))) {
          throw new ApiError(423, 'PRIVATE_LOCKED', 'Desbloquea la biblioteca privada antes de combinar cambios con una lectura oculta.');
        }
      }

      return db.transaction(() => {
        const seriesMap = new Map(), chapterMap = new Map(), folderMap = new Map(), workMap = new Map();
        const counts = { seriesAdded: 0, chaptersAdded: 0, foldersAdded: 0, progressImported: 0 };
        for (const row of rows.Folders) {
          let saved = db.prepare('SELECT id FROM Folders WHERE name=? COLLATE NOCASE').get(row.name);
          if (!saved) { saved = db.prepare('INSERT INTO Folders(name) VALUES(?) RETURNING id').get(row.name); counts.foldersAdded++; }
          folderMap.set(row.id, saved.id);
        }
        for (const work of rows.Works) {
          const edition = rows.Series.filter(row => row.work_id === work.id).map(row => db.prepare('SELECT work_id FROM Series WHERE source=? AND url_origen=?').get(row.source, row.url_origen)).find(Boolean);
          const id = edition?.work_id ?? db.prepare('INSERT INTO Works(title,feedback_json) VALUES(?,?) RETURNING id').get(work.title, work.feedback_json).id;
          workMap.set(work.id, id);
        }
        for (const row of rows.Series) {
          let saved = db.prepare('SELECT * FROM Series WHERE source=? AND url_origen=?').get(row.source, row.url_origen);
          if (!saved) {
            saved = db.prepare(`INSERT INTO Series(source,titulo,url_origen,portada,metadata_json,reading_state,last_sync_at,work_id,is_private,is_adult)
              VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING *`).get(row.source, row.titulo, row.url_origen, row.portada, row.metadata_json, row.reading_state, row.last_sync_at, workMap.get(row.work_id), row.is_private, row.is_adult);
            counts.seriesAdded++;
          } else if (row.is_private) db.prepare('UPDATE Series SET is_private=1 WHERE work_id=?').run(saved.work_id);
          seriesMap.set(row.id, saved.id);
        }
        // Una obra compartida no debe mezclar ediciones públicas con privadas.
        db.prepare('UPDATE Series SET is_private=1 WHERE work_id IN (SELECT work_id FROM Series WHERE is_private=1)').run();
        for (const row of rows.Chapters) {
          const serie = seriesMap.get(row.serie_id);
          let saved = db.prepare('SELECT id FROM Chapters WHERE serie_id=? AND url_origen=?').get(serie, row.url_origen);
          if (!saved) { saved = db.prepare('INSERT INTO Chapters(serie_id,titulo,url_origen,numero,estado_lectura,first_seen_at,is_new) VALUES(?,?,?,?,?,?,?) RETURNING id').get(serie, row.titulo, row.url_origen, row.numero, row.estado_lectura, row.first_seen_at, row.is_new); counts.chaptersAdded++; }
          else if (row.estado_lectura) db.prepare('UPDATE Chapters SET estado_lectura=1,is_new=0 WHERE id=?').run(saved.id);
          chapterMap.set(row.id, saved.id);
        }
        for (const row of rows.SeriesFolders) db.prepare('INSERT OR IGNORE INTO SeriesFolders VALUES(?,?)').run(seriesMap.get(row.serie_id), folderMap.get(row.folder_id));
        for (const row of rows.Progress) {
          const serie = seriesMap.get(row.serie_id), existing = db.prepare('SELECT timestamp FROM Progress WHERE serie_id=?').get(serie);
          const timestamp = Math.min(row.timestamp, Date.now());
          if (!existing || existing.timestamp < timestamp) {
            db.prepare(`INSERT INTO Progress(serie_id,capitulo_id,scroll_position_y,timestamp,page_index,page_fraction) VALUES(?,?,?,?,?,?)
              ON CONFLICT(serie_id) DO UPDATE SET capitulo_id=excluded.capitulo_id,scroll_position_y=excluded.scroll_position_y,timestamp=excluded.timestamp,page_index=excluded.page_index,page_fraction=excluded.page_fraction`).run(serie, chapterMap.get(row.capitulo_id), row.scroll_position_y, timestamp, row.page_index, row.page_fraction);
            counts.progressImported++;
          }
        }
        const oldPreferences = db.prepare('SELECT value_json FROM DiscoveryPreferences WHERE id=1').get().value_json;
        if (oldPreferences === '{}') db.prepare('UPDATE DiscoveryPreferences SET value_json=? WHERE id=1').run(rows.DiscoveryPreferences[0].value_json);
        for (const row of rows.RecommendationFeedback) db.prepare('INSERT OR IGNORE INTO RecommendationFeedback VALUES(?,?,?,?)').run(row.item_key, row.item_json, row.feedback_json, row.updated_at);
        db.prepare('DELETE FROM Works WHERE NOT EXISTS(SELECT 1 FROM Series WHERE work_id=Works.id)').run();
        return { imported: true, ...counts };
      })();
    }
  };
}
