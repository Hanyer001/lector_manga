-- Ejecutar una vez desde el editor SQL de Supabase. Solo Node usa la clave secreta.
begin;
create table if not exists public.reader_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  check (octet_length(state::text) <= 12582912)
);
create table if not exists public.reader_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  fingerprint text not null,
  response jsonb not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.reader_accounts enable row level security;
alter table public.reader_operations enable row level security;
-- La biblioteca completa incluye datos privados y el hash del PIN: el navegador
-- nunca puede consultarla directamente, ni siquiera con una sesión autenticada.
revoke all on public.reader_accounts, public.reader_operations from public, anon, authenticated;
grant select, insert, update, delete on public.reader_accounts, public.reader_operations to service_role;

create or replace function public.reader_commit(p_user uuid, p_expected bigint, p_state jsonb,
  p_operation uuid, p_fingerprint text, p_response jsonb)
returns table(committed boolean, revision bigint)
language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; saved_revision bigint;
begin
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
create or replace function public.reader_media_access(p_user uuid, p_series bigint, p_source text default null, p_url text default null)
returns table(series_found boolean, is_private boolean, pin jsonb)
language sql security invoker set search_path = '' as $$
  select p_series is null or s.value is not null,
    coalesce((s.value->>'is_private')::integer=1, false),
    a.state->'tables'->'PrivateAccess'->0
  from (select 1) seed
  left join public.reader_accounts a on a.user_id=p_user
  left join lateral (select value from jsonb_array_elements(coalesce(a.state->'tables'->'Series','[]'::jsonb))
    where (p_series is not null and (value->>'id')::bigint=p_series)
      or (p_series is null and value->>'source'=p_source and value->>'url_origen'=p_url) limit 1) s on true;
$$;
revoke all on function public.reader_commit(uuid,bigint,jsonb,uuid,text,jsonb), public.reader_media_access(uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.reader_commit(uuid,bigint,jsonb,uuid,text,jsonb), public.reader_media_access(uuid,bigint,text,text) to service_role;
commit;
