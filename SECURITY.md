# Seguridad de la biblioteca privada

En modo con cuenta, títulos, carpetas, enlaces, capítulos leídos y posición se cifran y descifran exclusivamente en el navegador. `src/frontend/vault-crypto.js` utiliza AES-256-GCM, IV aleatorio de 96 bits nuevo por operación y autenticación adicional que vincula cuenta, bóveda y finalidad. PBKDF2-HMAC-SHA-256 con sal aleatoria de 128 bits y 600 000 iteraciones deriva la clave que envuelve una clave de datos aleatoria de 256 bits.

Usa una frase larga, única e independiente del acceso por correo o Google. El mínimo de 12 caracteres no hace segura una contraseña predecible. Se rechazan valores exclusivamente numéricos. La recuperación es una clave aleatoria independiente: guárdala fuera del sitio. Perder contraseña y recuperación impide recuperar la privada mediante el login. Cambiar la contraseña rota la clave de datos y la recuperación del bloque actual; no revoca copias antiguas.

## Sincronización y permisos

`vault-sync.js` usa el mismo SDK de Supabase y la sesión del usuario. El bloque cifrado se guarda en `reader_private_vaults`; no pasa por Render. Las cuatro tablas de cuenta tienen RLS con `auth.uid() = user_id` y las RPC usan SECURITY INVOKER. `reader_vault_commit_owned` obtiene el propietario del JWT, verifica ambas revisiones y confirma los traslados general ↔ privada en una transacción. Retira las respuestas de operaciones públicas anteriores para que no revelen títulos ocultados.

Las migraciones 003 y 004 preservan ciphertext y claves existentes. La 003 habilita la versión nueva; la 004 retira permisos administrativos antiguos después del despliegue. Sigue `DEPLOYMENT.md`. No ejecutes solamente las primeras dos migraciones en una instalación nueva.

Render usa únicamente la clave publicable de Supabase y el JWT de cada petición, verificado con Auth. No necesita `SUPABASE_SECRET_KEY` ni `service_role`; no recibe ni enumera bóvedas y rechaza las rutas antiguas de sincronización antes de interpretar su contenido. Sigue resolviendo catálogos, capítulos e imágenes, además de la API de biblioteca general. El secreto local de tickets permanece en su entorno, nunca en Pages o GitHub.

Las claves administrativas/BYPASSRLS y el propietario del proyecto no quedan limitados por RLS. Revocar permisos de estas tablas reduce acceso, pero no convierte una clave administrativa en una credencial segura para el proxy. Si estuvo expuesta, rótala en Supabase y revisa accesos. No es necesario rotarla solo por haber estado legítimamente en Render; sí retirarla cuando deja de ser necesaria.

## Sesión, caché y límites

La web también admite invitados. `device-library.js` guarda la biblioteca general
en IndexedDB y la privada como un bloque cifrado con la misma criptografía de la
bóveda con cuenta. El propietario local es un UUID aleatorio. La importación a una
cuenta es explícita y vuelve a cifrar la privada para ese propietario.

Las rutas `/api/guest/` sólo permiten consultar catálogos y recursos de las fuentes;
no cargan bibliotecas de Supabase. Una lista cerrada de rutas, límites por IP y
límites de concurrencia reducen abuso. Sus tickets de imágenes tienen propietario
`guest`; un ticket de cuenta no se acepta por esa ruta. No otorgan acceso a datos
privados. El proxy sigue viendo los enlaces solicitados.

Las portadas se reutilizan en memoria con limpieza de entradas sin referencias;
se vacían al bloquear o cambiar de cuenta. El progreso general tiene una cola
local de reintento por cuenta/dispositivo, con ID de operación y versión esperada.
El progreso privado nunca se incluye en esa cola en texto claro.

Las claves y el estado privado descifrado permanecen en memoria. El bloqueo cierra la base SQLite del navegador, retira las claves/referencias, cancela sincronización pendiente y elimina contenido privado visible. Cambiar de cuenta también invalida la bóveda. No se persisten progreso privado ni contraseñas en texto claro en localStorage, IndexedDB, service workers o analítica. El recolector de memoria de JavaScript no garantiza borrado físico de todas las copias temporales.

La versión y los IDs de operación evitan sobrescrituras accidentales y duplicados. No garantizan frescura frente a un administrador que restaure una copia antigua ni disponibilidad si elimina ciphertext. Conserva respaldos cifrados y verifica guardados antes de cerrar: iOS puede interrumpir peticiones al pasar a segundo plano.

Supabase sigue viendo propietario, tamaño y tiempos. Render ve URLs de lectura y los JWT que recibe. Un proxy comprometido podría actuar con un JWT robado mientras siga válido, pero no descifrar la privada sin contraseña/recuperación. E2EE de metadatos no cifra imágenes en otras cachés ni anonimiza lectura.

XSS, una dependencia maliciosa, un dispositivo infectado o JavaScript modificado en Pages pueden capturar datos al desbloquear. Usa control de despliegues, dependencias revisadas y MFA en cuentas de infraestructura. Las imágenes se transmiten con límites, tickets asociados al usuario y validación de destinos/redirecciones para evitar SSRF. CORS no sustituye autenticación.

El servidor `APP_MODE=local` conserva su PIN y SQLite sin cifrar. Esta protección
E2EE corresponde a la web en modo cloud, tanto con cuenta como sin ella.
