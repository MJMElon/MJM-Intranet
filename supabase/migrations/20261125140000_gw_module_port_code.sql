-- =====================================================================
-- The Plantation Operation icon's code becomes PORT (it was STOCK from the
-- days when the system was only the stock app). Nothing else keys on the
-- code: the API key, access tags and open history hang off the module id.
-- Can be run again.
-- =====================================================================
update public.gw_modules set code = 'PORT' where code = 'STOCK';
