// Demo aislada: SQLite en memoria, HTML y paneles de prueba servidos en loopback.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/backend/app.js';
import { openDatabase } from '../src/storage/database.js';
import SitioEjemplo from '../src/extensions/sitioEjemplo.js';

const panels = await Promise.all([1, 2, 3].map(i => readFile(new URL(`../test/fixtures/reader-${i}.png`, import.meta.url))));
let imageRequests = 0;
let active = 0;
let maxActive = 0;
const source = createServer((req, res) => {
  if (req.url.startsWith('/image/')) {
    imageRequests++; active++; maxActive = Math.max(maxActive, active);
    res.on('close', () => { active--; });
    res.writeHead(200, { 'Content-Type': 'image/png' });
    const index = Number(req.url.split('/').at(-1)) || 0;
    const timer = setTimeout(() => res.end(panels[index % panels.length]), 150);
    res.on('close', () => clearTimeout(timer));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<meta charset="utf-8"><h1 class="chapter-title">Capítulo ${req.url.endsWith('2') ? 2 : 1} · El jardín de las horas</h1>
      <div class="reading-content">${Array.from({ length: 72 }, (_, i) => `<img data-src="/image/${i}">`).join('')}</div>`);
  }
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const origin = `http://127.0.0.1:${source.address().port}`;
const database = openDatabase(':memory:');
const series = database.saveFavorite({ source: 'sitio-ejemplo', titulo: 'El jardín de las horas · Demo', url_origen: origin + '/series' });
database.saveChapters(series.id, [1, 2].map(i => ({ title: `Capítulo ${i}`, number: i, url: origin + `/chapter/${i}` })));
const sources = new Map([['sitio-ejemplo', { pageOrigin: origin, imageOrigins: [origin],
  userAgent: 'ReaderDemo/1.0', scraper: new SitioEjemplo({ baseUrl: origin }) }]]);
const app = createApp({ database, sources });
// Métricas solo disponibles en este servidor de prueba, nunca en server.js.
const server = createServer((req, res) => {
  if (req.url === '/__demo/metrics') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ imageRequests, active, maxActive }));
  } else app(req, res);
});
server.listen(Number(process.env.DEMO_PORT ?? 3211), '127.0.0.1');
await once(server, 'listening');
console.log(`Demo del visor: http://127.0.0.1:${server.address().port}/?chapter=1`);
function stop() {
  server.closeAllConnections(); source.closeAllConnections();
  server.close(); source.close(); database.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
