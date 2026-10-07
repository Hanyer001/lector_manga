import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createVaultEncryption} from '../src/frontend/vault-crypto.js';
import {USERS} from './helpers/account-store.js';

test('Supabase directo: conserva ciphertext, RLS por propietario y RPC atómica sin administrador',async()=>{
  const pg=new PGlite(),a=USERS.a.id,b=USERS.b.id;
  const created=await createVaultEncryption({titles:['Dato de prueba']},'Frase extensa de prueba para SQL 395',a);
  try{
    await pg.exec(`create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      create role anon;create role authenticated;create role service_role bypassrls;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    await pg.query('insert into auth.users values($1),($2)',[a,b]);
    for(const name of ['202610070001_accounts','202610070002_private_vault'])await pg.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
    await pg.query('insert into public.reader_private_vaults(user_id,revision,envelope) values($1,7,$2::jsonb)',[a,JSON.stringify(created.envelope)]);
    await pg.query('insert into public.reader_accounts(user_id,revision,state) values($1,3,$2::jsonb)',[a,'{"tables":{"Series":[{"titulo":"Anteriormente pública"}]}}']);
    await pg.query('insert into public.reader_operations(user_id,operation_id,fingerprint,response,revision) values($1,$2,$3,$4::jsonb,3)',[a,randomUUID(),'old','{"titulo":"Anteriormente pública"}']);
    for(const name of ['202610080003_direct_vault','202610080004_retire_admin_access'])await pg.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
    const as=async(role,id)=>{await pg.exec('reset role;set role '+role);await pg.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id})]);};
    const operation=randomUUID(),fingerprint='a'.repeat(64);
    const commit=(expected,id=operation,accountRevision=3,accountState='{"tables":{"Series":[]}}',hash=fingerprint)=>pg.query(
      'select * from public.reader_vault_commit_owned($1,$2::jsonb,$3,$4,$5,$6::jsonb)',
      [expected,JSON.stringify(created.envelope),id,hash,accountRevision,accountState]);
    await as('authenticated',a);
    const row=(await pg.query('select * from public.reader_private_vaults')).rows[0];
    assert.equal(row.revision,7);assert.deepEqual(row.envelope,created.envelope,'la migración no recifra ni reemplaza las bóvedas');
    const saved=(await commit(7)).rows[0];assert.equal(saved.committed,true);assert.equal(saved.revision,8);assert.equal(saved.account_revision,4);
    assert.equal((await pg.query('select state from public.reader_accounts')).rows[0].state.tables.Series.length,0);
    assert.deepEqual((await pg.query('select response,fingerprint from public.reader_operations')).rows[0],{response:{},fingerprint:''});
    assert.deepEqual((await commit(7)).rows[0],saved,'respuesta idempotente después de una transacción confirmada');
    assert.equal((await commit(8,operation,4,undefined,'b'.repeat(64))).rows[0].reason,'operation_mismatch');
    assert.equal((await commit(8,randomUUID(),3)).rows[0].committed,false,'un conflicto público no actualiza la privada');
    assert.equal((await pg.query('select revision from public.reader_private_vaults')).rows[0].revision,8);
    assert.equal((await commit(8,randomUUID(),null,null)).rows[0].revision,9,'guardado privado sin escritura general');
    await assert.rejects(pg.query('select * from public.reader_commit_owned($1,0,$2::jsonb,$3,$4,$5::jsonb)',[b,'{}',randomUUID(),'test','{}']),{code:'42501'});
    assert.equal((await pg.query('select * from public.reader_media_access_owned($1,null)',[b])).rows.length,0);
    await as('authenticated',b);
    for(const table of ['reader_accounts','reader_private_vaults','reader_operations','reader_vault_operations'])
      assert.equal((await pg.query('select * from public.'+table)).rows.length,0);
    assert.equal((await pg.query('update public.reader_private_vaults set revision=10 where user_id=$1 returning *',[a])).rows.length,0);
    assert.equal((await pg.query('delete from public.reader_private_vaults where user_id=$1 returning *',[a])).rows.length,0);
    await assert.rejects(pg.query('insert into public.reader_private_vaults(user_id,revision,envelope) values($1,1,$2::jsonb)',[a,JSON.stringify(created.envelope)]),{code:'42501'});
    assert.equal((await commit(0,randomUUID(),null,null)).rows[0].revision,1,'otra cuenta solo crea su propia fila');
    for(const role of ['anon','service_role']){
      await as(role,a);
      for(const table of ['reader_accounts','reader_private_vaults','reader_operations','reader_vault_operations'])
        await assert.rejects(pg.query('select * from public.'+table),{code:'42501'});
      await assert.rejects(commit(9),{code:'42501'});
      await assert.rejects(pg.query('select * from public.reader_vault_commit($1,9,$2::jsonb,$3,$4)',[a,JSON.stringify(created.envelope),randomUUID(),fingerprint]),{code:'42501'});
    }
    await as('authenticated',a);
    await assert.rejects(pg.query('update public.reader_private_vaults set user_id=$1,revision=10 where user_id=$2',[b,a]),{code:'23514'});
    await assert.rejects(pg.query('update public.reader_private_vaults set envelope=$1::jsonb,revision=10 where user_id=$2',[JSON.stringify({...created.envelope,title:'Sin cifrar'}),a]),{code:'23514'});
    await pg.query('delete from public.reader_private_vaults where user_id=$1',[a]);
    assert.equal((await pg.query('select * from public.reader_private_vaults')).rows.length,0);
  }finally{created.rawKey.fill(0);await pg.close();}
});
