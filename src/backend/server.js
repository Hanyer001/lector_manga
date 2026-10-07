import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../storage/database.js';
import { createApp } from './app.js';
import { readServerConfig } from './config.js';
import { createCloudStore } from './cloud-store.js';
import { createImageTickets } from './imageTickets.js';

const port = Number(process.env.PORT ?? 3210);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválido.');
const config = readServerConfig();
const database = config.mode === 'local' ? openDatabase(process.env.DB_PATH ?? fileURLToPath(new URL('../../data/reader.db', import.meta.url))) : null;
const cloudStore = config.mode === 'cloud' ? createCloudStore(config.cloud) : undefined;
const tickets = createImageTickets(config.imageSecret ? { secret: config.imageSecret, ttlMs: 60 * 60 * 1000 } : {});
const server = createServer(createApp({ database, cloudStore, tickets, ...config }));
server.headersTimeout = 10000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.on('error', error => { console.error(error); database?.close(); process.exitCode = 1; });
server.listen(port, config.mode === 'cloud' ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(config.mode === 'cloud' ? `API de cuentas disponible en ${config.apiOrigin}` : `API disponible en http://127.0.0.1:${server.address().port}`);
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => server.closeAllConnections(), 5000);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); database?.close(); });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
