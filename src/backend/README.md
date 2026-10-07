# API local y proxy por streaming

El modo con cuentas mantiene estos contratos y requiere un Bearer token de
Supabase verificado por el servidor. Su configuración está en
[la guía de despliegue](../../DEPLOYMENT.md). En producción se exige HTTPS;
solo se admiten los orígenes configurados. Cada petición utiliza el estado de
su usuario, y las escrituras se confirman en PostgreSQL antes de responder.
En producción, las lecturas privadas se cifran en el navegador y se sincronizan mediante `/api/vault`; el servidor no recibe su contraseña ni su recuperación.
`X-Operation-Id` identifica reintentos; las respuestas repetidas vuelven a
comprobar la privacidad. Las escrituras de progreso deben incluir
`expected_timestamp` (null al iniciar), para detectar posiciones obsoletas.

`GET /api/account` devuelve la sesión y revisión; `GET /api/library/export`
exporta enlaces y progreso generales. El cliente combina ese respaldo con el paquete privado cifrado al seleccionar `?private=1`.
`POST /api/library/import` acepta solo datos generales en producción; la parte privada se importa y cifra en el cliente. En modo local, la transferencia privada utiliza el PIN y el respaldo es legible.

## Bóveda cifrada con cuenta

- `GET /api/vault` devuelve únicamente el paquete cifrado y su revisión del usuario autenticado.
- `PUT /api/vault` guarda un paquete validado con revisión esperada e identificador de operación.
- `POST /api/vault/move` y `/api/vault/reveal` confirman en una transacción las revisiones de biblioteca general y privada.
- `POST /api/vault/covers`, `/api/vault/chapters` y `/api/vault/images` realizan consultas de lectura transitorias con dominios permitidos y tickets asociados al usuario.

La contraseña y la recuperación se procesan mediante Web Crypto en el navegador. El backend rechaza con `426 E2EE_REQUIRED` las antiguas rutas privadas que guardaban metadatos legibles. Las rutas `/api/private/*` son operaciones virtuales del cliente cuando está activo el cifrado; no se envían al servidor.

Ejecutar desde lector_manga con Node >= 22.19:

```sh
npm ci
npm run server
```

Escucha exclusivamente en `http://127.0.0.1:3210`. Variables opcionales:
`PORT` (0 elige un puerto libre), `DB_PATH`, `FRONTEND_ORIGINS` (orígenes exactos
separados por coma). No añadir comodines ni el origen `null`.

## Endpoints

| Método | Ruta | Datos / resultado |
|---|---|---|
| GET | /api/health | Estado del proceso |
| GET | /api/storage | Modo streaming, bytes lógicos de SQLite y cantidades de series/capítulos |
| GET | /api/diagnostics | Última consulta por fuente, duración y código de resultado |
| GET | /api/sources | Catálogo público de fuentes activas y sus capacidades, sin demo ni pendientes |
| GET | /api/sources/detect?url=… | Detecta fuente por dominio exacto |
| GET | /api/sources/:id/search?q=…&page=0 | Busca series en esa fuente |
| GET | /api/sources/:id/manga?url=… | Obtiene ficha |
| GET | /api/series | Favoritos, portada firmada `coverUrl`, capítulos pendientes y última lectura |
| DELETE | /api/series/:id | Quita serie, capítulos y progreso mediante claves foráneas |
| POST | /api/series | `{url_origen}` detecta fuente y ficha; también acepta `{source,titulo,url_origen,portada?}` |
| POST | /api/series/:id/sync | Scrapea capítulos y los guarda sin borrar estados de lectura |
| GET | /api/series/:id/chapters | Capítulos persistidos con IDs locales |
| GET | /api/chapters/:id/images | Scrapea y entrega URLs firmadas del proxy |
| GET | /api/image?ticket=… | Bytes de imagen en streaming |
| GET | /api/series/:id/progress | Progreso vigente o null |
| PUT | /api/series/:id/progress | `{capitulo_id,scroll_position_y,page_index?,page_fraction?}` |
| POST | /api/progress | `{serie_id,capitulo_id,scroll_position_y,page_index?,page_fraction?}`; usado por el visor |
| PUT | /api/chapters/:id/read | `{read:true}` o `{read:false}`; por defecto true |

El ancla opcional requiere ambos campos: `page_index` es un entero desde cero y
`page_fraction` un número entre 0 y 1. Omitir ambos conserva compatibilidad con
clientes anteriores y limpia cualquier ancla obsoleta. No contiene imágenes.

Cada endpoint devuelve errores JSON `{error:{code,message}}`, salvo cuando el
stream ya comenzó: en ese caso se destruye la conexión para indicar truncamiento.
Las respuestas API usan `Cache-Control: no-store`. Búsquedas y listados incluyen
`coverUrl` firmada para cargar portadas a través del mismo proxy de imágenes.
Los bytes de las portadas tampoco se persisten.

