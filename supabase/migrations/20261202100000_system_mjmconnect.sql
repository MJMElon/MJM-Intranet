-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- >>> NOT the MJMConnect database (hbxzbowkucpqlhxdomap)             <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Run 20261120100000_gw_register_system.sql first (already done if Machinery Portal is connected).
-- =====================================================================
--
-- 接入 MJMConnect（员工 App：请假、Estate 行程、日历；repo aiconnect33-sketch/mjmconnect-app）
--   - 代码 MJMCONNECT（Intranet 首页月历小工具用这个代码认出 MJMConnect 的权限，不要改）
--   - 标签 Business「HQ」：名称要和 Master Manage → Business 一样，否则会报错
--   - access_level 1 = 直接打开网址（MJMConnect 还没有接 Token 跳转，所以还要在那边登录）
--
-- 跑完之后（在网页里做，不用 SQL）：
--   1. Master Manage → Module → MJMConnect → Upload photo → 选 MJMConnect 的 logo → Save
--      （Icon 照片只能放在 Intranet 自己的储存，所以要从这里上传）
--   2. User & Group Manage → 给要用的人开 MJMConnect 的 Access
-- 可以重复执行。
-- =====================================================================

do $$
declare
  v_id uuid;
begin
  v_id := public.gw_register_system(
    p_code         => 'MJMCONNECT',
    p_name         => 'MJMConnect',
    p_url          => 'https://mjmconnect.opispro.com/',
    p_icon         => 'users',
    p_description  => 'Staff app: leave, estate trips and team calendar',
    p_category     => 'HR',
    p_access_level => 1,
    p_kind         => 'system',
    p_open_mode    => 'new_tab',
    p_api_key      => null,
    p_businesses   => array['HQ'],
    p_companies    => null,
    p_sort_order   => 5
  );
  raise notice 'MJMConnect registered as module %', v_id;
end $$;

-- 确认：Icon 和 Business 标签
select m.code, m.name, m.url, m.kind, m.is_active,
       (select string_agg(g.name, ', ') from public.gw_group_modules gm join public.gw_groups g on g.id = gm.group_id where gm.module_id = m.id) as businesses
  from public.gw_modules m
 where m.code = 'MJMCONNECT';
