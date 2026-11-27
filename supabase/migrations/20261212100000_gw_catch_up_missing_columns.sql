-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE (briqzyxfxsvulyizzbiu) <<<
-- 补上线上资料库漏跑的部分（2026-11 检查发现）。可以重复执行。
--  - 20261201110000 / 20261201120000：文件夹分享给 Business 用的栏位（tag_group_id / tag_company_id / tag_role）
--    （那两个档里的旧函式不跑：之后的 20261201140000 / 20261201190000 已经有新版本）
--  - 20261201200000：删除 Business / Company / 模块的权限改在 Role 里勾
--  - 20261121110000（gw_company_estates）不用补：已被 Company Locations 取代，程式不再使用
-- =====================================================================

-- 文件夹分享给 Business（旧的方式；新的在 gw_folder_business_shares，页面两种都读）
alter table public.gw_user_folders add column if not exists tag_group_id uuid references public.gw_groups (id) on delete set null;
alter table public.gw_user_folders add column if not exists tag_company_id uuid references public.gw_companies (id) on delete set null;
alter table public.gw_user_folders add column if not exists tag_role text not null default 'view';
alter table public.gw_user_folders drop constraint if exists gw_user_folders_tag_role_check;
alter table public.gw_user_folders add constraint gw_user_folders_tag_role_check check (tag_role in ('view', 'edit'));

-- 删除权限在 Role 里勾
alter table public.gw_roles
  add column if not exists can_delete_business boolean not null default false,
  add column if not exists can_delete_company  boolean not null default false,
  add column if not exists can_delete_module   boolean not null default false;

create or replace function public.gw_my_delete_right(p_what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
      or (p_what in ('business', 'company', 'module')
          and public.gw__my_role_flag('can_delete_' || p_what));
$$;
revoke all on function public.gw_my_delete_right(text) from public, anon;
grant execute on function public.gw_my_delete_right(text) to authenticated;

notify pgrst, 'reload schema';

-- 检查：两个都应该是 true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gw_user_folders' and column_name = 'tag_role') as folder_columns_ok,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gw_roles' and column_name = 'can_delete_business') as delete_rights_ok;
