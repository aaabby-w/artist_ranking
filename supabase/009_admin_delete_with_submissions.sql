-- 009: the admin delete button also removes test submissions.
-- An admin may delete a manually published, unclaimed ('open') task even if it has
-- submissions, as long as no contribution (guild_awards) was ever recorded for it.
-- Its submission rows are deleted with it; the website then removes the uploaded
-- images, which this storage policy allows ONLY for files whose task no longer exists.
begin;
drop function if exists public.guild_delete_task(uuid);
create function public.guild_delete_task(p_task uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; n int;
begin
  if not public.guild_admin() then raise exception '只有负责人可以删除任务'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found then raise exception '任务不存在，请刷新'; end if;
  if t.import_key is not null or t.kdocs_card_id is not null then
    raise exception '这张卡来自金山表，请直接在金山表里删除';
  end if;
  if t.status<>'open' or t.assignee is not null then raise exception '只能删除还没人认领的任务'; end if;
  if exists(select 1 from public.guild_awards where task_id=p_task) then
    raise exception '这份任务已有贡献分记录，不能删除';
  end if;
  delete from public.guild_submissions where task_id=p_task;
  get diagnostics n=row_count;
  delete from public.guild_tasks where id=p_task;
  return n;  -- number of submissions removed
end $$;
revoke all on function public.guild_delete_task(uuid) from public, anon;
grant execute on function public.guild_delete_task(uuid) to authenticated;

-- Upload paths are <uploader id>/<task id>/<file>. Admins may delete a file only once
-- its task is gone, so no image of an existing task can be removed through this policy.
drop policy if exists guild_submission_images_admin_cleanup on storage.objects;
create policy guild_submission_images_admin_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'guild-submissions' and (select public.guild_admin())
    and not exists(select 1 from public.guild_tasks t where t.id::text = (storage.foldername(name))[2]));
commit;
-- Rollback: drop function public.guild_delete_task(uuid); then re-run 008_admin_delete_task.sql;
--   drop policy guild_submission_images_admin_cleanup on storage.objects;
