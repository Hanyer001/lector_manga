import {validateVaultEnvelope} from './vault-envelope.js';
const failure=(code,message,status=503)=>Object.assign(new Error(message),{code,status});

// Solo el SDK con la clave publicable y el JWT del usuario. Nunca usa Render.
export function createVaultSync({client,owner,onAccountRevision=()=>{}}) {
  let controller=new AbortController();
  async function context() {
    const signal=controller.signal,id=owner(),sdk=await client();
    if(!id||!sdk)throw failure('AUTH_REQUIRED','Inicia sesión para sincronizar tu bóveda.',401);
    const check=()=>{if(signal.aborted||owner()!==id)throw failure('PRIVATE_LOCKED','La cuenta cambió o la bóveda se bloqueó.',423);};
    check();const {data,error}=await sdk.auth.getSession();check();
    if(error||data?.session?.user?.id!==id)throw failure('AUTH_REQUIRED','Tu sesión ha vencido.',401);
    return {sdk,id,signal,check};
  }
  async function read(table,columns,fallback) {
    const {sdk,id,signal,check}=await context();
    const {data,error}=await sdk.from(table).select(columns).eq('user_id',id).abortSignal(signal).maybeSingle();
    check();if(error)throw failure('CLOUD_UNAVAILABLE','No se pudo consultar Supabase. Vuelve a intentarlo.');
    return data??fallback;
  }
  return {
    cancel(){controller.abort();controller=new AbortController();},
    async load(){const row=await read('reader_private_vaults','revision,envelope',{revision:0,envelope:null});if(row.envelope)validateVaultEnvelope(row.envelope);return row;},
    async revision(){return (await read('reader_private_vaults','revision',{revision:0})).revision;},
    account:()=>read('reader_accounts','revision,state',{revision:0,state:null}),
    async commit({expectedRevision,envelope,operationId},account={}) {
      validateVaultEnvelope(envelope);
      const {sdk,id,signal,check}=await context();
      const payload={p_expected:expectedRevision,p_envelope:envelope,p_operation:operationId,
        p_account_expected:account.revision??null,p_account_state:account.state??null};
      const bytes=new TextEncoder().encode(JSON.stringify({owner:id,...payload}));
      try{payload.p_fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}
      check();const {data,error}=await sdk.rpc('reader_vault_commit_owned',payload).abortSignal(signal);check();
      if(error)throw failure('CLOUD_UNAVAILABLE','No se pudo confirmar el guardado. Comprueba la sincronización antes de reintentar.');
      const saved=Array.isArray(data)?data[0]:data;
      if(!saved?.committed)throw failure(saved?.reason==='operation_mismatch'?'OPERATION_MISMATCH':'VAULT_CHANGED','La biblioteca cambió en otro dispositivo. Actualiza y vuelve a intentarlo.',409);
      onAccountRevision(Number(saved.account_revision));
      return {revision:Number(saved.revision),accountRevision:Number(saved.account_revision)};
    }
  };
}
