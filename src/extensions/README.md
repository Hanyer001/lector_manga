# Fuentes y adaptadores

Fuentes nuevas comprobadas el 8 de octubre de 2026. No hay dependencias nuevas.

`catalog.js` es el único registro utilizado por CLI, API y visor. Declara la
identidad, URL base, orígenes de páginas/API/imágenes, idiomas, capacidades y
cargador. `index.js` conserva el punto público de importación. Los adaptadores se
cargan a demanda: una fuente con sintaxis inválida no impide iniciar la API ni
utilizar otras fuentes.

## Estado

| ID | Sitio | Adaptador | Condiciones |
|---|---|---|---|
| manhwaweb | ManhwaWeb | Activo, API JSON | Español; capítulos alojados en el propio sitio; conserva versiones por URL |
| mangadex | MangaDex | Activo, API REST | Español y español latino por defecto; feed paginado; omite capítulos externos/no disponibles |
| webtoon | WEBTOON Español | Activo, HTML | Episodios publicados para lectura web; recorre la paginación de la serie |
| olympus | Olympus | Activo, API JSON | Español; índice público con búsqueda local por nombre, fichas y capítulos paginados; solo cómics |
| inmanga | InManga | Activo, HTML y JSON | Español; consulta mediante formulario público, capítulos y plantilla CDN sin ejecutar scripts |
| novelcool | NovelCool Español | Activo, HTML | Solo cómics; búsqueda, recomendaciones, capítulos y todas las páginas del lector |
| tumanga | TuManga.net | Activo, HTML y JSON embebido | Español; catálogo independiente de zonatmo.com; capítulos públicos, búsqueda y recomendaciones |
| asura | Asura Scans | Activo, HTML | El dominio proporcionado es inglés; capítulos públicos |
| tapas | Tapas | Activo, HTML y JSON | Episodios gratuitos sin sesión; idioma de cada obra; no desbloquea episodios |
| sitio-ejemplo | Fixtures locales | Activo, demostración | Ficha, capítulos e imágenes; sin búsqueda |
| tmo | zonatmo.org | Activo en local, HTML | Búsqueda y recomendaciones paginadas; extrae capítulos del listado antiguo oculto; desactivado en Render por HTTP 403 |
| senshimanga | capibaratraductor.com/senshimanga | Activo, HTML y API JSON | Catálogo del grupo SenshiManga; datos Astro UTF-8 sin ejecutar scripts; páginas ordenadas; excluye novelas, capítulos restringidos y sin publicar |
| manhwa-latino | manhwa-latino.com | No verificado | HTTP 403 de Cloudflare y dominio bloqueado por la política de seguridad del navegador; no se anuncia como disponible |
| yugen | yugenmangas.lat | Pendiente | Fallo de verificación TLS; sin desactivar controles de certificado |
| bato | bato.to | No disponible | Redirige a un aviso de cierre |
| lectormanga | lectormanga.com | Pendiente | El nombre es ambiguo y el dominio probado no resuelve; se necesita el enlace activo |
| mangaplus | MANGA Plus | Pendiente | Web accesible, API de lectura respondió 403 desde este entorno |
| mango | mangomanga.co | Pendiente | Sitio promocional de aplicación; sin catálogo/lector web encontrado |

Los estados pendientes describen la comprobación actual, no una caída global
permanente del sitio. Estas seis fuentes y el ejemplo no aparecen en el catálogo
público ni en Explorar. Sus identificadores se conservan internamente para reconocer
enlaces y favoritos antiguos; no se habilitan como adaptadores funcionales.

## Contrato

- `search(query, {page: 0})` → `{source, results: [{title,url,cover,...}], nextPage}`.
  Páginas desde cero; `nextPage: null` señala el final. Sin resultados es válido.
- `getManga(url)` → `{source, manga: {title,url,cover,description,...}}`.
- `getChapters(url)` → `{source,manga,chapters:[{title,number,url}]}`.
  Decimales admitidos; extras pueden tener número nulo. Las distintas traducciones
  se conservan por URL. Una lista vacía genera `EXTRACTION_EMPTY`.
- `getChapterImages(url)` → `{source,chapter:{title,url},images:[{index,url,referer}]}`.
  Índices desde uno y orden original. URLs firmadas de terceros conservan query.
- `recommend(filters)` → `{source,results,unavailableTags?,partial?,warnings?}`. Capacidad declarada
  en ManhwaWeb, MangaDex, Olympus, WEBTOON, NovelCool, TuManga.net, ZonaTMO y SenshiManga; InManga ofrece búsqueda y lectura.
  Devuelve metadatos para aplicar los filtros en el servidor. No inventa etiquetas
  ausentes: WEBTOON no aporta los temas de cada obra y Olympus no declara su país.
  SenshiManga tiene fichas sin géneros: conserva autores y demografía disponibles,
  pero no inventa etiquetas. Ambas fuentes nuevas admiten `nextPage` en Descubrir.

