-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- HQ 类型的 Business：gw_groups.all_companies = true
--   这个 Business 的人不用切换 Company：首页区块同时显示他被分到的所有 Company 的 App 和文件夹
--   （Master Manage → 编辑 Business → 勾「HQ — show all companies together」）
-- 可以重复执行。
-- =====================================================================

alter table public.gw_groups add column if not exists all_companies boolean not null default false;

select name, code, all_companies from public.gw_groups order by sort_order, name;
