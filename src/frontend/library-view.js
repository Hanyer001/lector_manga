import { tagLabel } from './discovery-core.js';
import { isAdult } from './content-policy.js';
import { cloudMode, isProxyUrl, setCover } from './network.js';
const cardStates=new WeakMap();
// Solo DOM y URLs firmadas locales: las portadas no se persisten en el cliente.
export function renderSeriesCards(container, items, { selectedId, sourceName, onSelect, onResume, onRemove, onAdd, onFeedback, retainCards=true, hasFavorite = () => false } = {}) {
  const previous=retainCards?cardStates.get(container)??new Map():new Map(),next=new Map();
  if(!retainCards||!items.length){for (const image of container.querySelectorAll('img')) image.removeAttribute('src');container.replaceChildren();cardStates.delete(container);}
  else for(const child of [...container.children])if(![...previous.values()].some(value=>value.card===child))child.remove();
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'series-empty';
    empty.textContent = onAdd ? 'No hay resultados para esta búsqueda.' : 'No hay series con estos filtros. Añade una historia por enlace o busca en un sitio.';
    container.append(empty); return;
  }
  for (const item of items) {
    const identity=`${item.source}|${item.url_origen??item.url??item.id}`,signature=JSON.stringify([item,selectedId,hasFavorite(item)],(key,value)=>['coverUrl','coverVariants'].includes(key)?undefined:value),old=previous.get(identity);
    if(old?.signature===signature){container.append(old.card);next.set(identity,old);continue;}
    const title = item.titulo ?? item.title;
    const card = document.createElement('article'); card.className = 'series-card';next.set(identity,{card,signature});
    card.classList.toggle('selected', selectedId!=null && item.id!=null && (String(item.id) === String(selectedId)||Boolean(item.editions?.some(e=>String(e.id)===String(selectedId)))));
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'series-choice';
    choose.setAttribute('aria-label', `${onAdd ? 'Ver' : 'Elegir'} ${title}`);
    const alreadySaved = Boolean(onAdd && hasFavorite(item)); choose.disabled = false;
    const cover = document.createElement('div'); cover.className = 'series-cover';
    const badge = document.createElement('span'); badge.className = 'cover-badge';
    badge.textContent = onAdd ? sourceName(item.source) : item.total_capitulos ? item.pendientes ? `${item.pendientes} sin leer` : '' : 'Sin sincronizar';
    badge.hidden = !badge.textContent;
    const country = document.createElement('span'); country.className = 'origin-badge';
    const known = typeof item.country === 'string' && /^[A-Z]{2}$/.test(item.country);
    let countryName = 'Origen no disponible';
    if (known) { try { countryName = new Intl.DisplayNames(['es'],{type:'region'}).of(item.country); } catch { countryName = item.country; } }
    country.title = countryName; country.setAttribute('aria-label', `Origen: ${countryName}`);
    const flag = document.createElement('span'); flag.className = 'country-flag'; flag.setAttribute('aria-hidden','true');
    flag.textContent = known ? String.fromCodePoint(...[...item.country].map(char => char.charCodeAt(0)+127397)) : '◎';
    const code = document.createElement('span'); code.className = 'country-code'; code.textContent = known ? item.country : '◎'; code.setAttribute('aria-hidden','true');
    country.append(flag,code);
    const newBadge = document.createElement('span'); newBadge.className = 'new-badge'; newBadge.textContent = `${item.nuevos ?? 0} ${item.nuevos === 1 ? 'nuevo' : 'nuevos'}`; newBadge.hidden = !item.nuevos || Boolean(onAdd);
    const fallback = () => { const text = document.createElement('span'); text.textContent = title; cover.replaceChildren(text,country,newBadge); };
    if (isProxyUrl(item.coverUrl)) {
      const image = document.createElement('img'); image.alt = `Portada de ${title}`;
      image.loading = 'lazy'; image.decoding = 'async';
      let retries=0;
      image.addEventListener('error',()=>{
        if(retries++===0&&image.isConnected){image.removeAttribute('srcset');setTimeout(()=>{if(image.isConnected)setCover(image,item.coverUrl+'&retry=1',item.coverKey);},600);}
        else fallback();
      });cover.append(image, badge,country,newBadge);setCover(image,item.coverUrl,item.coverKey);
      if(!cloudMode&&item.coverVariants?.length){image.srcset=item.coverVariants.filter(v=>isProxyUrl(v.url)).map(v=>`${v.url} ${v.width}w`).join(', ');image.sizes='(max-width: 599px) 45vw, 220px';}
    } else fallback();
    const name = document.createElement('span'); name.className = 'series-title'; name.textContent = title; name.title = title;
    const caption=document.createElement('span');caption.className='series-caption';caption.append(name,badge);
    choose.append(cover, caption);
    choose.addEventListener('click', async () => {
      choose.disabled = true;
      try { await (onSelect ? onSelect(item) : onAdd(item)); } finally { choose.disabled = false; }
    });
    const details = document.createElement('p'); details.className = 'series-details';
    details.textContent = (item.editions?.length>1?`${item.editions.length} fuentes`:sourceName(item.source)) + (onAdd ? '' : ` · ${item.total_capitulos ?? 0} capítulos`);
    if(onFeedback)details.textContent=[...(item.genres??[]),...(item.themes??[])].slice(0,2).map(tagLabel).join(' · ')||sourceName(item.source);
    if(isAdult(item))details.textContent+=' · +18';
    card.append(choose, details);
    if(item.reason){const reason=document.createElement('p');reason.className='recommendation-reason';reason.textContent=item.reason;card.append(reason);}
    const actions = document.createElement('div'); actions.className = 'card-actions'; card.append(actions);
    const action = (text, handler, primary = false) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `button ${primary ? 'primary' : 'subtle'}`;
      button.textContent = text; button.addEventListener('click', handler); actions.append(button); return button;
    };
    if (onAdd) {
      const button = action(alreadySaved ? 'En tu biblioteca ✓' : '＋ Añadir a biblioteca', async () => {
        button.disabled = true; try { await onAdd(item); } finally { button.disabled = false; }
      }, true);
      button.disabled = alreadySaved;
      if(onFeedback) {
        const menu=document.createElement('details');menu.className='recommendation-menu';const summary=document.createElement('summary');summary.textContent='Afinar sugerencia';menu.append(summary);
        for(const [kind,label] of [['like','Me gustó'],['dislike','No me gustó'],['more_like','Más como este'],['hidden','No me interesa'],['already_read','Ya lo leí']]) {
          const control=document.createElement('button');control.type='button';control.className='button subtle';control.textContent=label;control.addEventListener('click',async()=>{control.disabled=true;try{await onFeedback(item,kind);}finally{control.disabled=false;}});menu.append(control);
        }
        actions.append(menu);
      }
    } else {
      if (item.ultimo_capitulo_id) {
        const button = action('Continuar ↗', () => onResume(item), true);
        button.setAttribute('aria-label', `Continuar ${title}`);
        button.title = item.ultimo_capitulo ?? 'Último capítulo abierto';
      }
      if (onRemove) {
      const removeLabel=item.editions?.length>1?'Quitar obra y sus fuentes':'Quitar de biblioteca';
      const remove = action(removeLabel, async () => {
        if (remove.dataset.confirm !== 'yes') {
          remove.dataset.confirm = 'yes'; remove.textContent = 'Confirmar eliminación';
          setTimeout(() => { remove.dataset.confirm = ''; remove.textContent = removeLabel; }, 8000); return;
        }
        remove.disabled = true; try { await onRemove(item); } finally { remove.disabled = false; }
      });
      remove.setAttribute('aria-label', `Quitar ${title}`);
      const menu = document.createElement('details'); menu.className = 'card-menu';
      const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.setAttribute('aria-label', `Opciones de ${title}`);
      menu.append(summary, remove); actions.append(menu);
      }
    }
    container.append(card);
  }
  if(retainCards){for(const [key,value] of previous)if(next.get(key)?.card!==value.card){for(const image of value.card.querySelectorAll('img')){image.removeAttribute('src');image.removeAttribute('srcset');}value.card.remove();}cardStates.set(container,next);}
}
