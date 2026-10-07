ALTER TABLE Series ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0 CHECK(is_private IN (0,1));
ALTER TABLE Series ADD COLUMN is_adult INTEGER NOT NULL DEFAULT 0 CHECK(is_adult IN (0,1));
UPDATE Series SET is_adult=1 WHERE json_extract(metadata_json,'$.contentRating') IN ('erotica','pornographic','adult');
CREATE TABLE PrivateAccess(id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, pin_hash TEXT NOT NULL);
CREATE INDEX idx_series_visibility ON Series(is_private,is_adult);
