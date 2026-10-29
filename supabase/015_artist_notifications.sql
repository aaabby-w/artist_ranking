begin;
alter table public.guild_profiles add column onboarding_done boolean not null default false;
create table public.guild_notifications(id uuid primary key default gen_random_uuid(),recipient uuid not null references public.guild_profiles(id) on delete cascade,task_id uuid references public.guild_tasks(id) on delete set null,title text not null,body text not null,read_at timestamptz,created_at timestamptz not null default now());
create index on public.guild_notifications(recipient,created_at desc);
alter table public.guild_notifications enable row level security;
revoke all on public.guild_notifications from public,anon,authenticated;
grant select on public.guild_notifications to authenticated;
create policy inbox_self on public.guild_notifications for select to authenticated using(recipient=auth.uid());
create function public.guild_read_notification(p_id uuid) returns void language sql security definer set search_path='' as $$ update public.guild_notifications set read_at=now() where id=p_id and recipient=auth.uid() and read_at is null $$;
create function public.guild_finish_onboarding() returns void language sql security definer set search_path='' as $$ update public.guild_profiles set onboarding_done=true where id=auth.uid() $$;
revoke all on function public.guild_read_notification(uuid),public.guild_finish_onboarding() from public,anon;
grant execute on function public.guild_read_notification(uuid),public.guild_finish_onboarding() to authenticated;
create function public.guild_welcome_artist() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.guild_notifications(recipient,title,body) values(new.id,'欢迎来到众生绘卷 ✉','先填写画师昵称，由负责人开通后即可认领任务、上传作品。已经在原表认领过的，请让负责人核对署名并绑定账号，原有任务和贡献就会归到你名下。');return new;end $$;
create trigger guild_welcome_artist after insert on public.guild_profiles for each row execute function public.guild_welcome_artist();
create function public.guild_task_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and new.status='open') or (tg_op='UPDATE' and old.status is distinct from new.status and new.status='open' and old.status='imported') then
 insert into public.guild_notifications(recipient,task_id,title,body) select id,new.id,'新任务发布了',new.title from public.guild_profiles where active and role='artist';
 end if;
 if new.assignee is not null and tg_op='UPDATE' then
  if new.status in ('done','changes') and old.status is distinct from new.status then
   insert into public.guild_notifications(recipient,task_id,title,body) values(new.assignee,new.id,case when new.status='done' then '稿件验收通过 ✧' else '稿件需要修改' end,new.title||case when new.status='changes' then '：'||coalesce(new.review_note,'请打开任务查看修改意见') else '，贡献已按验收记录入账。' end);
  elsif old.assignee is distinct from new.assignee then
   insert into public.guild_notifications(recipient,task_id,title,body) values(new.assignee,new.id,'任务已连接到你的账号',new.title||'，可在“我的画桌”查看。');
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guild_welcome_artist(),public.guild_task_notification() from public,anon,authenticated;
create trigger guild_task_notification after insert or update on public.guild_tasks for each row execute function public.guild_task_notification();
alter publication supabase_realtime add table public.guild_notifications;
commit;
