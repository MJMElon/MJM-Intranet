-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- >>> NOT the Machinery Portal database (qcvbzzdbbqmnrljfnxjp)       <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Run 20261120100000_gw_register_system.sql and …100100_system_machinery_portal.sql first.
-- =====================================================================
--
-- Diesel Claims 搬到 CMMS 2（repo MJM-Machinery-Portal，Diesel Manage 模块）。
--  - Intranet 上原本的「Diesel Claims」Icon（code DIESEL）改名「Diesel Manage」，
--    点下去直接进入 CMMS 2 的 Diesel Manage 页面（Token 跳转，同一个分页，不用再登录）。
--    它有自己的 API Key：同一串字要放进 Machinery 项目的 secret GW_API_KEY_DIESEL。
--  - Machinery Portal Icon 改名「CMMS 2」，同一个分页打开（不再出现 about:blank 等待）。
--  - 旧的 diesel_* 资料表保留，不再使用（之后确定不要了再另外删）。
--
-- 执行前改：v_diesel_key（和 Machinery 项目的 GW_API_KEY_DIESEL 一样，至少 24 个字）。
-- =====================================================================

do $$
declare
  v_diesel_key text   := 'CHANGE-ME-gwk_put-a-long-random-string-here';
  v_businesses text[] := null;   -- 例如 array['Plantation']；null = 保留现有标签
begin
  if v_diesel_key like 'CHANGE-ME%' then
    raise exception 'Please set v_diesel_key first (and put the same value in the Machinery project''s GW_API_KEY_DIESEL secret).';
  end if;

  perform public.gw_register_system(
    p_code         => 'DIESEL',
    p_name         => 'Diesel Manage',
    p_url          => 'https://mjmelon.github.io/MJM-Machinery-Portal/#/diesel',
    p_icon         => 'fuel',
    p_description  => 'Vehicles, cash fuel claims, fleet cards and reports (inside CMMS 2)',
    p_category     => 'Fleet',
    p_access_level => 2,
    p_kind         => 'system',
    p_open_mode    => 'same_tab',
    p_api_key      => v_diesel_key,
    p_businesses   => v_businesses,
    p_companies    => null,
    p_sort_order   => 24
  );

  perform public.gw_register_system(
    p_code         => 'MACHINERY-PORTAL',
    p_name         => 'CMMS 2',
    p_url          => 'https://mjmelon.github.io/MJM-Machinery-Portal/',
    p_icon         => 'wrench',
    p_description  => 'Machinery Manage (maintenance cases, machinery profile, suppliers) and Diesel Manage',
    p_category     => 'Machinery',
    p_access_level => 2,
    p_kind         => 'system',
    p_open_mode    => 'same_tab',
    p_api_key      => null,        -- keep the existing key
    p_businesses   => null,
    p_companies    => null,
    p_sort_order   => 23
  );
end $$;

select m.code, m.name, m.url, m.access_level, m.open_mode, k.key_prefix
  from public.gw_modules m left join public.gw_module_api_keys k on k.module_id = m.id
 where m.code in ('DIESEL', 'MACHINERY-PORTAL') order by m.code;
