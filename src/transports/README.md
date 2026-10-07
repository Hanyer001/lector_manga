# Transportes HTML, API JSON y navegador

`HttpTransport` descarga HTML o JSON con redirecciones validadas, límites de
cuerpo, timeout por intento y reintentos acotados. `BaseScraper.fetchDocument`
analiza el HTML con Cheerio; `fetchJson` usa el origen de API declarado.
Los adaptadores habilitados actualmente usan HTTP/API.

`BrowserTransport` es opcional para contenido generado con JavaScript. Usa
puppeteer-core y Chrome/Edge instalado en modo local. En Render, el build puede
preparar una versión compatible con `INSTALL_BROWSER=1`; la ruta se registra en
un manifiesto generado. No se activa automáticamente ante errores 403 ni
resuelve desafíos.

```js
const scraper = new MiExtension({
  transport: 'browser',
  browserOptions: {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    waitForSelector: '.chapter-list'
  },
  browserOrigins: ['https://cdn-scripts-del-proveedor.example']
});
const result = await scraper.runOperation(() => scraper.getChapters(url));
```

En un registro de fuente configura esos campos en `catalog.js`; también se
admite la variable BROWSER_EXECUTABLE. `browserOrigins` autoriza orígenes exactos
de scripts, estilos o API adicionales. Las navegaciones principales siguen
limitadas a pageOrigins. Se bloquean imágenes, fuentes y vídeos: el navegador
solo prepara el DOM para extraer metadatos y URLs. Se desactiva la caché y se
cierra la sesión en éxito, error y cancelación. No usa el perfil personal.

Ambos transportes devuelven `{buffer,url}`. Puede inyectarse `documentTransport`
para pruebas, conservando validación, tamaño y cancelación. El presupuesto de
45 segundos de `runOperation` se comparte entre páginas, reintentos y esperas
mediante AsyncLocalStorage; AbortSignal también propaga la desconexión del visor.
El catálogo limita operaciones concurrentes por fuente a dos (una en navegador).

La suite prueba renderizado simulado, cierre, cancelación y rechazo de
redirecciones externas. La verificación con Edge real fue bloqueada en el
entorno de trabajo por `spawn EPERM`; debe comprobarse en una ejecución normal
que permita abrir el navegador. Esto no afecta a las fuentes HTTP/API activas.

Documentación oficial: https://pptr.dev/guides/configuration y
https://pptr.dev/guides/network-interception.
