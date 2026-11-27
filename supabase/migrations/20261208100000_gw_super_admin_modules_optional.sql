-- Super Admin 不再自动拥有每一个模块：跟一般人一样，要在自己的资料里勾 Access 才有
-- （他们仍然可以替任何人、包括自己，勾 / 取消模块；Super Admin 的其他权限不变）
-- 规则：模块启用中 + 有勾 Access + 那个人在这个 Business 里 + 模块有开给这个 Business
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
    and exists (
      select 1
      from public.gw_module_members mm
      join public.gw_group_members gm on gm.group_id = mm.group_id and gm.user_id = mm.user_id
      join public.gw_group_modules gx on gx.group_id = mm.group_id and gx.module_id = mm.module_id
      where mm.user_id = p_user and mm.module_id = m.id
    )
$$;

-- 检查：每个 Super Admin 现在有几个模块（0 = 还没勾，去 Admin → Users → 自己 勾要用的模块）
select p.full_name, count(e) as modules
  from public.gw_profiles p
  left join lateral public.gw__effective_module_ids(p.id) e on true
 where p.role = 'super_admin'
 group by p.full_name
 order by p.full_name;
