-- La bóveda se cifra en el navegador. Estas tablas nunca reciben su contraseña.
begin;
create table if not exists public.reader_private_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check(revision>0),
  envelope jsonb not null check(octet_length(envelope::text)<=18000000),
  updated_at timestamptz not null default now()
);
create table if not exists public.reader_vault_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  fingerprint text not null,
  revision bigint not null,
  account_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
alter table public.reader_private_vaults enable row level security;
alter table public.reader_vault_operations enable row level security;
revoke all on public.reader_private_vaults,public.reader_vault_operations from public,anon,authenticated;
grant select,insert,update,delete on public.reader_private_vaults,public.reader_vault_operations to service_role;
create or replace function public.reader_vault_commit(p_user uuid,p_expected bigint,p_envelope jsonb,
 p_operation uuid,p_fingerprint text,p_account_expected bigint default null,p_account_state jsonb default null)
returns table(committed boolean,revision bigint,account_revision bigint,reason text)
language plpgsql security invoker set search_path='' as $$
declare v_revision bigint; a_revision bigint; old_operation public.reader_vault_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into old_operation from public.reader_vault_operations where user_id=p_user and operation_id=p_operation;
  if found then
    return query select old_operation.fingerprint=p_fingerprint,old_operation.revision,old_operation.account_revision,
      case when old_operation.fingerprint=p_fingerprint then null::text else 'operation_mismatch' end;
    return;
  end if;
  select v.revision into v_revision from public.reader_private_vaults v where v.user_id=p_user;
  v_revision:=coalesce(v_revision,0);
  select a.revision into a_revision from public.reader_accounts a where a.user_id=p_user;
  a_revision:=coalesce(a_revision,0);
  if v_revision<>p_expected or (p_account_expected is not null and a_revision<>p_account_expected) then
    return query select false,v_revision,a_revision,'conflict'::text;return;
  end if;
  if (p_account_expected is null)<>(p_account_state is null) then raise exception 'invalid account update';end if;
  if p_account_state is not null then
    a_revision:=a_revision+1;
    insert into public.reader_accounts(user_id,revision,state) values(p_user,a_revision,p_account_state)
      on conflict(user_id) do update set revision=excluded.revision,state=excluded.state,updated_at=now();
    -- Las respuestas anteriores podrían contener títulos que ahora son privados.
    -- Conservar solo los IDs de operación impide que un reintento antiguo los revele.
    update public.reader_operations set response='{}'::jsonb,fingerprint='' where user_id=p_user;
  end if;
  v_revision:=v_revision+1;
  insert into public.reader_private_vaults(user_id,revision,envelope) values(p_user,v_revision,p_envelope)
    on conflict(user_id) do update set revision=excluded.revision,envelope=excluded.envelope,updated_at=now();
  insert into public.reader_vault_operations(user_id,operation_id,fingerprint,revision,account_revision)
    values(p_user,p_operation,p_fingerprint,v_revision,a_revision);
  delete from public.reader_vault_operations where user_id=p_user and created_at<now()-interval '7 days';
  return query select true,v_revision,a_revision,null::text;
end;$$;
revoke all on function public.reader_vault_commit(uuid,bigint,jsonb,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.reader_vault_commit(uuid,bigint,jsonb,uuid,text,bigint,jsonb) to service_role;
commit;
