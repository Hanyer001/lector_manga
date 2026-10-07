# Lector vertical y paginado · Vanilla JS

Descubrir incluye filtros combinados por géneros y temas, exclusiones, origen,
publicación y mínimo de capítulos en español. Las opciones visuales permiten recomendar por
gustos, lecturas recientes, una obra, géneros o variedad. Cada tarjeta explica su
motivo y ofrece Me gustó/No me gustó/Más como este/No me interesa/Ya lo leí.
Los descartes se pueden deshacer y el reinicio de gustos pide una segunda pulsación.
Las notas se editan desde la ficha; los gustos se guardan en SQLite, no solo en
este navegador. El estado Abandonado se edita en Organizar esta historia.

La biblioteca y Continuar leyendo agrupan fuentes vinculadas en una portada.
En la ficha se cambia de fuente, se vinculan ediciones guardadas o un enlace nuevo,
y se puede separar una fuente. Vincular pide comprobar que sea la misma obra.
Para continuar desde otra traducción, primero se previsualiza una coincidencia
única por número, después se confirma y se abre desde el inicio del capítulo.
Extras sin número y números duplicados requieren elegir un capítulo manualmente.
El título de la ficha permanece estable al cambiar de fuente.

## Ejecutar

```sh
npm run server
```

Abrir http://127.0.0.1:3210/ (no abrir index.html como file://).
La pantalla inicial es **Inicio**, con una historia destacada, carrusel de últimas
lecturas y novedades detectadas. **Descubrir** (`/#discover`) reúne las recomendaciones
de varias fuentes y carga la primera consulta al entrar. **Personalizar búsqueda**
despliega los catálogos y filtros; elegir **A tu gusto** abre los géneros directamente.
La búsqueda entre sugerencias y los órdenes Afinidad/Título/Catálogo se aplican sin
consultar de nuevo las fuentes. **Más historias como esta** abre Descubrir con esa
obra seleccionada. Las sugerencias se conservan al cambiar de pestaña durante la sesión.
Los modos se consultan al pulsarlos; al elegir una semilla también empieza «Más
como…». Ese modo sustituye las inclusiones de géneros/temas anteriores por la obra
seleccionada y conserva exclusiones, fuentes y límites. No guarda filtros al hacer
ese cambio. Las sugerencias guardadas en memoria de la sesión duran dos minutos
y se invalidan al cambiar la biblioteca, el historial o los gustos. «Actualizar»
fuerza una consulta nueva. Las fuentes muestran «consultando…» mientras llegan
otras recomendaciones: no se espera a que terminen todos los proveedores.
Las tarjetas sin cambios conservan sus elementos de imagen entre actualizaciones
progresivas. Cambiar el modo o los filtros cancela la consulta anterior y limpia
sus resultados para evitar mostrar recomendaciones de un contexto distinto.
**Añadir serie** abre un
formulario compacto para pegar su URL; la API detecta la fuente, consulta su ficha
y sincroniza los capítulos. **Filtros** usa el catálogo de fuentes activas del servidor.
Una fuente antigua guardada puede seguir apareciendo en Biblioteca con la etiqueta
«no disponible», aunque ya no se ofrezca para buscar. Selecciona una portada, actualiza sus
capítulos si hace falta, elige uno y pulsa **Leer capítulo**.
También admite enlaces directos: `/?chapter=ID_LOCAL`.

**Tus historias** muestra portadas, títulos, fuente y capítulos pendientes; pulsa
una portada para elegir capítulos o **Continuar** para abrir el último guardado.
Puedes buscar por título sin acentos y, desde **Filtros**, seleccionar fuente,
ordenar por lectura reciente/título y mostrar solo pendientes. También hay filtros
por género, autor, publicación, estado personal y carpeta. **Organizar esta
historia**, dentro del selector de capítulos, permite cambiar el estado, asignar
varias carpetas y completar metadatos. El origen desconocido se muestra como tal;
los datos editados manualmente prevalecen al sincronizar.

