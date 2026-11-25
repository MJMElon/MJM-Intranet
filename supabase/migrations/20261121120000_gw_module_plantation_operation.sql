-- =====================================================================
-- Intranet 的 Stock 图示改成 Plantation Operation 门户
--   按进去先看到 Plantation Operation 首页（Stock、Management Report 等模块按钮），
--   按 Stock 才进现在的 Stock 系统。代码仍是 STOCK（API key、权限都不用动）。
-- 可以重复执行。
-- =====================================================================

update public.gw_modules
   set name        = 'Plantation Operation',
       icon        = 'tractor',
       url         = 'https://oliviawsc.github.io/plantationstockmanagementsystem/',
       description = 'Plantation Operation portal: Stock, Management Report and the other estate modules',
       category    = 'Plantation'
 where code in ('PORT', 'STOCK');
