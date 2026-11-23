-- =====================================================================
-- Super Admin 永远拥有全部模块（包括以后新增的）
--  gw__effective_module_ids 是所有「这个人能用哪些模块」判断的源头：
--  首页 gw_get_home、模块 RLS、gw_user_can_access（发 token / 检查权限）都用它。
--  现在：状态是 active 的 super_admin → 回传所有启用中的模块，不需要 gw_module_members，也不需要在任何 Business 里。
--  其他人照旧：要被开权限（gw_module_members）＋ 所属 Business 有标这个模块（gw_group_modules）。
-- 只改函数，不改动任何资料。
-- =====================================================================
create or replace function public.gw__effective_module_ids(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.gw_modules m
  join public.gw_profiles p on p.id = p_user and p.status = 'active'
  where m.is_active
    and (
      p.role = 'super_admin'
      or (
        exists (
          select 1 from public.gw_module_members mm
          where mm.user_id = p_user and mm.module_id = m.id
        )
        and exists (
          select 1
          from public.gw_group_members gm
          join public.gw_group_modules gx on gx.group_id = gm.group_id
          where gm.user_id = p_user and gx.module_id = m.id
        )
      )
    )
$$;
