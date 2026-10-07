export function debounce(fn, delay = 2000) {
  let timer;
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  run.cancel = () => clearTimeout(timer);
  return run;
}

export function filterSeries(items, { source = '', query = '', unreadOnly = false, sort = 'recent', genre = '', author = '', publication = '', reading = '', folder = '' } = {}) {
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const text = normalize(query.trim());
  return items.filter(item => (!source || item.source === source) && normalize([item.titulo,item.work_title??'',...(item.authors ?? [])].join(' ')).includes(text) &&
    (!unreadOnly || item.pendientes > 0) && (!genre || (genre === 'adult' ? Boolean(item.is_adult) : genre === '__unknown' ? !item.genres?.length : item.genres?.some(v => normalize(v) === normalize(genre)))) &&
    (!author || (author === '__unknown' ? !item.authors?.length : item.authors?.some(v => normalize(v) === normalize(author)))) &&
    (!publication || (item.status ?? 'unknown') === publication) && (!reading || item.reading_state === reading) &&
    (!folder || item.folder_ids?.includes(Number(folder)))).sort((a, b) =>
    (sort === 'recent' ? (b.ultima_lectura ?? 0) - (a.ultima_lectura ?? 0) : 0) || a.titulo.localeCompare(b.titulo, 'es') || a.id - b.id);
}

export function imageProxyUrl(image, origin) {
  const signed = new URL(image.url, origin);
  if (signed.origin !== origin || !/^\/api\/(guest\/)?image$/.test(signed.pathname) || !signed.searchParams.get('ticket')) {
    throw new Error('La API devolvió una URL de imagen no válida.');
  }
  // La firma se conserva: el proxy valida también url y referer contra el ticket.
  if (image.originalUrl && image.referer) {
    const params = new URLSearchParams({ url: image.originalUrl, referer: image.referer,
      ticket: signed.searchParams.get('ticket') });
    return `${signed.pathname}?${params}`;
  }
  return signed.pathname + signed.search;
}

// Una escritura en vuelo. Los cambios posteriores se agrupan conservando el último.
export class ProgressWriter {
  constructor(send, report = () => {}) { this.send = send; this.report = report; this.queue=new Map(); }
  enqueue(snapshot) {
    this.queue.set(snapshot.serie_id??'current',snapshot);
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  async drain() {
    while (this.queue.size) {
      const [key,snapshot]=this.queue.entries().next().value;
      this.queue.delete(key);
      this.report('saving', snapshot);
      try { await this.send(snapshot); this.report('saved', snapshot); }
      catch { this.report('error', snapshot); }
    }
  }
}
