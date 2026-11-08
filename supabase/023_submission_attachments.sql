-- Supplemental files do not replace the revision being reviewed or its submitted date.
-- Existing awards and files are preserved. Apply after 021.
begin;
alter table public.guild_submissions add column if not exists submission_kind text not null default 'revision'
  check (submission_kind in ('revision','attachment'));
-- 014 is the only writer of this reserved prefix in the historical upload flow.
update public.guild_submissions set submission_kind='attachment'
where submission_kind='revision' and note like '历史稿件补传：%';

create or replace function public.guild_attach_artwork(p_task uuid,p_url text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.guild_tasks;
begin
 if not public.guild_admin() then raise exception '只有负责人可以补传历史稿件'; end if;
 select * into t from public.guild_tasks where id=p_task for update;
 if not found or not (t.status in ('submitted','done') or (t.status='imported' and t.source_removed_at is null and t.source_record->>'status'='已递交终稿')) then raise exception '这份任务不属于可补传的历史稿件'; end if;
 if p_url is null or p_url !~ '^https://' or length(p_url)>2048 or coalesce(length(trim(p_note)),0) not between 1 and 1980 then raise exception '请上传作品并填写来源说明'; end if;
 -- A retry after an uncertain network response must not duplicate the same uploaded file.
 if exists(select 1 from public.guild_submissions where task_id=p_task and url=p_url and submission_kind='attachment' and withdrawn_at is null) then return; end if;
 insert into public.guild_submissions(task_id,author_id,url,note,submission_kind)
 values(p_task,auth.uid(),p_url,'历史稿件补传：'||trim(p_note),'attachment');
end $$;

-- Preserve the deployed business functions; refuse an unexpected body instead of replacing it.
do $$
declare body text; old_selection text; new_selection text; target regprocedure;
begin
 foreach target in array array[
  'public.guild_action(uuid,text,text,text,text)'::regprocedure,
  'public.guild_withdraw_submission(uuid)'::regprocedure
 ] loop
  body := pg_get_functiondef(target);
  if target = 'public.guild_action(uuid,text,text,text,text)'::regprocedure then
   old_selection := 'where task_id=p_task order by created_at desc,id desc limit 1';
  else
   old_selection := 'where task_id=p_task and withdrawn_at is null order by created_at desc,id desc limit 1';
  end if;
  new_selection := 'where task_id=p_task and withdrawn_at is null and submission_kind=''revision'' order by created_at desc,id desc limit 1';
  if position(new_selection in body)>0 then continue; end if;
  if position(old_selection in body)=0 then raise exception 'Unexpected submission selector in %, inspect before applying 023',target; end if;
  execute replace(body,old_selection,new_selection);
 end loop;
end $$;
commit;
-- Rollback: restore guild_attach_artwork from 014, guild_action from 013 and withdrawal from 021
-- after comparing the live definitions. Keep submission_kind and all rows; do not rewrite awards.
