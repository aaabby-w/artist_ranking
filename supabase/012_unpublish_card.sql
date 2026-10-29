-- 012: admins can undo "publish" on a KDocs card.
-- A published card task (open / active / changes) with no submission and no contribution
-- goes back to the unpublished card list (status 'imported'); points and due date are kept.
begin;
create or replace function public.guild_unpublish_task(p_task uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
  if not public.guild_admin() then raise exception '只有负责人可以撤回发布'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found then raise exception '任务不存在，请刷新'; end if;
  if t.kdocs_card_id is null then raise exception '只有金山表里的卡可以撤回发布；手动发布的任务请用删除'; end if;
  if t.status not in ('open','active','changes') then raise exception '已交稿或已完成的任务不能撤回发布'; end if;
  if exists(select 1 from public.guild_submissions where task_id=p_task)
     or exists(select 1 from public.guild_awards where task_id=p_task) then
    raise exception '这份任务已有交稿记录，不能撤回发布';
  end if;
  update public.guild_tasks set status='imported',assignee=null,artist_name=null,updated_at=now() where id=p_task;
end $$;
revoke all on function public.guild_unpublish_task(uuid) from public, anon;
grant execute on function public.guild_unpublish_task(uuid) to authenticated;
commit;
-- Rollback: drop function public.guild_unpublish_task(uuid);
