export const readingLabels = { planned: 'Pendiente', reading: 'Leyendo', on_hold: 'Pausado', completed: 'Completado', abandoned: 'Abandonado' };
export const publicationLabels = { ongoing: 'En emisión', completed: 'Finalizado', hiatus: 'En pausa', cancelled: 'Cancelado' };
export function libraryProgress(item) {
  const total = Math.max(0, Number(item.total_capitulos) || 0);
  const pending = Math.max(0, Math.min(total, Number(item.pendientes ?? total) || 0));
  const read = total - pending;
  const effectiveState = item.reading_state ?? (item.ultimo_capitulo_id ? 'reading' : 'planned');
  return { total, read, percent: total ? Math.round(read / total * 100) : 0, label: readingLabels[effectiveState] ?? 'Pendiente' };
}