**Explorar** busca en las fuentes seleccionadas o todas las activas y entrega
resultados parciales por proveedor, con paginación y reintento independientes.
Admite botón Buscar y búsqueda automática tras 350 ms con al menos dos caracteres.
Las fuentes sin adaptador operativo no aparecen en Explorar ni reciben consultas.
El menú **⋯** de cada tarjeta contiene **Quitar de
biblioteca**: pide un segundo clic para confirmar y elimina esa serie junto con
sus capítulos y progreso.

**Ajustes** permite elegir Sistema/Oscuro/Negro OLED/Claro, acentos violeta/cian/
carmesí o color personalizado, densidad, banderas y transparencia. Se guardan
localmente en este navegador. Inter se sirve desde `fonts/` con su licencia.
La navegación es lateral en escritorio e inferior en móvil; Atrás recupera vistas.

**Actualizar mis series** consulta metadatos y enlaces, no imágenes de capítulos.
La primera sincronización establece una base y no genera falsas novedades.
Las recomendaciones se cargan al entrar en Descubrir y se actualizan con sus botones; se basan en géneros conocidos
y excluyen favoritos de la misma fuente/URL. Si falta información, puedes
completarla en la ficha. Las carpetas son agrupaciones SQLite, no directorios físicos;
quitar una conserva sus series.

Durante la lectura, los controles superpuestos mantienen acceso a **Biblioteca**
y **Cerrar capítulo**. **Volver al lector** permite regresar al capítulo abierto conservando
la posición; navegar por la biblioteca no sobrescribe su progreso. Los formularios
se cierran con Escape, mantienen el recorrido de Tab dentro del diálogo y
devuelven el foco al control que los abrió. El resumen de almacenamiento está
plegado al pie de la biblioteca.

**Cerrar capítulo** guarda el progreso y retira las imágenes del DOM; al volver
a abrirlo obtiene la lista actual del sitio y descarga las páginas necesarias.
**Recargar imágenes del capítulo** renueva las URLs firmadas cuando caducan.
La consulta se puede cancelar. No hay modo offline ni descargas permanentes.
El diseño es responsivo, pero el servidor escucha solo en el PC local; aún no
es una aplicación móvil instalada ni un servidor accesible desde otro equipo.

Para probar inmediatamente sin favoritos, red externa ni un sitio real:

```sh
npm run demo:reader
```

Abrir http://127.0.0.1:3211/?chapter=1. Esta demo crea una base SQLite en memoria,
dos capítulos de 72 paneles sintéticos y un origen HTTP local. No modifica tus
favoritos. Sus PNG están incluidos en test/fixtures; no requiere librerías de
imágenes ni dependencias adicionales. El contador `/__demo/metrics` solo existe
en ese servidor de prueba y muestra solicitudes y concurrencia del origen.

## Archivos

- `index.html`: estructura semántica, biblioteca, lector, navegación y estados.
- `reader.css`: diseño oscuro responsivo y tira de imágenes sin separaciones.
- `shell.css`: tokens de temas, lenguaje visual, navegación y vistas responsivas.
- `appearance.js`: resolución inicial y persistencia de tema/acento sin parpadeo.
- `shell.js`: dashboard, organización, ajustes y búsquedas simultáneas.
- `reader.js`: obtención de datos, observers, cola de carga, virtualización y UI.
- `reader-core.js`: debounce, constructor de URLs y escritor de progreso serial.
- `reader-controls.js` / `.css`: overlay, ajustes persistentes y controles táctiles.
- `reader-preferences.js`: validación, dirección, anclas y ventana de precarga.
- `library-view.js`: tarjetas de biblioteca y búsqueda, portadas y acciones.
- `discovery-stream.js`: lectura incremental de NDJSON, UTF-8 y detección de cortes.

## Carga y memoria

Las imágenes nacen sin src. Cada contenedor tiene un aspect-ratio estimado, o el
último conocido, para que su altura no sea cero. IntersectionObserver y el scroll
detectan las imágenes visibles. La ventana incluye esas imágenes y las siguientes
3–5 (4 por defecto); en paginado incluye la actual y las próximas. La cola permite
tres cargas activas y da prioridad a las visibles antes de las anticipadas.
Cada carga tiene timeout y botón para reintentar si falla.

