-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- >>> NOT the Machinery Portal database (qcvbzzdbbqmnrljfnxjp)       <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Run 20261120100000_gw_register_system.sql first.
-- =====================================================================
--
-- 接入 Machinery Portal（CMMS 2 ＋ Diesel Manage；repo MJM-Machinery-Portal）
--
-- 执行前改两个地方：
--   1. v_api_key：换成你自己的一串随机字（至少 24 个字，例如 gwk_ 开头）。
--      同一串字要放进 Machinery 项目：Supabase → Edge Functions → Secrets → GW_API_KEY。
--      之后要换 key：改这里再跑一次，并同时改 Machinery 的 secret。
--   2. v_businesses：哪些 Business 看得到这个 Icon（名称要和 Master Manage → Business 一样）。
--      null = 先不标签（之后在 Master Manage 里勾也可以）。
-- 之后 User & Group Manage → Module access 勾 Access 给要用的人。
-- =====================================================================

do $$
declare
  v_api_key    text   := 'CHANGE-ME-gwk_put-a-long-random-string-here';
  v_businesses text[] := null;   -- 例如 array['Plantation', 'Machinery']
  v_id uuid;
begin
  if v_api_key like 'CHANGE-ME%' then
    raise exception 'Please set v_api_key first (and put the same value in the Machinery project''s GW_API_KEY secret).';
  end if;

  v_id := public.gw_register_system(
    p_code         => 'MACHINERY-PORTAL',
    p_name         => 'Machinery Portal',
    p_url          => 'https://mjmelon.github.io/MJM-Machinery-Portal/',
    p_icon         => 'wrench',
    p_description  => 'CMMS 2 (maintenance cases, machinery profile, suppliers) and Diesel Manage',
    p_category     => 'Machinery',
    p_access_level => 2,          -- Token 跳转：Portal 用 GW_API_KEY 兑换 60 秒 Token，无需再登录
    p_kind         => 'system',      -- 和 Stock / Mantap 一样：出现在 Master Manage → Module，可标签、逐个用户开权限
    p_open_mode    => 'new_tab',
    p_api_key      => v_api_key,
    p_businesses   => v_businesses,
    p_companies    => null,
    p_sort_order   => 23
  );
  raise notice 'Machinery Portal registered as module %', v_id;
end $$;

-- 确认：Icon、API Key 前缀、Business 标签
select m.code, m.name, m.url, m.access_level, m.kind, k.key_prefix,
       (select string_agg(g.name, ', ') from public.gw_group_modules gm join public.gw_groups g on g.id = gm.group_id where gm.module_id = m.id) as businesses
  from public.gw_modules m
  left join public.gw_module_api_keys k on k.module_id = m.id
 where m.code = 'MACHINERY-PORTAL';
