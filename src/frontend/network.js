const settings = typeof window === 'undefined' ? {} : window.LECTOR_CONFIG ?? {};
export const cloudMode = settings.mode === 'cloud';
export const encryptedPrivate = cloudMode && settings.privateEncryption==='e2ee';
export const apiOrigin = settings.apiBase || (typeof location === 'undefined' ? 'http://127.0.0.1' : location.origin);
let client, session, privateToken = '', revision = 0, initializing;
const device=cloudMode?createDeviceLibrary({transport:publicFetch}):null;
const cloudSync=encryptedPrivate?createVaultSync({client:()=>client,owner:()=>session?.user?.id,onAccountRevision:value=>{revision=Math.max(revision,value);}}):null;
const sync=cloudSync?Object.fromEntries(['load','revision','account','commit','cancel'].map(name=>[name,(...args)=>(session?cloudSync:device.sync)[name](...args)])):null;
const vault=encryptedPrivate?createPrivateVault({transport:baseFetch,sync,owner:()=>session?.user?.id??device.owner()}):null;
export const isGuest=()=>cloudMode&&!session;
export const guestBackup=()=>device.backup();
export const setPrivateScope=value=>vault?.setScope(value);
export const accountUser = () => session?.user ?? null;
export const accountRevision = () => revision;

