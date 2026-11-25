-- =====================================================================
-- The Plantation Operation repo was renamed (plantationstockmanagementsystem
-- → MJM-PORT), so its GitHub Pages address changed. Point every Intranet
-- icon that opened the old address at the new one. Can be run again.
-- =====================================================================
update public.gw_modules
   set url = replace(url, 'oliviawsc.github.io/plantationstockmanagementsystem/', 'oliviawsc.github.io/MJM-PORT/')
 where url like '%oliviawsc.github.io/plantationstockmanagementsystem/%';