Cada adaptador valida el origen y formato de los enlaces antes de consultar la
red. Las APIs JSON aceptan solo respuestas JSON y orígenes declarados. Olympus
también declara su API pública de capítulos en `panel.olympusxyz.com`.
La paginación tiene un límite y falla sin entregar silenciosamente una lista
truncada. Para MangaDex puede cambiarse `languages` al crear el scraper.
WEBTOON usa `episode_no` como orden numérico, incluyendo prólogos y especiales.
NovelCool recorre las páginas de cada capítulo, con el formato de diez imágenes
cuando está anunciado por el lector, y valida que todas pertenezcan al mismo
capítulo. El límite es cien páginas de navegación; un fallo impide entregar una
lista incompleta. TuManga.net analiza el JSON de `ts_reader.run` sin ejecutar código
del sitio y conserva el orden de imágenes. Sus recomendaciones mantienen las
fichas válidas si otra falla e incluyen una advertencia de resultado parcial.
TuManga.net limita recomendaciones a 6,5 segundos y cada ficha a 2,2 segundos,
con dos consultas simultáneas. Una ficha lenta se cancela; las demás conservan
el orden del catálogo. NovelCool y TuManga.net consultan una sola vez su catálogo
general por petición; el servidor aplica los filtros sin repetir las mismas fichas
por cada género aprendido.
WEBTOON conserva en RAM el catálogo de géneros durante cinco minutos; si el filtro
no existe en su catálogo (por ejemplo, Harem), informa «filtro no disponible».

## API

```text
GET /api/sources
GET /api/sources/detect?url=URL
GET /api/sources/:id/search?q=CONSULTA&page=0
GET /api/sources/:id/manga?url=URL
POST /api/series {"url_origen":"URL"}
```

La última operación detecta la fuente y obtiene título y portada. Se mantiene
compatibilidad con `{source,titulo,url_origen,portada?}`. Las fuentes pendientes
devuelven `503 SOURCE_UNAVAILABLE`, las desconocidas `400 UNKNOWN_SOURCE` y las
operaciones no admitidas `400 UNSUPPORTED_OPERATION`.
`GET /api/sources` publica únicamente las nueve fuentes activas, sin la demo.

El proxy sigue validando tickets HMAC, Referer y cada salto de redirección. Para
MangaDex admite únicamente nodos HTTPS bajo `mangadex.network`, sin puertos
alternativos; Tapas utiliza sus dominios CDN. No se aceptan dominios de imágenes
arbitrarios elegidos por el cliente. Una imagen retirada del alojamiento puede
devolver 404 aunque el capítulo siga listándose en la fuente.

## Incorporar un sitio

1. Verificar la página o API actual y escoger un capítulo público de prueba.
2. Añadir una clase en `src/extensions/`, reutilizando `BaseScraper`.
3. Declarar en `catalog.js` los orígenes y las capacidades reales.
4. Añadir pruebas con HTML/JSON local para títulos, capítulos, imágenes,
   paginación, extras, versiones y fallos. La suite no depende de la red externa.
5. Comprobar una serie real mediante la API y el proxy antes de habilitarla.

No añadir otra lista en `backend/sources.js`: ese módulo deriva las fuentes del
catálogo y contiene solo la política de validación.

## Verificación

`npm test` usa `node --test --test-isolation=none`, compatible con el entorno que
bloquea subprocesos. Incluye aislamiento de extensiones rotas, contratos,
paginación, políticas de imágenes y flujo completo con dos fuentes en SQLite.

Las pruebas locales incluyen ranking por modo, cancelación, cachés compartidas y
entrega progresiva. Se comprobó búsqueda, ficha, sincronización, obtención
de imágenes, una imagen por el proxy y guardado/lectura de progreso de las nueve
fuentes activas, con SQLite aislado en memoria. NovelCool entregó 53 imágenes de
un capítulo y TuManga.net 27 en la primera prueba; ambos aportaron recomendaciones.
WEBTOON entregó 93 imágenes de un episodio y recomendaciones de Acción.
Se corrigieron entradas de imagen vacías de ManhwaWeb y el selector de portada
de InManga. Esto no garantiza la disponibilidad de todos los capítulos del sitio:
una ficha de TuManga.net respondió 500 y algunas imágenes antiguas de ManhwaWeb
respondieron 404 en su alojamiento. Se conservan los demás resultados válidos.

Referencias: [API MangaDex](https://api.mangadex.org/docs/redoc.html),
[ManhwaWeb](https://manhwaweb.com/), [WEBTOON](https://www.webtoons.com/es/),
[Asura](https://asurascans.com/), [Tapas](https://tapas.io/),
[Olympus](https://olympusxyz.com/), [InManga](https://inmanga.com/),
[NovelCool Español](https://es.novelcool.com/), [TuManga.net](https://tumanga.net/).

Se comprobaron Berserk en ZonaTMO (402 capítulos, 23 imágenes del capítulo 386)
y Blue Lock en SenshiManga (369 capítulos, 10 imágenes del capítulo 364).
Las comprobaciones del proxy utilizan SQLite aislado; no modifican bibliotecas personales.
SenshiManga respondió correctamente desde Render. ZonaTMO respondió HTTP 403 desde
ese alojamiento: `unavailableIn.render` la desactiva mediante la variable de plataforma
`RENDER=true`, manteniendo el adaptador en local. No se recurre a navegadores, proxies
externos ni cambios de identidad para eludir ese bloqueo.
