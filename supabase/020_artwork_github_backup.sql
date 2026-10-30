-- 020: copy every uploaded artwork into the GitHub repo, one folder per artist:
--   artworks/<画师名>/<任务名>_<YYYYMMDD-HHMM>_<交稿id前8位>.png
-- Supabase Storage stays the source the website reads; GitHub only receives copies.
-- The Edge Function artwork-backup (service role) asks for pending uploads, commits them,
-- then records the result here. Link-only submissions (网盘链接) have no file and are skipped.
-- NOTE: the repo is public, so every copied artwork is publicly visible (owner's decision).
begin;
create table if not exists public.guild_artwork_backups(
  submission_id uuid primary key,
  status text not null default 'pending' check(status in ('pending','done','failed')),
  repo_path text,
  commit_sha text,
  error_code text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.guild_artwork_backups enable row level security;
revoke all on public.guild_artwork_backups from public,anon,authenticated;
grant select on public.guild_artwork_backups to authenticated;
drop policy if exists artwork_backups_admin_read on public.guild_artwork_backups;
create policy artwork_backups_admin_read on public.guild_artwork_backups for select to authenticated using(public.guild_admin());
grant select,insert,update on public.guild_artwork_backups to service_role;

-- Uploads not copied yet (failed ones are retried up to 5 times), oldest first.
-- artist = the task's artist (account name, else sheet name), never the admin who proxied.
create or replace function public.guild_artwork_pending(p_limit integer default 20)
returns table(submission_id uuid, storage_path text, artist text, task_title text, created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select s.id,
    substring(s.url from '/storage/v1/object/authenticated/guild-submissions/(.+)$'),
    coalesce(nullif(trim((select p.name from public.guild_profiles p where p.id=t.assignee)),''),
             nullif(trim(t.artist_name),''), nullif(trim(t.source_record->>'artist'),''), '未署名'),
    t.title, s.created_at
  from public.guild_submissions s
  join public.guild_tasks t on t.id=s.task_id
  left join public.guild_artwork_backups b on b.submission_id=s.id
  where s.url ~ '/storage/v1/object/authenticated/guild-submissions/[^/]+/[^/]+/[^/]+$'
    and (b.submission_id is null or (b.status='failed' and b.attempts<5))
  order by s.created_at
  limit greatest(1,least(coalesce(p_limit,20),50))
$$;
revoke all on function public.guild_artwork_pending(integer) from public,anon,authenticated;
grant execute on function public.guild_artwork_pending(integer) to service_role;

create or replace function public.guild_artwork_mark(p_submission uuid,p_status text,p_path text default null,p_commit text default null,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('done','failed') then raise exception 'bad status'; end if;
  insert into public.guild_artwork_backups(submission_id,status,repo_path,commit_sha,error_code,attempts,updated_at)
  values(p_submission,p_status,p_path,p_commit,left(p_error,80),case when p_status='failed' then 1 else 0 end,now())
  on conflict(submission_id) do update set status=excluded.status,repo_path=coalesce(excluded.repo_path,guild_artwork_backups.repo_path),
    commit_sha=coalesce(excluded.commit_sha,guild_artwork_backups.commit_sha),error_code=excluded.error_code,
    attempts=guild_artwork_backups.attempts+case when p_status='failed' then 1 else 0 end,updated_at=now();
end $$;
revoke all on function public.guild_artwork_mark(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.guild_artwork_mark(uuid,text,text,text,text) to service_role;

-- Scheduler: same Vault secret as the KDocs sync (x-sync-secret).
create or replace function public.guild_artwork_dispatch() returns bigint language plpgsql security definer set search_path='' as $$
declare token text; request_id bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='kdocs_sync_trigger';
 if token is null or length(token)<32 then raise exception 'Sync trigger secret is missing or too short'; end if;
 select net.http_post(url:='https://jcerhkfttppravatitdx.supabase.co/functions/v1/artwork-backup',headers:=jsonb_build_object('Content-Type','application/json','x-sync-secret',token),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function public.guild_artwork_dispatch() from public,anon,authenticated,service_role;
select cron.schedule('guild-artwork-backup','4-59/10 * * * *','select public.guild_artwork_dispatch();');
commit;
-- Pause: select cron.unschedule('guild-artwork-backup');
-- Rollback: unschedule; drop function guild_artwork_dispatch(), guild_artwork_mark(...), guild_artwork_pending(integer);
--   drop table guild_artwork_backups.  (Files already in GitHub stay there; remove them with a git commit.)
