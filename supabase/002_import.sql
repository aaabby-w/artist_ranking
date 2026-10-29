-- Add historical source records without manufacturing accounts, scores or approvals.
begin;
alter table public.guild_tasks add column if not exists import_key text;
alter table public.guild_tasks add column if not exists source_record jsonb;
create unique index if not exists guild_tasks_import_key_unique on public.guild_tasks(import_key);
alter table public.guild_tasks alter column points drop not null;
alter table public.guild_tasks drop constraint if exists guild_tasks_status_check;
alter table public.guild_tasks add constraint guild_tasks_status_check
  check(status in ('open','active','submitted','changes','done','imported'));
alter table public.guild_tasks drop constraint if exists guild_tasks_score_ready;
alter table public.guild_tasks add constraint guild_tasks_score_ready
  check((status='imported' and import_key is not null and source_record is not null and points is null and assignee is null)
     or (status<>'imported' and points is not null));

create or replace function public.guild_activate_import(p_task uuid,p_points integer,p_assignee uuid default null,p_legacy_confirm boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
  if not public.guild_admin() then raise exception '只有负责人可以确认原表委托'; end if;
  select * into t from public.guild_tasks where id=p_task for update;
  if not found or t.status<>'imported' then raise exception '记录已确认或不存在，请刷新'; end if;
  if p_points is null or p_points not between 1 and 1000 then raise exception '请先与画师约定 1–1000 贡献分'; end if;
  if t.source_record->>'system'='旧版参考' and p_legacy_confirm is not true then
    raise exception '旧版卡牌可能与现行卡牌共用美术，请先确认是否需要单独绘制';
  end if;
  if coalesce(t.source_record->>'artist','')<>'' and p_assignee is null then
    raise exception '原表已有画师，请先选择本人已开通的账号';
  end if;
  if p_assignee is not null and not exists(select 1 from public.guild_profiles where id=p_assignee and active) then
    raise exception '请选择已开通的画师账号';
  end if;
  update public.guild_tasks set points=p_points,assignee=p_assignee,
    status=case when p_assignee is null then 'open' else 'active' end,updated_at=now()
    where id=p_task;
end $$;
revoke execute on function public.guild_activate_import(uuid,integer,uuid,boolean) from public,anon;
grant execute on function public.guild_activate_import(uuid,integer,uuid,boolean) to authenticated;
commit;
