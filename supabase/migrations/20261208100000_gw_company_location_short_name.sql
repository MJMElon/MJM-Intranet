-- Location short name (Admin → Company → Locations), e.g. "SGR" for "Sg Rait".
-- Shown where space is tight, e.g. Plantation Operation → Worker list.
-- Safe to run more than once.
alter table public.gw_company_locations add column if not exists short_name text;
alter table public.gw_company_locations drop constraint if exists gw_company_locations_short_name_len;
alter table public.gw_company_locations add constraint gw_company_locations_short_name_len check (short_name is null or char_length(short_name) <= 20);
