-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261127100000_gw_folder_share_roles.sql first.
-- =====================================================================
-- 分享文件夹：Editor（role = 'edit'）也可以在文件夹里加 / 改 / 删连结
--  - 连结还是属于文件夹的拥有者（user_id = 拥有者），拥有者照样看得到、改得到
--  - Viewer（role = 'view'）只能看、打开，不能改
-- 可以重复执行。
-- =====================================================================

-- 我是 Editor 的文件夹
create or replace function public.gw_my_edit_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.folder_id from public.gw_folder_shares s where s.user_id = auth.uid() and s.role = 'edit'
$$;

-- 文件夹的拥有者
create or replace function public.gw__folder_owner(p_folder uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id from public.gw_user_folders f where f.id = p_folder
$$;

revoke all on function public.gw_my_edit_folder_ids(), public.gw__folder_owner(uuid) from public, anon;
grant execute on function public.gw_my_edit_folder_ids(), public.gw__folder_owner(uuid) to authenticated;

-- Editor：在自己是 Editor 的文件夹里加 / 改 / 删连结；新连结一定记在拥有者名下、留在那些文件夹里
drop policy if exists gw_user_links_editor on public.gw_user_links;
create policy gw_user_links_editor on public.gw_user_links
  for all to authenticated
  using (folder_id in (select public.gw_my_edit_folder_ids()))
  with check (
    folder_id in (select public.gw_my_edit_folder_ids())
    and user_id = public.gw__folder_owner(folder_id)
  );

select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'gw_user_links' order by 1;
