import {PRIVATE_ID_BASE} from './vault-envelope.js';
let loading;
export function sqliteAdapter(native) {
  const bind=args=>args.length===1&&args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])?Object.fromEntries(Object.entries(args[0]).map(([key,value])=>['@'+key,value])):args;
  const query=(sql,args,all)=>{const statement=native.prepare(sql);try{statement.bind(bind(args));const rows=[];while(statement.step()){rows.push(statement.getAsObject());if(!all)break;}return all?rows:rows[0];}finally{statement.free();}};
  return {
    exec(sql){native.run(sql);},close(){native.close();},
    pragma(sql,{simple=false}={}){const rows=query('PRAGMA '+sql,[],true);return simple?Object.values(rows[0]??{})[0]:rows;},
    prepare(sql){return {get:(...args)=>query(sql,args,false),all:(...args)=>query(sql,args,true),run:(...args)=>{native.run(sql,bind(args));return {changes:native.getRowsModified()};}};},
    transaction(fn){return (...args)=>{native.run('SAVEPOINT lector_transaction');try{const value=fn(...args);native.run('RELEASE lector_transaction');return value;}catch(error){native.run('ROLLBACK TO lector_transaction');native.run('RELEASE lector_transaction');throw error;}};}
  };
}
export async function loadPrivateDatabase() {
  if(loading)return loading;
  loading=(async()=>{
    if(!window.initSqlJs)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('./vendor/sql-wasm.js',import.meta.url).href;script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo cargar la biblioteca cifrada.'));document.head.append(script);});
    const [SQL,schemas,{createDatabaseStore}]=await Promise.all([window.initSqlJs({locateFile:name=>new URL('./vendor/'+name,import.meta.url).href}),fetch(new URL('./vendor/schema.json',import.meta.url)).then(response=>{if(!response.ok)throw new Error('Falta el esquema de la biblioteca.');return response.json();}),import('./vendor/database-core.js')]);
    const open=({privateIds=true}={})=>{
      const db=sqliteAdapter(new SQL.Database());db.pragma('foreign_keys = ON');
      for(const schema of schemas)db.exec(schema.replaceAll('id INTEGER PRIMARY KEY,','id INTEGER PRIMARY KEY AUTOINCREMENT,'));
      if(privateIds)for(const name of ['Series','Chapters','Progress','Folders','Works'])db.prepare('INSERT OR REPLACE INTO sqlite_sequence(name,seq) VALUES(?,?)').run(name,PRIVATE_ID_BASE);
      return createDatabaseStore(db,()=>open({privateIds}));
    };return open;
  })().catch(error=>{loading=undefined;throw error;});return loading;
}
