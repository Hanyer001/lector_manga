CREATE TABLE Works (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  feedback_json TEXT NOT NULL DEFAULT '{}'
);
ALTER TABLE Series ADD COLUMN work_id INTEGER REFERENCES Works(id);
INSERT INTO Works(id,title) SELECT id,titulo FROM Series;
UPDATE Series SET work_id=id;
CREATE INDEX idx_series_work ON Series(work_id);
CREATE TABLE DiscoveryPreferences (id INTEGER PRIMARY KEY CHECK(id=1), value_json TEXT NOT NULL DEFAULT '{}');
INSERT INTO DiscoveryPreferences(id) VALUES(1);
CREATE TABLE RecommendationFeedback (
  item_key TEXT PRIMARY KEY,
  item_json TEXT NOT NULL,
  feedback_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
