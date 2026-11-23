-- =====================================================================
-- 谁可以删除 Business / Company / 模块（Master Manage）
--  - gw_profiles 多三个勾：can_delete_business、can_delete_company、can_delete_module
--    （super_admin 在 Admin Console 用户资料里勾；super_admin 自己永远可以）
--  - 三张主资料表各加一条「for delete」policy：勾了的人可以删
--  - gw_profiles_guard 已用白名单保护：一般用户改不了自己的这三栏
-- 可以重复执行。
-- =====================================================================

alter table public.gw_profiles
  add column if not exists can_delete_business boolean not null default false,
  add column if not exists can_delete_company  boolean not null default false,
  add column if not exists can_delete_module   boolean not null default false;

-- 我（登录的人）有没有某个删除权
create or replace function public.gw_my_delete_right(p_what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_what
             when 'business' then p.can_delete_business
             when 'company'  then p.can_delete_company
             when 'module'   then p.can_delete_module
             else false
           end
    from public.gw_profiles p
    where p.id = auth.uid() and p.status = 'active'
  ), false);
$$;
revoke all on function public.gw_my_delete_right(text) from public;
grant execute on function public.gw_my_delete_right(text) to authenticated;

drop policy if exists gw_groups_delete_right on public.gw_groups;
create policy gw_groups_delete_right on public.gw_groups
  for delete to authenticated
  using ((select public.gw_my_delete_right('business')));

drop policy if exists gw_companies_delete_right on public.gw_companies;
create policy gw_companies_delete_right on public.gw_companies
  for delete to authenticated
  using ((select public.gw_my_delete_right('company')));

drop policy if exists gw_modules_delete_right on public.gw_modules;
create policy gw_modules_delete_right on public.gw_modules
  for delete to authenticated
  using ((select public.gw_my_delete_right('module')));
