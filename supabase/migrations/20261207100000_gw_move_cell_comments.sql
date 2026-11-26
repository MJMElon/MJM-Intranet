-- 表格页插入 / 删除好几栏（或列）时，留言跟着移：p_count > 0 = 在 p_at 插入几个（p_at 以后的往后移）；
-- p_count < 0 = 删掉 p_at 开始的 -p_count 个（那几个的留言删掉，后面的往前移）。只有能改这个文件夹的人可以用
create or replace function public.gw_move_cell_comments(p_folder uuid, p_page text, p_kind text, p_at int, p_count int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos int := case when p_kind = 'row' then 1 else 2 end;
begin
  if p_kind not in ('row', 'col') or p_at is null or p_at < 0 or p_count is null or p_count = 0 or abs(p_count) > 500 then
    raise exception 'gw: bad arguments' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gw_user_folders f
    where f.id = p_folder
      and (f.user_id = auth.uid() or f.id in (select public.gw_my_edit_folder_ids()))
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  if p_count < 0 then
    delete from public.gw_folder_cell_comments c
     where c.folder_id = p_folder and c.page_id = p_page
       and split_part(c.cell, ':', v_pos)::int between p_at and p_at - p_count - 1;
  end if;
  update public.gw_folder_cell_comments c
     set cell = case
       when v_pos = 1 then (split_part(c.cell, ':', 1)::int + p_count)::text || ':' || split_part(c.cell, ':', 2)
       else split_part(c.cell, ':', 1) || ':' || (split_part(c.cell, ':', 2)::int + p_count)::text
     end
   where c.folder_id = p_folder and c.page_id = p_page
     and split_part(c.cell, ':', v_pos)::int >= (case when p_count > 0 then p_at else p_at - p_count end);
end $$;
revoke all on function public.gw_move_cell_comments(uuid, text, text, int, int) from public, anon;
grant execute on function public.gw_move_cell_comments(uuid, text, text, int, int) to authenticated;
