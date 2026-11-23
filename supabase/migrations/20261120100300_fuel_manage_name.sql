-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 「Diesel Manage」改名「Fuel Manage」（不是每家公司都用柴油）。Icon 代码、API Key、网址都不变。
update public.gw_modules
   set name = 'Fuel Manage',
       description = 'Vehicles, cash fuel claims, fleet cards and reports (inside CMMS 2)'
 where code = 'DIESEL';

select code, name, url from public.gw_modules where code in ('DIESEL', 'MACHINERY-PORTAL') order by code;
