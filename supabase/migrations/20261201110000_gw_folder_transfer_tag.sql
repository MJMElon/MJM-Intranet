-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261201100000_gw_folder_editors_links.sql first.
-- =====================================================================
-- 1) 文件夹放在哪个 Business / Company：gw_user_folders.tag_group_id / tag_company_id
--    有标的文件夹，看得到它的人会在那个 Business 区块里看到（不在 My Home）；没标 = 照旧在 My Home
-- 2) 转移拥有者：gw_transfer_folder(文件夹, 新拥有者)
--    - 只有现在的拥有者可以转；新拥有者要是已分享的人或可以分享的同事
--    - 文件夹和里面的连结都改到新拥有者名下；原拥有者变成 Editor
--    - 原拥有者自己放进文件夹的 App 回到他自己的 My Home（App 是每个人自己的）
-- 可以重复执行。
-- =====================================================================

alter table public.gw_user_folders add column if not exists tag_group_id uuid references public.gw_groups (id) on delete set null;
alter table public.gw_user_folders add column if not exists tag_company_id uuid references public.gw_companies (id) on delete set null;

create or replace function public.gw_transfer_folder(p_folder uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_old_sort integer;
  v_new_sort integer;
begin
  select f.user_id, f.sort_order into v_old, v_old_sort from public.gw_user_folders f where f.id = p_folder for update;
  if v_old is null or v_old <> auth.uid() then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  if p_new_owner is null or p_new_owner = v_old then
    return;
  end if;
  if not exists (select 1 from public.gw_profiles p where p.id = p_new_owner and p.status = 'active') then
    raise exception 'gw: user not found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.gw_folder_shares s where s.folder_id = p_folder and s.user_id = p_new_owner)
     and not exists (select 1 from public.gw_folder_share_candidates() c where c.id = p_new_owner) then
    raise exception 'gw: cannot transfer to this user' using errcode = '42501';
  end if;

  select s.sort_order into v_new_sort from public.gw_folder_shares s where s.folder_id = p_folder and s.user_id = p_new_owner;
  delete from public.gw_folder_shares s where s.folder_id = p_folder and s.user_id = p_new_owner;
  -- 原拥有者的 App 先拿出来（App 的位置跟着人走，不能跟着文件夹转）
  update public.gw_user_layout l set folder_id = null where l.folder_id = p_folder and l.user_id = v_old;
  update public.gw_user_folders f set user_id = p_new_owner, is_shared = true, sort_order = coalesce(v_new_sort, f.sort_order) where f.id = p_folder;
  update public.gw_user_links k set user_id = p_new_owner where k.folder_id = p_folder;
  insert into public.gw_folder_shares (folder_id, user_id, role, sort_order)
  values (p_folder, v_old, 'edit', coalesce(v_old_sort, 0))
  on conflict (folder_id, user_id) do update set role = 'edit';
end $$;

revoke all on function public.gw_transfer_folder(uuid, uuid) from public, anon;
grant execute on function public.gw_transfer_folder(uuid, uuid) to authenticated;

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'gw_user_folders' and column_name like 'tag_%' order by 1;
