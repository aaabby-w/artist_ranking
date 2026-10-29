-- Five-minute automatic sync. Run only after 007 is applied and two manual
-- syncs succeeded (second one with zero changes).
-- Prerequisites:
--   * Vault secret `kdocs_sync_trigger` holds the SAME value as the Edge Function
--     secret SYNC_TRIGGER_SECRET (>= 32 chars);
--   * kdocs-sync deployed with --no-verify-jwt (it checks x-sync-secret itself).
-- Safe to re-run: the job is upserted by name; any other job that calls the
-- sync makes this script stop instead of creating a duplicate.
begin;
do $$ begin
 if not exists(select 1 from vault.secrets where name='kdocs_sync_trigger') then raise exception '请先在 Vault 创建 kdocs_sync_trigger'; end if;
 if to_regprocedure('public.guild_kdocs_begin()') is null then raise exception '请先执行 007_kdocs_task_projection.sql'; end if;
end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ declare other text; begin
 select string_agg(jobname||' ('||schedule||')', ', ') into other from cron.job
  where jobname is distinct from 'guild-kdocs-sync' and (command ilike '%kdocs%' or command ilike '%guild_kdocs_dispatch%');
 if other is not null then raise exception '已存在其他同步定时任务：%，请先确认并 cron.unschedule 后重试', other; end if;
end $$;
create or replace function public.guild_kdocs_dispatch() returns bigint language plpgsql security definer set search_path='' as $$
declare token text; request_id bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='kdocs_sync_trigger';
 if token is null or length(token)<32 then raise exception 'Sync trigger secret is missing or too short'; end if;
 select net.http_post(url:='https://jcerhkfttppravatitdx.supabase.co/functions/v1/kdocs-sync',headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',token),body:='{}'::jsonb,timeout_milliseconds:=90000) into request_id;
 return request_id;
end $$;
revoke all on function public.guild_kdocs_dispatch() from public,anon,authenticated,service_role;
-- Odd minute offset keeps clear of the top-of-the-hour rush; one run every 5 minutes.
select cron.schedule('guild-kdocs-sync','2-59/5 * * * *','select public.guild_kdocs_dispatch();');
commit;
-- Inspect:  select * from cron.job where jobname='guild-kdocs-sync';
--           select * from cron.job_run_details order by start_time desc limit 5;
--           select status,error_code,summary,started_at from public.guild_kdocs_runs order by started_at desc limit 5;
-- Pause (keeps all data):  select cron.unschedule('guild-kdocs-sync');
