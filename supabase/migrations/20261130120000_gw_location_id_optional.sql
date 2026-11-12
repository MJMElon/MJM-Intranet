-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- Opispro Location ID 先可以空着（之后接旧系统时再填）；有填的话同一家公司不能重复。
-- 可以重复执行。
-- =====================================================================

alter table public.gw_company_locations alter column location_id drop not null;
alter table public.gw_company_locations drop constraint if exists gw_company_locations_location_id_check;
alter table public.gw_company_locations
  add constraint gw_company_locations_location_id_check check (location_id is null or char_length(btrim(location_id)) between 1 and 40);

select count(*) as locations_without_id from public.gw_company_locations where location_id is null;
