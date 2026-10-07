# Publicar y sincronizar tu biblioteca

La instalación de este repositorio utiliza [GitHub Pages](https://hanyer001.github.io/lector_manga/), [Render](https://lector-manga-api.onrender.com/api/health) y Supabase. Esta guía también explica cómo crear una instalación propia. El repositorio incluye únicamente configuración pública; el secreto de tickets de imágenes permanece en Render. La API no necesita una clave administrativa de Supabase.

```text
iPhone / computador → GitHub Pages: interfaz
                    → Supabase Auth: enlace de acceso al correo
                    → Supabase Data API con JWT: bóveda privada cifrada + RLS
                    → Render por HTTPS: API, fuentes y proxy de imágenes
                      → Supabase PostgreSQL con JWT + RLS: biblioteca general
```

## Seguir usando la biblioteca local

Requiere Node.js 22.19 o posterior; Node.js 24 es la versión elegida para el despliegue. En PowerShell:

```powershell
Set-Location .\lector_manga
npm ci
npm run server
```

Abre `http://127.0.0.1:3210/`. Detén el servidor con Ctrl+C. Sin `.env`, el modo predeterminado sigue siendo local y utiliza `data/reader.db`; no necesita Supabase ni una cuenta. Si creas `.env` a partir de `.env.example`, conserva `APP_MODE=local` para este uso. La dirección 127.0.0.1 pertenece al computador y no permite abrir esa instalación desde el iPhone.

Antes de migrar, utiliza **Cuenta → Exportar biblioteca**. Conserva el archivo JSON fuera del repositorio. Para incluir lecturas ocultas, marca **Incluir lecturas privadas en la exportación** y autoriza la operación con el PIN cuando la aplicación lo solicite. El archivo contiene enlaces, títulos, organización y progreso; puede revelar tus lecturas.

## 1. Crear el repositorio de GitHub

1. Crea un repositorio, por ejemplo `lector_manga`. Puedes usar uno público para publicar con GitHub Pages sin contratar un plan adicional; comprueba las condiciones de tu cuenta si prefieres uno privado.
2. Sube el código del proyecto y `package-lock.json`, incluyendo `.github/workflows/pages.yml`, `render.yaml` y la carpeta `supabase`.
3. Usa la rama `main`, que es la rama configurada en el workflow.
4. Revisa los archivos antes de subirlos. `.gitignore` excluye `.env`, bases SQLite, `work`, dependencias, resultados de pruebas y `dist`. Mantén también tus exportaciones personales fuera del repositorio. Los archivos que Git ya estuviera siguiendo no dejan de estarlo por añadirlos a `.gitignore`.

La URL habitual de este ejemplo será `https://TU_USUARIO.github.io/lector_manga/`. Sustituye los nombres de ejemplo por los reales en los siguientes pasos. Conserva la ruta del repositorio y la barra final en la URL del sitio. GitHub Pages publica archivos estáticos; Node y SQLite no se ejecutan allí. [Documentación de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## 2. Crear Supabase y preparar la base de datos

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En su **SQL Editor**, ejecuta en orden las migraciones `202610070001_accounts.sql`, `202610070002_private_vault.sql` y [202610080003_direct_vault.sql](supabase/migrations/202610080003_direct_vault.sql). Crean tablas y RPC, conservan las bóvedas existentes y habilitan políticas RLS para que cada usuario acceda únicamente a sus filas.
3. Desde la configuración del proyecto, anota su URL HTTPS y la clave **publishable**. Los proyectos con claves antiguas pueden usar `anon` como pública. No uses `secret`/`service_role` en Pages ni Render.
4. En una instalación nueva, ejecuta también [202610080004_retire_admin_access.sql](supabase/migrations/202610080004_retire_admin_access.sql) antes de abrir el sitio. Si actualizas la versión antigua, ejecuta primero la migración 003, despliega el servidor nuevo y comprueba que esté Live; después ejecuta la 004 y elimina `SUPABASE_SECRET_KEY` de Render. No repitas migraciones ya aplicadas.

La biblioteca general contiene metadatos legibles para el servidor. La privada se sincroniza directamente desde el navegador a Supabase como un bloque cifrado; Render no recibe ese bloque, la contraseña ni la recuperación. La API general usa la clave pública y el JWT verificado del usuario. Las políticas comprueban `auth.uid() = user_id` en SELECT, INSERT, UPDATE y DELETE; las RPC son SECURITY INVOKER y confirman versiones en una transacción. No añadas una política pública para “arreglar” un error de permisos. Las claves administrativas pueden saltarse RLS: retirarlas de Render reduce el alcance de un incidente. [RLS en Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Configurar el acceso por correo

1. En **Authentication → Sign In / Providers**, conserva habilitado **Email** y la confirmación de correo.
2. En **Authentication → URL Configuration**, configura **Site URL** como `https://TU_USUARIO.github.io/lector_manga/` y añade esa misma URL exacta a **Redirect URLs**.
3. Los enlaces de las plantillas predeterminadas funcionan sin editarlas. El SDK recibe la sesión por el fragmento de la URL y la aplicación lo retira antes de cargar la biblioteca. El enlace puede abrirse desde otro navegador o dispositivo.
4. Si configuras SMTP propio y quieres personalizar **Confirm signup** y **Magic link**, también se admite un enlace a la página inicial con hash de un solo uso:

   ```html
   <h2>Accede a Lector Manga</h2>
   <p><a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&amp;type=email">Entrar a mi biblioteca</a></p>
   <p>Si no solicitaste este acceso, ignora este mensaje.</p>
   ```

   El cliente verifica ese hash con Supabase y lo elimina de la dirección. Un enlace expirado permite solicitar otro sin reiniciar la página.
5. Para admitir correos de usuarios externos, configura un proveedor SMTP en **Authentication → Email → SMTP Settings**. El servicio de correo incluido con Supabase solo envía a direcciones del equipo del proyecto y tiene un límite inicial de dos mensajes por hora. En el plan gratuito también exige SMTP propio para editar plantillas. Sirve para empezar con tu propio correo; no equivale a correo de producción abierto al público.

No necesitas un proyecto Google Cloud para esta modalidad. [Enlaces de acceso de Supabase](https://supabase.com/docs/guides/auth/auth-email-passwordless), [límites y SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 3. Crear el servidor en Render

Conecta el repositorio en [Render](https://dashboard.render.com/) y crea un **Blueprint** con `render.yaml`. El archivo prepara Node.js 24, instala dependencias y Chrome para los adaptadores que requieren JavaScript, y arranca `npm run server`. El health check es `/api/health`. [Blueprints de Render](https://render.com/docs/blueprint-spec), [Puppeteer en Render](https://render.com/docs/deploy-puppeteer-node).

Configura estos valores en el servicio:

| Variable | Valor |
| --- | --- |
| `APP_MODE` | `cloud` — ya declarado en el Blueprint |
| `NODE_ENV` | `production` — ya declarado |
| `PUBLIC_API_ORIGIN` | El origen HTTPS real asignado al servicio, por ejemplo `https://lector-manga-api.onrender.com` |
| `FRONTEND_ORIGINS` | `https://TU_USUARIO.github.io`, sin la ruta del repositorio |
| `SUPABASE_URL` | `https://TU_PROYECTO.supabase.co` |
| `SUPABASE_PUBLIC_KEY` | La clave publishable, o la antigua anon |
| `IMAGE_TICKET_SECRET` | El Blueprint genera un secreto; mantenlo estable entre despliegues |
| `INSTALL_BROWSER` | `1` — ya declarado |

Si Render asigna una URL diferente a la prevista, actualiza `PUBLIC_API_ORIGIN` con la URL real y vuelve a desplegar. Todas las variables de origen deben incluir únicamente esquema y dominio, sin ruta, parámetros ni credenciales. Para más de una interfaz autorizada, separa sus orígenes por comas en `FRONTEND_ORIGINS`. Render proporciona `PORT` automáticamente.

Una vez desplegado, comprueba `https://TU_SERVICIO.onrender.com/api/health`. Debe responder correctamente; las demás rutas de datos requieren una sesión válida. Una respuesta correcta del health check confirma que arrancó el servidor, no que todas las fuentes externas funcionen desde Render. Prueba búsqueda, capítulos e imágenes por fuente después de publicar: sus bloqueos y disponibilidad pueden diferir de los del computador.

El Blueprint elige el plan gratuito para empezar. Render suspende los servicios gratuitos tras 15 minutos sin tráfico entrante; la siguiente visita puede esperar a que el servidor arranque. Los límites y recursos del plan también afectan al scraping con navegador. La biblioteca permanece en Supabase y las claves privadas desbloqueadas permanecen solo en el navegador. [Límites del plan gratuito](https://render.com/docs/free).

## 4. Publicar la interfaz en GitHub Pages

En el repositorio de GitHub:

1. Abre **Settings → Secrets and variables → Actions → Variables** y crea estas variables de repositorio:

   | Variable | Valor |
   | --- | --- |
   | `RENDER_API_ORIGIN` | El mismo origen HTTPS usado en `PUBLIC_API_ORIGIN` de Render |
   | `SUPABASE_URL` | La URL del proyecto Supabase |
   | `SUPABASE_PUBLIC_KEY` | Solo la clave publishable o anon |

2. Abre **Settings → Pages** y elige **GitHub Actions** como fuente de publicación.
3. En **Actions**, ejecuta **Publicar interfaz en GitHub Pages**, o sube un commit a `main`.
4. Espera a que finalicen `build` y `deploy`; abre la URL indicada por el workflow.

El build genera `dist/pages` a partir de la interfaz y publica únicamente esa carpeta. Inserta la configuración pública, prepara el SDK y los iconos, y conserva los enlaces relativos necesarios para `/lector_manga/`. No publiques todo el proyecto como sitio. Las claves secretas no deben existir en las variables de Pages, en `config.js` ni en archivos JavaScript. [Configurar publicación con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Cada cambio posterior en las variables públicas requiere ejecutar de nuevo el workflow. Los cambios en variables de Render requieren reiniciar o desplegar su servicio.

## 5. Importar y comprobar la sincronización

1. Abre Pages y solicita el enlace de acceso a tu correo desde el computador. La biblioteca nueva comienza vacía.
2. Si tu exportación incluye lecturas privadas, necesitarás crear o introducir una contraseña de cifrado de al menos 12 caracteres. El PIN local no se importa. Guarda la nueva clave de recuperación fuera del navegador.
3. En **Cuenta**, pulsa **Importar biblioteca** y selecciona el JSON exportado desde la instalación local. La parte privada se cifra en el navegador antes de enviarse. Si el respaldo ya estaba cifrado con otra clave, también necesitarás su contraseña original o su clave de recuperación. Debe aparecer el resumen de series, capítulos y carpetas añadidos.
4. Abre la misma URL en el iPhone e inicia sesión con el mismo correo. Comprueba las carpetas, capítulos marcados como leídos y **Continuar leyendo**.
5. Lee parte de un capítulo en un dispositivo; sincroniza o vuelve a abrir la biblioteca en el otro. La posición se guarda como imagen y fracción de imagen para adaptarse a tamaños de pantalla diferentes.

La importación combina lecturas por fuente y URL, conserva lo existente y remapea identificadores. No elimina la biblioteca local ni vincula automáticamente esa instalación sin cuenta a la cuenta de la nube. Puedes conservarla como copia independiente.

La interfaz consulta cambios aproximadamente cada 15 segundos mientras está visible y al recuperar visibilidad o conexión. **Sincronizar** permite pedirlos de inmediato. Si otro dispositivo guardó una posición más reciente, el lector evita sobrescribirla y ofrece retomar el progreso sincronizado. El progreso público pendiente puede conservarse en ese navegador para reintentarlo al recuperar conexión; el privado permanece en memoria y puede perder un cambio todavía no enviado al cerrar la página.

## Uso en iPhone

Abre la URL HTTPS de Pages en Safari. Puedes usarla como página normal. Opcionalmente, usa **Compartir → Añadir a pantalla de inicio** y la opción de abrir como aplicación web cuando Safari la ofrezca; no requiere descargar una aplicación de App Store. [Instrucciones de Apple](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).

La interfaz incluye áreas seguras para el notch, botones principales de al menos 44 px y campos de 16 px. La API utiliza cabeceras de autorización, y el desbloqueo privado se mantiene en memoria del cliente; la comunicación Pages–Render no depende de cookies de terceros. El enlace al correo vuelve a la página por HTTPS y se consume una sola vez.

La caché de la aplicación web conserva únicamente recursos públicos de la interfaz. No guarda respuestas de API, portadas ni páginas de capítulos para lectura offline. Añadir el icono no convierte la biblioteca en una colección de capítulos descargados.

## Datos guardados y protección privada

| Dato | Instalación local | Modo con cuenta |
| --- | --- | --- |
| Biblioteca, carpetas, metadatos, capítulos leídos y posición | SQLite en `data/reader.db` | Snapshot de metadatos por usuario en Supabase PostgreSQL |
| Privada | Bloqueo por PIN; SQLite sin cifrar | Paquete AES-GCM cifrado en el navegador, con contraseña independiente y recuperación |
| Imágenes de capítulos y portadas | Streaming y memoria temporal del navegador | Streaming autorizado desde Render y blobs temporales del navegador |
| Tema, acento y preferencias del visor | Navegador | Navegador; no forman parte de la sincronización de biblioteca |

El snapshot y las importaciones admiten hasta **12 MiB de metadatos**. Los capítulos son registros y enlaces, no archivos de imágenes. Esta implementación vuelve a solicitar las imágenes a la fuente cuando hacen falta; si la fuente elimina una obra o no responde, no existe una copia offline a la que recurrir.

Node verifica la identidad con Supabase Auth y selecciona únicamente los datos de esa cuenta. Las escrituras usan revisiones y guardado transaccional para evitar reemplazos silenciosos entre dispositivos. Los traslados entre bibliotecas confirman ambas revisiones en una sola transacción y retiran las respuestas previas que contenían las lecturas ocultadas. Los tickets de imagen están asociados al usuario.

La privada con cuenta utiliza una clave aleatoria de 256 bits y AES-GCM mediante Web Crypto. PBKDF2-SHA-256 con 600.000 iteraciones deriva la clave que protege esa clave de datos. Una clave de recuperación independiente permite recuperar el acceso; ni esa clave ni la contraseña llegan a la API. No hay recuperación por correo si se pierden ambas. El bloqueo retira las claves y referencias de la sesión del navegador. La instalación local mantiene su PIN, que no cifra SQLite.

Este cifrado protege los metadatos privados almacenados y sincronizados. No oculta el correo, el tamaño del paquete ni las consultas de URL e imágenes que Render procesa al leer; tampoco protege frente a un navegador infectado o una interfaz modificada maliciosamente. Los respaldos anteriores a un traslado pueden conservar metadatos que antes eran públicos.

## Verificación antes de dar por terminado el despliegue

Las pruebas automatizadas de datos y API cubren aislamiento por cuenta, importación, progreso, cifrado privado y concurrencia. Las pruebas SQL ejecutan las migraciones con un motor PostgreSQL local y comprueban acceso directo/RLS, migración de ciphertext y traslados atómicos. Son comprobaciones de implementación; no sustituyen una sesión de usuario real contra Supabase.

La suite de interfaz prepara dos proyectos, Chromium de escritorio y WebKit con el perfil de iPhone 13. Para ejecutarla en un equipo que permita iniciar esos navegadores:

```powershell
npm test
npx playwright install chromium webkit
npm run test:ui
```

Las pruebas de interfaz utilizan cuentas y obras ficticias, con servidores aislados; no modifican `data/reader.db`. El workflow **Comprobar lector** ejecuta Chromium y WebKit en GitHub Actions. Un perfil WebKit de iPhone ayuda a detectar problemas, pero la prueba final debe hacerse en tu iPhone.

Después de configurar los servicios, comprueba estos casos en Safari de iPhone y en escritorio:

- Entrar con el enlace al correo, recargar, cerrar sesión y usar otra cuenta sin ver datos anteriores.
- Importar el respaldo, ver portadas y carpetas, marcar un capítulo leído y retomar la misma imagen desde el otro dispositivo.
- Leer en vertical y paginado, mostrar controles, ajustar zoom y cambiar orientación sin desplazamiento horizontal de la interfaz.
- Bloquear y desbloquear la privada en cada dispositivo; confirmar que sus títulos no aparecen en Inicio, Descubrir ni la biblioteca pública.
- Ocultar la pestaña y volver; repetir tras un reinicio de Render.
- Buscar y leer un capítulo desde cada fuente que quieras usar, incluyendo las que necesitan Chrome.
- Volver de un periodo sin conexión y comprobar el progreso; resolver un conflicto con el botón de retomar la posición sincronizada.

## Diagnóstico rápido

| Síntoma | Comprobación |
| --- | --- |
| El enlace de acceso no abre tu biblioteca | Revisa Site URL, la lista de redirecciones y las plantillas de correo; solicita un enlace nuevo si expiró. |
| Supabase rechaza un correo externo | Configura SMTP propio; el correo de prueba solo admite direcciones del equipo del proyecto. |
| Vuelve a una URL incorrecta tras iniciar sesión | Revisa Site URL y Redirect URLs de Supabase, incluida `/lector_manga/` y su barra final. |
| Pages funciona, pero no carga la biblioteca | Comprueba salud de Render, su origen público, claves de ambos servicios y CORS en `FRONTEND_ORIGINS`. |
| Render rechaza arrancar | Lee su log: en producción exige `APP_MODE=cloud`, URLs HTTPS, la clave pública y el secreto de tickets. |
| La API informa errores de tablas o funciones | Comprueba que la migración 003 esté aplicada y Render use la URL y la clave pública del mismo proyecto. Tras actualizar, aplica la 004. |
| La primera consulta tarda después de mucho tiempo | El plan gratuito de Render puede estar reactivando el servicio. |
| Solo falla una fuente | Revisa el error de esa fuente y el log de Chrome; su acceso desde el servidor puede diferir del acceso local. |
| Exportar o importar privadas devuelve bloqueo | Desbloquea con la contraseña de cifrado. Para un respaldo de otra bóveda, utiliza también la contraseña o recuperación de origen. En modo local se sigue utilizando el PIN. |

Conserva respaldos periódicos mediante **Exportar biblioteca** y revisa las cuotas de tus proyectos conforme crezca el uso. No se ha automatizado la contratación de planes ni la creación de cuentas externas.
