import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {USERS} from './helpers/account-store.js';
test('PostgreSQL: bóveda cifrada, traslado atómico, idempotencia y permisos cerrados',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role,anon,authenticated;');
    await pg.query('insert into auth.users values($1),($2)',[USERS.a.id,USERS.b.id]);
    for(const migration of ['202610070001_accounts','202610070002_private_vault'])await pg.exec(await readFile(new URL('../supabase/migrations/'+migration+'.sql',import.meta.url),'utf8'));
    await pg.exec('set role service_role');
    const publicOp=randomUUID();await pg.query('select * from public.reader_commit($1,0,$2::jsonb,$3,$4,$5::jsonb)',[USERS.a.id,'{"tables":{"Series":[{"titulo":"Antes de ocultar"}]}}',publicOp,'old-fingerprint','{"titulo":"Antes de ocultar"}']);
    const operation=randomUUID(),commit=(expected,id=operation,accountExpected=null,state=null,fingerprint='cipher-hash')=>pg.query('select * from public.reader_vault_commit($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb)',[USERS.a.id,expected,'{"ciphertext":"dato-cifrado-de-prueba"}',id,fingerprint,accountExpected,state]);
    assert.equal((await commit(0)).rows[0].committed,true);
    assert.equal(Number((await commit(0)).rows[0].revision),1,'un reintento devuelve la misma versión');
    assert.equal((await commit(0,operation,null,null,'different')).rows[0].reason,'operation_mismatch');
    assert.equal((await commit(0,randomUUID())).rows[0].committed,false);
    assert.equal((await commit(1,randomUUID(),0,'{"tables":{"Series":[]}}')).rows[0].committed,false,'si cambió la biblioteca general no se confirma ninguna parte del traslado');
    assert.equal((await pg.query('select revision from public.reader_private_vaults')).rows[0].revision,1);
    assert.equal((await commit(1,randomUUID(),1,'{"tables":{"Series":[]}}')).rows[0].committed,true);
    assert.equal((await pg.query('select state from public.reader_accounts')).rows[0].state.tables.Series.length,0);
    assert.deepEqual((await pg.query('select response,fingerprint from public.reader_operations')).rows[0],{response:{},fingerprint:''},'las respuestas previas no conservan los títulos ocultados');
    for(const role of ['anon','authenticated']){await pg.exec('reset role;set role '+role);await assert.rejects(pg.query('select envelope from public.reader_private_vaults'),/permission denied/);await assert.rejects(commit(2,randomUUID()),/permission denied/);}
    await pg.exec('reset role');await pg.query('delete from auth.users where id=$1',[USERS.a.id]);assert.equal((await pg.query('select count(*) as n from public.reader_private_vaults')).rows[0].n,0);
  }finally{await pg.close();}
});
