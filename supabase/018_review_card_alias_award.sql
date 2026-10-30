-- 018: 待验收「通过」for a sheet card whose artist name is already linked to an account
-- (guild_artist_aliases, 016). The alias trigger moves the task to that account, but
-- guild_review_card (013) still wrote the award under the bare name, so the 20 points
-- never reached the artist's ranking. Now the award follows whoever the task ends up with.
-- Only guild_review_card changes; rules, points and permissions are unchanged.
begin;
create or replace function public.guild_review_card(p_task uuid,p_action text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks; who text; aid uuid;
begin
  if not public.guild_admin() then raise exception '只有负责人可以验收'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.status<>'imported' or t.source_removed_at is not null
     or t.source_record->>'status' is distinct from '已递交终稿' then
    raise exception '这张卡不在待验收里，请刷新';
  end if;
  who:=nullif(left(trim(coalesce(t.source_record->>'artist','')),40),'');
  if who is null then raise exception '金山表里没写这张卡的画师，请先在表格登记'; end if;
  if p_action='approve' then
    update public.guild_tasks set status='done',artist_name=who,points=coalesce(points,20),review_note=null,updated_at=now()
     where id=p_task returning assignee into aid;
    insert into public.guild_awards(task_id,artist_id,artist_name,points)
      values(p_task,aid,case when aid is null then who end,coalesce(t.points,20));
  elsif p_action='reject' then
    if coalesce(length(trim(p_reason)),0) not between 1 and 2000 then raise exception '请写明打回理由'; end if;
    update public.guild_tasks set status='changes',artist_name=who,points=coalesce(points,20),review_note=trim(p_reason),updated_at=now() where id=p_task;
  else raise exception '未知操作'; end if;
end $$;
revoke all on function public.guild_review_card(uuid,text,text) from public,anon;
grant execute on function public.guild_review_card(uuid,text,text) to authenticated;
commit;
-- Rollback: re-run guild_review_card from 013.
