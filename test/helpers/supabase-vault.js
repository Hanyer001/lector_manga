// Doble exclusivo de pruebas: mismo contrato SDK/RPC, datos inventados.
export function memorySupabase(store,user,calls=[]) {
  const request=async(name,body)=>{
    calls.push({name,body:structuredClone(body)});
    try{
      let data;
      if(name==='reader_vault_commit_owned') {
        const saved=await store.commitVault(user.id,body.p_expected,body.p_envelope,
          {id:body.p_operation,fingerprint:body.p_fingerprint},
          body.p_account_state===null?{}:{revision:body.p_account_expected,state:body.p_account_state});
        data=[{committed:true,revision:saved.revision,account_revision:saved.accountRevision}];
      }else throw new Error('RPC inesperada: '+name);
      return {data,error:null};
    }catch(error){
      if(['VAULT_CHANGED','OPERATION_MISMATCH'].includes(error.code))return {data:[{committed:false,reason:error.code==='OPERATION_MISMATCH'?'operation_mismatch':'conflict'}],error:null};
      return {data:null,error:{code:error.code,message:error.message}};
    }
  };
  return {
    auth:{async getSession(){return {data:{session:{user}},error:null};}},
    rpc(name,body){let signal;return {abortSignal(value){signal=value;return this;},then(resolve,reject){if(signal?.aborted)return Promise.reject(new Error('Abortado')).then(resolve,reject);return request(name,body).then(resolve,reject);}};},
    from(table){let fields,identity,signal;return {
      select(value){fields=value;return this;},eq(name,value){if(name==='user_id')identity=value;return this;},abortSignal(value){signal=value;return this;},
      async maybeSingle(){
        calls.push({name:table,fields,identity});
        if(signal?.aborted)return {data:null,error:{code:'ABORTED'}};
        if(identity!==user.id)return {data:null,error:null};
        const row=table==='reader_accounts'?await store.load(user.id):table==='reader_private_vaults'?await store.loadVault(user.id):null;
        if(!row||row.revision===0)return {data:null,error:null};
        return {data:Object.fromEntries(fields.split(',').map(field=>[field,row[field]])),error:null};
      }
    };}
  };
}
