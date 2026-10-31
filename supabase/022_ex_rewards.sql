begin;
create table public.guild_ex_rewards (
 id uuid primary key,
 artist_id uuid not null references public.guild_profiles,
 task_id uuid unique references public.guild_tasks,
 points integer not null check(points between 1 and 20),
 reason text not null check(length(trim(reason)) between 1 and 300),
 given_by uuid not null references public.guild_profiles,
 created_at timestamptz not null default now()
);
alter table public.guild_ex_rewards enable row level security;
revoke all on public.guild_ex_rewards from public, anon, authenticated;
grant select on public.guild_ex_rewards to authenticated;
create policy members_read_ex on public.guild_ex_rewards for select to authenticated using(public.guild_member());
create function public.guild_give_ex(p_id uuid,p_artist uuid,p_task uuid,p_points integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.guild_admin() then raise exception '需要负责人权限'; end if;
 if p_artist=auth.uid() or not exists(select 1 from public.guild_profiles where id=p_artist and active) then raise exception '请选择其他已开通的画师'; end if;
 if p_task is not null and not exists(select 1 from public.guild_tasks where id=p_task and assignee=p_artist and status='done' for share) then raise exception '作品必须已验收且属于所选画师'; end if;
 insert into public.guild_ex_rewards(id,artist_id,task_id,points,reason,given_by) values(p_id,p_artist,p_task,p_points,trim(p_reason),auth.uid()) on conflict(id) do nothing;
exception when unique_violation then raise exception '这件作品已经获得过 EX 奖励';
end $$;
revoke all on function public.guild_give_ex(uuid,uuid,uuid,integer,text) from public,anon;
grant execute on function public.guild_give_ex(uuid,uuid,uuid,integer,text) to authenticated;
alter publication supabase_realtime add table public.guild_ex_rewards;
commit;
