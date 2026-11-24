-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE (briqzyxfxsvulyizzbiu) <<<
-- Needs all earlier migrations. Safe to run more than once.
-- =====================================================================
-- Master data rights in a Role (Master Manage → Role → Master data), next to
-- the delete rights:
--   can_add_business   add a new business
--   can_add_company    add a new company (and put it into businesses, with
--                      its locations)
--   can_add_module     add a module (icon) to a business
-- Super Admin can always do all of them. Editing a business / company / module
-- stays with Super Admin (module name: the "Edit module name" right).
-- People with an add right see every business (they choose where to add), and
-- with "Add module" every module (to pick one).
-- =====================================================================

alter table public.gw_roles
  add column if not exists can_add_business boolean not null default false,
  add column if not exists can_add_company  boolean not null default false,
  add column if not exists can_add_module   boolean not null default false;

-- Do I (the signed-in person) have an add right? Super Admin, or one of my roles has it ticked.
create or replace function public.gw_my_add_right(p_what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
      or (p_what in ('business', 'company', 'module')
          and public.gw__my_role_flag('can_add_' || p_what));
$$;
revoke all on function public.gw_my_add_right(text) from public;
grant execute on function public.gw_my_add_right(text) to authenticated;

-- Businesses: add; see all (to choose where a company / module goes)
drop policy if exists gw_groups_select_add_right on public.gw_groups;
create policy gw_groups_select_add_right on public.gw_groups
  for select to authenticated
  using ((select public.gw_my_add_right('business')) or (select public.gw_my_add_right('company')) or (select public.gw_my_add_right('module')));
drop policy if exists gw_groups_insert_add_right on public.gw_groups;
create policy gw_groups_insert_add_right on public.gw_groups
  for insert to authenticated
  with check ((select public.gw_my_add_right('business')));

-- Companies: add (everyone may already read them)
drop policy if exists gw_companies_insert_add_right on public.gw_companies;
create policy gw_companies_insert_add_right on public.gw_companies
  for insert to authenticated
  with check ((select public.gw_my_add_right('company')));

-- A new company goes into businesses (only adding links; changing or removing stays with Super Admin)
drop policy if exists gw_business_companies_insert_add_right on public.gw_business_companies;
create policy gw_business_companies_insert_add_right on public.gw_business_companies
  for insert to authenticated
  with check ((select public.gw_my_add_right('company')));

-- … with its locations
drop policy if exists gw_company_locations_insert_add_right on public.gw_company_locations;
create policy gw_company_locations_insert_add_right on public.gw_company_locations
  for insert to authenticated
  with check ((select public.gw_my_add_right('company')));

-- Modules: see all, and put one into a business
drop policy if exists gw_modules_select_add_right on public.gw_modules;
create policy gw_modules_select_add_right on public.gw_modules
  for select to authenticated
  using ((select public.gw_my_add_right('module')));
drop policy if exists gw_group_modules_select_add_right on public.gw_group_modules;
create policy gw_group_modules_select_add_right on public.gw_group_modules
  for select to authenticated
  using ((select public.gw_my_add_right('module')));
drop policy if exists gw_group_modules_insert_add_right on public.gw_group_modules;
create policy gw_group_modules_insert_add_right on public.gw_group_modules
  for insert to authenticated
  with check ((select public.gw_my_add_right('module')));
