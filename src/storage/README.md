# Persistencia SQLite

El modo local conserva esta base. En modo con cuenta, Supabase guarda un
snapshot JSONB por usuario de hasta 12 MiB; Node lo hidrata en SQLite en memoria
para cada petición y confirma escrituras mediante una revisión transaccional.
No se guardan bases locales de las cuentas ni imágenes de capítulos en Render.
`transfer.js` exporta/importa enlaces, carpetas, leídos y posición; remapea IDs,
valida referencias y normaliza los metadatos. La exportación omite el PIN y,
por defecto, las lecturas privadas. Consulta [DEPLOYMENT.md](../../DEPLOYMENT.md).

Por defecto la base está en `lector_manga/data/reader.db`. Guarda únicamente
títulos, fuente, enlaces de serie/capítulo/portada, leído/no leído, posición,
metadatos, estado personal, carpetas y fecha de detección de novedades.
No contiene imágenes ni HTML de capítulos. Las páginas y portadas llegan por
streaming con `no-store`, y el visor libera las imágenes lejanas, al cambiar de
capítulo, al ocultar la pestaña o al cerrar la lectura. Una copia pequeña en
localStorage conserva el progreso y proporciones de imagen de hasta 10 capítulos,
sin bytes de imágenes ni URLs de descarga.

Los archivos `reader.db-wal` y `reader.db-shm` son auxiliares de SQLite. El tamaño
mostrado por `/api/storage` es el tamaño lógico de la base, no la suma de esos
archivos ni el uso de RAM del navegador. SQLite reutiliza páginas libres tras
eliminar series; el archivo no necesariamente se encoge inmediatamente.

`removeFavorite(id)` elimina en cascada capítulos y progreso de esa serie.
La política de streaming requiere conexión y que el capítulo siga disponible
en el proveedor para volver a leerlo.

`schema.sql` define Series, Chapters y Progress con claves foráneas, índices y
restricciones. `database.js` usa better-sqlite3, WAL, busy timeout de 3 s,
consultas preparadas y transacciones síncronas breves. `schema.sql` crea la versión
inicial; `library-migration.sql` aplica la versión 2 en una transacción,
conservando series, capítulos y progreso existentes. Agrega `Folders` y
`SeriesFolders`; las carpetas son agrupaciones, no directorios con imágenes.
`reader-migration.sql` aplica la versión 3: agrega `page_index` y `page_fraction`
al progreso para reanudar en ambos modos. Las filas antiguas conservan su posición
Y y reciben un ancla nula; el lector mantiene esa restauración como alternativa.

La primera sincronización establece el catálogo base sin marcar todos los
capítulos como nuevos. Las posteriores registran nuevas URLs; abrir un capítulo
o marcarlo como leído reconoce su novedad. Los géneros, autores y origen se
guardan cuando la fuente los proporciona y pueden completarse manualmente.
Los campos manuales se conservan al volver a sincronizar.

```js
import { openDatabase } from './database.js';

const db = openDatabase('/ruta/datos/reader.db');
try {
  const series = db.saveFavorite({ source: 'sitio-ejemplo', titulo: 'Mi serie',
    url_origen: 'https://example.com/serie', portada: null });
  const [chapter] = db.saveChapters(series.id, [
    { title: 'Capítulo 1', number: 1, url: 'https://example.com/capitulo/1' }
  ]);
  db.updateProgress({ serie_id: series.id, capitulo_id: chapter.id, scroll_position_y: 1250.5 });
  db.markChapterRead(chapter.id);
} finally { db.close(); }
```

Guardar favoritos es idempotente. Sincronizar capítulos mantiene IDs y estado de
lectura. Progress contiene una posición vigente por serie, capítulo asociado y
timestamp Unix UTC en milisegundos. Se permiten números de capítulo decimales o
nulos. Los capítulos no se identifican por número sino por serie + URL.
La portada nula al guardar un favorito conserva la portada anterior.

La versión 4 añade Works, Series.work_id, DiscoveryPreferences y
RecommendationFeedback. La migración crea una obra independiente por favorito
existente, sin cambiar IDs, capítulos, notas de lectura ni anclas. No fusiona
títulos automáticamente. La ficha agrupada usa un título común, conserva los
títulos de cada edición y elige como principal la última fuente leída.

Gustos y nota opcional (1–10) viven en la obra; preferencias de sugerencias externas
se identifican por fuente + URL y guardan solo metadatos. Al añadir una sugerencia
a la biblioteca, sus gustos pasan a su nueva ficha. Vincular una edición adopta
los gustos y el estado personal de la ficha destino; separar conserva una copia.
Abandonado es un estado personal válido y no se usa como semilla positiva.
Las etiquetas manuales prevalecen sobre las sincronizaciones, incluidos los temas.
