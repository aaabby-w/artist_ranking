begin;
-- Preserve authorship when a withdrawn/released task is later claimed by someone else.
alter table public.guild_submissions add column if not exists artwork_owner_id uuid references public.guild_profiles(id);
alter table public.guild_submissions add column if not exists artwork_owner_name text;
update public.guild_submissions s set artwork_owner_id=case when p.role='artist' then s.author_id else t.assignee end,
 artwork_owner_name=case when p.role='artist' or t.assignee is not null then null else coalesce(nullif(trim(t.artist_name),''),nullif(trim(t.source_record->>'artist'),'')) end
 from public.guild_tasks t,public.guild_profiles p
 where s.task_id=t.id and s.author_id=p.id and s.artwork_owner_id is null and s.artwork_owner_name is null;
create or replace function public.guild_stamp_artwork_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select case when p.role='artist' then new.author_id else t.assignee end,
 case when p.role='artist' or t.assignee is not null then null else coalesce(nullif(trim(t.artist_name),''),nullif(trim(t.source_record->>'artist'),'')) end
 into new.artwork_owner_id,new.artwork_owner_name from public.guild_tasks t,public.guild_profiles p where t.id=new.task_id and p.id=new.author_id;
 return new;
end $$;
revoke all on function public.guild_stamp_artwork_owner() from public,anon,authenticated;
drop trigger if exists guild_stamp_artwork_owner on public.guild_submissions;
create trigger guild_stamp_artwork_owner before insert on public.guild_submissions for each row execute function public.guild_stamp_artwork_owner();
create or replace function public.guild_reads_submission(p_submission uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.guild_member() and (public.guild_admin() or exists(select 1 from public.guild_submissions s where s.id=p_submission and
 (s.artwork_owner_id=auth.uid() or (s.artwork_owner_id is null and exists(select 1 from public.guild_artist_aliases a where a.artist_name=s.artwork_owner_name and a.artist_id=auth.uid())))));
$$;
revoke all on function public.guild_reads_submission(uuid) from public,anon;
grant execute on function public.guild_reads_submission(uuid) to authenticated;
drop policy if exists guild_submission_original_boundary on public.guild_submissions;
create policy guild_submission_original_boundary on public.guild_submissions as restrictive for select to authenticated using(public.guild_reads_submission(id));
create or replace function public.guild_original_path_allowed(p_path text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare task_text text:=split_part(p_path,'/',2);
begin
 if not public.guild_member() then return false; end if;
 if public.guild_admin() then return true; end if;
 if task_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
 if exists(select 1 from public.guild_submissions s where split_part(s.url,'/guild-submissions/',2)=p_path) then
  return exists(select 1 from public.guild_submissions s where split_part(s.url,'/guild-submissions/',2)=p_path
   and s.task_id::text=task_text and s.author_id::text=split_part(p_path,'/',1) and public.guild_reads_submission(s.id));
 end if;
 -- A pending upload is readable only by its uploader while they own the task.
 return split_part(p_path,'/',1)=auth.uid()::text and public.guild_owns_artwork(task_text::uuid);
end $$;
create or replace function public.guild_preview_path_allowed(p_path text,p_write boolean default false)
 returns boolean language sql stable security definer set search_path='' as $$
 select public.guild_member() and exists(
  select 1 from public.guild_submissions s join public.guild_tasks t on t.id=s.task_id
  where p_path=s.task_id::text||'/'||s.id::text||'.jpg' and s.withdrawn_at is null and t.source_removed_at is null
   and (not p_write or public.guild_reads_submission(s.id))
 );
$$;
commit;
