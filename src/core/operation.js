import { AsyncLocalStorage } from 'node:async_hooks';
import { ScraperError } from './ScraperError.js';

const context = new AsyncLocalStorage();
export const operationContext = () => context.getStore();
export function cancellationError(signal) {
  return new ScraperError(signal.reason?.name === 'TimeoutError' ? 'Tiempo total de consulta agotado.' : 'Consulta cancelada.',
    { code: signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' });
}
export async function runOperation(task, { signal, timeoutMs = 45000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs inválido.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Presupuesto agotado', 'TimeoutError')), timeoutMs);
  timer.unref();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    if (combined.aborted) throw cancellationError(combined);
    const result = await context.run({ signal: combined }, task);
    if (combined.aborted) throw cancellationError(combined);
    return result;
  } catch (error) {
    if (combined.aborted) throw cancellationError(combined);
    throw error;
  } finally { clearTimeout(timer); }
}

// Cola por proveedor. Cancelar mientras espera no ocupa un turno ni inicia tráfico.
export function createGate(limit = 2) {
  let active = 0;
  const waiting = [];
  function drain() {
    while (active < limit && waiting.length) {
      const item = waiting.shift();
      item.signal?.removeEventListener('abort', item.abort);
      active++;
      item.resolve(() => { active--; drain(); });
    }
  }
  return signal => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancellationError(signal));
    const item = { signal, resolve, abort: () => {
      const index = waiting.indexOf(item);
      if (index >= 0) waiting.splice(index, 1);
      reject(cancellationError(signal));
    } };
    signal?.addEventListener('abort', item.abort, { once: true });
    waiting.push(item); drain();
  });
}
