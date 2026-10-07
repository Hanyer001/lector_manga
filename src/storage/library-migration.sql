ALTER TABLE Series ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE Series ADD COLUMN reading_state TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE Series ADD COLUMN last_sync_at INTEGER;
ALTER TABLE Chapters ADD COLUMN first_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Chapters ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0 CHECK(is_new IN (0,1));
UPDATE Series SET last_sync_at=0 WHERE EXISTS(SELECT 1 FROM Chapters WHERE serie_id=Series.id);
CREATE TABLE Folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80)
);
CREATE TABLE SeriesFolders (
  serie_id INTEGER NOT NULL REFERENCES Series(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES Folders(id) ON DELETE CASCADE,
  PRIMARY KEY(serie_id,folder_id)
);
CREATE INDEX idx_chapters_updates ON Chapters(is_new,first_seen_at);
