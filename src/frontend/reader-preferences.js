export const readerDefaults = Object.freeze({ mode:'vertical', direction:'rtl', fit:'width', zoom:100, width:760,
  brightness:100, warmth:0, prefetch:4 });
const clamp = (value,min,max,fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max,Math.max(min,value)) : fallback;
export function normalizeReaderPreferences(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const select = (key,choices) => choices.includes(input[key]) ? input[key] : readerDefaults[key];
  return { mode:select('mode',['vertical','paged']),direction:select('direction',['rtl','ltr']),fit:select('fit',['width','height','original']),
    zoom:clamp(input.zoom,50,200,100),width:clamp(input.width,320,1200,760),brightness:clamp(input.brightness,35,100,100),
    warmth:clamp(input.warmth,0,70,0),prefetch:Math.round(clamp(input.prefetch,3,5,4)) };
}
// Las imágenes conservan siempre el orden del proveedor; RTL cambia controles, no URLs.
export function pageStep(key,direction) {
  if (key === 'ArrowLeft') return direction === 'rtl' ? 1 : -1;
  if (key === 'ArrowRight') return direction === 'rtl' ? -1 : 1;
  return 0;
}
export function readingWindow(total,first,last,prefetch = 4) {
  if (!Number.isInteger(total) || total <= 0) return { load:[],retain:[] };
  first=Math.min(total-1,Math.max(0,Math.trunc(first)||0));
  last=Math.min(total-1,Math.max(first,Math.trunc(last)||first));
  prefetch=normalizeReaderPreferences({prefetch}).prefetch;
  const visible=Array.from({length:last-first+1},(_,i)=>first+i);
  const ahead=Array.from({length:Math.min(prefetch,total-last-1)},(_,i)=>last+i+1);
  const behind=Array.from({length:Math.min(2,first)},(_,i)=>first-i-1);
  return {load:[...visible,...ahead],retain:[...visible,...ahead,...behind]};
}
export function savedPageAnchor(local,server,total) {
  const useLocal=local && (!server || local.timestamp >= server.timestamp-3000);
  const index=useLocal ? local.anchor?.index : server?.page_index;
  const fraction=useLocal ? local.anchor?.fraction : server?.page_fraction;
  if (!Number.isInteger(index) || index < 0 || !total) return null;
  return {index:Math.min(total-1,index),fraction:clamp(fraction,0,1,0)};
}
