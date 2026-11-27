-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE (briqzyxfxsvulyizzbiu) <<<
-- 交接前整理（可以重复执行）
--  1) gw_migrations：记录哪些更新已经跑过（以后每个更新档最后都加一行 insert）
--  2) 文件夹分享给 Business：只用 gw_folder_business_shares（旧的 gw_user_folders.tag_* 栏位移除）
--  3) 移除不再使用的：gw_company_estates、gw_member_companies.role_id、
--     gw_profiles.can_delete_business / company / module、gw_login_locked_until()
-- 删除的东西不能复原：先跑最上面的「先看看」，确认都是 0 / 空的
-- =====================================================================

-- 先看看（另外跑，只读）：
--   select (select count(*) from public.gw_company_estates) as estates_rows,
--          (select count(*) from public.gw_user_folders where tag_group_id is not null) as old_folder_business_tags;

-- ---------- 1) 更新纪录
create table if not exists public.gw_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.gw_migrations enable row level security;
revoke all on public.gw_migrations from anon, authenticated;
drop policy if exists gw_migrations_select on public.gw_migrations;
create policy gw_migrations_select on public.gw_migrations
  for select to authenticated using ((select public.gw_is_super_admin()));
grant select on public.gw_migrations to authenticated;

-- 到今天为止都已经装好（2026-11 用检查表确认过）
insert into public.gw_migrations (name) values
  ('20261029100000_gw_schema'),
  ('20261029100100_gw_security'),
  ('20261029100200_gw_audit'),
  ('20261029100300_gw_rpc'),
  ('20261029100400_gw_token_redemptions'),
  ('20261029120000_drop_ai_management'),
  ('20261030100000_gw_widgets'),
  ('20261030120000_gw_companies'),
  ('20261031100000_gw_roles'),
  ('20261101090000_gw_master_data'),
  ('20261101100000_diesel'),
  ('20261102100000_gw_role_functions'),
  ('20261103100000_gw_role_functions_2'),
  ('20261104100000_gw_home_slots'),
  ('20261105100000_gw_company_area'),
  ('20261106100000_gw_modules_links_roles'),
  ('20261107100000_gw_role_business_perms'),
  ('20261108100000_gw_user_code'),
  ('20261109100000_gw_home_sections'),
  ('20261110100000_gw_link_folder'),
  ('20261111100000_gw_sectors'),
  ('20261112100000_gw_member_companies'),
  ('20261113100000_gw_notice_reactions'),
  ('20261114100000_gw_widget_weather'),
  ('20261115100000_gw_ai'),
  ('20261116100000_gw_mcp'),
  ('20261117100000_gw_modules_stock_report_mantap'),
  ('20261118100000_gw_super_admin_all_modules'),
  ('20261119100000_gw_member_company_roles'),
  ('20261120100000_gw_register_system'),
  ('20261120100100_system_machinery_portal'),
  ('20261120100200_system_diesel_manage'),
  ('20261120100300_fuel_manage_name'),
  ('20261121100000_fuel_claims_module'),
  ('20261121100000_gw_master_delete_rights'),
  ('20261121110000_gw_company_estates'),
  ('20261121120000_gw_module_plantation_operation'),
  ('20261125100000_gw_module_access_per_business'),
  ('20261125120000_gw_module_mjm_port_url'),
  ('20261125130000_gw_modules_token_signin'),
  ('20261125140000_gw_module_port_code'),
  ('20261126100000_gw_shared_folders'),
  ('20261127100000_gw_folder_share_roles'),
  ('20261128100000_gw_link_icons'),
  ('20261129100000_gw_no_login_lockout'),
  ('20261129100100_gw_company_opispro_locations'),
  ('20261130100000_gw_drop_old_diesel'),
  ('20261130110000_gw_company_billing'),
  ('20261130120000_gw_location_id_optional'),
  ('20261130130000_gw_location_per_business'),
  ('20261201100000_gw_folder_editors_links'),
  ('20261201110000_gw_folder_transfer_tag'),
  ('20261201120000_gw_folder_business_share'),
  ('20261201130000_gw_folder_share_guards'),
  ('20261201140000_gw_security_hardening'),
  ('20261201150000_gw_business_hq'),
  ('20261201160000_gw_module_access_per_company'),
  ('20261201170000_gw_no_module_admin'),
  ('20261201180000_gw_role_per_person'),
  ('20261201190000_gw_folder_business_shares'),
  ('20261201200000_gw_location_area_delete_roles'),
  ('20261201210000_gw_opispro_sso'),
  ('20261202100000_system_mjmconnect'),
  ('20261203100000_gw_master_add_rights'),
  ('20261204100000_gw_opispro_pending'),
  ('20261205100000_gw_company_locations_all'),
  ('20261206100000_gw_folder_cell_comments'),
  ('20261207100000_gw_move_cell_comments'),
  ('20261208100000_gw_company_location_short_name'),
  ('20261209100000_gw_company_location_id'),
  ('20261210100000_gw_icon_looks'),
  ('20261211100000_gw_security_fixes'),
  ('20261212100000_gw_catch_up_missing_columns')
on conflict (name) do nothing;

-- ---------- 2) 文件夹分享给 Business：旧栏位的资料搬到新表，再移除旧栏位
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gw_user_folders' and column_name = 'tag_group_id') then
    execute 'insert into public.gw_folder_business_shares (folder_id, group_id, company_id, role)
             select f.id, f.tag_group_id, f.tag_company_id, coalesce(f.tag_role, ''view'') from public.gw_user_folders f
              where f.tag_group_id is not null
             on conflict (folder_id, group_id) do nothing';
  end if;
end $$;
drop trigger if exists gw_user_folders_tag_guard on public.gw_user_folders;
drop function if exists public.gw__folder_tag_guard();
alter table public.gw_user_folders drop constraint if exists gw_user_folders_tag_role_check;
alter table public.gw_user_folders drop column if exists tag_role;
alter table public.gw_user_folders drop column if exists tag_company_id;
alter table public.gw_user_folders drop column if exists tag_group_id;

-- ---------- 3) 不再使用的
drop table if exists public.gw_company_estates;

alter table public.gw_member_companies drop constraint if exists gw_member_companies_role_id_unused;
alter table public.gw_member_companies drop column if exists role_id;

alter table public.gw_profiles drop column if exists can_delete_business;
alter table public.gw_profiles drop column if exists can_delete_company;
alter table public.gw_profiles drop column if exists can_delete_module;

drop function if exists public.gw_login_locked_until(text);
drop function if exists public.gw_transfer_folder(uuid, uuid);

insert into public.gw_migrations (name) values ('20261213100000_gw_cleanup_and_migration_log') on conflict (name) do nothing;
notify pgrst, 'reload schema';

-- 检查：最后一个更新应该是 20261213100000
select name, applied_at from public.gw_migrations order by name desc limit 3;
