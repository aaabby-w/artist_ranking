begin;
create table public.guild_artist_aliases(artist_name text primary key check(length(trim(artist_name)) between 1 and 40),artist_id uuid not null references public.guild_profiles(id),confirmed_by uuid not null references public.guild_profiles(id),created_at timestamptz not null default now());
alter table public.guild_artist_aliases enable row level security;
revoke all on public.guild_artist_aliases from public,anon,authenticated;
grant select on public.guild_artist_aliases to authenticated;
create policy artist_alias_admin on public.guild_artist_aliases for select to authenticated using(public.guild_admin() or artist_id=auth.uid());
-- Preserve current task/held-award binding, adding a persistent alias checked by admin.
do $$ declare body text; begin
 body:=pg_get_functiondef('public.guild_bind_artist(text,uuid)'::regprocedure);
 if position('return n;' in body)=0 then raise exception 'Inspect changed binding function before upgrading'; end if;
 body:=replace(body,'  update public.guild_tasks set assignee=p_user',E'  if exists(select 1 from public.guild_artist_aliases where artist_name=trim(p_name) and artist_id<>p_user) then raise exception ''这个署名已连接其他账号，请先核对''; end if;\n  update public.guild_tasks set assignee=p_user');
 body:=replace(body,'  return n;',E'  insert into public.guild_artist_aliases(artist_name,artist_id,confirmed_by) values(trim(p_name),p_user,auth.uid()) on conflict(artist_name) do nothing;\n  return n;');
 execute body;
end $$;
create function public.guild_route_artist_alias() returns trigger language plpgsql security definer set search_path='' as $$ declare who uuid; begin
 if new.assignee is null and new.artist_name is not null then
 select a.artist_id into who from public.guild_artist_aliases a join public.guild_profiles p on p.id=a.artist_id and p.active where a.artist_name=trim(new.artist_name);
 if who is not null then new.assignee:=who;new.artist_name:=null;end if;
 end if;
 return new;
end $$;
revoke all on function public.guild_route_artist_alias() from public,anon,authenticated;
create trigger guild_route_artist_alias before insert or update on public.guild_tasks for each row execute function public.guild_route_artist_alias();
commit;
