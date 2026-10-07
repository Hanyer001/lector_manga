import { createClient } from '@supabase/supabase-js';
import { ApiError } from './errors.js';

export function createCloudStore({ url, publicKey, fetchImpl = fetch }) {
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (...args) => fetchImpl(args[0], { ...args[1], signal: AbortSignal.timeout(15000) }) } };
  const auth = createClient(url, publicKey, options), clients=new WeakMap();
  const verified = new Map();
  const failure = () => new ApiError(503, 'CLOUD_UNAVAILABLE', 'No se pudo contactar con la sincronización. Tus cambios no se han confirmado; vuelve a intentarlo.');
  function checked(result) { if (result.error) throw failure(); return result.data; }
  return {
    async authenticate(token) {
      if (typeof token !== 'string' || token.length > 12000) throw new ApiError(401, 'AUTH_REQUIRED', 'Inicia sesión para acceder a tu biblioteca.');
      const cached = verified.get(token);
      if (cached && cached.expires > Date.now()) return cached.user;
      let result;
      try { result = await auth.auth.getUser(token); } catch { throw failure(); }
      if(result.error?.name==='AuthRetryableFetchError'||result.error?.status>=500)throw failure();
      if (result.error || !result.data?.user?.id) throw new ApiError(401, 'AUTH_REQUIRED', 'Tu sesión ha vencido. Inicia sesión de nuevo.');
      // Cache breve solo de respuestas verificadas por Supabase, nunca de claims sin verificar.
      let expiry = Date.now() + 10000;
      try { expiry = Math.min(expiry, JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp * 1000); } catch { expiry = 0; }
      if (verified.size >= 512) verified.delete(verified.keys().next().value);
      clients.set(result.data.user,createClient(url,publicKey,{...options,global:{...options.global,headers:{Authorization:'Bearer '+token}}}));
      verified.set(token, { user: result.data.user, expires: expiry });
      return result.data.user;
    },
    forUser(user) {
      const sdk=clients.get(user);
      if(!sdk)throw new ApiError(401,'AUTH_REQUIRED','La cuenta no está verificada.');
      const owner=id=>{if(id!==user.id)throw new ApiError(403,'ACCOUNT_MISMATCH','La operación pertenece a otra cuenta.');};
      return {
    async load(userId) {
      owner(userId);
      const data = checked(await sdk.from('reader_accounts').select('revision,state').eq('user_id', userId).maybeSingle());
      return data ?? { revision: 0, state: null };
    },
    async operation(userId, id) {
      owner(userId);
      if (!id) return null;
      return checked(await sdk.from('reader_operations').select('response,revision,fingerprint').eq('user_id', userId).eq('operation_id', id).maybeSingle());
    },
    async commit(userId, revision, state, operation) {
      owner(userId);
      const rows = checked(await sdk.rpc('reader_commit_owned', { p_user: userId, p_expected: revision, p_state: state, p_operation: operation.id, p_fingerprint: operation.fingerprint, p_response: operation.response }));
      const saved = Array.isArray(rows) ? rows[0] : rows;
      if (!saved?.committed) throw new ApiError(409, 'ACCOUNT_CHANGED', 'La biblioteca cambió en otro dispositivo. Actualiza y vuelve a intentarlo.');
      return saved.revision;
    },
    async mediaAccess(userId, seriesId, { source, url } = {}) {
      owner(userId);
      const rows = checked(await sdk.rpc('reader_media_access_owned', { p_user: userId, p_series: seriesId ?? null, p_source: source ?? null, p_url: url ?? null }));
      const result = Array.isArray(rows) ? rows[0] : rows;
      if (seriesId && !result?.series_found) throw new ApiError(404, 'SERIES_NOT_FOUND', 'Esta lectura ya no está en tu biblioteca.');
      return { isPrivate: Boolean(result?.is_private), pin: result?.pin ?? null };
    }
      };
    }
  };
}
