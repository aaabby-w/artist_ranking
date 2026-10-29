-- Additive source-data storage. No updates to guild_tasks/submissions/awards.
begin;
create table public.guild_kdocs_runs (
 id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(),
 finished_at timestamptz, status text not null default 'running' check(status in ('running','success','failed')),
 summary jsonb, error_code text
);
create table public.guild_kdocs_cards (
 sheet_name text not null, card_id text not null, data jsonb not null,
 missing_since timestamptz, updated_at timestamptz not null default now(),
 primary key(sheet_name,card_id)
);
create table public.guild_kdocs_state (
 id smallint primary key check(id=1), last_success_at timestamptz,
 last_started_at timestamptz, last_run_id uuid references public.guild_kdocs_runs
);
insert into public.guild_kdocs_state(id) values(1);
alter table public.guild_kdocs_runs enable row level security;
alter table public.guild_kdocs_cards enable row level security;
alter table public.guild_kdocs_state enable row level security;
revoke all on public.guild_kdocs_runs,public.guild_kdocs_cards,public.guild_kdocs_state from public,anon,authenticated;
grant select on public.guild_kdocs_runs,public.guild_kdocs_cards,public.guild_kdocs_state to authenticated;
grant select,insert,update on public.guild_kdocs_runs,public.guild_kdocs_cards,public.guild_kdocs_state to service_role;
create policy kdocs_runs_read on public.guild_kdocs_runs for select to authenticated using(public.guild_member());
create policy kdocs_cards_read on public.guild_kdocs_cards for select to authenticated using(public.guild_member());
create policy kdocs_state_read on public.guild_kdocs_state for select to authenticated using(public.guild_member());
create function public.guild_kdocs_apply(p_run uuid,p_sheets jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; c jsonb; started timestamptz; previous timestamptz; total int:=0; changed int:=0; missing int:=0; n int; seen text[]:='{}';
begin
 select started_at into started from public.guild_kdocs_runs where id=p_run and status='running' for update;
 if started is null then raise exception 'Invalid sync run'; end if;
 select last_started_at into previous from public.guild_kdocs_state where id=1 for update;
 if previous is not null and started <= previous then raise exception 'Stale sync run'; end if;
 if jsonb_typeof(p_sheets) is distinct from 'array' or jsonb_array_length(p_sheets) not between 1 and 20 then raise exception 'Invalid sheet set'; end if;
 for s in select value from jsonb_array_elements(p_sheets) loop
  if coalesce(s->>'name','')='' or s->>'name'=any(seen) or s->>'complete' is distinct from 'true' or jsonb_typeof(s->'cards') is distinct from 'array' or jsonb_array_length(s->'cards') not between 1 and 20000 or jsonb_typeof(s->'rows') is distinct from 'array' then raise exception 'Incomplete sheet'; end if;
  seen:=array_append(seen,s->>'name');
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(s->'cards')) then raise exception 'Duplicate IDs'; end if;
  for c in select value from jsonb_array_elements(s->'cards') loop
   if coalesce(c->>'id','')='' or jsonb_typeof(c->'data') is distinct from 'object' then raise exception 'Invalid card'; end if;
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
 end loop;
 update public.guild_kdocs_state set last_success_at=now(),last_started_at=started,last_run_id=p_run where id=1;
 update public.guild_kdocs_runs set status='success',finished_at=now(),summary=jsonb_build_object('cards',total,'changed',changed,'marked_missing',missing) where id=p_run;
 return jsonb_build_object('cards',total,'changed',changed,'marked_missing',missing);
end $$;
revoke all on function public.guild_kdocs_apply(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guild_kdocs_apply(uuid,jsonb) to service_role;
alter publication supabase_realtime add table public.guild_kdocs_cards,public.guild_kdocs_runs,public.guild_kdocs_state;
commit;
