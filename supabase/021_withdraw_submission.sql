-- Keep artwork and submission history. Never remove an award.
begin;
alter table public.guild_submissions add column if not exists withdrawn_at timestamptz;
create or replace function public.guild_withdraw_submission(p_task uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; sid uuid;
begin
 if not public.guild_member() then raise exception '请先登录并开通成员权限'; end if;
 select * into t from public.guild_tasks where id=p_task for update;
 if not found or t.assignee is distinct from auth.uid() then raise exception '只能撤回自己负责的任务交稿'; end if;
 if t.status <> 'submitted' then raise exception '只能撤回待验收的交稿，请刷新任务状态'; end if;
 if exists(select 1 from public.guild_awards where task_id=p_task) then raise exception '该任务已有贡献记录，请联系负责人'; end if;
 select id into sid from public.guild_submissions where task_id=p_task and withdrawn_at is null order by created_at desc,id desc limit 1;
 if sid is null then raise exception '没有可以撤回的交稿记录'; end if;
 update public.guild_submissions set withdrawn_at=now() where id=sid;
 update public.guild_tasks set status='active',updated_at=now() where id=p_task;
end $$;
revoke all on function public.guild_withdraw_submission(uuid) from public,anon;
grant execute on function public.guild_withdraw_submission(uuid) to authenticated;
commit;
