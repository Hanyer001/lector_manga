import { ApiError } from '../../src/backend/errors.js';
export const USERS = { a: { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.test' }, b: { id: '00000000-0000-4000-8000-000000000002', email: 'b@example.test' } };
// Doble explícito usado únicamente por tests y el ejemplo local, nunca por server.js.
export function memoryAccountStore() {
  const states=new Map(),operations=new Map(),vaults=new Map(),vaultOperations=new Map();
  return {
    states,vaults,vaultOperations,
    async loadVault(id){return structuredClone(vaults.get(id)??{revision:0,envelope:null});},
    async vaultRevision(id){return vaults.get(id)?.revision??0;},
    async vaultOperation(id,operation){const saved=vaultOperations.get(id+'|'+operation);return saved?{revision:saved.revision,account_revision:saved.accountRevision,fingerprint:saved.fingerprint}:null;},
    async commitVault(id,revision,envelope,operation,account={}) {
      const key=id+'|'+operation.id,saved=vaultOperations.get(key);
      if(saved){if(saved.fingerprint!==operation.fingerprint)throw new ApiError(409,'OPERATION_MISMATCH','Operación reutilizada.');return {revision:saved.revision,accountRevision:saved.accountRevision};}
      if((vaults.get(id)?.revision??0)!==revision||(account.revision!==undefined&&(states.get(id)?.revision??0)!==account.revision))throw new ApiError(409,'VAULT_CHANGED','La biblioteca cambió.');
      let accountRevision=states.get(id)?.revision??0;
      if(account.state){accountRevision++;states.set(id,{revision:accountRevision,state:structuredClone(account.state)});for(const [key,op] of operations)if(key.startsWith(id+'|'))operations.set(key,{...op,fingerprint:'',response:{}});}
      vaults.set(id,{revision:revision+1,envelope:structuredClone(envelope)});vaultOperations.set(key,{revision:revision+1,accountRevision,fingerprint:operation.fingerprint});return {revision:revision+1,accountRevision};
    },
    async authenticate(token) { if(!USERS[token])throw new ApiError(401,'AUTH_REQUIRED','Inicia sesión.');return USERS[token]; },
    async load(id) { return structuredClone(states.get(id)??{revision:0,state:null}); },
    async operation(id,operation) { return structuredClone(operations.get(id+'|'+operation)??null); },
    async commit(id,revision,state,operation) {
      const key=id+'|'+operation.id,saved=operations.get(key);
      if(saved){if(saved.fingerprint!==operation.fingerprint)throw new ApiError(409,'OPERATION_MISMATCH','Operación reutilizada.');return saved.revision;}
      if((states.get(id)?.revision??0)!==revision)throw new ApiError(409,'ACCOUNT_CHANGED','La biblioteca cambió.');
      states.set(id,{revision:revision+1,state:structuredClone(state)});
      operations.set(key,{revision:revision+1,fingerprint:operation.fingerprint,response:structuredClone(operation.response)});
      return revision+1;
    },
    async mediaAccess(id,seriesId,{source,url}={}) {
      const tables=states.get(id)?.state?.tables,series=tables?.Series.find(row=>seriesId?row.id===seriesId:row.source===source&&row.url_origen===url);
      if(seriesId&&!series)throw new ApiError(404,'SERIES_NOT_FOUND','Serie eliminada.');
      return {isPrivate:Boolean(series?.is_private),pin:tables?.PrivateAccess[0]??null};
    }
  };
}
