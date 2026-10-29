begin;
create or replace function public.guild_attach_artwork(p_task uuid,p_url text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
 if not public.guild_admin() then raise exception '只有负责人可以补传历史稿件'; end if;
 select * into t from public.guild_tasks where id=p_task for update;
 if not found or not (t.status in ('submitted','done') or (t.status='imported' and t.source_removed_at is null and t.source_record->>'status'='已递交终稿')) then raise exception '这份任务不属于可补传的历史稿件'; end if;
 if p_url is null or p_url !~ '^https://' or length(p_url)>2048 or coalesce(length(trim(p_note)),0) not between 1 and 1980 then raise exception '请上传作品并填写来源说明'; end if;
 insert into public.guild_submissions(task_id,author_id,url,note) values(p_task,auth.uid(),p_url,'历史稿件补传：'||trim(p_note));
end $$;
revoke all on function public.guild_attach_artwork(uuid,text,text) from public,anon;
grant execute on function public.guild_attach_artwork(uuid,text,text) to authenticated;
create policy guild_historical_artwork_upload on storage.objects for insert to authenticated with check(bucket_id='guild-submissions' and public.guild_admin() and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.guild_tasks t where t.id::text=(storage.foldername(name))[2] and (t.status in ('submitted','done') or (t.status='imported' and t.source_removed_at is null and t.source_record->>'status'='已递交终稿'))));
create or replace function public.guild_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.guild_profiles(id,name) values(new.id,coalesce(nullif(left(trim(coalesce(new.raw_user_meta_data->>'artist_name','')),40),''),'新画师')); return new;
end $$;
commit;
