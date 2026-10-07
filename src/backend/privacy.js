import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

// El PIN es un bloqueo adicional de acceso; no representa cifrado de extremo a extremo.
export function createPrivateAccess(database, { now = Date.now, idleMs = 10 * 60 * 1000 } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const owner = req => req.user?.id ?? 'local';
  const name = req => `lector_private_${req.socket.localPort}`;
  const cookieToken = req => req.user ? req.headers['x-private-token'] : (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(name(req) + '='))?.slice(name(req).length + 1);
  function unlocked(req) {
    const token = cookieToken(req), session = sessions.get(token);
    if (!session || session.owner !== owner(req) || session.pinHash !== database.getPrivateAccess()?.pin_hash || session.expires <= now() || session.hardExpires <= now()) { if(session?.owner===owner(req))sessions.delete(token); return false; }
    session.expires = now() + idleMs; return true;
  }
  const requireAccess = req => { if (!unlocked(req)) throw new ApiError(423, 'PRIVATE_LOCKED', 'Desbloquea la biblioteca privada con tu PIN.'); };
  function grant(req, res) {
    for (const [key, session] of sessions) if (session.expires <= now() || session.hardExpires <= now()) sessions.delete(key);
    // Renovar invalida el token anterior de este navegador.
    sessions.delete(cookieToken(req));
    if (sessions.size >= 1024) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { owner: owner(req), pinHash: database.getPrivateAccess()?.pin_hash, expires: now() + idleMs, hardExpires: now() + 60 * 60 * 1000 });
    if (!req.user) res.set('Set-Cookie', `${name(req)}=${token}; HttpOnly; SameSite=Strict; Path=/api`);
    return { configured: true, unlocked: true, idleMs, ...(req.user ? { privateToken: token } : {}) };
  }
  function pin(value) { if (typeof value !== 'string' || !/^\d{4,12}$/.test(value)) throw new ApiError(400, 'INVALID_PIN', 'Usa un PIN de 4 a 12 dígitos.'); return value; }
  return {
    requireAccess, unlocked,
    status(req) { return { configured: Boolean(database.getPrivateAccess()), unlocked: unlocked(req), idleMs }; },
    setup(req, res, value) {
      if (database.getPrivateAccess()) throw new ApiError(409, 'PIN_EXISTS', 'El PIN ya está configurado.');
      const salt = randomBytes(16).toString('hex'), hash = scryptSync(pin(value), salt, 32).toString('hex');
      database.savePrivateAccess(salt, hash); return grant(req, res);
    },
    unlock(req, res, value) {
      const attempt = attempts.get(owner(req)) ?? { failures: 0, blockedUntil: 0 };
      if (now() < attempt.blockedUntil) throw new ApiError(429, 'PIN_RATE_LIMIT', 'Demasiados intentos. Espera un minuto.');
      const config = database.getPrivateAccess();
      if (!config) throw new ApiError(409, 'PIN_REQUIRED', 'Primero crea el PIN de tu biblioteca privada.');
      const actual = scryptSync(pin(value), config.salt, 32), expected = Buffer.from(config.pin_hash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        if (++attempt.failures >= 5) { attempt.blockedUntil = now() + 60000; attempt.failures = 0; }
        if(attempts.size>=1024&&!attempts.has(owner(req)))attempts.delete(attempts.keys().next().value);
        attempts.set(owner(req), attempt);
        throw new ApiError(403, 'INVALID_PIN', 'PIN incorrecto.');
      }
      attempts.delete(owner(req)); return grant(req, res);
    },
    change(req, value) {
      requireAccess(req);
      const salt = randomBytes(16).toString('hex'), hash = scryptSync(pin(value), salt, 32).toString('hex');
      database.replacePrivateAccess(salt, hash); for(const [token,session] of sessions)if(session.owner===owner(req))sessions.delete(token); return { configured: true, unlocked: false, idleMs };
    },
    lock(req, res) {
      const token=cookieToken(req);if(sessions.get(token)?.owner===owner(req))sessions.delete(token);
      if(!req.user)res.set('Set-Cookie', `${name(req)}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`);
      return { configured: Boolean(database.getPrivateAccess()), unlocked: false, idleMs };
    }
  };
}
