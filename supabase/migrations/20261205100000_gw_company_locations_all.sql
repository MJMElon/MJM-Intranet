-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE (briqzyxfxsvulyizzbiu) <<<
-- Company locations in one go: 20261129100100 + 20261130120000 +
-- 20261130130000 + the location area of 20261201200000. Safe to run more than once.
-- =====================================================================
alter table public.gw_companies add column if not exists opispro_id text check (opispro_id is null or char_length(opispro_id) <= 40);
alter table public.gw_companies add column if not exists has_locations boolean not null default false;

create table if not exists public.gw_company_locations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.gw_companies (id) on delete cascade,
  location_id  text,
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists gw_company_locations_company_idx on public.gw_company_locations (company_id);

-- Opispro Location ID may stay empty
alter table public.gw_company_locations alter column location_id drop not null;
alter table public.gw_company_locations drop constraint if exists gw_company_locations_location_id_check;
alter table public.gw_company_locations
  add constraint gw_company_locations_location_id_check check (location_id is null or char_length(btrim(location_id)) between 1 and 40);

-- Each location belongs to one business of the company
alter table public.gw_company_locations add column if not exists group_id uuid references public.gw_groups (id) on delete cascade;
update public.gw_company_locations l
   set group_id = (select bc.group_id from public.gw_business_companies bc where bc.company_id = l.company_id)
 where l.group_id is null
   and (select count(*) from public.gw_business_companies bc where bc.company_id = l.company_id) = 1;
alter table public.gw_company_locations drop constraint if exists gw_company_locations_company_id_location_id_key;
alter table public.gw_company_locations drop constraint if exists gw_company_locations_company_id_name_key;
drop index if exists public.gw_company_locations_biz_name_uq;
drop index if exists public.gw_company_locations_biz_id_uq;
create unique index gw_company_locations_biz_name_uq on public.gw_company_locations (company_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create unique index gw_company_locations_biz_id_uq on public.gw_company_locations (company_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), location_id) where location_id is not null;
alter table public.gw_company_locations drop constraint if exists gw_company_locations_business_company_fkey;
alter table public.gw_company_locations
  add constraint gw_company_locations_business_company_fkey
  foreign key (group_id, company_id) references public.gw_business_companies (group_id, company_id) on delete cascade;

-- Area (Ha) of each location
alter table public.gw_company_locations add column if not exists area numeric(12,2);
alter table public.gw_company_locations drop constraint if exists gw_company_locations_area_check;
alter table public.gw_company_locations add constraint gw_company_locations_area_check check (area is null or area >= 0);

-- Who may read / change locations (Super Admin changes them)
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

notify pgrst, 'reload schema';

-- Check: each company and how many locations it has
select c.name, c.has_locations, (select count(*) from public.gw_company_locations l where l.company_id = c.id) as locations
  from public.gw_companies c
 order by c.sort_order, c.name;
