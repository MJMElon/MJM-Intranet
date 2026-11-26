-- Opispro Location ID of a company that has no multiple locations (the company
-- itself is its one location, e.g. a head office / direct company).
-- Admin → Master Manage → Company → Business Details, shown when "multiple
-- locations" is not ticked. Sent to modules (Plantation Operation) with the
-- company, like each location's own Location ID.
-- Safe to run more than once.
alter table public.gw_companies add column if not exists location_id text;
alter table public.gw_companies drop constraint if exists gw_companies_location_id_len;
alter table public.gw_companies add constraint gw_companies_location_id_len check (location_id is null or char_length(location_id) <= 40);
