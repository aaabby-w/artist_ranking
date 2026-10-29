-- 007: connect the KDocs mirror (guild_kdocs_cards) to the tasks the website reads.
-- Prerequisites: 002, 003, 004, 005 already applied. Additive only:
--   * no row in guild_tasks / guild_submissions / guild_awards / guild_profiles is deleted;
--   * points, assignee and status are never written by the sync;
--   * a card removed from the sheet is only flagged (source_removed_at).
-- The whole file is one transaction and aborts on any precheck failure.
-- Rollback: see the end of this file.
begin;

-- ---------------------------------------------------------------- prechecks
do $$
declare n int; m int; sample text;
begin
  if to_regclass('public.guild_kdocs_cards') is null or to_regclass('public.guild_kdocs_state') is null
     or to_regprocedure('public.guild_kdocs_apply(uuid,jsonb)') is null then
    raise exception '请先执行 005_kdocs_incremental.sql';
  end if;
  -- Production: guild_task_preview is a TABLE copied from guild_tasks by trigger
  -- guild_task_preview_changed -> guild_sync_task_preview(). Refuse anything else.
  if (select relkind from pg_class where oid=to_regclass('public.guild_task_preview')) is distinct from 'r'
     or to_regprocedure('public.guild_sync_task_preview()') is null
     or not exists(select 1 from pg_trigger where tgname='guild_task_preview_changed' and tgrelid='public.guild_tasks'::regclass) then
    raise exception 'guild_task_preview 不是由 guild_sync_task_preview 触发器维护的表，停止升级，请人工核对';
  end if;
  -- Every imported task must carry a unique card_id: that is the link key.
  select count(*) into n from public.guild_tasks
   where import_key is not null and coalesce(source_record->>'card_id','')='';
  if n>0 then raise exception '有 % 条原表导入任务缺少 card_id，停止升级', n; end if;
  select count(*) into n from (select source_record->>'card_id' from public.guild_tasks
   where import_key is not null group by 1 having count(*)>1) d;
  if n>0 then raise exception '有 % 组原表导入任务 card_id 重复，停止升级', n; end if;
  -- Every card already mirrored from 全部卡牌 must match exactly one existing import task;
  -- otherwise linking would create duplicate tasks. Abort and inspect instead.
  select count(*), min(c.card_id) into n, sample from public.guild_kdocs_cards c
   where c.sheet_name='全部卡牌' and not exists(select 1 from public.guild_tasks t
     where t.import_key is not null and t.source_record->>'card_id'=c.card_id);
  select count(*) into m from public.guild_kdocs_cards where sheet_name='全部卡牌';
  if n>0 then raise exception '镜像中有 %/% 张卡在 guild_tasks 找不到对应导入记录（例如 %），停止升级以免重复建任务', n, m, sample; end if;
end $$;

-- ---------------------------------------------------------------- columns
alter table public.guild_tasks add column if not exists kdocs_card_id text;
alter table public.guild_tasks add column if not exists source_removed_at timestamptz;
alter table public.guild_tasks add column if not exists source_pending jsonb;
create unique index if not exists guild_tasks_kdocs_card_unique on public.guild_tasks(kdocs_card_id) where kdocs_card_id is not null;

alter table public.guild_kdocs_state add column if not exists task_sheet text not null default '全部卡牌';
alter table public.guild_kdocs_state add column if not exists approved_removals integer check(approved_removals>0);
alter table public.guild_kdocs_state add column if not exists approved_inserts integer check(approved_inserts>0);

-- Link existing imported tasks to their mirrored card (same ID the AirScript wrote to column 同步ID).
update public.guild_tasks t set kdocs_card_id=t.source_record->>'card_id'
 where t.import_key is not null and t.kdocs_card_id is null
   and exists(select 1 from public.guild_kdocs_cards c where c.sheet_name='全部卡牌' and c.card_id=t.source_record->>'card_id');

-- ---------------------------------------------------------------- helpers
-- Same layout as the original import, so unchanged cards produce identical text.
create or replace function public.guild_kdocs_brief(d jsonb) returns text language sql immutable set search_path='' as $$
  select left(coalesce(nullif(concat_ws(E'\n',
    '画面效果：'||nullif(d->>'art_requirement',''),
    '角色：'||nullif(d->>'owner',''),
    '技能介绍：'||nullif(d->>'description',''),
    '卡牌类型：'||nullif(d->>'card_type',''),
    '机制简述：'||nullif(d->>'mechanism',''),
    '效果 / 数值：'||nullif(d->>'effect',''),
    '卡牌消耗（非贡献分）：'||nullif(d->>'cost','')),''),'（原表暂无说明）'),5000)
