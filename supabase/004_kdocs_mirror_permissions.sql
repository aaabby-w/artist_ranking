-- Existing mirror table only. Diagnosed in production on 2026-10-29:
-- RLS enabled; service_role BYPASSRLS and public USAGE present;
-- SELECT/INSERT/UPDATE absent. No business data or policies are changed.
begin;
do $$ begin
  if to_regclass('public.guild_kdocs_mirror') is null then
    raise exception 'guild_kdocs_mirror is missing; inspect the existing deployment first';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.guild_kdocs_mirror'::regclass) then
    raise exception 'Expected mirror RLS to be enabled; investigate before granting access';
  end if;
end $$;
grant select, insert, update on table public.guild_kdocs_mirror to service_role;
commit;
-- Verify: service_role SELECT/INSERT/UPDATE=true; anon INSERT=false;
-- authenticated UPDATE=false; RLS remains enabled.
-- Rollback only this migration's grants (stops the sync writer; keeps all data):
-- revoke select, insert, update on public.guild_kdocs_mirror from service_role;
