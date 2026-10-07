import {validateVaultEnvelope,VAULT_ITERATIONS,VAULT_MAX_BYTES} from './vault-envelope.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export const encode64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export function decode64(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Dato cifrado inválido.');
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
}
function encodePayload(bytes) {
  let text='';for(let offset=0;offset<bytes.length;offset+=16384)text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  return btoa(text).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
const random=bytes=>crypto.getRandomValues(new Uint8Array(bytes));
const context=(owner,vaultId,purpose)=>encoder.encode(`lector-manga|private-vault|v1|${owner}|${vaultId}|${purpose}`);
function passwordText(value) {
  if(typeof value!=='string'||value.length<12||value.length>512||/^\d+$/.test(value)||!value.trim())throw new Error('Usa una contraseña de cifrado de al menos 12 caracteres; evita un PIN numérico.');
  return encoder.encode(value);
}
async function passwordKey(password,salt,creation=false) {
  const bytes=creation?passwordText(password):encoder.encode(String(password??''));
  if(bytes.length>2048)throw new Error('Contraseña demasiado larga.');
  try {
    const material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:decode64(salt),iterations:VAULT_ITERATIONS},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  } finally {bytes.fill(0);}
}
const dataKey=bytes=>crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
async function seal(bytes,key,aad) {
  const iv=random(12),ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,bytes));
  return {iv:encode64(iv),ciphertext:encodePayload(ciphertext)};
}
async function unseal(box,key,aad) {
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(box.iv),additionalData:aad,tagLength:128},key,decode64(box.ciphertext)));
}
export async function encryptVaultState(state,key,owner,envelope) {
  const bytes=encoder.encode(JSON.stringify(state));
  if(bytes.byteLength>VAULT_MAX_BYTES)throw new Error('La biblioteca privada supera los 12 MB de metadatos.');
  try{return {...envelope,payload:await seal(bytes,key,context(owner,envelope.vaultId,'payload'))};}finally{bytes.fill(0);}
}
export async function createVaultEncryption(state,password,owner) {
  if(!owner)throw new Error('Inicia sesión antes de crear la bóveda.');
  const salt=encode64(random(16)),vaultId=encode64(random(16)),rawKey=random(32),recovery=random(32);
  try {
    const key=await dataKey(rawKey),kek=await passwordKey(password,salt,true);
    const envelope={version:1,algorithm:'AES-256-GCM',vaultId,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:VAULT_ITERATIONS,salt},wrappedKey:await seal(rawKey,kek,context(owner,vaultId,'password')),recovery:await seal(rawKey,await dataKey(recovery),context(owner,vaultId,'recovery'))};
    return {envelope:await encryptVaultState(state,key,owner,envelope),key,rawKey,recoveryKey:encode64(recovery)};
  }catch(error){rawKey.fill(0);throw error;}finally{recovery.fill(0);}
}
export async function openVaultEncryption(envelope,secret,owner,{recovery=false}={}) {
  validateVaultEnvelope(envelope);let rawKey;
  try {
    const kek=recovery?await dataKey(decode64(secret)):await passwordKey(secret,envelope.kdf.salt);
    rawKey=await unseal(recovery?envelope.recovery:envelope.wrappedKey,kek,context(owner,envelope.vaultId,recovery?'recovery':'password'));
    const key=await dataKey(rawKey),bytes=await unseal(envelope.payload,key,context(owner,envelope.vaultId,'payload'));
    try{return {key,rawKey,state:JSON.parse(decoder.decode(bytes))};}finally{bytes.fill(0);}
  }catch{rawKey?.fill(0);throw new Error('La contraseña o la clave de recuperación no es correcta, o la bóveda fue alterada.');}
}
export async function decryptVaultState(envelope,key,owner) {
  validateVaultEnvelope(envelope);
  const bytes=await unseal(envelope.payload,key,context(owner,envelope.vaultId,'payload'));
  try{return JSON.parse(decoder.decode(bytes));}finally{bytes.fill(0);}
}
export async function changeVaultPassword(envelope,rawKey,password,owner) {
  const salt=encode64(random(16)),kek=await passwordKey(password,salt,true);
  return {...envelope,kdf:{...envelope.kdf,salt},wrappedKey:await seal(rawKey,kek,context(owner,envelope.vaultId,'password'))};
}
