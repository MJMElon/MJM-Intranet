-- 文件夹表格页（Sheet）的格子留言：看得到这个文件夹的人（拥有者、被分享的 Viewer / Editor）都可以留言
-- 每则留言记：哪个文件夹、哪一页、哪一格（"列:栏"）、谁（名字在写入时由数据库填，不能冒名）、内容、时间
-- 删除：自己的留言，或文件夹拥有者。删掉一列 / 一栏时，能改这个文件夹的人用 gw_shift_cell_comments 让留言跟着移
create table if not exists public.gw_folder_cell_comments (
  id           uuid primary key default gen_random_uuid(),
  folder_id    uuid not null references public.gw_user_folders (id) on delete cascade,
  page_id      text not null check (page_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  cell         text not null check (cell ~ '^[0-9]{1,3}:[0-9]{1,2}$'),
  user_id      uuid not null default auth.uid() references public.gw_profiles (id) on delete cascade,
  author_name  text not null default '',
  body         text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index if not exists gw_folder_cell_comments_page_idx on public.gw_folder_cell_comments (folder_id, page_id);
alter table public.gw_folder_cell_comments enable row level security;

-- 写入时：一定是自己、名字从自己的资料拿、时间用现在
create or replace function public.gw__cell_comment_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.author_name := coalesce((select p.full_name from public.gw_profiles p where p.id = auth.uid()), '');
  new.created_at := now();
  new.body := btrim(new.body);
  return new;
end $$;
drop trigger if exists gw_cell_comment_stamp on public.gw_folder_cell_comments;
create trigger gw_cell_comment_stamp before insert on public.gw_folder_cell_comments
  for each row execute function public.gw__cell_comment_stamp();

drop policy if exists gw_cell_comments_select on public.gw_folder_cell_comments;
create policy gw_cell_comments_select on public.gw_folder_cell_comments
  for select to authenticated
  using (
    exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
    or folder_id in (select public.gw_my_shared_folder_ids())
  );
drop policy if exists gw_cell_comments_insert on public.gw_folder_cell_comments;
create policy gw_cell_comments_insert on public.gw_folder_cell_comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
      or folder_id in (select public.gw_my_shared_folder_ids())
    )
  );
drop policy if exists gw_cell_comments_delete on public.gw_folder_cell_comments;
create policy gw_cell_comments_delete on public.gw_folder_cell_comments
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  );
grant select, insert, delete on public.gw_folder_cell_comments to authenticated;

-- 删掉一列（p_kind = 'row'）或一栏（'col'）：那一列 / 栏的留言删掉，后面的往前移一格
create or replace function public.gw_shift_cell_comments(p_folder uuid, p_page text, p_kind text, p_index int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('row', 'col') or p_index is null or p_index < 0 then
    raise exception 'gw: bad arguments' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gw_user_folders f
    where f.id = p_folder
      and (f.user_id = auth.uid() or f.id in (select public.gw_my_edit_folder_ids()))
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  delete from public.gw_folder_cell_comments c
   where c.folder_id = p_folder and c.page_id = p_page
     and (case when p_kind = 'row' then split_part(c.cell, ':', 1) else split_part(c.cell, ':', 2) end)::int = p_index;
  update public.gw_folder_cell_comments c
     set cell = case
       when p_kind = 'row' then ((split_part(c.cell, ':', 1))::int - 1)::text || ':' || split_part(c.cell, ':', 2)
       else split_part(c.cell, ':', 1) || ':' || ((split_part(c.cell, ':', 2))::int - 1)::text
     end
   where c.folder_id = p_folder and c.page_id = p_page
     and (case when p_kind = 'row' then split_part(c.cell, ':', 1) else split_part(c.cell, ':', 2) end)::int > p_index;
end $$;
revoke all on function public.gw_shift_cell_comments(uuid, text, text, int) from public, anon;
grant execute on function public.gw_shift_cell_comments(uuid, text, text, int) to authenticated;
revoke all on function public.gw__cell_comment_stamp() from public, anon, authenticated;