export function apiUrl(path) {
  const url = new URL(path, apiOrigin);
  if (url.origin !== apiOrigin || !url.pathname.startsWith('/api/')) throw new Error('Dirección de API inválida.');
  return url.href;
}
export function isProxyUrl(value) {
  try { const url = new URL(value, apiOrigin); return url.origin === apiOrigin && /^\/api\/(guest\/)?image$/.test(url.pathname) && Boolean(url.searchParams.get('ticket')); } catch { return false; }
}
export async function initializeAccount() {
  if (!cloudMode) return null;
  if (initializing) return initializing;
  initializing = (async () => {
    if (!settings.supabaseUrl || !settings.supabasePublicKey) throw new Error('El servicio de cuentas todavía no está configurado.');
    if (!window.supabase?.createClient) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = new URL('./vendor/supabase.js', import.meta.url).href;
      script.onload = resolve; script.onerror = () => reject(new Error('No se pudo cargar el servicio de cuentas. Recarga la página.')); document.head.append(script);
    });
    // Los enlaces predeterminados también deben abrirse en otro navegador o dispositivo.
    client ??= window.supabase.createClient(settings.supabaseUrl, settings.supabasePublicKey, { auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const url = new URL(location.href);
    const tokenHash = url.searchParams.get('token_hash'), tokenType = url.searchParams.get('type');
    // El enlace de correo se consume una sola vez y se retira de la dirección
    // antes de cargar bibliotecas, imágenes o cualquier otro recurso.
    if (tokenHash || url.searchParams.has('error_description')) {
      for (const name of ['token_hash', 'type', 'error', 'error_code', 'error_description']) url.searchParams.delete(name);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      if (!tokenHash || tokenType !== 'email') throw new Error('El enlace no es válido o ha expirado. Solicita uno nuevo.');
      const verification = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
      if (verification.error) throw new Error('El enlace expiró o ya se utilizó. Solicita uno nuevo.');
    }
    const result = await client.auth.getSession();
    // El SDK consume el fragmento del enlace predeterminado; retirarlo evita compartirlo.
    const fragment=new URLSearchParams(new URL(location.href).hash.slice(1));
    if(fragment.has('access_token')||fragment.has('refresh_token')||fragment.has('error_description'))history.replaceState(null,'',url.pathname+url.search);
    if (result.error) throw result.error;
    if(fragment.has('error_description'))throw new Error('El enlace no es válido o ha expirado. Solicita uno nuevo.');
    session = result.data.session;
    client.auth.onAuthStateChange((_event, next) => {
      const previous = session?.user?.id; session = next;
      if (previous !== next?.user?.id) { privateToken = ''; revision = 0; window.dispatchEvent(new CustomEvent('account-changed', { detail: next?.user ?? null })); }
    });
    // El código OAuth se usa una sola vez y no queda en enlaces compartidos.
    if (url.searchParams.has('code')) { url.searchParams.delete('code'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return session;
  })().catch(error => { initializing = undefined; throw error; });
  return initializing;
}
export async function signIn(email) {
  if (!cloudMode) throw new Error('El inicio de sesión está disponible en la versión con cuenta.');
  email = String(email ?? '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Introduce un correo válido.');
  await initializeAccount();
  const result = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (result.error?.status === 429 || result.error?.code === 'over_email_send_rate_limit') throw new Error('Se alcanzó el límite de enlaces. Espera antes de solicitar otro.');
  if (result.error?.code === 'email_address_not_authorized') throw new Error('Este correo no está habilitado para recibir enlaces. Consulta al administrador de la página.');
  if (result.error) throw new Error('No se pudo enviar el enlace. Comprueba el correo e inténtalo de nuevo.');
}
export async function signOut() {
  privateToken = '';
  const result = await client.auth.signOut();
  if (result.error) throw result.error;
}
export async function recheckAccount() {
  if(!cloudMode||!client)return;
  const result=await client.auth.getSession();
  if(result.error)return;
  const next=result.data.session;
  if(next?.user?.id!==session?.user?.id){privateToken='';session=next;window.dispatchEvent(new CustomEvent('account-changed',{detail:next?.user??null}));}
  else session=next;
}
export async function apiFetch(path, options = {}) {
  if(path.startsWith('/api/guest/'))return publicFetch(path,options);
  if(cloudMode){await initializeAccount();if(!session)await device.ready();}
  if(vault){const local=await vault.handle(path,options);if(local)return local;}
  if(isGuest())return device.handle(path,options);
  if(sync&&path==='/api/account') {
    const [response,vaultRevision]=await Promise.all([rawApiFetch(path,options),sync.revision()]);
    if(!response.ok)return response;
    return new Response(JSON.stringify({...await response.json(),vaultRevision}),{status:response.status,headers:response.headers});
  }
  return rawApiFetch(path,options);
}
function baseFetch(path,options={}){return isGuest()?device.handle(path,options):rawApiFetch(path,options);}
async function publicFetch(path,options={}){
  const url=apiUrl(path.startsWith('/api/guest/')?path:path.replace(/^\/api\//,'/api/guest/'));
  const headers=new Headers(options.headers);headers.delete('Authorization');headers.delete('X-Private-Token');
  if(options.body)headers.set('Content-Type','application/json');
  return fetch(url,{...options,headers,credentials:'omit',cache:'no-store'});
}
async function rawApiFetch(path, options = {}) {
  const url = apiUrl(path), headers = new Headers(options.headers);
  if (cloudMode) {
    await initializeAccount();
    if (!session?.access_token) { const error = new Error('Inicia sesión para acceder a tu biblioteca.'); error.code = 'AUTH_REQUIRED'; throw error; }
    headers.set('Authorization', 'Bearer ' + session.access_token);
    if (privateToken) headers.set('X-Private-Token', privateToken);
  }
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (cloudMode && ['POST', 'PUT', 'DELETE'].includes(options.method) && !headers.has('X-Operation-Id')) headers.set('X-Operation-Id', crypto.randomUUID());
  const response = await fetch(url, { ...options, headers, credentials: cloudMode ? 'omit' : 'same-origin', cache: 'no-store' });
  const received = Number(response.headers.get('X-Library-Revision'));
  if (Number.isSafeInteger(received)) revision = Math.max(revision, received);
  return response;
}
export function receivePrivateStatus(path, data) {
  if (!path.startsWith('/api/private/')) return;
  if (data.privateToken) privateToken = data.privateToken;
  if (data.unlocked === false) privateToken = '';
}

// Caché en RAM compartida por tarjetas: una descarga por portada, aunque cambie
// el ticket o se cambie de pestaña. Se vacía al bloquear o cambiar de cuenta.
const covers=new Map(),coverPool=new Map(),coverQueue=new Set();
let observer,intersection,loadingCovers=0,coverBytes=0;
function coverIdentity(url,key){
  if(key)return String(key);
  try{const ticket=new URL(url,apiOrigin).searchParams.get('ticket').split('.')[0];const image=JSON.parse(atob(ticket.replaceAll('-','+').replaceAll('_','/')));return [image.ownerId,image.source,image.url].join('|');}catch{return url;}
}
function trimCovers(){
  for(const [key,entry] of coverPool){if(coverPool.size<=60&&coverBytes<=20*1024*1024)break;if(!entry.refs&&entry.blob){URL.revokeObjectURL(entry.blob);coverBytes-=entry.size;coverPool.delete(key);}}
}
function assignCover(image,state,entry){
  if(covers.get(image)!==state)return;
  state.entry=entry;entry.refs++;image.src=entry.blob;intersection?.unobserve(image);
}
function pumpCovers(){
  for(const image of [...coverQueue]){
    if(loadingCovers>=3)break;
    coverQueue.delete(image);const state=covers.get(image);
    if(!state||state.loading||state.entry||!image.isConnected)continue;
    state.loading=true;loadingCovers++;
    let entry=coverPool.get(state.key);
    if(!entry){
      entry={refs:0,controller:new AbortController(),blob:null,size:0};coverPool.set(state.key,entry);
      entry.promise=apiFetch(state.url,{signal:entry.controller.signal}).then(async response=>{
        if(!response.ok)throw new Error('No se pudo cargar la portada.');
        const blob=await response.blob();if(entry.controller.signal.aborted)throw new Error('Cancelado');
        entry.blob=URL.createObjectURL(blob);entry.size=blob.size;coverBytes+=blob.size;return entry;
      }).catch(error=>{if(coverPool.get(state.key)===entry)coverPool.delete(state.key);throw error;});
    }
    entry.promise.then(()=>{if(image.isConnected)assignCover(image,state,entry);}).catch(()=>{if(covers.get(image)===state)image.dispatchEvent(new Event('error'));})
      .finally(()=>{loadingCovers--;state.loading=false;trimCovers();pumpCovers();});
  }
}
export function setCover(image,url,key){
  const identity=coverIdentity(url,key),current=covers.get(image);
  if(current?.key===identity&&current.entry){current.url=url;image.dataset.cover=url;return;}
  clearCover(image);if(!isProxyUrl(url))return;
  if(!cloudMode){image.src=url;return;}
  const state={key:identity,url,loading:false,entry:null};covers.set(image,state);image.dataset.cover=url;
  if(!observer){observer=new MutationObserver(()=>{for(const [target,value] of covers)if(!target.isConnected||!target.hasAttribute('src')&&value.entry)clearCover(target);});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});}
  const cached=coverPool.get(identity);
  if(cached?.blob){coverPool.delete(identity);coverPool.set(identity,cached);assignCover(image,state,cached);return;}
  if('IntersectionObserver' in window){
    intersection??=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)coverQueue.add(entry.target);pumpCovers();},{rootMargin:'120px'});
    intersection.observe(image);
  }else setTimeout(()=>{coverQueue.add(image);pumpCovers();},0);
}
export function clearCover(image){
  const state=covers.get(image);if(state?.entry)state.entry.refs=Math.max(0,state.entry.refs-1);
  intersection?.unobserve(image);coverQueue.delete(image);covers.delete(image);image.removeAttribute('src');image.removeAttribute('srcset');delete image.dataset.cover;trimCovers();
}
export function clearTemporaryCovers(){
  for(const image of [...covers.keys()])clearCover(image);
  for(const entry of coverPool.values()){entry.controller.abort();if(entry.blob)URL.revokeObjectURL(entry.blob);}
  coverPool.clear();coverBytes=0;
}
export function clearAccountMedia() { clearTemporaryCovers(); privateToken = '';vault?.clear(); }
import {createPrivateVault} from './private-vault.js';
import {createVaultSync} from './vault-sync.js';
import {createDeviceLibrary} from './device-library.js';
