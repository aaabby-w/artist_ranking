-- Minimal stand-in for the Supabase platform pieces our migrations touch.
-- Test-only; never run against production.
do $$ begin  -- roles are cluster-wide; tolerate a previous test database
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default grants on new public objects.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create publication supabase_realtime;

create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text, updated_at timestamptz default now());
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create schema extensions;
create extension pgcrypto schema extensions;
create schema storage;
create table storage.buckets(id text primary key, public boolean);
insert into storage.buckets values('guild-submissions', false);

create schema cron;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values(p_name, p_schedule, p_command)
  on conflict(jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $$;

create schema net;
create table net.requests(id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.requests(url, headers, body) values(url, headers, body) returning id $$;
