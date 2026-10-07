-- Etapa 2: ejecutar DESPUÉS de que el servidor sin clave administrativa esté Live.
-- No borra datos ni cambia claves de cifrado; cierra las rutas administrativas antiguas.
begin;
revoke all on public.reader_accounts,public.reader_operations,
  public.reader_private_vaults,public.reader_vault_operations from service_role;
revoke all on function public.reader_commit(uuid,bigint,jsonb,uuid,text,jsonb),
  public.reader_media_access(uuid,bigint,text,text),
  public.reader_vault_commit(uuid,bigint,jsonb,uuid,text,bigint,jsonb)
  from public,anon,authenticated,service_role;
commit;
