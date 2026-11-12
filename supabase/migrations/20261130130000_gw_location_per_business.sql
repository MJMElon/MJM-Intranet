-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261129100100 (company locations) and 20261130120000 (optional ID) first.
-- =====================================================================
-- Location 按「公司 × Business」：同一家公司在不同 Business 可以有不同的 Location
--  - gw_company_locations.group_id：这个 Location 属于哪个 Business
--  - 旧资料：公司只属于一个 Business 的，自动填那个 Business；属于多个的先留空，在公司编辑窗里挑好再存
--  - 公司从某个 Business 拿掉时，那个 Business 的 Location 一起删
--  - 名称 / Location ID 在同一家公司、同一个 Business 里不能重复
-- 可以重复执行。
-- =====================================================================

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

select c.name as company, g.name as business, l.location_id, l.name as location
  from public.gw_company_locations l
  join public.gw_companies c on c.id = l.company_id
  left join public.gw_groups g on g.id = l.group_id
 order by c.name, g.name, l.sort_order, l.name;
