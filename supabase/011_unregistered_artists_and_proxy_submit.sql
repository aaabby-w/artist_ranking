-- 011: work with artists who have not registered yet.
-- * guild_tasks.artist_name: the sheet name of the artist doing a task while they have
--   no account. Only allowed with no assignee and status active / changes / submitted.
-- * Publishing a card whose sheet lists an artist no longer requires an account:
--   it becomes 'active' under that name (an account can still be chosen instead).
-- * Admins can submit work on an artist's behalf (guild_admin_submit), image or link.
-- * guild_bind_artist links every task under a sheet name to the artist's new account.
-- * Approval still needs an account (contribution must belong to someone): guild_action
--   gets one guard line, otherwise unchanged from production.
begin;
alter table public.guild_tasks add column if not exists artist_name text;
alter table public.guild_tasks drop constraint if exists guild_tasks_artist_name_check;
alter table public.guild_tasks add constraint guild_tasks_artist_name_check
  check(artist_name is null or (assignee is null and length(trim(artist_name)) between 1 and 40
        and status in ('active','changes','submitted')));

create or replace function public.guild_activate_import(p_task uuid,p_points integer,p_assignee uuid default null,p_legacy_confirm boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; sheet_artist text;
begin
  if not public.guild_admin() then raise exception '只有负责人可以确认任务'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.status<>'imported' then raise exception '记录已确认或不存在，请刷新'; end if;
  if p_points is null or p_points not between 1 and 1000 then raise exception '请先与画师约定 1–1000 贡献分'; end if;
  if t.source_record->>'system'='旧版参考' and p_legacy_confirm is not true then
    raise exception '旧版卡牌可能与现行卡牌共用美术，请先确认是否需要单独绘制';
  end if;
  if p_assignee is not null and not exists(select 1 from public.guild_profiles where id=p_assignee and active) then
    raise exception '请选择已开通的画师账号';
  end if;
  sheet_artist:=nullif(left(trim(coalesce(t.source_record->>'artist','')),40),'');
  update public.guild_tasks set points=p_points,assignee=p_assignee,
    artist_name=case when p_assignee is null then sheet_artist end,
    status=case when p_assignee is null and sheet_artist is null then 'open' else 'active' end,updated_at=now()
    where id=p_task;
end $$;
revoke execute on function public.guild_activate_import(uuid,integer,uuid,boolean) from public,anon;
grant execute on function public.guild_activate_import(uuid,integer,uuid,boolean) to authenticated;

create or replace function public.guild_admin_submit(p_task uuid,p_url text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
  if not public.guild_admin() then raise exception '只有负责人可以代交稿'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.status not in ('active','changes') then raise exception '只有创作中或待修改的任务可以交稿'; end if;
  if p_url is null or p_url !~ '^https?://' or length(p_url)>2048 or coalesce(length(trim(p_note)),0) not between 1 and 1980 then
    raise exception '请上传图片或填写有效作品链接，并写一句交稿说明';
  end if;
  insert into public.guild_submissions(task_id,author_id,url,note) values(p_task,auth.uid(),p_url,'负责人代交：'||trim(p_note));
  update public.guild_tasks set status='submitted',updated_at=now() where id=p_task;
end $$;
revoke all on function public.guild_admin_submit(uuid,text,text) from public,anon;
grant execute on function public.guild_admin_submit(uuid,text,text) to authenticated;

create or replace function public.guild_bind_artist(p_name text,p_user uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n int;
begin
  if not public.guild_admin() then raise exception '只有负责人可以绑定画师账号'; end if;
  if not exists(select 1 from public.guild_profiles where id=p_user and active) then raise exception '请选择已开通的画师账号'; end if;
  update public.guild_tasks set assignee=p_user,artist_name=null,updated_at=now()
   where artist_name=trim(p_name) and assignee is null;
  get diagnostics n=row_count;
  if n=0 then raise exception '没有挂在这个名字下的任务，请刷新'; end if;
  return n;
end $$;
revoke all on function public.guild_bind_artist(text,uuid) from public,anon;
grant execute on function public.guild_bind_artist(text,uuid) to authenticated;

-- Hand a task held under a sheet name back to 待认领 (e.g. the artist dropped out).
create or replace function public.guild_release_artist_name(p_task uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
  if not public.guild_admin() then raise exception '只有负责人可以操作'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.artist_name is null or t.status not in ('active','changes') then raise exception '只有未注册画师创作中的任务可以改回待认领'; end if;
  update public.guild_tasks set artist_name=null,status='open',updated_at=now() where id=p_task;
end $$;
revoke all on function public.guild_release_artist_name(uuid) from public,anon;
grant execute on function public.guild_release_artist_name(uuid) to authenticated;

-- Production guild_action plus one guard: approval needs a bound account.
create or replace function public.guild_action(p_task uuid,p_action text,p_url text default null,p_note text default null,p_feedback text default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; sid uuid;
begin
 if not public.guild_member() then raise exception '请先登录并由负责人开通成员权限';end if;
 select * into t from public.guild_tasks where id=p_task for update;
 if not found then raise exception '任务不存在';end if;
 if p_action='claim' then
  if t.status<>'open' then raise exception '任务已被其他人认领，请刷新';end if;
  update public.guild_tasks set status='active',assignee=auth.uid(),updated_at=now() where id=p_task;
 elsif p_action in ('release','submit') then
  if t.assignee is distinct from auth.uid() or t.status not in ('active','changes') then raise exception '当前不能执行此操作';end if;
  if p_action='release' then update public.guild_tasks set status='open',assignee=null,updated_at=now() where id=p_task;
  else
   if p_url is null or p_url !~ '^https?://' or length(p_url)>2048 or coalesce(length(trim(p_note)),0) not between 1 and 2000 then raise exception '请填写有效作品链接及交稿说明';end if;
   insert into public.guild_submissions(task_id,author_id,url,note) values(p_task,auth.uid(),p_url,trim(p_note));
   update public.guild_tasks set status='submitted',updated_at=now() where id=p_task;
  end if;
 elsif p_action in ('approve','changes') then
  if not public.guild_admin() or t.assignee=auth.uid() then raise exception '请由其他负责人验收';end if;
  if t.status<>'submitted' then raise exception '该任务已处理或还未交稿';end if;
  if p_action='approve' and t.assignee is null then raise exception '这位画师还没绑定账号，请先绑定再验收（贡献分要记到账号上）';end if;
  if length(coalesce(p_feedback,''))>2000 then raise exception '反馈过长';end if;
  if p_action='changes' and coalesce(length(trim(p_feedback)),0)=0 then raise exception '请填写修改意见';end if;
  select id into sid from public.guild_submissions where task_id=p_task order by created_at desc,id desc limit 1;
  if sid is null then raise exception '没有可验收的提交';end if;
  update public.guild_submissions set feedback=coalesce(trim(p_feedback),'') where id=sid;
  if p_action='approve' then
   insert into public.guild_awards(task_id,artist_id,points,submission_id) values(p_task,t.assignee,t.points,sid);
   update public.guild_tasks set status='done',updated_at=now() where id=p_task;
  else update public.guild_tasks set status='changes',updated_at=now() where id=p_task;
  end if;
 else raise exception '未知操作';end if;
end $$;

-- Admins may upload images for proxy submissions: their own folder, a task in progress.
drop policy if exists guild_submission_images_admin_upload on storage.objects;
create policy guild_submission_images_admin_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'guild-submissions' and (select public.guild_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists(select 1 from public.guild_tasks t where t.id::text = (storage.foldername(name))[2]
               and t.status in ('active','changes')));
-- Gallery credit: every finished / submitted work (and cards marked final in the sheet)
-- carries the artist's name in the guest copy, so 稿件展示 always credits the artist.
-- Tasks without work show no name to guests.
alter table public.guild_task_preview add column if not exists artist_credit text;
create or replace function public.guild_task_credit(t public.guild_tasks) returns text
language sql stable security definer set search_path='' as $$
  select case
    when t.status in ('submitted','done') then
      coalesce((select p.name from public.guild_profiles p where p.id=t.assignee), t.artist_name)
    when t.status='imported' and t.source_removed_at is null and t.source_record->>'status'='已递交终稿' then
      nullif(trim(t.source_record->>'artist'),'')
  end
$$;
revoke all on function public.guild_task_credit(public.guild_tasks) from public,anon,authenticated;
create or replace function public.guild_sync_task_preview() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.guild_task_preview where id = old.id;
    return old;
  end if;
  insert into public.guild_task_preview
    (id, title, category, brief, points, status, due_date, created_at, updated_at, source_state, artist_credit)
  values
    (new.id, new.title, new.category, new.brief, new.points, new.status,
     new.due_date, new.created_at, new.updated_at, public.guild_task_source_state(new), public.guild_task_credit(new))
  on conflict (id) do update set
    title = excluded.title, category = excluded.category, brief = excluded.brief,
    points = excluded.points, status = excluded.status, due_date = excluded.due_date,
    created_at = excluded.created_at, updated_at = excluded.updated_at,
    source_state = excluded.source_state, artist_credit = excluded.artist_credit;
  return new;
end $$;
update public.guild_task_preview p set artist_credit=public.guild_task_credit(t)
  from public.guild_tasks t where t.id=p.id and p.artist_credit is distinct from public.guild_task_credit(t);
commit;
-- Rollback: re-run guild_activate_import from 002_import.sql (with 003's wording) and guild_action
--   from production (same body without the 'assignee is null' line); drop functions
--   guild_admin_submit, guild_bind_artist, guild_release_artist_name; drop policy
--   guild_submission_images_admin_upload on storage.objects; bind or release any task with
--   artist_name first, then drop constraint guild_tasks_artist_name_check and column artist_name.