El plazo total de consulta es 45 s e incluye paginación, intentos y esperas.
La cancelación del cliente se propaga mediante AbortSignal a ambos transportes.
Las fuentes del catálogo permiten dos operaciones simultáneas por proveedor,
una para navegador; el resto espera con el mismo presupuesto y puede cancelarse.
`/api/diagnostics` conserva una entrada por fuente utilizada, sin URLs, consultas
ni tickets. Los fallos se registran con fuente, operación, duración y código.

## Streaming

`imageProxy.js` usa `http/https.get` → `Transform` contador → `pipeline(res)`.
El transporte nativo no descomprime silenciosamente la respuesta. Solicita
`Accept-Encoding: identity`, inyecta `Referer` y `User-Agent` desde la política de
la extensión y conserva Content-Type/Content-Length cuando están disponibles.
No usa `fetch().arrayBuffer()`, `Buffer.concat()` ni archivos intermedios.
`pipeline` propaga backpressure: un lector lento frena al origen y los buffers no
crecen con el tamaño total de la imagen. Hay hasta 8 streams simultáneos y un
límite de 64 MiB por imagen, configurable al crear el proxy.

Timeouts configurables: cabeceras 15 s (incluye conexión), inactividad del socket
15 s y plazo total 120 s (incluye redirecciones y cliente lento). Antes de enviar
cabeceras responde 504; después, cierra el stream. Desconectar el cliente cancela
la petición remota. No reintenta una imagen parcialmente enviada ni concatena
datos de un segundo intento. El frontend puede solicitar de nuevo la imagen.

El frontend recibe URL externa y Referer junto con un ticket HMAC
válido 6 horas, sin caché de imágenes en RAM. Reiniciar el proceso invalida los
tickets; volver a pedir `/images` los renueva. Los parámetros opcionales url y
referer del visor se comparan con el ticket; no permiten elegir otro destino.
Cada salto de redirección se
valida contra la política declarada en `src/extensions/catalog.js`. Allí se
configuran dominios reales y CDN; `sources.js` deriva el registro común. Los
nodos dinámicos de MangaDex se limitan a HTTPS bajo `mangadex.network`; Tapas
declara sus CDN bajo `tapas.io`. La lista presupone dominios confiables administrados
por el desarrollador: no es un proxy público ni un filtro DNS de redes privadas.
El proxy admite imágenes raster; una respuesta HTML de bloqueo se rechaza.

## Integración con el lector

1. Guardar la serie y sincronizar sus capítulos.
2. Pedir `/api/chapters/:id/images` y asignar cada URL local a un `<img>`.
3. Guardar el scroll con debounce (p. ej. 500 ms) y al cambiar de capítulo.
4. Al reabrir, consultar progreso y restaurarlo cuando el layout esté preparado.

```js
const api = 'http://127.0.0.1:3210';
const response = await fetch(`${api}/api/chapters/${chapterId}/images`);
if (!response.ok) throw new Error('No se pudo cargar el capítulo');
const { images } = await response.json();
for (const page of images) {
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.crossOrigin = 'anonymous'; // Envía Origin también desde un WebView de otro origen.
  img.src = new URL(page.url, api).href;
  container.append(img);
}
```

Un frontend servido por otro puerto debe declarar su origen exacto mediante
FRONTEND_ORIGINS. El servidor valida Host y Origin; no expone CORS universal.
En Electron puede ejecutarse como proceso auxiliar. En Tauri se distribuye un
sidecar Node, con better-sqlite3 compilado para cada plataforma/ABI; Rust controla
su arranque, puerto y cierre. Autoriza el origen exacto del WebView y configura
CSP connect-src/img-src hacia loopback. La base debe residir en el directorio de
datos de la aplicación (DB_PATH), no en recursos empaquetados. No hay que portar
el motor a Rust para esta etapa. El visor Vanilla JS se sirve en `/`; no se ha
añadido empaquetado de escritorio. Consulta `../frontend/README.md`.

## Validación

Descubrimiento y obras (SQLite v4):

- `GET/PUT /api/discovery`: preferencias. Arrays `genres`, `themes`,
  `excludeGenres`, `excludeThemes`; `country`, `status`, `minChapters`,
  `genreMatch` (`any`/`all`) y `sources` (IDs; vacío significa todos los aptos).
