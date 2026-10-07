-- Ancla independiente del ancho de pantalla y del modo de lectura.
ALTER TABLE Progress ADD COLUMN page_index INTEGER CHECK(page_index IS NULL OR page_index >= 0);
ALTER TABLE Progress ADD COLUMN page_fraction REAL CHECK(page_fraction IS NULL OR (page_fraction >= 0 AND page_fraction <= 1));
