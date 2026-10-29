-- 010: every KDocs card defaults to 20 contribution points and a 2026-11-15 due date.
-- * Unpublished cards ('imported') may now carry a preset score. It is never awarded by
--   itself: points are recorded only when an admin publishes the card and later approves
--   a submission (unchanged guild_activate_import / guild_action flow).
-- * Existing card tasks that nobody has claimed (imported + open) get 20 / 2026-11-15.
--   Claimed, submitted or finished tasks keep their agreed score and date.
-- * New cards from the sync use guild_kdocs_state.default_points / default_due_date.
--   The sync never overwrites points or due_date of an existing task.
begin;
alter table public.guild_kdocs_state add column if not exists default_points integer not null default 20 check(default_points between 1 and 1000);
alter table public.guild_kdocs_state add column if not exists default_due_date date default '2026-11-15';
update public.guild_kdocs_state set default_points=20, default_due_date='2026-11-15' where id=1;

alter table public.guild_tasks drop constraint if exists guild_tasks_score_ready;
alter table public.guild_tasks add constraint guild_tasks_score_ready
  check((status='imported' and import_key is not null and source_record is not null and assignee is null
         and (points is null or points between 1 and 1000))
     or (status<>'imported' and points is not null));

update public.guild_tasks set points=20, due_date='2026-11-15'
 where kdocs_card_id is not null and assignee is null and status in ('imported','open')
   and (points, due_date) is distinct from (20, date '2026-11-15');

create or replace function public.guild_kdocs_project(p_sheet text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c record; t public.guild_tasks; n int;
  inserted int:=0; updated int:=0; flagged int:=0; removed int:=0; restored int:=0;
  new_title text; new_brief text; src jsonb; synced jsonb; base_system text; base_url text; key_prefix text;
  def_points integer; def_due date;
begin
  select default_points, default_due_date into def_points, def_due from public.guild_kdocs_state where id=1;
  select left(import_key, length(import_key)-length(kdocs_card_id)) into key_prefix
    from public.guild_tasks where kdocs_card_id is not null and right(import_key, length(kdocs_card_id))=kdocs_card_id
    group by 1 order by count(*) desc limit 1;
  select source_record->>'system', source_record->>'url' into base_system, base_url
    from public.guild_tasks where kdocs_card_id is not null and category='卡牌 · 灵卡'
    group by 1,2 order by count(*) desc limit 1;
  for c in select * from public.guild_kdocs_cards where sheet_name=p_sheet order by card_id loop
    select * into t from public.guild_tasks where kdocs_card_id=c.card_id for update;
    if c.missing_since is not null then
      if found and t.source_removed_at is null then
        update public.guild_tasks set source_removed_at=c.missing_since where id=t.id;
        removed:=removed+1;
      end if;
      continue;
    end if;
    new_title:=left(c.data->>'title',80);
    new_brief:=public.guild_kdocs_brief(c.data);
    synced:=jsonb_build_object('title',new_title,'brief',new_brief);
    if not found then
      insert into public.guild_tasks(title,category,brief,points,due_date,status,assignee,import_key,source_record,kdocs_card_id)
      values(new_title,'卡牌 · 灵卡',new_brief,def_points,def_due,'imported',null,coalesce(key_prefix,'kdocs:')||c.card_id,
        jsonb_build_object('system',coalesce(base_system,'灵卡'),'sheet',p_sheet,'row',(c.data->>'row')::int,
          'card_id',c.card_id,'artist',c.data->>'artist','status',c.data->>'status','url',base_url,'synced',synced),
        c.card_id);
      inserted:=inserted+1;
      continue;
    end if;
    src:=t.source_record || jsonb_build_object('sheet',p_sheet,'row',(c.data->>'row')::int,
      'artist',c.data->>'artist','status',c.data->>'status','synced',synced);
    if t.source_removed_at is not null then restored:=restored+1; end if;
    if t.status='imported' then
      update public.guild_tasks set title=new_title,brief=new_brief,source_record=src,source_removed_at=null,source_pending=null
       where id=t.id and (title,brief,source_record,source_removed_at,source_pending)
         is distinct from (new_title,new_brief,src,null::timestamptz,null::jsonb);
      get diagnostics n=row_count; updated:=updated+n;
    else
      -- Formal task: never touch title/brief/points/assignee/status here.
      update public.guild_tasks set source_record=src,source_removed_at=null,
        source_pending=case
          when t.source_record->'synced' is distinct from synced and (t.title,t.brief) is distinct from (new_title,new_brief)
            then jsonb_build_object('title',new_title,'brief',new_brief,'detected_at',now())
          when (t.title,t.brief) is not distinct from (new_title,new_brief) then null
          else t.source_pending end
       where id=t.id and (source_record,source_removed_at) is distinct from (src,null::timestamptz);
      get diagnostics n=row_count; updated:=updated+n;
      if n>0 and (select source_pending is not null and source_pending is distinct from t.source_pending
                  from public.guild_tasks where id=t.id) then flagged:=flagged+1; end if;
    end if;
  end loop;
  return jsonb_build_object('tasks_inserted',inserted,'tasks_updated',updated,'tasks_flagged',flagged,
    'tasks_marked_removed',removed,'tasks_restored',restored);
end $$;
revoke all on function public.guild_kdocs_project(text) from public,anon,authenticated;
grant execute on function public.guild_kdocs_project(text) to service_role;
commit;
-- Change defaults later:  update public.guild_kdocs_state set default_points=..., default_due_date='...' where id=1;
-- Rollback: points/due_date values can be cleared with
--   update public.guild_tasks set points=null, due_date=null where status='imported';
--   then restore the 002 constraint (points is null for imported) and re-run 007's guild_kdocs_project.
