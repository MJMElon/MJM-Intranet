-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                            <<<
-- >>> NOT the Machinery Portal database (qcvbzzdbbqmnrljfnxjp)         <<<
-- Safe to run more than once.
-- =====================================================================
-- The DIESEL icon is called "Fuel Claims" and opens straight into
-- CMMS 2 → Fuel Manage → Fuel Claims.
update public.gw_modules
   set name = 'Fuel Claims',
       url  = 'https://mjmelon.github.io/MJM-Machinery-Portal/#/diesel/claims'
 where code = 'DIESEL';
select code, name, url from public.gw_modules where code in ('DIESEL', 'MACHINERY-PORTAL') order by code;
