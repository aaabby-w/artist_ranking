-- Run once in a fresh Supabase project's SQL editor.
create table public.guild_profiles(id uuid primary key references auth.users on delete cascade,name text not null,role text not null default 'artist' check(role in ('artist','admin')),active boolean not null default false,created_at timestamptz not null default now());
create table public.guild_tasks(id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title)) between 1 and 80),category text not null,brief text not null check(length(trim(brief)) between 1 and 5000),points integer not null check(points between 1 and 1000),status text not null default 'open' check(status in ('open','active','submitted','changes','done')),assignee uuid references public.guild_profiles, due_date date,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.guild_submissions(id uuid primary key default gen_random_uuid(),task_id uuid not null references public.guild_tasks,author_id uuid not null references public.guild_profiles,url text not null,note text not null,feedback text not null default '',created_at timestamptz not null default now());
create table public.guild_awards(id uuid primary key default gen_random_uuid(),task_id uuid not null unique references public.guild_tasks,artist_id uuid not null references public.guild_profiles,points integer not null check(points>0),created_at timestamptz not null default now());
create index on public.guild_tasks(assignee);create index on public.guild_submissions(task_id,created_at desc);create index on public.guild_awards(artist_id,created_at);
create function public.guild_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.guild_profiles(id,name) values(new.id,'新画师');return new;end $$;
create trigger guild_auth_created after insert on auth.users for each row execute function public.guild_new_user();
insert into public.guild_profiles(id,name) select id,'新画师' from auth.users on conflict do nothing;
create function public.guild_member() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.guild_profiles where id=auth.uid() and active) $$;
create function public.guild_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.guild_profiles where id=auth.uid() and active and role='admin') $$;
alter table public.guild_profiles enable row level security;alter table public.guild_tasks enable row level security;alter table public.guild_submissions enable row level security;alter table public.guild_awards enable row level security;
revoke all on public.guild_profiles,public.guild_tasks,public.guild_submissions,public.guild_awards from anon,authenticated;
grant select on public.guild_profiles,public.guild_tasks,public.guild_submissions,public.guild_awards to authenticated;
grant insert(title,category,brief,points,due_date) on public.guild_tasks to authenticated;
create policy profiles_read on public.guild_profiles for select to authenticated using(id=auth.uid() or public.guild_member());
create policy tasks_read on public.guild_tasks for select to authenticated using(public.guild_member());
create policy submissions_read on public.guild_submissions for select to authenticated using(public.guild_member());
create policy awards_read on public.guild_awards for select to authenticated using(public.guild_member());
create policy tasks_create on public.guild_tasks for insert to authenticated with check(public.guild_admin() and status='open' and assignee is null);
create function public.guild_action(p_task uuid,p_action text,p_url text default null,p_note text default null,p_feedback text default null) returns void language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; sid uuid;
begin
 if not public.guild_member() then raise exception '请先登录并由负责人开通成员权限';end if;
 select * into t from public.guild_tasks where id=p_task for update;
 if not found then raise exception '委托不存在';end if;
 if p_action='claim' then
  if t.status<>'open' then raise exception '委托已被其他人认领，请刷新';end if;
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
  if t.status<>'submitted' then raise exception '该委托已处理或还未交稿';end if;
  if length(coalesce(p_feedback,''))>2000 then raise exception '反馈过长';end if;
  if p_action='changes' and coalesce(length(trim(p_feedback)),0)=0 then raise exception '请填写修改意见';end if;
  select id into sid from public.guild_submissions where task_id=p_task order by created_at desc,id desc limit 1;
  if sid is null then raise exception '没有可验收的提交';end if;
  update public.guild_submissions set feedback=coalesce(trim(p_feedback),'') where id=sid;
  if p_action='approve' then
   insert into public.guild_awards(task_id,artist_id,points) values(p_task,t.assignee,t.points);
   update public.guild_tasks set status='done',updated_at=now() where id=p_task;
  else update public.guild_tasks set status='changes',updated_at=now() where id=p_task;
  end if;
 else raise exception '未知操作';end if;
end $$;
revoke execute on function public.guild_new_user() from public;
revoke execute on function public.guild_action(uuid,text,text,text,text),public.guild_member(),public.guild_admin() from public;
grant execute on function public.guild_action(uuid,text,text,text,text),public.guild_member(),public.guild_admin() to authenticated;
alter publication supabase_realtime add table public.guild_tasks,public.guild_submissions,public.guild_awards,public.guild_profiles;
-- After your first email login, find the UUID under Authentication > Users.
-- Bootstrap first reviewer and approve members in SQL editor (never in browser):
-- update public.guild_profiles set name='晚婳',role='admin',active=true where id='YOUR_AUTH_USER_UUID';
-- update public.guild_profiles set name='画师昵称',active=true where id='ARTIST_AUTH_USER_UUID';
