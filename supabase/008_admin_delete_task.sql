-- 008: let an admin delete a task they published that nobody has claimed yet.
-- Only manually published tasks (no import_key / kdocs_card_id): KDocs cards are
-- managed in the KDocs sheet. Tasks with any submission or award are never deleted.
-- The guest copy row is removed by the existing guild_sync_task_preview trigger
-- (and the guild_task_preview.id foreign key cascades).
begin;
create or replace function public.guild_delete_task(p_task uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
  if not public.guild_admin() then raise exception '只有负责人可以删除任务'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found then raise exception '任务不存在，请刷新'; end if;
  if t.import_key is not null or t.kdocs_card_id is not null then
    raise exception '这张卡来自金山表，请直接在金山表里删除';
  end if;
  if t.status<>'open' or t.assignee is not null then raise exception '只能删除还没人认领的任务'; end if;
  if exists(select 1 from public.guild_submissions where task_id=p_task)
     or exists(select 1 from public.guild_awards where task_id=p_task) then
    raise exception '这份任务已有交稿或贡献记录，不能删除';
  end if;
  delete from public.guild_tasks where id=p_task;
end $$;
revoke all on function public.guild_delete_task(uuid) from public, anon;
grant execute on function public.guild_delete_task(uuid) to authenticated;
commit;
-- Rollback: drop function public.guild_delete_task(uuid);
