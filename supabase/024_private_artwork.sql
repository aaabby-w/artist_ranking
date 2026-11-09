begin;
-- Original files follow task ownership, including previously confirmed sheet aliases.
-- Nickname equality never grants access to another person's original.
create or replace function public.guild_owns_artwork(p_task uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.guild_member() and (public.guild_admin() or exists(
  select 1 from public.guild_tasks t where t.id=p_task and
   (t.assignee=auth.uid() or (t.assignee is null and exists(
    select 1 from public.guild_artist_aliases a where a.artist_id=auth.uid()
     and a.artist_name=coalesce(nullif(trim(t.artist_name),''),trim(t.source_record->>'artist'))
   )))
 ));
$$;
revoke all on function public.guild_owns_artwork(uuid) from public,anon;
grant execute on function public.guild_owns_artwork(uuid) to authenticated;

create or replace function public.guild_original_path_allowed(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare task_text text:=split_part(p_path,'/',2);
begin
 if not public.guild_member() then return false; end if;
 if public.guild_admin() then return true; end if;
 if task_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
 return public.guild_owns_artwork(task_text::uuid);
end $$;
revoke all on function public.guild_original_path_allowed(text) from public,anon;
grant execute on function public.guild_original_path_allowed(text) to authenticated;
update storage.buckets set public=false where id='guild-submissions';
drop policy if exists guild_original_read_boundary on storage.objects;
create policy guild_original_read_boundary on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'guild-submissions' or public.guild_original_path_allowed(name));
drop policy if exists guild_original_read on storage.objects;
create policy guild_original_read on storage.objects for select to authenticated
 using(bucket_id='guild-submissions' and public.guild_original_path_allowed(name));
drop policy if exists guild_private_guest_boundary on storage.objects;
create policy guild_private_guest_boundary on storage.objects as restrictive for all to anon
 using(bucket_id not in ('guild-submissions','guild-artwork-previews'))
 with check(bucket_id not in ('guild-submissions','guild-artwork-previews'));
drop policy if exists guild_submission_original_boundary on public.guild_submissions;
create policy guild_submission_original_boundary on public.guild_submissions as restrictive for select to authenticated
 using(public.guild_owns_artwork(task_id));

-- A separate bucket contains only small, baked-in watermarked JPEGs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('guild-artwork-previews','guild-artwork-previews',false,524288,array['image/jpeg'])
 on conflict(id) do update set public=false,file_size_limit=524288,allowed_mime_types=array['image/jpeg'];
create table if not exists public.guild_artwork_previews(
 submission_id uuid primary key references public.guild_submissions(id) on delete cascade,
 path text not null unique,
 created_at timestamptz not null default now()
);
alter table public.guild_artwork_previews enable row level security;
revoke all on public.guild_artwork_previews from public,anon,authenticated;
-- No raw-table access: the catalogue filters withdrawn submissions and removed tasks.
create or replace function public.guild_list_artwork_previews()
 returns table(id uuid,task_id uuid,preview_path text,created_at timestamptz,submission_kind text)
 language sql stable security definer set search_path='' as $$
 select s.id,s.task_id,p.path,s.created_at,s.submission_kind
 from public.guild_artwork_previews p join public.guild_submissions s on s.id=p.submission_id
 join public.guild_tasks t on t.id=s.task_id
 where public.guild_member() and s.withdrawn_at is null and t.source_removed_at is null;
$$;
revoke all on function public.guild_list_artwork_previews() from public,anon;
grant execute on function public.guild_list_artwork_previews() to authenticated;
create or replace function public.guild_preview_path_allowed(p_path text,p_write boolean default false)
 returns boolean language sql stable security definer set search_path='' as $$
 select public.guild_member() and exists(
  select 1 from public.guild_submissions s join public.guild_tasks t on t.id=s.task_id
  where p_path=s.task_id::text||'/'||s.id::text||'.jpg'
   and s.withdrawn_at is null and t.source_removed_at is null
   and (not p_write or public.guild_owns_artwork(s.task_id))
 );
$$;
revoke all on function public.guild_preview_path_allowed(text,boolean) from public,anon;
grant execute on function public.guild_preview_path_allowed(text,boolean) to authenticated;
drop policy if exists guild_preview_boundary on storage.objects;
create policy guild_preview_boundary on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'guild-artwork-previews' or public.guild_preview_path_allowed(name,false));
drop policy if exists guild_preview_read on storage.objects;
create policy guild_preview_read on storage.objects for select to authenticated
 using(bucket_id='guild-artwork-previews' and public.guild_preview_path_allowed(name,false));
drop policy if exists guild_preview_insert on storage.objects;
create policy guild_preview_insert on storage.objects for insert to authenticated
 with check(bucket_id='guild-artwork-previews' and public.guild_preview_path_allowed(name,true));
drop policy if exists guild_preview_update on storage.objects;
create policy guild_preview_update on storage.objects for update to authenticated
 using(bucket_id='guild-artwork-previews' and public.guild_preview_path_allowed(name,true))
 with check(bucket_id='guild-artwork-previews' and public.guild_preview_path_allowed(name,true));
create or replace function public.guild_save_artwork_preview(p_submission uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare p text;
begin
 select s.task_id::text||'/'||s.id::text||'.jpg' into p from public.guild_submissions s where s.id=p_submission;
 if p is null or not public.guild_preview_path_allowed(p,true) then raise exception '无权保存这份预览'; end if;
 if not exists(select 1 from storage.objects where bucket_id='guild-artwork-previews' and name=p) then raise exception '请先上传预览'; end if;
 insert into public.guild_artwork_previews(submission_id,path) values(p_submission,p)
 on conflict(submission_id) do update set path=excluded.path;
end $$;
revoke all on function public.guild_save_artwork_preview(uuid) from public,anon;
grant execute on function public.guild_save_artwork_preview(uuid) to authenticated;

-- Close both the current guest projection and the old definer view.
do $$ declare r record; begin
 for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'guild_%' and c.relkind in ('r','v','m','p') loop
  execute format('revoke all on public.%I from anon',r.relname);
 end loop;
 if to_regclass('public.guild_public_tasks') is not null then
  revoke all on public.guild_public_tasks from public,anon,authenticated;
 end if;
 if to_regclass('public.guild_task_preview') is not null then
  revoke all on public.guild_task_preview from public,anon,authenticated;
 end if;
end $$;
-- Registration is not membership. Existing members and assignments are untouched.
alter table public.guild_profiles alter column active set default false;
create or replace function public.guild_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.guild_profiles(id,name,active,role)
 values(new.id,coalesce(nullif(left(trim(coalesce(new.raw_user_meta_data->>'artist_name','')),40),''),'新画师'),false,'artist');
 return new;
end $$;
revoke all on function public.guild_new_user() from public,anon,authenticated;
commit;
