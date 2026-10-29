-- An admin can verify a source name before its imported cards are published.
-- Pending cards stay imported; the alias only links identity for display/routing.
begin;
do $$ declare body text;begin
 body:=pg_get_functiondef('public.guild_bind_artist(text,uuid)'::regprocedure);
 if position('if n+m=0 then' in body)=0 then raise exception 'Inspect binding function before applying 017';end if;
 body:=replace(body,'if n+m=0 then',E'if n+m=0 and not exists(select 1 from public.guild_tasks where status=''imported'' and source_removed_at is null and trim(source_record->>''artist'')=trim(p_name)) then');
 execute body;
end $$;
commit;
