export class ApiError extends Error {
  constructor(status, code, message, options) {
    super(message, options);
    Object.assign(this, { status, code });
  }
}

export function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new ApiError(400, 'INVALID_ID', 'ID inválido.');
  }
  return Number(value);
}

export function httpUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new ApiError(400, 'INVALID_URL', 'Se requiere una URL HTTP(S) sin credenciales.');
  }
}
