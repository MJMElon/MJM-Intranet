-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261201110000_gw_folder_transfer_tag.sql first.
-- =====================================================================
-- 文件夹分享给整个 Business（或 Business 里的某个 Company）
--  - gw_user_folders.tag_group_id / tag_company_id（上一版加的）现在也代表「分享给谁」：
--    那个 Business 的人（选了 Company 就是那个 Company 的人）都看得到、打得开这个文件夹
--  - gw_user_folders.tag_role：这些人是 Viewer（view，预设）还是 Editor（edit）
--  - super_admin 看得到所有分享给 Business 的文件夹（跟看得到所有 Business 区块一样）
--  - 原本一个一个人分享（gw_folder_shares）照旧
-- 可以重复执行。
-- =====================================================================

alter table public.gw_user_folders add column if not exists tag_role text not null default 'view';
alter table public.gw_user_folders drop constraint if exists gw_user_folders_tag_role_check;
alter table public.gw_user_folders add constraint gw_user_folders_tag_role_check check (tag_role in ('view', 'edit'));

-- 分享给我的文件夹：一个一个人分享的 ＋ 分享给我所在 Business / Company 的
create or replace function public.gw_my_shared_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.folder_id from public.gw_folder_shares s where s.user_id = auth.uid()
  union
  select f.id
  from public.gw_user_folders f
  where f.tag_group_id is not null
    and f.user_id <> auth.uid()
    and (
      public.gw_is_super_admin()
      or (
        exists (select 1 from public.gw_group_members gm where gm.group_id = f.tag_group_id and gm.user_id = auth.uid())
        and (
          f.tag_company_id is null
          or exists (
            select 1 from public.gw_member_companies mc
            where mc.group_id = f.tag_group_id and mc.company_id = f.tag_company_id and mc.user_id = auth.uid()
          )
        )
      )
    )
$$;

-- 我是 Editor 的文件夹：一个一个人分享成 Editor 的 ＋ 分享给我所在 Business（设成 Editor）的
create or replace function public.gw_my_edit_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.folder_id from public.gw_folder_shares s where s.user_id = auth.uid() and s.role = 'edit'
  union
  select f.id
  from public.gw_user_folders f
  where f.tag_role = 'edit'
    and f.id in (select public.gw_my_shared_folder_ids())
$$;

-- 存文件夹的标题 / 排法：拥有者或 Editor（包括 Business 的 Editor）
create or replace function public.gw_save_folder_canvas(p_folder uuid, p_canvas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_canvas is not null and pg_column_size(p_canvas) > 300000 then
    raise exception 'gw: canvas too large' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gw_user_folders f
    where f.id = p_folder
      and (f.user_id = auth.uid() or f.id in (select public.gw_my_edit_folder_ids()))
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  update public.gw_user_folders set canvas = p_canvas where id = p_folder;
end $$;

revoke all on function public.gw_my_shared_folder_ids(), public.gw_my_edit_folder_ids(), public.gw_save_folder_canvas(uuid, jsonb) from public, anon;
grant execute on function public.gw_my_shared_folder_ids(), public.gw_my_edit_folder_ids(), public.gw_save_folder_canvas(uuid, jsonb) to authenticated;

select f.name as folder, g.name as business, c.name as company, f.tag_role
  from public.gw_user_folders f
  join public.gw_groups g on g.id = f.tag_group_id
  left join public.gw_companies c on c.id = f.tag_company_id
 order by g.name, f.name;