Después de cargar, se usa la proporción natural exacta y se conserva el ancla
visible del scroll. Los contenedores e imágenes son bloques con margin, padding,
border y line-height cero. El visor no agrega separación ni recorta la imagen;
los espacios blancos que formen parte del archivo original se conservan.

Se retienen como máximo dos anteriores, además de la ventana de precarga;
las lejanas se liberan y sus descargas pendientes se cancelan. Se conserva su
proporción para no colapsar la tira; al regresar, se vuelven a cargar.
Esto reduce la cantidad de imágenes activas. El navegador decide cuándo liberar
su caché de bitmaps: quitar src no garantiza liberación inmediata ni un límite
absoluto de RAM. La demo verifica la concurrencia y los elementos activos, no
pretende medir la memoria de un capítulo real. Una imagen individual muy larga
puede seguir siendo costosa al decodificarla.

## Contratos de API

`GET /api/chapters/:id/images` llama al scraper desde el backend y devuelve
chapter (incluidos id y serie_id) e images con originalUrl, referer y URL firmada.
El frontend construye las imágenes así:

```text
/api/image?url=URL_CODIFICADA&referer=REFERER_CODIFICADO&ticket=FIRMA
```

Se mantiene ticket por compatibilidad con el proxy existente. El proxy verifica
que url y referer coincidan con la firma. No se convierte en un proxy de URLs
arbitrarias. La forma anterior `/api/image?ticket=…` continúa funcionando.

El progreso se envía a `POST /api/progress` como:

```json
{ "serie_id": 1, "capitulo_id": 5, "scroll_position_y": 1234.5,
  "page_index": 3, "page_fraction": 0.25 }
```

Es un alias de la operación SQLite existente; PUT /api/series/:id/progress sigue
disponible. El scroll usa listener pasivo, UI limitada por requestAnimationFrame
y debounce de 2000 ms. Las escrituras se serializan y se agrupan para evitar
solapamientos. Al cambiar de capítulo se intenta guardar inmediatamente.
visibilitychange utiliza fetch con keepalive y pagehide usa sendBeacon cuando
no hay escritura previa en vuelo. El cierre forzado del proceso no garantiza la
entrega de la última petición.

La página (índice desde cero) y la fracción entre 0 y 1 se guardan también en SQLite.
Permiten cambiar de modo o ancho conservando el lugar. Clientes anteriores pueden
seguir enviando solo la posición Y; la API limpia cualquier ancla anterior para
evitar reanudar desde una página obsoleta.

Se conserva una copia local de la posición, ancho natural y proporciones para los últimos diez
capítulos. Permite restaurar por imagen y fracción sin descargar todas las
imágenes anteriores. Si falta esa copia, se utiliza la posición Y de SQLite; con
alturas desconocidas o un ancho distinto, la restauración inicial puede ser
aproximada. El porcentaje de lectura también es aproximado hasta conocer todas
las alturas. La restauración no sobrescribe el progreso guardado con un cero
transitorio durante la carga.

## Controles

Modo vertical continuo sin separaciones añadidas o paginado con una imagen por
vez. Dirección RTL por defecto: flecha izquierda y zona izquierda avanzan;
derecha retrocede. LTR invierte esos controles sin invertir el orden de las URLs.
Cambiar a paginado selecciona ajuste a la altura; regresar a vertical selecciona
anchura. Puedes elegir otro ajuste después y se conserva al reabrir el lector.
En vertical, las flechas conservan el desplazamiento nativo.

Clic/tap en el centro o C/Espacio/F alterna los controles; Escape los oculta.
El botón **Controles** permite recuperarlos con teclado. El overlay se oculta
tras inactividad, salvo al interactuar con sus ajustes.

Ajustes: anchura (320–1200 px), altura o tamaño original; zoom 50–200%, brillo
35–100%, filtro cálido 0–70% y precarga de 3–5 imágenes. El tamaño original usa
las dimensiones naturales y admite desplazamiento si supera la pantalla. Los
filtros son CSS locales; no modifican los archivos del proveedor. Preferencias
persistentes por navegador. Barra deslizante para saltar a una imagen,
capítulo anterior/siguiente, marcado como leído y retorno al inicio. Biblioteca
con selectores etiquetados, foco visible y mensajes de carga/error. No usa fuentes
externas, React, Vue ni un bundler.

