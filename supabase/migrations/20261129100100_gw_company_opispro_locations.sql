-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- Company 多两样（Master Manage → Company 编辑窗）：
--  - opispro_id：Opispro 的公司编号（之后接旧系统用）
--  - has_locations + gw_company_locations：勾了「这家公司有 Location」才可以加 Location（每个有自己的 Location ID 和名称）
--    没勾的公司什么都不用设。一家公司也可以只加一个 Location。
-- 可以重复执行。
-- =====================================================================

alter table public.gw_companies add column if not exists opispro_id text check (opispro_id is null or char_length(opispro_id) <= 40);
alter table public.gw_companies add column if not exists has_locations boolean not null default false;

create table if not exists public.gw_company_locations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.gw_companies (id) on delete cascade,
  location_id  text not null check (char_length(btrim(location_id)) between 1 and 40),
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (company_id, location_id),
  unique (company_id, name)
);
create index if not exists gw_company_locations_company_idx on public.gw_company_locations (company_id);

alter table public.gw_company_locations enable row level security;
revoke all on public.gw_company_locations from anon;
grant select, insert, update, delete on public.gw_company_locations to authenticated;

drop policy if exists gw_company_locations_select on public.gw_company_locations;
create policy gw_company_locations_select on public.gw_company_locations
  for select to authenticated using (true);
drop policy if exists gw_company_locations_write on public.gw_company_locations;
create policy gw_company_locations_write on public.gw_company_locations
  for all to authenticated
  using ((select public.gw_is_super_admin()))
  with check ((select public.gw_is_super_admin()));

select c.name, c.opispro_id, c.has_locations, (select count(*) from public.gw_company_locations l where l.company_id = c.id) as locations
  from public.gw_companies c
 order by c.sort_order, c.name;
