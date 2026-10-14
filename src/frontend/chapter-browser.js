const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function chapterEntries(chapters, { query = '', order = 'asc', filter = 'all', lastId } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return chapters.map((chapter, index) => ({ chapter, index })).filter(({ chapter }) => {
    const read = Boolean(chapter.estado_lectura);
    const searchable = normalize(`${chapter.titulo ?? chapter.title} ${chapter.numero ?? chapter.number ?? ''}`);
    return words.every(word => searchable.includes(word)) && (filter === 'all' || filter === 'read' && read || filter === 'unread' && !read || filter === 'last' && String(chapter.id) === String(lastId));
  }).sort((a, b) => {
    const number = row => Number.isFinite(Number(row.numero ?? row.number)) && (row.numero ?? row.number) != null ? Number(row.numero ?? row.number) : Infinity;
    const difference = number(a.chapter) - number(b.chapter);
    const stable = Number.isNaN(difference) || difference === 0 ? a.index - b.index : difference;
    return order === 'desc' ? -stable : stable;
  });
}

let browserCount = 0;
export function createChapterBrowser(container, { onChoose, temporary = false } = {}) {
  const prefix = `chapters-${++browserCount}`;
  container.classList.add('chapter-browser');
  container.innerHTML = `<div class="chapter-browser-tools"><label for="${prefix}-query" class="sr-only">Buscar capítulo</label><input id="${prefix}-query" type="search" placeholder="Buscar capítulo o número…" maxlength="200"><label for="${prefix}-order" class="sr-only">Orden de capítulos</label><select id="${prefix}-order"><option value="asc">Primeros capítulos</option><option value="desc">Últimos capítulos</option></select><label for="${prefix}-filter" class="sr-only">Estado del capítulo</label><select id="${prefix}-filter"><option value="all">Todos</option><option value="unread">Pendientes</option><option value="read">Leídos</option><option value="last">Último abierto</option></select></div><p class="chapter-count small muted" role="status" aria-live="polite"></p><ul class="chapter-list" aria-label="Capítulos disponibles"></ul><button class="button chapter-more" type="button" hidden>Mostrar más capítulos</button>`;
  const query = container.querySelector('input'), [order, filter] = container.querySelectorAll('select');
  const list = container.querySelector('ul'), count = container.querySelector('.chapter-count'), more = container.querySelector('.chapter-more');
  const reverse=document.createElement('button');reverse.type='button';reverse.className='button chapter-order-toggle';reverse.id=prefix+'-reverse';
  reverse.setAttribute('aria-label','Invertir orden de capítulos');
  order.hidden=true;order.after(reverse);
  reverse.addEventListener('click',()=>{order.value=order.value==='asc'?'desc':'asc';order.dispatchEvent(new Event('change',{bubbles:true}));});
  if (temporary) filter.hidden = true;
  let chapters = [], lastId, selectedId, limit = 60, busy = false;
  function render() {
    const scrollTop = list.scrollTop;
    const entries = chapterEntries(chapters, { query: query.value, order: order.value, filter: filter.value, lastId });
    list.replaceChildren();
    count.textContent = busy ? 'Cargando capítulos…' : chapters.length ? `${entries.length} de ${chapters.length} capítulos` : 'Todavía no hay capítulos disponibles.';
    for (const { chapter, index } of entries.slice(0, limit)) {
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'chapter-row'; button.disabled = busy;
      const title = chapter.titulo ?? chapter.title ?? `Capítulo ${chapter.numero ?? chapter.number ?? index + 1}`;
      const last = lastId != null && String(lastId) === String(chapter.id);
      const selected = selectedId != null && String(selectedId) === String(chapter.id);
      const status = last ? 'Último abierto' : chapter.estado_lectura ? 'Leído' : temporary ? 'Probar' : 'Pendiente';
      button.setAttribute('aria-label', `${temporary ? 'Elegir' : 'Leer'} ${title} · ${status}`);
      if (last) button.setAttribute('aria-current', 'true');
      button.classList.toggle('selected', selected);
      if (temporary) button.setAttribute('aria-pressed', String(selected));
      const name = document.createElement('span'); name.textContent = title;
      const state = document.createElement('span'); state.className = 'chapter-state'; state.textContent = status;
      button.append(name, state); button.addEventListener('click', () => { selectedId = chapter.id; render(); list.querySelector('.chapter-row.selected')?.focus({preventScroll:true}); onChoose?.(chapter, index); });
      row.append(button); list.append(row);
    }
    if (!entries.length && !busy) { const empty = document.createElement('li'); empty.className = 'chapter-empty muted'; empty.textContent = chapters.length ? 'No hay capítulos con esta búsqueda. Prueba otro número o estado.' : 'Actualiza los capítulos para consultar la fuente.'; list.append(empty); }
    more.hidden = busy || entries.length <= limit;
    more.textContent = `Mostrar ${Math.min(60, Math.max(0, entries.length - limit))} capítulos más`;
    list.scrollTop = scrollTop;
    query.disabled = order.disabled = filter.disabled = busy || !chapters.length;
    reverse.disabled=order.disabled;reverse.textContent=order.value==='asc'?'↑ Ascendente':'↓ Descendente';reverse.setAttribute('aria-pressed',String(order.value==='desc'));
  }
  for (const control of [query, order, filter]) control.addEventListener(control === query ? 'input' : 'change', () => { limit = 60; render(); });
  more.addEventListener('click', () => { limit += 60; render(); });
  return {
    update(items, options = {}) { chapters = items; lastId = options.lastId; selectedId = options.selectedId; busy = false; if (options.reset) { query.value = ''; filter.value = 'all'; order.value = 'asc'; limit = 60; } render(); },
    loading() { busy = true; chapters = []; render(); },
    clear() { this.update([], { reset: true }); },
    focus() { query.focus({ preventScroll: true }); }
  };
}