$$;
revoke all on function public.guild_kdocs_brief(jsonb) from public,anon,authenticated;

-- A card removed from the sheet cannot be turned into a live task until someone restores it.
create or replace function public.guild_kdocs_guard_activation() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='imported' and new.status<>'imported' and old.source_removed_at is not null then
    raise exception '这张卡已从金山原表移除，请先在原表核实后再转为任务';
  end if;
  return new;
end $$;
revoke all on function public.guild_kdocs_guard_activation() from public,anon,authenticated;
drop trigger if exists guild_kdocs_guard_activation on public.guild_tasks;
create trigger guild_kdocs_guard_activation before update of status on public.guild_tasks
  for each row execute function public.guild_kdocs_guard_activation();

-- ---------------------------------------------------------------- projection
-- Copies mirrored source data onto tasks. Rules:
--   imported  -> title/brief/source_record follow the sheet automatically;
--   open/active/submitted/changes/done -> only source_record (登记画师/完成情况/行号) follows;
--     a change of name or description is parked in source_pending for an admin to review.
--   removed from sheet -> source_removed_at is set; nothing is deleted.
-- Every UPDATE is conditional, so an unchanged sheet writes nothing.
create or replace function public.guild_kdocs_project(p_sheet text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c record; t public.guild_tasks; n int;
  inserted int:=0; updated int:=0; flagged int:=0; removed int:=0; restored int:=0;
  new_title text; new_brief text; src jsonb; synced jsonb; base_system text; base_url text; key_prefix text;
begin
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
      insert into public.guild_tasks(title,category,brief,points,status,assignee,import_key,source_record,kdocs_card_id)
      values(new_title,'卡牌 · 灵卡',new_brief,null,'imported',null,coalesce(key_prefix,'kdocs:')||c.card_id,
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

-- ---------------------------------------------------------------- run control
create or replace function public.guild_kdocs_begin() returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  perform 1 from public.guild_kdocs_state where id=1 for update;
  update public.guild_kdocs_runs set status='failed',finished_at=now(),error_code='RUN_TIMEOUT'
   where status='running' and started_at<now()-interval '10 minutes';
  if exists(select 1 from public.guild_kdocs_runs where status='running') then
    raise exception 'SYNC_ALREADY_RUNNING';
  end if;
  -- Keep 90 days of run history; never the run the state points at.
  delete from public.guild_kdocs_runs r where r.started_at<now()-interval '90 days'
    and r.id is distinct from (select last_run_id from public.guild_kdocs_state where id=1);
  insert into public.guild_kdocs_runs default values returning id into rid;
  return rid;
end $$;
revoke all on function public.guild_kdocs_begin() from public,anon,authenticated;
grant execute on function public.guild_kdocs_begin() to service_role;

-- Replaces 005's version: same validation and mirror writes, plus
--   * bulk-change guard (a short or broken read cannot hide many cards at once);
--   * projection onto guild_tasks inside the same transaction.
create or replace function public.guild_kdocs_apply(p_run uuid,p_sheets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; c jsonb; started timestamptz; previous timestamptz; st public.guild_kdocs_state;
  total int:=0; changed int:=0; missing int:=0; n int; seen text[]:='{}';
  active_before int; to_remove int; to_insert int; limit_remove int; limit_insert int; proj jsonb:='{}';
begin
 select started_at into started from public.guild_kdocs_runs where id=p_run and status='running' for update;
 if started is null then raise exception 'INVALID_SYNC_RUN'; end if;
 select * into st from public.guild_kdocs_state where id=1 for update;
 previous:=st.last_started_at;
 if previous is not null and started <= previous then raise exception 'STALE_SYNC_RUN'; end if;
 if jsonb_typeof(p_sheets) is distinct from 'array' or jsonb_array_length(p_sheets) not between 1 and 20 then raise exception 'INVALID_SHEET_SET'; end if;
 for s in select value from jsonb_array_elements(p_sheets) loop
  if coalesce(s->>'name','')='' or s->>'name'=any(seen) or s->>'complete' is distinct from 'true' or jsonb_typeof(s->'cards') is distinct from 'array' or jsonb_array_length(s->'cards') not between 1 and 20000 or jsonb_typeof(s->'rows') is distinct from 'array' then raise exception 'INCOMPLETE_SHEET'; end if;
  seen:=array_append(seen,s->>'name');
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(s->'cards')) then raise exception 'DUPLICATE_CARD_IDS'; end if;
  if exists(select 1 from jsonb_array_elements(s->'cards') x where coalesce(x->>'id','')='' or jsonb_typeof(x->'data') is distinct from 'object') then raise exception 'INVALID_CARD'; end if;

  -- Bulk-change guard. Small edits flow through; large ones wait for an explicit approval
  -- of the exact number (guild_kdocs_approve). First sync of a new sheet is exempt.
  select count(*) into active_before from public.guild_kdocs_cards where sheet_name=s->>'name' and missing_since is null;
  select count(*) into to_remove from public.guild_kdocs_cards k where k.sheet_name=s->>'name' and k.missing_since is null
    and not exists(select 1 from jsonb_array_elements(s->'cards') x where x->>'id'=k.card_id);
  select count(*) into to_insert from jsonb_array_elements(s->'cards') x
    where not exists(select 1 from public.guild_kdocs_cards k where k.sheet_name=s->>'name' and k.card_id=x->>'id');
  limit_remove:=greatest(5,ceil(active_before*0.10)::int);
  limit_insert:=greatest(10,ceil(active_before*0.25)::int);
  if active_before>0 and to_remove>limit_remove then
    if st.approved_removals is distinct from to_remove then raise exception 'MASS_REMOVAL_BLOCKED_%', to_remove; end if;
    update public.guild_kdocs_state set approved_removals=null where id=1;
  end if;
  if active_before>0 and to_insert>limit_insert then
    if st.approved_inserts is distinct from to_insert then raise exception 'MASS_INSERT_BLOCKED_%', to_insert; end if;
    update public.guild_kdocs_state set approved_inserts=null where id=1;
  end if;

  for c in select value from jsonb_array_elements(s->'cards') loop
   insert into public.guild_kdocs_cards(sheet_name,card_id,data) values(s->>'name',c->>'id',c->'data')
   on conflict(sheet_name,card_id) do update set data=excluded.data,missing_since=null,updated_at=now()
   where guild_kdocs_cards.data is distinct from excluded.data or guild_kdocs_cards.missing_since is not null;
   get diagnostics n=row_count; changed:=changed+n; total:=total+1;
  end loop;
  update public.guild_kdocs_cards set missing_since=now(),updated_at=now()
   where sheet_name=s->>'name' and missing_since is null and not exists(select 1 from jsonb_array_elements(s->'cards') x where x->>'id'=card_id);
  get diagnostics n=row_count; missing:=missing+n;
  insert into public.guild_kdocs_mirror(source_key,sheet_name,cells,updated_at)
   values(case when s->>'name'='全部卡牌' then 'main' else 'sheet:'||(s->>'name') end,s->>'name',s->'rows',now())
   on conflict(source_key) do update set cells=excluded.cells,updated_at=excluded.updated_at where guild_kdocs_mirror.cells is distinct from excluded.cells;
  if s->>'name'=st.task_sheet then proj:=public.guild_kdocs_project(st.task_sheet); end if;
 end loop;
 update public.guild_kdocs_state set last_success_at=now(),last_started_at=started,last_run_id=p_run where id=1;
 update public.guild_kdocs_runs set status='success',finished_at=now(),
   summary=jsonb_build_object('cards',total,'changed',changed,'marked_missing',missing) || proj where id=p_run;
 return jsonb_build_object('cards',total,'changed',changed,'marked_missing',missing) || proj;
end $$;
revoke all on function public.guild_kdocs_apply(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guild_kdocs_apply(uuid,jsonb) to service_role;

-- Approve one specific bulk change (exact counts from the blocked run's error code).
-- Callable from the SQL editor, or by an active admin from the website.
create or replace function public.guild_kdocs_approve(p_removals integer,p_inserts integer default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not public.guild_admin() then raise exception '只有负责人可以确认大批同步变更'; end if;
  if coalesce(p_removals,1)<1 or coalesce(p_inserts,1)<1 then raise exception '请填写被拦截的确切数量'; end if;
  update public.guild_kdocs_state set approved_removals=p_removals,approved_inserts=p_inserts where id=1;
end $$;
revoke all on function public.guild_kdocs_approve(integer,integer) from public,anon;
grant execute on function public.guild_kdocs_approve(integer,integer) to authenticated;

-- Admin decision on a parked sheet change for a formal task.
--   accept : only for unclaimed ('open') tasks — copies the new name/description; points unchanged.
--   dismiss: keep the commission as agreed and clear the notice.
create or replace function public.guild_kdocs_resolve(p_task uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
  if not public.guild_admin() then raise exception '只有负责人可以处理原表变更'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.source_pending is null then raise exception '没有待核对的原表变更，请刷新'; end if;
  if p_action='accept' then
    if t.status<>'open' then raise exception '画师已接手的任务不自动改要求；请与画师沟通后选择“保持原要求”'; end if;
    update public.guild_tasks set title=t.source_pending->>'title',brief=t.source_pending->>'brief',source_pending=null,updated_at=now() where id=p_task;
  elsif p_action='dismiss' then
    update public.guild_tasks set source_pending=null,updated_at=now() where id=p_task;
  else raise exception '未知操作'; end if;
end $$;
revoke all on function public.guild_kdocs_resolve(uuid,text) from public,anon;
grant execute on function public.guild_kdocs_resolve(uuid,text) to authenticated;

-- ---------------------------------------------------------------- guest copy
-- guild_task_preview stays a trigger-maintained copy (no rows deleted). It gains a
-- name-free source_state; guests no longer see imported cards that left the sheet.
alter table public.guild_task_preview add column if not exists source_state text;

create or replace function public.guild_task_source_state(t public.guild_tasks) returns text
language sql stable set search_path='' as $$
  select case when t.status<>'imported' then null
    when t.source_removed_at is not null then 'removed'
    when t.source_record->>'status'='已递交终稿' then 'final'
    when coalesce(trim(t.source_record->>'artist'),'')<>'' then 'assigned'
    else 'unassigned' end
$$;
revoke all on function public.guild_task_source_state(public.guild_tasks) from public,anon,authenticated;

-- Same body as the deployed version, plus source_state.
create or replace function public.guild_sync_task_preview() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.guild_task_preview where id = old.id;
    return old;
  end if;
  insert into public.guild_task_preview
    (id, title, category, brief, points, status, due_date, created_at, updated_at, source_state)
  values
    (new.id, new.title, new.category, new.brief, new.points, new.status,
     new.due_date, new.created_at, new.updated_at, public.guild_task_source_state(new))
  on conflict (id) do update set
    title = excluded.title, category = excluded.category, brief = excluded.brief,
    points = excluded.points, status = excluded.status, due_date = excluded.due_date,
    created_at = excluded.created_at, updated_at = excluded.updated_at,
    source_state = excluded.source_state;
  return new;
end $$;

update public.guild_task_preview p set source_state=public.guild_task_source_state(t)
  from public.guild_tasks t where t.id=p.id and p.source_state is distinct from public.guild_task_source_state(t);

drop policy if exists guild_task_preview_read on public.guild_task_preview;
create policy guild_task_preview_read on public.guild_task_preview for select to anon, authenticated
  using (source_state is distinct from 'removed');

-- ---------------------------------------------------------------- verify
do $$
declare n int;
begin
  select count(*) into n from public.guild_tasks where import_key is not null and kdocs_card_id is null;
  raise notice '已链接 % 条导入任务；未链接 % 条（镜像中没有的旧记录，保持原状）',
    (select count(*) from public.guild_tasks where kdocs_card_id is not null), n;
  if has_table_privilege('anon','public.guild_tasks','select') then raise exception 'anon 不应能直接读 guild_tasks'; end if;
end $$;
commit;

-- Rollback (keeps all data; stops projection, restores 005 behaviour):
--   1. re-run the guild_kdocs_apply definition from 005_kdocs_incremental.sql;
--   2. drop trigger guild_kdocs_guard_activation on public.guild_tasks;
--   3. restore the original preview trigger function (body without source_state, kept in
--      supabase/ops/preview_trigger_before_007.sql) and the policy:
--      drop policy guild_task_preview_read on public.guild_task_preview;
--      create policy guild_task_preview_read on public.guild_task_preview for select to anon,authenticated using (true);
--   4. the added columns can stay (nullable, unused) or be dropped after review.
