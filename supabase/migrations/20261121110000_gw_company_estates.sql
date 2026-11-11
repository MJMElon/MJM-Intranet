-- =====================================================================
-- Company 底下的 Estate（一家公司可以有几个 Estate，例如 MJM Plantation 1 / 2 / 3）
--  - 主画面区块的 Company 旁边多一个 Estate 下拉（只有多于一个 Estate 的公司才会出现）
--  - 开模块时把 Estate 名字一起带过去（gw_estate），Stock / Management Report 直接切到那个 Estate
--  - 只有一个 Estate 的公司什么都不用设
-- 可以重复执行。
-- =====================================================================

create table if not exists public.gw_company_estates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.gw_companies (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  short_name  text check (short_name is null or char_length(short_name) <= 40),
  area        numeric(12,2) check (area is null or area >= 0),
  area_unit   text not null default 'ha',
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists gw_company_estates_company_idx on public.gw_company_estates (company_id);

alter table public.gw_company_estates enable row level security;
revoke all on public.gw_company_estates from anon;
grant select, insert, update, delete on public.gw_company_estates to authenticated;

drop policy if exists gw_company_estates_select on public.gw_company_estates;
create policy gw_company_estates_select on public.gw_company_estates
  for select to authenticated using (true);

drop policy if exists gw_company_estates_write on public.gw_company_estates;
create policy gw_company_estates_write on public.gw_company_estates
  for all to authenticated
  using ((select public.gw_is_super_admin()))
  with check ((select public.gw_is_super_admin()));
