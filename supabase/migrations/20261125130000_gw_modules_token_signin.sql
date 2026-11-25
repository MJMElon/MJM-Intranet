-- =====================================================================
-- Plantation Operation (STOCK), Management Report and Mantap sign people in
-- with the Intranet's 60-second token (access level 2). They were seeded as
-- plain links (level 1), so the Intranet opened them without any token and
-- the modules showed "not signed in". Also points them at the MJM-PORT site.
-- Can be run again.
-- =====================================================================
update public.gw_modules
   set access_level = 2,
       url = replace(url, 'oliviawsc.github.io/plantationstockmanagementsystem/', 'oliviawsc.github.io/MJM-PORT/')
 where code in ('PORT', 'STOCK', 'MGMT_REPORT', 'MANTAP');