- `POST /api/discovery/recommendations`: `mode` personal/recent/similar/diverse/genres,
  `seedWorkId` o `seedFeedbackKey` obligatorio en similar y filtros opcionales.
  La segunda opción identifica una ficha pública ya valorada, sin aceptar enlaces
  arbitrarios como semilla. Devuelve motivos y
  advertencias por etiquetas ausentes o consultas que no pudieron verificarse.
  Las candidatas vienen de MangaDex, ManhwaWeb, Olympus, WEBTOON, NovelCool y TuManga.net. Se consultan
  en paralelo con 12 segundos de presupuesto por catálogo (8 para TuManga.net) y
  errores parciales. Se ejecutan en paralelo las consultas de etiquetas aprendidas.
  Se intercalan hasta 24 resultados y se quitan títulos iguales entre fuentes.
  `sources` en la respuesta detalla candidatas, sugerencias, estado y avisos de
  cada proveedor. Los géneros en modo O se consultan por separado; las etiquetas
  no admitidas se señalan como `unsupported`, diferenciadas de errores de conexión.
  Un adaptador puede devolver `partial` y `warnings` para conservar otras fichas válidas.
  Las etiquetas explícitas y exclusiones se comprueban antes de servir los resultados.
  El mínimo comprueba hasta doce candidatas, con dos consultas de
  capítulos a la vez, 15 segundos de presupuesto y cancelación al desconectar.
  Cada candidata se comprueba en su propia fuente. Cuenta números únicos y
  extras sin número por URL. No almacena estos capítulos ni sus imágenes.
  Guarda en RAM las cantidades verificadas y las respuestas públicas de catálogo,
  nunca resultados personalizados ni tickets: máximo 128 entradas, cinco minutos
  para respuestas completas y treinta segundos para catálogos parciales.
  Consultas simultáneas iguales comparten tráfico; cancelar una no interrumpe a
  otra que aún espere ese catálogo. Al cancelar todas se aborta la consulta remota.
  `refresh:true` vuelve a consultar y no conserva errores en caché.
  En modos personales, completa hasta tres fichas sin etiquetas desde sus fuentes;
  respeta campos manuales y usa una caché de metadatos en RAM de diez minutos,
  acotada a 200 fichas. La operación no modifica la biblioteca.
  El cliente puede enviar `Accept: application/x-ndjson`: recibe líneas `start`,
  `progress` y `complete`, con resultados y estados por proveedor. `error` indica
  un fallo posterior a las cabeceras. La respuesta JSON anterior sigue disponible.
  Cada avance conserva las firmas de portada dentro de la consulta e informa
  `elapsedMs`; cada proveedor terminado incluye `durationMs` y `cached`.
- `POST/DELETE /api/discovery/feedback`: ficha + preferencia, o `key` para deshacer.
- `DELETE /api/discovery`: reinicia notas/gustos/descartes/filtros; conserva biblioteca,
  estados personales, organización y progreso.
- `GET /api/works/:id`, `PUT /api/works/:id/feedback`: ediciones y gustos comunes.
- `POST /api/works/:id/editions` con `serie_id`: vinculación explícita de una edición.
- `DELETE /api/series/:id/edition`: separa una edición conservando datos y gustos.
- `POST /api/series` admite `work_id` para añadir una fuente a la misma ficha.
  Una fuente ya guardada en otra obra exige vincularse explícitamente (409).
- `GET /api/works/:id/transfer?from=ID&to=ID` previsualiza la correspondencia.
  `POST` con `from/to` la aplica únicamente si el número coincide con un solo
  capítulo. La lectura nueva comienza en página cero; la anterior se conserva.
  No deduce equivalencias para extras sin número ni para traducciones duplicadas.

`npm test` incluye pruebas SQLite, HTTP local, streaming, límites, errores,
timeouts, fuentes y desconexión del cliente. Usa `--test-isolation=none` para
funcionar también cuando el entorno bloquea subprocesos del runner.

Referencias: [pipeline de Node](https://nodejs.org/api/stream.html),
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md),
[Express 5](https://expressjs.com/en/5x/api/).

## Privacidad local y género +18

El siguiente bloqueo por PIN corresponde al modo local; la producción utiliza la bóveda cifrada descrita arriba.

- `GET /api/private/status`: estado de configuración y sesión, sin hash ni sal.
- `POST /api/private/setup`, `POST /api/private/unlock`: `{pin}`; cookie de sesión HttpOnly/SameSite=Strict exclusiva del puerto.
- `POST /api/private/lock`: revoca el token y elimina la cookie.
- `PUT /api/private/pin`: `{pin}`, exige sesión abierta e invalida todas las sesiones.
- `GET /api/series?scope=library|adult|private`: la vista pública es predeterminada; private exige sesión.
- `PUT /api/series/:id/library`: `is_private` / `is_adult` booleanos, aplicados a todas las ediciones de la obra. Mover a privada exige sesión.
- `POST /api/adult/catalog`: `{query,source,page}`; catálogo auxiliar para el género +18. Respuesta por proveedor, fallos parciales y paginación de búsquedas.
- Recomendaciones: incluir `adult` o `+18` en `filters.genres` activa únicamente proveedores con `capabilities.adult`, conserva las demás etiquetas y exige clasificación adulta en cada resultado.

Las rutas de capítulos, imágenes, progreso, ediciones y obras privadas exigen sesión. Los tickets de imágenes guardan el ID de la serie y el proxy comprueba su privacidad actual, incluso para tickets anteriores al cambio. Lecturas privadas y sus alias se excluyen de los perfiles/resultados generales. Las sesiones vencen tras 10 minutos sin acceso y tienen límite absoluto de una hora; desaparecen al reiniciar. La clasificación no equivale a privacidad. SQLite conserva los metadatos sin cifrar.
