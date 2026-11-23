-- =====================================================================
-- Sector（部门性质，例如 Operation、Admin、Account）和每个「Business × 模块」的负责人
--  - gw_sectors：super_admin 自己新增 / 改名 / 删除的预设清单
--  - gw_group_modules 多两栏：sector_id（这个 Business 里，这个模块属于哪个 Sector）、
--    lead_user_id（这个模块在这个 Business 的主要负责人）
-- 只新增；删除 Sector 或用户时，模块上的这两栏自动变回空。
-- =====================================================================

create table public.gw_sectors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index gw_sectors_name_uq on public.gw_sectors (lower(btrim(name)));

alter table public.gw_sectors enable row level security;
revoke all on public.gw_sectors from anon;

create policy gw_sectors_select on public.gw_sectors
  for select to authenticated using (true);
create policy gw_sectors_write on public.gw_sectors
  for all to authenticated
  using ((select public.gw_is_super_admin()))
  with check ((select public.gw_is_super_admin()));

create trigger gw_audit after insert or update or delete on public.gw_sectors
  for each row execute function public.gw_audit_row();

alter table public.gw_group_modules
  add column sector_id uuid references public.gw_sectors (id) on delete set null,
  add column lead_user_id uuid references public.gw_profiles (id) on delete set null;
