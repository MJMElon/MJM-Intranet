-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- >>> NOT the Machinery Portal database (qcvbzzdbbqmnrljfnxjp)       <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
--
-- 用程式码接入其他系统（不用在 Master Manage → Module 里按）
-- gw_register_system(...)：一次完成「新增 / 更新 Icon、设定 API Key、标签 Business / Company」。
-- 每个要接入的系统（repo）在这个资料夹放一个小小的 migration，呼叫这个函数即可，
-- 例如 20261120100100_system_machinery_portal.sql。
--
-- 参数
--   p_code          Icon 代码（固定不变，例如 'MACHINERY-PORTAL'）
--   p_name          Icon 名称
--   p_url           网址（kind = link：完整 https://…；kind = system：本站路径，例如 diesel/index.html）
--   p_icon          图示（core.js 的 MODULE_ICONS：app-window、fuel、truck、tractor、wrench、…）
--   p_description   说明（可空）
--   p_category      分类（可空）
--   p_access_level  1 = 外部链接，2 = Token 跳转（目标系统用 API Key 兑换），3 = SSO
--   p_kind          'system'（会出现在 Master Manage → Module，可以标签 Business / Company、逐个用户开权限；
--                   其他 repo 的系统也用这个，例如 Stock、Mantap）或 'link'（纯外部网站）
--   p_open_mode     'new_tab' 或 'same_tab'
--   p_api_key       Token 跳转用的 API Key 明文（例如 'gwk_…'，自己决定，至少 24 个字）；
--                   资料库只存 SHA-256；同一把 key 要放进目标系统（Machinery 项目）的 GW_API_KEY secret。
--                   null = 不改动现有的 key
--   p_businesses    要标签的 Business 名称（gw_groups.name）；null = 不改动
--   p_companies     要标签的 Company 代码（gw_companies.code）；null = 不改动
--   p_sort_order    主画面排序
-- 标签只会「加上」，不会移除已有的（Sector、负责人等设定保留）；要移除请在 Master Manage 里做。
-- 回传 Icon 的 id。可以重复执行（upsert）。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- 旧版本（p_access_level smallint）先移除，否则会变成两个同名函数
drop function if exists public.gw_register_system(text, text, text, text, text, text, smallint, text, text, text, text[], text[]);
drop function if exists public.gw_register_system(text, text, text, text, text, text, integer, text, text, text, text[], text[], integer);

create or replace function public.gw_register_system(
  p_code          text,
  p_name          text,
  p_url           text,
  p_icon          text default 'app-window',
  p_description   text default null,
  p_category      text default null,
  p_access_level  integer default 1,
  p_kind          text default 'system',
  p_open_mode     text default 'new_tab',
  p_api_key       text default null,
  p_businesses    text[] default null,
  p_companies     text[] default null,
  p_sort_order    integer default 50
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module uuid;
  v_missing text;
begin
  -- 只有 super_admin（网页 / RPC）或没有登录者的 SQL Editor / migration 可以执行
  if auth.uid() is not null and not public.gw_is_super_admin() then
    raise exception 'gw_register_system: super_admin only' using errcode = '42501';
  end if;
  if p_api_key is not null and char_length(p_api_key) < 24 then
    raise exception 'gw_register_system: p_api_key must be at least 24 characters';
  end if;

  insert into public.gw_modules (code, name, icon, url, description, category, access_level, open_mode, kind, sort_order, is_active)
  values (p_code, p_name, coalesce(p_icon, 'app-window'), p_url, p_description, p_category,
          coalesce(p_access_level, 1), coalesce(p_open_mode, 'new_tab'), coalesce(p_kind, 'system'), coalesce(p_sort_order, 50), true)
  on conflict (code) do update
    set name         = excluded.name,
        icon         = excluded.icon,
        url          = excluded.url,
        description  = excluded.description,
        category     = excluded.category,
        access_level = excluded.access_level,
        open_mode    = excluded.open_mode,
        kind         = excluded.kind,
        sort_order   = excluded.sort_order,
        is_active    = true
  returning id into v_module;

  -- API Key：只存 hash（和 gw-admin「产生 API Key」存的格式一样）
  if p_api_key is not null then
    insert into public.gw_module_api_keys (module_id, key_hash, key_prefix, created_at)
    values (v_module, encode(extensions.digest(p_api_key, 'sha256'), 'hex'), left(p_api_key, 10), now())
    on conflict (module_id) do update
      set key_hash = excluded.key_hash, key_prefix = excluded.key_prefix, created_at = now();
  end if;

  -- Business 标签（名称一定要存在，打错会直接报错，不会默默跳过）
  if p_businesses is not null then
    select string_agg(b, ', ') into v_missing
      from unnest(p_businesses) b where not exists (select 1 from public.gw_groups g where g.name = b);
    if v_missing is not null then
      raise exception 'gw_register_system: business not found: %', v_missing;
    end if;
    insert into public.gw_group_modules (group_id, module_id)
    select g.id, v_module from public.gw_groups g where g.name = any (p_businesses)
    on conflict do nothing;
  end if;

  -- Company 标签（用 Company 代码）
  if p_companies is not null then
    select string_agg(c, ', ') into v_missing
      from unnest(p_companies) c where not exists (select 1 from public.gw_companies x where x.code = c);
    if v_missing is not null then
      raise exception 'gw_register_system: company code not found: %', v_missing;
    end if;
    insert into public.gw_module_companies (module_id, company_id)
    select v_module, x.id from public.gw_companies x where x.code = any (p_companies)
    on conflict do nothing;
  end if;

  perform public.gw__write_audit(auth.uid(), 'register', 'modules', v_module::text, p_code, null,
    jsonb_build_object('code', p_code, 'name', p_name, 'url', p_url, 'access_level', p_access_level,
                       'kind', p_kind, 'api_key_set', p_api_key is not null,
                       'businesses', p_businesses, 'companies', p_companies));
  return v_module;
end;
$$;

revoke all on function public.gw_register_system(text, text, text, text, text, text, integer, text, text, text, text[], text[], integer)
  from public, anon;
grant execute on function public.gw_register_system(text, text, text, text, text, text, integer, text, text, text, text[], text[], integer)
  to authenticated;
