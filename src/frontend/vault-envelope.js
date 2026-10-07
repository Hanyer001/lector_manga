// Formato público de la bóveda. Nunca contiene títulos, enlaces o claves sin cifrar.
export const VAULT_MAX_BYTES=12*1024*1024;
export const PRIVATE_ID_BASE=2**40;
export const VAULT_ITERATIONS=600000;
const binary=(value,bytes)=>typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&value.length===Math.ceil(bytes*4/3);
const box=(value,bytes)=>value&&Object.keys(value).length===2&&binary(value.iv,12)&&binary(value.ciphertext,bytes);
export function validateVaultEnvelope(value) {
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='algorithm,kdf,payload,recovery,vaultId,version,wrappedKey'||value.version!==1||value.algorithm!=='AES-256-GCM'||!binary(value.vaultId,16))throw new Error('Formato de bóveda cifrada inválido.');
  const kdf=value.kdf;
  if(!kdf||Object.keys(kdf).sort().join(',')!=='hash,iterations,name,salt'||kdf.name!=='PBKDF2'||kdf.hash!=='SHA-256'||kdf.iterations!==VAULT_ITERATIONS||!binary(kdf.salt,16))throw new Error('Derivación de clave no compatible.');
  if(!box(value.wrappedKey,48)||!box(value.recovery,48)||!value.payload||Object.keys(value.payload).length!==2||!binary(value.payload.iv,12)||typeof value.payload.ciphertext!=='string'||!/^[A-Za-z0-9_-]+$/.test(value.payload.ciphertext)||value.payload.ciphertext.length<24||value.payload.ciphertext.length>Math.ceil((VAULT_MAX_BYTES+16)*4/3))throw new Error('Contenido cifrado inválido o demasiado grande.');
  return value;
}
