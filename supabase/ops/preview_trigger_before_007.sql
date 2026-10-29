-- Guest copy as deployed in production before 007 (read from the live database on
-- 2026-10-29; it was never committed). Kept for reference and rollback.
-- guild_task_preview is a TABLE: RLS on, policy guild_task_preview_read (select,
-- anon+authenticated, using true), anon/authenticated SELECT only, in supabase_realtime,
-- id -> guild_tasks(id) on delete cascade. Maintained by this trigger function:
create or replace function public.guild_sync_task_preview() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.guild_task_preview where id = old.id;
    return old;
  end if;

  insert into public.guild_task_preview
    (id, title, category, brief, points, status, due_date, created_at, updated_at)
  values
    (new.id, new.title, new.category, new.brief, new.points, new.status,
     new.due_date, new.created_at, new.updated_at)
  on conflict (id) do update set
    title = excluded.title,
    category = excluded.category,
    brief = excluded.brief,
    points = excluded.points,
    status = excluded.status,
    due_date = excluded.due_date,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
  return new;
end $$;
-- create trigger guild_task_preview_changed after insert or delete or update on public.guild_tasks
--   for each row execute function public.guild_sync_task_preview();
