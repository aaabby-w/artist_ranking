begin;
alter table public.guild_awards add column if not exists submission_id uuid references public.guild_submissions(id);
create table if not exists public.guild_campaign(
 id smallint primary key default 1 check(id=1),name text not null default '第一期创作奖励',
 starts_at timestamptz,ends_at timestamptz,reward_amount integer not null default 100 check(reward_amount=100),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at>starts_at))
);
insert into public.guild_campaign(id) values(1) on conflict do nothing;
alter table public.guild_campaign enable row level security;
revoke all on public.guild_campaign from anon,authenticated;
grant select on public.guild_campaign to authenticated;
drop policy if exists campaign_read on public.guild_campaign;
create policy campaign_read on public.guild_campaign for select to authenticated using(public.guild_member());
create or replace function public.guild_set_campaign(p_name text,p_start timestamptz,p_end timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.guild_admin() then raise exception '只有负责人可以设置阶段时间'; end if;
 if coalesce(length(trim(p_name)),0) not between 1 and 60 or p_start is null or p_end is null or p_end<=p_start then
  raise exception '请填写阶段名称和有效起止时间'; end if;
 update public.guild_campaign set name=trim(p_name),starts_at=p_start,ends_at=p_end,updated_at=now() where id=1;
end $$;
revoke execute on function public.guild_set_campaign(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.guild_set_campaign(text,timestamptz,timestamptz) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='guild_campaign') then
  alter publication supabase_realtime add table public.guild_campaign;
 end if;
end $$;

create or replace function public.guild_save_task(p_task uuid,p_title text,p_category text,p_brief text,p_points integer,p_due date default null,p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid; t public.guild_tasks;
begin
 if not public.guild_admin() then raise exception '只有负责人可以发布或分配任务'; end if;
 if coalesce(length(trim(p_title)),0) not between 1 and 80 or coalesce(length(trim(p_brief)),0) not between 1 and 5000
   or coalesce(length(trim(p_category)),0) not between 1 and 40 or p_points is null or p_points not between 1 and 1000
   then raise exception '请填写任务名称、交付要求、分类及 1–1000 的贡献分'; end if;
 if p_assignee is not null and not exists(select 1 from public.guild_profiles where id=p_assignee and active)
   then raise exception '请选择已开通的画师账号'; end if;
 if p_task is null then
  insert into public.guild_tasks(title,category,brief,points,due_date,assignee,status)
  values(trim(p_title),trim(p_category),trim(p_brief),p_points,p_due,p_assignee,case when p_assignee is null then 'open' else 'active' end)
  returning id into tid;
 else
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.status<>'open' then raise exception '只有未认领任务可以改要求、分值或分配画师；创作开始后分值锁定'; end if;
  update public.guild_tasks set title=trim(p_title),category=trim(p_category),brief=trim(p_brief),points=p_points,
   due_date=p_due,assignee=p_assignee,status=case when p_assignee is null then 'open' else 'active' end,updated_at=now() where id=p_task;
  tid:=p_task;
 end if;
 return tid;
end $$;

create or replace function public.guild_set_name(p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(length(trim(p_name)),0) not between 1 and 40 then raise exception '请登录并填写 1–40 字的昵称'; end if;
 update public.guild_profiles set name=trim(p_name) where id=auth.uid();
end $$;

create or replace function public.guild_set_member(p_user uuid,p_name text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare member public.guild_profiles;
begin
 if not public.guild_admin() then raise exception '只有负责人可以管理画师'; end if;
 select * into member from public.guild_profiles where id=p_user for update;
 if not found or member.role='admin' then raise exception '此处仅管理画师账号，不能修改负责人权限'; end if;
 if coalesce(length(trim(p_name)),0) not between 1 and 40 or p_active is null then raise exception '请填写昵称和成员状态'; end if;
 if not p_active and exists(select 1 from public.guild_tasks where assignee=p_user and status in ('active','changes','submitted')) then
   raise exception '这位画师还有进行中或待验收任务，请先处理再停用'; end if;
 update public.guild_profiles set name=trim(p_name),active=p_active where id=p_user;
end $$;
revoke execute on function public.guild_save_task(uuid,text,text,text,integer,date,uuid),public.guild_set_name(text),public.guild_set_member(uuid,text,boolean) from public,anon;
grant execute on function public.guild_save_task(uuid,text,text,text,integer,date,uuid),public.guild_set_name(text),public.guild_set_member(uuid,text,boolean) to authenticated;

-- Preserve the deployed business function, adding the exact reviewed submission reference.
do $$
declare body text;
begin
 body:=pg_get_functiondef('public.guild_action(uuid,text,text,text,text)'::regprocedure);
 if position('insert into public.guild_awards(task_id,artist_id,points) values(p_task,t.assignee,t.points);' in body)>0 then
  body:=replace(body,'insert into public.guild_awards(task_id,artist_id,points) values(p_task,t.assignee,t.points);',
    'insert into public.guild_awards(task_id,artist_id,points,submission_id) values(p_task,t.assignee,t.points,sid);');
 elsif position('values(p_task,t.assignee,t.points,sid);' in body)=0 then
  raise exception '当前验收函数与预期不同，请人工合并后再升级';
 end if;
 execute replace(body,'委托','任务');
 body:=pg_get_functiondef('public.guild_activate_import(uuid,integer,uuid,boolean)'::regprocedure);
 execute replace(body,'委托','任务');
end $$;
commit;
