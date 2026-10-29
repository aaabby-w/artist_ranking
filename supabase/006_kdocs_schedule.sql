-- Run only after real full sync and idempotency checks pass.
-- User must first set Vault secret kdocs_sync_trigger to the CURRENT trigger secret.
begin;
do $$ begin
 if not exists(select 1 from vault.secrets where name='kdocs_sync_trigger') then raise exception 'Create kdocs_sync_trigger in Vault first'; end if;
end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function public.guild_kdocs_dispatch() returns bigint language plpgsql security definer set search_path='' as $$
declare token text; request_id bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='kdocs_sync_trigger';
 if token is null or length(token)<32 then raise exception 'Sync trigger secret is missing or too short'; end if;
 update public.guild_kdocs_runs set status='failed',finished_at=now(),error_code='RUN_TIMEOUT' where status='running' and started_at<now()-interval '15 minutes';
 select net.http_post(url:='https://jcerhkfttppravatitdx.supabase.co/functions/v1/kdocs-sync',headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',token),body:='{}'::jsonb,timeout_milliseconds:=90000) into request_id;
 return request_id;
end $$;
revoke all on function public.guild_kdocs_dispatch() from public,anon,authenticated,service_role;
select cron.schedule('guild-kdocs-sync','*/5 * * * *','select public.guild_kdocs_dispatch();');
commit;
-- Inspect: cron.job, cron.job_run_details, public.guild_kdocs_runs and guild_kdocs_state.
-- Pause without deleting data: select cron.unschedule('guild-kdocs-sync');
