-- =====================================================================
-- 1) 每个 Location 可以填面积（Ha）：gw_company_locations.area
-- 2) 删除 Business / Company / 模块：改成在 Role 里勾（Master Manage → Role → Master data）
--    - gw_roles 多三个勾：can_delete_business、can_delete_company、can_delete_module
--    - Super Admin 永远可以；其他人看自己的 Role 有没有勾
--    - 以前在用户资料勾的（gw_profiles.can_delete_*）不再使用
-- 可以重复执行。
-- =====================================================================

alter table public.gw_company_locations
  add column if not exists area numeric(12,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gw_company_locations_area_check') then
    alter table public.gw_company_locations
      add constraint gw_company_locations_area_check check (area is null or area >= 0);
  end if;
end $$;

alter table public.gw_roles
  add column if not exists can_delete_business boolean not null default false,
  add column if not exists can_delete_company  boolean not null default false,
  add column if not exists can_delete_module   boolean not null default false;

-- 我（登录的人）有没有某个删除权：Super Admin，或我的 Role 有勾
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
revoke all on function public.gw_my_delete_right(text) from public;
grant execute on function public.gw_my_delete_right(text) to authenticated;