## Verificación

Descubrir incorpora una selección visual de 23 géneros y 36 temas: seis accesos
rápidos, búsqueda de etiquetas, inclusión/exclusión y filtros avanzados plegables.
Las fuentes de recomendaciones se pueden activar individualmente. Los resultados
muestran el catálogo en la portada, etiquetas y un motivo; se intercalan proveedores
y pueden filtrarse por fuente sin otra consulta. Los fallos parciales se muestran
en una sección de estado. «Descubrir historias» guarda los filtros; «Actualizar»
consulta sin escribir preferencias. Los estados distinguen errores de consulta,
filtros no admitidos por un catálogo y búsquedas sin coincidencias.
Explorar selecciona inicialmente los siete
catálogos en español; las fuentes en inglés o de idioma variable son opcionales.

`node --test --test-isolation=none`: pruebas de API, SQLite, proxy, contratos del
visor, debounce y serialización de escrituras. Verificación adicional en navegador
con la demo de 72 imágenes: carga inicial parcial, tres cargas activas en la cola,
cero separación entre paneles, retiro de imágenes lejanas y reanudación tras recarga.
La cancelación de una imagen puede tardar en llegar al origen; el cierre de una
conexión anterior puede coincidir brevemente con una nueva petición.

Referencias oficiales:
[IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API),
[sendBeacon y visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon).

## Privacidad y clasificación

En modo con cuenta, `network.js` gestiona Supabase Auth con enlaces de un solo uso al correo. Admite las plantillas predeterminadas con flujo implícito y las personalizadas con `token_hash`, y retira los datos del enlace tras verificarlos;
`account-ui.js` incorpora sesión, sincronización e importación/exportación.
Las transferencias privadas piden la contraseña de cifrado en un diálogo y bloquean la bóveda
al terminar. Los recursos usan rutas relativas para GitHub Pages. La API y las
imágenes se solicitan con autorización, sin cookies de terceros; los blobs se
revocan al retirarse de la pantalla. La caché PWA conserva solo la interfaz.
La suite `npm run test:ui` prepara Chromium y WebKit/iPhone; requiere instalar
sus motores y un entorno que permita iniciarlos. Consulta las comprobaciones
de Safari real en [DEPLOYMENT.md](../../DEPLOYMENT.md).

`privacy-ui.js` gestiona el bloqueo, creación/cambio de contraseña (PIN solo en modo local) y las acciones por obra. `content-policy.js` comparte los criterios de visibilidad entre cliente y servidor. +18 forma parte de la taxonomía: selector de género en Explorar, botón en recomendaciones y filtro de Biblioteca; las solicitudes generales excluyen clasificaciones adultas conocidas. La privada tiene un panel separado y nunca se mezcla con los carruseles o las semillas de recomendaciones generales. Los títulos privados no se colocan en el nombre de la pestaña ni en las URLs de capítulos y no se guardan sus anclas en localStorage. Al bloquear, se eliminan portadas y texto privado del lector y del selector.


La bóveda con cuenta utiliza sql.js solo en memoria del navegador y sincroniza un paquete AES-GCM con revisiones. El bloqueo retira claves, base temporal y portadas. Los títulos, carpetas y progreso privados se cifran antes de enviarse; Render sigue procesando las consultas de fuentes e imágenes mientras se lee.

`private-session.js` controla los plazos de la bóveda E2EE: 30 minutos de inactividad
y 2 minutos en segundo plano por defecto, configurables en Ajustes y guardados por
navegador. La clave nunca se almacena con las preferencias. Cambiar de sección
conserva el desbloqueo y retira carpetas privadas de los controles públicos.
Mientras la página está oculta, una máscara cubre la interfaz. Al volver se compara
el reloj con los plazos originales, incluso si Safari suspendió los temporizadores.
Recargar, pagehide, cerrar sesión y bloquear manualmente eliminan la clave y el DOM
privado. El PIN local conserva su política anterior.
