import { ApiError, httpUrl, positiveId } from '../backend/errors.js';
import { normalizeMetadata, readingStates } from './metadata.js';
import { createDiscoveryStore } from './discovery.js';
import { isAdult, inLibraryScope } from '../frontend/content-policy.js';
import { createLibraryTransfer, createSnapshotTools } from './transfer.js';

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) {
    throw new ApiError(400, 'INVALID_FIELD', `${name} debe ser texto no vacío de hasta 2000 caracteres.`);
  }
  return value.trim();
}

export function createDatabaseStore(db, openDatabase) {
    const saveSeries = db.prepare(`INSERT INTO Series(source, titulo, url_origen, portada)
      VALUES (@source, @titulo, @url_origen, @portada)
      ON CONFLICT(source, url_origen) DO UPDATE SET titulo=excluded.titulo,
      portada=COALESCE(excluded.portada, Series.portada) RETURNING *`);
    const saveChapter = db.prepare(`INSERT INTO Chapters(serie_id, titulo, url_origen, numero, first_seen_at, is_new)
      VALUES (@serie_id, @titulo, @url_origen, @numero, @first_seen_at, @is_new)
      ON CONFLICT(serie_id, url_origen) DO UPDATE SET titulo=excluded.titulo, numero=excluded.numero RETURNING *`);
    const progress = db.prepare(`INSERT INTO Progress(serie_id, capitulo_id, scroll_position_y, timestamp, page_index, page_fraction)
      VALUES (@serie_id, @capitulo_id, @scroll_position_y, @timestamp, @page_index, @page_fraction)
      ON CONFLICT(serie_id) DO UPDATE SET capitulo_id=excluded.capitulo_id,
      scroll_position_y=excluded.scroll_position_y, timestamp=excluded.timestamp,
      page_index=excluded.page_index, page_fraction=excluded.page_fraction RETURNING *`);
    const readChapter = db.prepare('UPDATE Chapters SET estado_lectura=? WHERE id=? RETURNING *');
    const seriesById = db.prepare('SELECT * FROM Series WHERE id=?');
    const chapterById = db.prepare('SELECT * FROM Chapters WHERE id=?');
    const chaptersBySeries = db.prepare('SELECT * FROM Chapters WHERE serie_id=? ORDER BY numero IS NULL, numero, id');
    const progressBySeries = db.prepare('SELECT * FROM Progress WHERE serie_id=?');
    const allSeries = db.prepare(`SELECT s.*, p.capitulo_id AS ultimo_capitulo_id, p.scroll_position_y,
      p.timestamp AS ultima_lectura, c.titulo AS ultimo_capitulo,
      (SELECT count(*) FROM Chapters WHERE serie_id=s.id) AS total_capitulos,
      (SELECT count(*) FROM Chapters WHERE serie_id=s.id AND estado_lectura=0) AS pendientes
      FROM Series s LEFT JOIN Progress p ON p.serie_id=s.id
      LEFT JOIN Chapters c ON c.id=p.capitulo_id ORDER BY s.titulo, s.id`);
    const deleteSeries = db.prepare('DELETE FROM Series WHERE id=?');
    const enrich = row => row && { ...JSON.parse(row.metadata_json),
      ...JSON.parse(db.prepare('SELECT feedback_json FROM Works WHERE id=?').get(row.work_id)?.feedback_json??'{}'), ...row,
      work_title:db.prepare('SELECT title FROM Works WHERE id=?').get(row.work_id)?.title??row.titulo,
      folder_ids: db.prepare('SELECT folder_id FROM SeriesFolders WHERE serie_id=?').all(row.id).map(f => f.folder_id),
      nuevos: db.prepare('SELECT count(*) AS n FROM Chapters WHERE serie_id=? AND is_new=1').get(row.id).n };
    const mergeMetadata = (id, input, manual = false) => {
      const row = seriesById.get(id);
      const old = JSON.parse(row.metadata_json);
      const patch = normalizeMetadata(input, manual);
      const manualFields = new Set(old.manualFields ?? []);
      for (const [key, value] of Object.entries(patch)) if (manual || !manualFields.has(key)) {
        old[key] = value; if (manual) manualFields.add(key);
      }
      old.manualFields = [...manualFields];
      db.prepare('UPDATE Series SET metadata_json=? WHERE id=?').run(JSON.stringify(old), id);
      if (patch.contentRating !== undefined && (manual || !manualFields.has('contentRating'))) {
        db.prepare('UPDATE Series SET is_adult=? WHERE work_id=(SELECT work_id FROM Series WHERE id=?)').run(Number(isAdult({ contentRating: old.contentRating })), id);
      }
    };

    const getSeries = id => {
      const row = seriesById.get(positiveId(id));
      if (!row) throw new ApiError(404, 'SERIES_NOT_FOUND', 'Serie no encontrada.');
      return enrich(row);
    };
    const getChapter = id => {
      const row = chapterById.get(positiveId(id));
      if (!row) throw new ApiError(404, 'CHAPTER_NOT_FOUND', 'Capítulo no encontrado.');
      return row;
    };

    return {
      ...createSnapshotTools(db),
      ...createLibraryTransfer(db, openDatabase),
      ...createDiscoveryStore(db,getSeries),
      close: () => db.close(),
      listSeries: () => allSeries.all().map(enrich),
      listVisibleSeries: (scope = 'library') => allSeries.all().map(enrich).filter(item => inLibraryScope(item, scope)),
      getPrivateAccess: () => db.prepare('SELECT salt,pin_hash FROM PrivateAccess WHERE id=1').get() ?? null,
      savePrivateAccess: (salt, hash) => db.prepare('INSERT INTO PrivateAccess(id,salt,pin_hash) VALUES(1,?,?)').run(salt, hash),
      replacePrivateAccess: (salt, hash) => db.prepare('UPDATE PrivateAccess SET salt=?,pin_hash=? WHERE id=1').run(salt, hash),
      removeFavorite: db.transaction(id => { const series = getSeries(id); deleteSeries.run(series.id);
        db.prepare('DELETE FROM Works WHERE id=? AND NOT EXISTS(SELECT 1 FROM Series WHERE work_id=Works.id)').run(series.work_id);
        return { id: series.id, deleted: true }; }),
      storageInfo() {
        return { mode: 'stream', persistentImages: false,
          databaseBytes: db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true }),
          series: db.prepare('SELECT count(*) AS n FROM Series').get().n,
          chapters: db.prepare('SELECT count(*) AS n FROM Chapters').get().n };
      },
      getSeries,
      getChapter,
      saveFavorite: db.transaction(({ source, titulo, url_origen, portada = null, metadata = {}, work_id }) => {
        if(work_id!==undefined&&!db.prepare('SELECT id FROM Works WHERE id=?').get(positiveId(work_id)))throw new ApiError(404,'WORK_NOT_FOUND','Obra no encontrada.');
        const row = saveSeries.get({ source: requiredText(source, 'source'), titulo: requiredText(titulo, 'titulo'),
          url_origen: httpUrl(url_origen), portada: portada === null ? null : httpUrl(portada) });
        if(work_id!==undefined&&row.work_id&&row.work_id!==Number(work_id))throw new ApiError(409,'WORK_CONFLICT','Esta fuente ya está guardada en otra ficha. Vincúlala desde la ficha de la obra.');
        if(!row.work_id) {
          const feedback=db.prepare('SELECT feedback_json FROM RecommendationFeedback WHERE item_key=?').get(`${source}|${row.url_origen}`)?.feedback_json??'{}';
          const work=work_id??db.prepare('INSERT INTO Works(title,feedback_json) VALUES (?,?) RETURNING id').get(row.titulo,feedback).id;
          const readingState=db.prepare('SELECT reading_state FROM Series WHERE work_id=? LIMIT 1').get(work)?.reading_state??'planned';
          const inherited = db.prepare('SELECT MAX(is_private) AS p,MAX(is_adult) AS a FROM Series WHERE work_id=?').get(work);
          db.prepare('UPDATE Series SET work_id=?,reading_state=?,is_private=?,is_adult=? WHERE id=?').run(work,readingState,inherited.p??0,inherited.a??0,row.id);
          db.prepare('DELETE FROM RecommendationFeedback WHERE item_key=?').run(`${source}|${row.url_origen}`);
        }
        mergeMetadata(row.id, metadata); return getSeries(row.id);
      }),
      updateSourceMetadata(id, input) { id = getSeries(id).id; mergeMetadata(id, input); return getSeries(id); },
      updateLibrary: db.transaction((id, input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_FIELD', 'Organización inválida.');
        id = getSeries(id).id;
        for (const field of ['is_private','is_adult']) if (input[field] !== undefined) {
          if (typeof input[field] !== 'boolean') throw new ApiError(400, 'INVALID_FIELD', 'La privacidad y la clasificación +18 deben ser booleanas.');
          db.prepare(`UPDATE Series SET ${field}=? WHERE work_id=(SELECT work_id FROM Series WHERE id=?)`).run(Number(input[field]), id);
        }
        if (input.is_adult !== undefined) for (const edition of db.prepare('SELECT id FROM Series WHERE work_id=(SELECT work_id FROM Series WHERE id=?)').all(id)) mergeMetadata(edition.id, { contentRating: input.is_adult ? 'adult' : 'safe' }, true);
        if (input.reading_state !== undefined) {
          if (!readingStates.includes(input.reading_state)) throw new ApiError(400, 'INVALID_FIELD', 'Estado personal inválido.');
          db.prepare('UPDATE Series SET reading_state=? WHERE work_id=(SELECT work_id FROM Series WHERE id=?)').run(input.reading_state, id);
        }
        if (input.metadata !== undefined) mergeMetadata(id, input.metadata, true);
        if (input.folder_ids !== undefined) {
          if (!Array.isArray(input.folder_ids) || input.folder_ids.length > 100) throw new ApiError(400, 'INVALID_FIELD', 'Carpetas inválidas.');
          const folders = [...new Set(input.folder_ids.map(positiveId))];
          for (const folder of folders) if (!db.prepare('SELECT id FROM Folders WHERE id=?').get(folder)) throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Carpeta no encontrada.');
          db.prepare('DELETE FROM SeriesFolders WHERE serie_id=?').run(id);
          for (const folder of folders) db.prepare('INSERT INTO SeriesFolders VALUES (?,?)').run(id, folder);
        }
        return getSeries(id);
      }),
      listFolders() { return db.prepare('SELECT f.*, (SELECT count(*) FROM SeriesFolders sf JOIN Series s ON s.id=sf.serie_id WHERE sf.folder_id=f.id AND s.is_private=0 AND s.is_adult=0) AS count FROM Folders f ORDER BY name').all(); },
      saveFolder(name, id) {
        name = requiredText(name, 'name');
        if (name.length > 80) throw new ApiError(400, 'INVALID_FIELD', 'El nombre admite hasta 80 caracteres.');
        try {
          if (id === undefined) return db.prepare('INSERT INTO Folders(name) VALUES (?) RETURNING *').get(name);
          const row = db.prepare('UPDATE Folders SET name=? WHERE id=? RETURNING *').get(name, positiveId(id));
          if (!row) throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Carpeta no encontrada.');
          return row;
        } catch (error) { if (error.code?.startsWith('SQLITE_CONSTRAINT_UNIQUE')) throw new ApiError(409, 'FOLDER_EXISTS', 'Ya existe una carpeta con ese nombre.'); throw error; }
      },
      removeFolder(id) {
        const row = db.prepare('DELETE FROM Folders WHERE id=? RETURNING id').get(positiveId(id));
        if (!row) throw new ApiError(404, 'FOLDER_NOT_FOUND', 'Carpeta no encontrada.');
        return { ...row, deleted: true };
      },
      listUpdates() {
        return db.prepare(`SELECT c.id, c.serie_id, c.titulo AS chapter_title, c.numero, c.first_seen_at,
          s.titulo, s.source, s.portada, s.url_origen, s.metadata_json FROM Chapters c JOIN Series s ON s.id=c.serie_id
          WHERE c.is_new=1 AND s.is_private=0 AND s.is_adult=0 ORDER BY c.first_seen_at DESC, c.id DESC LIMIT 100`).all().map(row => ({ ...row, ...JSON.parse(row.metadata_json) }));
      },
      saveChapters: db.transaction((serieId, chapters) => {
        const series = getSeries(serieId), serie_id = series.id;
        if (!Array.isArray(chapters)) throw new ApiError(400, 'INVALID_CHAPTERS', 'chapters debe ser un arreglo.');
        const first_seen_at = Date.now(), is_new = Number(series.last_sync_at !== null);
        const saved = chapters.map(chapter => {
          if (chapter.number !== null && (typeof chapter.number !== 'number' || !Number.isFinite(chapter.number))) {
            throw new ApiError(400, 'INVALID_NUMBER', 'Número de capítulo inválido.');
          }
          return saveChapter.get({ serie_id, first_seen_at, is_new, titulo: requiredText(chapter.title, 'title'),
            url_origen: httpUrl(chapter.url), numero: chapter.number });
        });
        db.prepare('UPDATE Series SET last_sync_at=? WHERE id=?').run(first_seen_at, serie_id);
        return saved;
      }),
      listChapters(serieId) { return chaptersBySeries.all(getSeries(serieId).id); },
      getProgress(serieId) { return progressBySeries.get(getSeries(serieId).id) ?? null; },
      updateProgress: db.transaction(({ serie_id, capitulo_id, scroll_position_y, page_index = null, page_fraction = null, expected_timestamp }) => {
        serie_id = getSeries(serie_id).id;
        const previous = progressBySeries.get(serie_id);
        if (expected_timestamp !== undefined && expected_timestamp !== (previous?.timestamp ?? null)) {
          throw new ApiError(409, 'PROGRESS_CONFLICT', 'Tu progreso cambió en otro dispositivo. Abre de nuevo el capítulo para continuar desde la posición sincronizada.');
        }
        const chapter = getChapter(capitulo_id);
        if (chapter.serie_id !== serie_id) throw new ApiError(400, 'CHAPTER_MISMATCH', 'El capítulo no pertenece a la serie.');
        if (typeof scroll_position_y !== 'number' || !Number.isFinite(scroll_position_y) || scroll_position_y < 0) {
          throw new ApiError(400, 'INVALID_SCROLL', 'scroll_position_y debe ser un número finito no negativo.');
        }
        if ((page_index !== null && (!Number.isSafeInteger(page_index) || page_index < 0)) ||
            (page_fraction !== null && (typeof page_fraction !== 'number' || !Number.isFinite(page_fraction) || page_fraction < 0 || page_fraction > 1)) ||
            ((page_index === null) !== (page_fraction === null))) {
          throw new ApiError(400, 'INVALID_PAGE_ANCHOR', 'El ancla requiere página entera no negativa y fracción entre 0 y 1.');
        }
        db.prepare('UPDATE Chapters SET is_new=0 WHERE id=?').run(chapter.id);
        return progress.get({ serie_id, capitulo_id: chapter.id, scroll_position_y, page_index, page_fraction, timestamp: Math.max(Date.now(), (previous?.timestamp ?? 0) + 1) });
      }),
      markChapterRead(id, read = true) {
        if (typeof read !== 'boolean') throw new ApiError(400, 'INVALID_READ_STATE', 'read debe ser booleano.');
        const row = readChapter.get(Number(read), positiveId(id));
        if (!row) throw new ApiError(404, 'CHAPTER_NOT_FOUND', 'Capítulo no encontrado.');
        if (read) { db.prepare('UPDATE Chapters SET is_new=0 WHERE id=?').run(row.id); row.is_new = 0; }
        return row;
      }
    };
}
