-- Una fila en Series representa un favorito. Los capítulos se identifican por URL,
-- ya que extras y especiales pueden compartir número o no tenerlo.
CREATE TABLE IF NOT EXISTS Series (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  titulo TEXT NOT NULL CHECK(length(trim(titulo)) > 0),
  url_origen TEXT NOT NULL,
  portada TEXT,
  UNIQUE(source, url_origen)
);

CREATE TABLE IF NOT EXISTS Chapters (
  id INTEGER PRIMARY KEY,
  serie_id INTEGER NOT NULL REFERENCES Series(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  url_origen TEXT NOT NULL,
  numero REAL,
  estado_lectura INTEGER NOT NULL DEFAULT 0 CHECK(estado_lectura IN (0, 1)),
  UNIQUE(serie_id, url_origen),
  UNIQUE(id, serie_id)
);

-- Una posición vigente por serie. capitulo_id evita reanudar en un capítulo ajeno.
-- timestamp: milisegundos Unix UTC asignados por el servidor.
CREATE TABLE IF NOT EXISTS Progress (
  id INTEGER PRIMARY KEY,
  serie_id INTEGER NOT NULL UNIQUE REFERENCES Series(id) ON DELETE CASCADE,
  capitulo_id INTEGER NOT NULL,
  scroll_position_y REAL NOT NULL CHECK(scroll_position_y >= 0),
  timestamp INTEGER NOT NULL,
  FOREIGN KEY(capitulo_id, serie_id) REFERENCES Chapters(id, serie_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chapters_series_number ON Chapters(serie_id, numero);
