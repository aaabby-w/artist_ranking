-- 013: 待验收 has exactly two admin actions.
--   通过   → the task is done and appears in 稿件展示; the score is recorded. If the artist
--            has no account yet, the score is held under their sheet name and moves to
--            their account when guild_bind_artist links it.
--   不通过 → a written reason is required; the task goes back to 待修改 for the artist.
-- Applies to normal submissions (guild_action approve / changes) and to sheet cards marked
-- 已递交终稿 that were never submitted on the site (guild_review_card).
begin;
alter table public.guild_tasks add column if not exists review_note text;
alter table public.guild_tasks drop constraint if exists guild_tasks_artist_name_check;
alter table public.guild_tasks add constraint guild_tasks_artist_name_check
  check(artist_name is null or (assignee is null and length(trim(artist_name)) between 1 and 40
        and status in ('active','changes','submitted','done')));

-- Held scores: artist_id stays empty until the sheet name is bound to an account.
alter table public.guild_awards alter column artist_id drop not null;
alter table public.guild_awards add column if not exists artist_name text;
alter table public.guild_awards drop constraint if exists guild_awards_artist_check;
alter table public.guild_awards add constraint guild_awards_artist_check
  check(artist_id is not null or length(trim(coalesce(artist_name,''))) between 1 and 40);

create or replace function public.guild_review_card(p_task uuid,p_action text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; who text;
begin
  if not public.guild_admin() then raise exception '只有负责人可以验收'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.status<>'imported' or t.source_removed_at is not null
     or t.source_record->>'status' is distinct from '已递交终稿' then
    raise exception '这张卡不在待验收里，请刷新';
  end if;
  who:=nullif(left(trim(coalesce(t.source_record->>'artist','')),40),'');
  if who is null then raise exception '金山表里没写这张卡的画师，请先在表格登记'; end if;
  if p_action='approve' then
    update public.guild_tasks set status='done',artist_name=who,points=coalesce(points,20),review_note=null,updated_at=now() where id=p_task;
    insert into public.guild_awards(task_id,artist_id,artist_name,points)
      select p_task,null,who,coalesce(t.points,20);
  elsif p_action='reject' then
    if coalesce(length(trim(p_reason)),0) not between 1 and 2000 then raise exception '请写明打回理由'; end if;
    update public.guild_tasks set status='changes',artist_name=who,points=coalesce(points,20),review_note=trim(p_reason),updated_at=now() where id=p_task;
  else raise exception '未知操作'; end if;
end $$;
revoke all on function public.guild_review_card(uuid,text,text) from public,anon;
grant execute on function public.guild_review_card(uuid,text,text) to authenticated;

-- guild_action: approve no longer needs an account (score held under the sheet name);
-- 不通过 stores its reason on the task too. Otherwise unchanged.
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
  if p_action='approve' and t.assignee is null and t.artist_name is null then raise exception '这份任务没有画师，无法记分';end if;
  if length(coalesce(p_feedback,''))>2000 then raise exception '反馈过长';end if;
  if p_action='changes' and coalesce(length(trim(p_feedback)),0)=0 then raise exception '请写明打回理由';end if;
  select id into sid from public.guild_submissions where task_id=p_task order by created_at desc,id desc limit 1;
  if sid is null then raise exception '没有可验收的提交';end if;
  update public.guild_submissions set feedback=coalesce(trim(p_feedback),'') where id=sid;
  if p_action='approve' then
   insert into public.guild_awards(task_id,artist_id,artist_name,points,submission_id)
     values(p_task,t.assignee,case when t.assignee is null then t.artist_name end,t.points,sid);
   update public.guild_tasks set status='done',review_note=null,updated_at=now() where id=p_task;
  else update public.guild_tasks set status='changes',review_note=trim(p_feedback),updated_at=now() where id=p_task;
  end if;
 else raise exception '未知操作';end if;
end $$;

-- Binding a sheet name also moves its held scores to the account.
create or replace function public.guild_bind_artist(p_name text,p_user uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n int; m int;
begin
  if not public.guild_admin() then raise exception '只有负责人可以绑定画师账号'; end if;
  if not exists(select 1 from public.guild_profiles where id=p_user and active) then raise exception '请选择已开通的画师账号'; end if;
  update public.guild_tasks set assignee=p_user,artist_name=null,updated_at=now()
   where artist_name=trim(p_name) and assignee is null;
  get diagnostics n=row_count;
  update public.guild_awards set artist_id=p_user,artist_name=null
   where artist_name=trim(p_name) and artist_id is null;
  get diagnostics m=row_count;
  if n+m=0 then raise exception '没有挂在这个名字下的任务，请刷新'; end if;
  return n;
end $$;
revoke all on function public.guild_bind_artist(text,uuid) from public,anon;
grant execute on function public.guild_bind_artist(text,uuid) to authenticated;
commit;
-- Rollback: re-run guild_action and guild_bind_artist from 011; drop function guild_review_card;
--   bind or remove held awards (artist_id is null) before restoring artist_id NOT NULL.
