-- READ-ONLY production check before applying 007. Changes nothing.
-- Paste into Supabase Dashboard → SQL Editor → Run. Never prints secret values.
with
preview as (select c.relkind, c.reloptions, pg_get_userbyid(c.relowner) owner,
  pg_get_viewdef('public.guild_task_preview'::regclass, true) def
  from pg_class c where c.oid = 'public.guild_task_preview'::regclass),
links as (select
  (select count(*) from guild_kdocs_cards where sheet_name='全部卡牌') mirror_cards,
  (select count(*) from guild_kdocs_cards where sheet_name='全部卡牌' and missing_since is not null) mirror_missing,
  (select count(*) from guild_kdocs_cards c where sheet_name='全部卡牌' and exists(
     select 1 from guild_tasks t where t.import_key is not null and t.source_record->>'card_id'=c.card_id)) mirror_matched,
  (select count(*) from guild_tasks where import_key is not null) import_tasks,
  (select count(*) from guild_tasks where import_key is not null and coalesce(source_record->>'card_id','')='') import_without_card_id,
  (select count(*) from (select source_record->>'card_id' from guild_tasks where import_key is not null group by 1 having count(*)>1) d) duplicate_card_ids)
select 'preview_kind' item, (select relkind::text from preview) value
union all select 'preview_owner', (select owner from preview)
union all select 'preview_options', (select coalesce(array_to_string(reloptions, ','), '(none)') from preview)
union all select 'preview_definition', (select def from preview)
union all select 'tasks_by_status', (select string_agg(status||'='||n, ', ' order by status) from (select status, count(*) n from guild_tasks group by 1) s)
union all select 'awards / submissions', (select count(*) from guild_awards)::text||' / '||(select count(*) from guild_submissions)::text
union all select 'import_tasks', (select import_tasks::text from links)
union all select 'import_without_card_id (must be 0)', (select import_without_card_id::text from links)
union all select 'duplicate_card_ids (must be 0)', (select duplicate_card_ids::text from links)
union all select 'mirror_cards / matched (must be equal)', (select mirror_cards||' / '||mirror_matched from links)
union all select 'mirror_missing', (select mirror_missing::text from links)
union all select 'sample_card_ids', (select string_agg(x, ', ') from (select source_record->>'card_id' x from guild_tasks where import_key is not null order by created_at limit 5) s)
union all select 'sample_import_keys', (select string_agg(import_key, ', ') from (select import_key from guild_tasks where import_key is not null order by created_at limit 3) s)
union all select 'last_runs', (select string_agg(started_at::text||' '||status||' '||coalesce(error_code,'')||' '||coalesce(summary::text,''), E'\n' order by started_at desc) from (select * from guild_kdocs_runs order by started_at desc limit 5) r)
union all select 'state', (select row_to_json(s)::text from guild_kdocs_state s)
union all select 'vault kdocs_sync_trigger (name, length, sha256 prefix, updated)', (
  select coalesce(string_agg(s.name||' len='||length(d.decrypted_secret)||' sha256:'||left(encode(extensions.digest(d.decrypted_secret,'sha256'),'hex'),12)||' updated='||s.updated_at, '; '), '(missing)')
  from vault.secrets s join vault.decrypted_secrets d on d.id=s.id where s.name='kdocs_sync_trigger')
union all select 'cron jobs mentioning kdocs', case when to_regclass('cron.job') is null then '(pg_cron not enabled)' else
  (xpath('/row/v/text()', query_to_xml($q$select coalesce(string_agg(jobid||':'||jobname||' '||schedule, '; '), '(none)') v from cron.job where command ilike '%kdocs%'$q$, false, true, '')))[1]::text end
union all select 'service_role on guild_kdocs_mirror S/I/U', (select has_table_privilege('service_role','public.guild_kdocs_mirror','select')||'/'||has_table_privilege('service_role','public.guild_kdocs_mirror','insert')||'/'||has_table_privilege('service_role','public.guild_kdocs_mirror','update'))
union all select 'anon can read guild_tasks (must be false)', has_table_privilege('anon','public.guild_tasks','select')::text
union all select 'storage guild-submissions public? (must be false)', (select coalesce(public::text,'(no bucket)') from storage.buckets where id='guild-submissions');
