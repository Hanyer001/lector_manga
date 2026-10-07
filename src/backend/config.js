const origin = (value, name, { local = false } = {}) => {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}: indica una URL válida.`); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error(`${name}: usa un origen HTTPS sin ruta, credenciales ni parámetros.`);
  return url.origin;
};
export function readServerConfig(env = process.env) {
  const mode = env.APP_MODE ?? 'local';
  if (!['local', 'cloud'].includes(mode)) throw new Error('APP_MODE debe ser local o cloud.');
  if ((env.RENDER === 'true' || env.NODE_ENV === 'production') && mode !== 'cloud') throw new Error('El alojamiento público exige APP_MODE=cloud.');
  if (mode === 'local') return { mode, publicConfig: { mode: 'local', apiBase: '' }, frontendOrigins: (env.FRONTEND_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean) };
  const apiOrigin = origin(env.PUBLIC_API_ORIGIN, 'PUBLIC_API_ORIGIN');
  const supabaseUrl = origin(env.SUPABASE_URL, 'SUPABASE_URL');
  const frontendOrigins = (env.FRONTEND_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean).map(v => origin(v, 'FRONTEND_ORIGINS', { local: env.NODE_ENV !== 'production' }));
  if (!frontendOrigins.length) throw new Error('Configura FRONTEND_ORIGINS con el origen de GitHub Pages.');
  if (!env.SUPABASE_PUBLIC_KEY || !env.IMAGE_TICKET_SECRET || env.IMAGE_TICKET_SECRET.length < 40) throw new Error('Configura SUPABASE_PUBLIC_KEY y un IMAGE_TICKET_SECRET de al menos 40 caracteres en Render.');
  if (env.SUPABASE_PUBLIC_KEY.startsWith('sb_secret_')) throw new Error('SUPABASE_PUBLIC_KEY debe ser la clave publicable, nunca la clave secreta.');
  try { const role = JSON.parse(Buffer.from(env.SUPABASE_PUBLIC_KEY.split('.')[1], 'base64url')).role; if (role === 'service_role') throw new Error('Clave service_role en configuración pública.'); } catch (error) { if (error.message.includes('service_role')) throw error; }
  return { mode, apiOrigin, frontendOrigins, publicConfig: { mode, apiBase: apiOrigin, supabaseUrl, supabasePublicKey: env.SUPABASE_PUBLIC_KEY, privateEncryption:'e2ee',privateSync:'supabase' }, cloud: { url: supabaseUrl, publicKey: env.SUPABASE_PUBLIC_KEY }, imageSecret: env.IMAGE_TICKET_SECRET };
}
