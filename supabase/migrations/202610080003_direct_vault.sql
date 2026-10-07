-- Etapa 1: conserva tablas y ciphertext; activa acceso con JWT y RPC de propietario.
-- Ejecutar antes de desplegar el frontend y servidor nuevos.
begin;
do $$
declare t text; op text;
begin
  foreach t in array array['reader_accounts','reader_operations','reader_private_vaults','reader_vault_operations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    foreach op in array array['select','insert','update','delete'] loop
      execute format('create policy %I on public.%I for %s to authenticated %s',
        t||'_'||op,t,op,
        case when op='insert' then 'with check ((select auth.uid()) = user_id)'
             when op='update' then 'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)'
             else 'using ((select auth.uid()) = user_id)' end);
    end loop;
  end loop;
end;$$;
alter table public.reader_private_vaults add constraint vault_envelope_shape check ((
    jsonb_typeof(envelope) = 'object'
    and envelope ?& array['version','algorithm','vaultId','kdf',
                          'wrappedKey','recovery','payload']
    and envelope - array['version','algorithm','vaultId','kdf',
                         'wrappedKey','recovery','payload'] = '{}'::jsonb
    and envelope->>'version' = '1'
    and envelope->>'algorithm' = 'AES-256-GCM'
    and jsonb_typeof(envelope->'kdf') = 'object'
    and jsonb_typeof(envelope->'wrappedKey') = 'object'
    and jsonb_typeof(envelope->'recovery') = 'object'
    and jsonb_typeof(envelope->'payload') = 'object'
    and envelope->'kdf'->>'name' = 'PBKDF2'
    and envelope->'kdf'->>'hash' = 'SHA-256'
    and envelope->'kdf'->>'iterations' = '600000'
    and envelope->>'vaultId' ~ '^[A-Za-z0-9_-]{22}$'
    and envelope->'kdf'->>'salt' ~ '^[A-Za-z0-9_-]{22}$'
    and envelope->'wrappedKey'->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
    and envelope->'wrappedKey'->>'ciphertext' ~ '^[A-Za-z0-9_-]{64}$'
    and envelope->'recovery'->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
    and envelope->'recovery'->>'ciphertext' ~ '^[A-Za-z0-9_-]{64}$'
    and envelope->'payload'->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
    and envelope->'payload'->>'ciphertext' ~ '^[A-Za-z0-9_-]{24,}$'
    and (envelope->'kdf') - array['name','hash','iterations','salt'] = '{}'::jsonb
    and (envelope->'wrappedKey') - array['iv','ciphertext'] = '{}'::jsonb
    and (envelope->'recovery') - array['iv','ciphertext'] = '{}'::jsonb
    and (envelope->'payload') - array['iv','ciphertext'] = '{}'::jsonb
  ) is true);
alter table public.reader_private_vaults add constraint vault_revision_safe check(revision between 1 and 9007199254740991);
create function public.reader_direct_vault_version()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.revision <> 1 then
      raise exception 'La revision inicial debe ser 1' using errcode = '23514';
    end if;
  elsif NEW.user_id is distinct from OLD.user_id
     or NEW.revision <> OLD.revision + 1 then
    raise exception 'Propietario o revision invalida' using errcode = '23514';
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;
revoke all on function public.reader_direct_vault_version()
  from public, anon, authenticated, service_role;
create trigger reader_direct_vault_version
  before insert or update on public.reader_private_vaults
  for each row execute function public.reader_direct_vault_version();

create or replace function public.reader_commit_owned(p_user uuid, p_expected bigint, p_state jsonb,
  p_operation uuid, p_fingerprint text, p_response jsonb)
returns table(committed boolean, revision bigint)
language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; saved_revision bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user then raise exception 'unauthorized owner' using errcode='42501'; end if;
  -- Serializa las escrituras de una cuenta incluso entre varias instancias Node.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select o.revision into saved_revision from public.reader_operations o where o.user_id=p_user and o.operation_id=p_operation and o.fingerprint=p_fingerprint;
  if found then return query select true, saved_revision; return; end if;
  select a.revision into current_revision from public.reader_accounts a where a.user_id=p_user;
  current_revision := coalesce(current_revision, 0);
  if current_revision <> p_expected then return query select false, current_revision; return; end if;
  if exists(select 1 from public.reader_operations o where o.user_id=p_user and o.operation_id=p_operation) then
    raise exception 'operation id reused';
  end if;
  saved_revision := current_revision + 1;
  insert into public.reader_accounts(user_id,revision,state) values(p_user,saved_revision,p_state)
    on conflict(user_id) do update set revision=excluded.revision,state=excluded.state,updated_at=now();
  insert into public.reader_operations(user_id,operation_id,fingerprint,response,revision) values(p_user,p_operation,p_fingerprint,p_response,saved_revision);
  delete from public.reader_operations o where o.user_id=p_user and o.created_at < now() - interval '7 days';
  return query select true, saved_revision;
end;
$$;
create or replace function public.reader_media_access_owned(p_user uuid, p_series bigint, p_source text default null, p_url text default null)
returns table(series_found boolean, is_private boolean, pin jsonb)
language sql security invoker set search_path = '' as $$
  select p_series is null or s.value is not null,
    coalesce((s.value->>'is_private')::integer=1, false),
    a.state->'tables'->'PrivateAccess'->0
  from (select 1) seed
  left join public.reader_accounts a on a.user_id=p_user and p_user=(select auth.uid())
  left join lateral (select value from jsonb_array_elements(coalesce(a.state->'tables'->'Series','[]'::jsonb))
    where (p_series is not null and (value->>'id')::bigint=p_series)
      or (p_series is null and value->>'source'=p_source and value->>'url_origen'=p_url) limit 1) s on true
  where p_user=(select auth.uid());
$$;
create or replace function public.reader_vault_commit_owned(p_expected bigint,p_envelope jsonb,
 p_operation uuid,p_fingerprint text,p_account_expected bigint default null,p_account_state jsonb default null)
returns table(committed boolean,revision bigint,account_revision bigint,reason text)
language plpgsql security invoker set search_path='' as $$
declare p_user uuid:=auth.uid(); v_revision bigint; a_revision bigint; old_operation public.reader_vault_operations;
begin
  if p_user is null then raise exception 'authentication required' using errcode='42501'; end if;
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
  if v_revision=1 then
    insert into public.reader_private_vaults(user_id,revision,envelope) values(p_user,v_revision,p_envelope);
  else
    update public.reader_private_vaults set revision=v_revision,envelope=p_envelope,updated_at=now() where user_id=p_user;
  end if;
  insert into public.reader_vault_operations(user_id,operation_id,fingerprint,revision,account_revision)
    values(p_user,p_operation,p_fingerprint,v_revision,a_revision);
  delete from public.reader_vault_operations where user_id=p_user and created_at<now()-interval '7 days';
  return query select true,v_revision,a_revision,null::text;
end;$$;
revoke all on function public.reader_commit_owned(uuid,bigint,jsonb,uuid,text,jsonb),
  public.reader_media_access_owned(uuid,bigint,text,text),
  public.reader_vault_commit_owned(bigint,jsonb,uuid,text,bigint,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.reader_commit_owned(uuid,bigint,jsonb,uuid,text,jsonb),
  public.reader_media_access_owned(uuid,bigint,text,text),
  public.reader_vault_commit_owned(bigint,jsonb,uuid,text,bigint,jsonb) to authenticated;
commit;
