-- 019: a KDocs card that already lists its artist is shown in 「创作中」, so it must be
-- possible to hand in work for it without a separate "publish" step and without
-- choosing an author (the sheet decides the author).
-- guild_start_sheet_card turns such a card into a real in-progress task right before the
-- first hand-in: status active, author = the sheet name (the 016 alias trigger moves it to
-- the bound account), points / DDL keep their values or fall back to the defaults.
-- Who may call it: an admin, or the artist whose account is bound to that sheet name.
-- Unassigned cards, final cards, removed cards and 旧版参考 cards are refused.
begin;
create or replace function public.guild_start_sheet_card(p_task uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; who text; st public.guild_kdocs_state;
begin
  if not public.guild_member() then raise exception '请先登录并由负责人开通成员权限'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found then raise exception '任务不存在，请刷新'; end if;
  if t.status in ('active','changes') then return; end if; -- already started (e.g. a retried hand-in)
  who:=nullif(left(trim(coalesce(t.source_record->>'artist','')),40),'');
  if t.status<>'imported' or t.source_removed_at is not null or who is null
     or t.source_record->>'status' is not distinct from '已递交终稿' then
    raise exception '这张卡现在不能交稿，请刷新';
  end if;
  if t.source_record->>'system'='旧版参考' then raise exception '旧版卡牌请负责人先确认是否需要单独绘制'; end if;
  if not public.guild_admin() and not exists(
       select 1 from public.guild_artist_aliases a where a.artist_name=who and a.artist_id=auth.uid()) then
    raise exception '这张卡不在你名下，请让负责人核对署名';
  end if;
  select * into st from public.guild_kdocs_state where id=1;
  update public.guild_tasks set status='active',assignee=null,artist_name=who,
    points=coalesce(points,st.default_points,20),due_date=coalesce(due_date,st.default_due_date),updated_at=now()
   where id=p_task;
end $$;
revoke all on function public.guild_start_sheet_card(uuid) from public,anon;
grant execute on function public.guild_start_sheet_card(uuid) to authenticated;
commit;
-- Rollback: drop function public.guild_start_sheet_card(uuid);
