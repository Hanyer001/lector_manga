import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { USERS } from './helpers/account-store.js';
test('PostgreSQL real: migración, RLS, persistencia, conflicto e idempotencia por cuenta',async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role,anon,authenticated;`);
    await pg.query('insert into auth.users values($1),($2)',[USERS.a.id,USERS.b.id]);
    await pg.exec(await readFile(new URL('../supabase/migrations/202610070001_accounts.sql',import.meta.url),'utf8'));
    await pg.exec('set role service_role');
    const id=randomUUID(),state={version:1,tables:{Series:[{id:1,is_private:1,source:'test',url_origen:'https://example.test/manga'}],PrivateAccess:[{salt:'s',pin_hash:'hash'}]}};
    const commit=async(user,expected,operation=id,fingerprint='test')=>(await pg.query('select * from public.reader_commit($1,$2,$3::jsonb,$4,$5,$6::jsonb)',[user,expected,JSON.stringify(state),operation,fingerprint,'{"ok":true}'])).rows[0];
    assert.equal((await commit(USERS.a.id,0)).committed,true);
    assert.equal(Number((await commit(USERS.a.id,0)).revision),1,'reintento idempotente');
    assert.equal((await commit(USERS.a.id,0,randomUUID())).committed,false,'rechaza versión obsoleta');
    assert.equal((await commit(USERS.b.id,0,randomUUID())).committed,true,'cuentas independientes');
    const access=(await pg.query('select * from public.reader_media_access($1,$2)',[USERS.a.id,1])).rows[0];assert.equal(access.is_private,true);assert.equal(access.pin.pin_hash,'hash');
    const catalogAccess=(await pg.query('select * from public.reader_media_access($1,null,$2,$3)',[USERS.a.id,'test','https://example.test/manga'])).rows[0];assert.equal(catalogAccess.is_private,true,'portadas antiguas de catálogo respetan la privacidad actual');
    assert.equal((await pg.query('select * from public.reader_media_access($1,$2)',[USERS.a.id,99])).rows[0].series_found,false);
    await pg.exec('reset role;set role authenticated');
    await assert.rejects(pg.query('select state from public.reader_accounts'),/permission denied/);
    await assert.rejects(commit(USERS.a.id,1,randomUUID()),/permission denied/);
    await pg.exec('reset role;set role anon');
    await assert.rejects(pg.query('select * from public.reader_operations'),/permission denied/);
    await pg.exec('reset role');
    await pg.query('delete from auth.users where id=$1',[USERS.a.id]);assert.equal((await pg.query('select count(*) as n from public.reader_accounts')).rows[0].n,1,'borrar cuenta elimina solo sus datos');
  }finally{await pg.close();}
});
