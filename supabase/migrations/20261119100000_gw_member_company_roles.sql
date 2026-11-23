-- =====================================================================
-- 角色改成「按 Business ＋ Company」指派
--  - gw_member_companies.role_id：这个人在这个 Business 的这个 Company 是什么角色（null = 一般用户）
--  - 有效角色 = gw_profiles.role_id（全域，照旧可用）∪ 所有 gw_member_companies.role_id
--      · 在 (Business B, Company C) 指派的角色：拿到这个角色在 gw_role_businesses 里「Business B」那一列的功能，
--        以及角色的全域功能（can_view_user_group / can_view_audit / can_edit_module_name / can_manage_module_access）
--      · 功能仍然以 Business 为范围；Company 现在只是记录和显示用（之后要缩到 Company 再加）
--  - super_admin 照旧：什么都可以
--  - 所有读 gw_my_role_id() 的函数 / policy 改成读 gw_my_role_ids_in(Business) / gw_my_role_ids()；签名不变
-- 可以重复执行（add column if not exists、create or replace、drop policy if exists）。
-- =====================================================================

alter table public.gw_member_companies
  add column if not exists role_id uuid references public.gw_roles (id) on delete set null;
create index if not exists gw_member_companies_role_idx on public.gw_member_companies (role_id);

-- ---------------------------------------------------------------------
-- 我的角色（集合）
-- ---------------------------------------------------------------------
-- 在某个 Business 里对我有效的角色：全域角色 ＋ 在这个 Business 任一 Company 指派的角色
create or replace function public.gw_my_role_ids_in(p_group uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.role_id
  from public.gw_profiles p
  where p.id = auth.uid() and p.status = 'active' and p.role = 'user' and p.role_id is not null
  union
  select mc.role_id
  from public.gw_member_companies mc
  join public.gw_profiles p on p.id = mc.user_id
  where mc.user_id = auth.uid() and mc.group_id = p_group and mc.role_id is not null
    and p.status = 'active' and p.role = 'user'
$$;
-- 我的全部角色（算全域功能用）
create or replace function public.gw_my_role_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.role_id
  from public.gw_profiles p
  where p.id = auth.uid() and p.status = 'active' and p.role = 'user' and p.role_id is not null
  union
  select mc.role_id
  from public.gw_member_companies mc
  join public.gw_profiles p on p.id = mc.user_id
  where mc.user_id = auth.uid() and mc.role_id is not null
    and p.status = 'active' and p.role = 'user'
$$;
revoke execute on function public.gw_my_role_ids_in(uuid), public.gw_my_role_ids() from public, anon;
grant execute on function public.gw_my_role_ids_in(uuid), public.gw_my_role_ids() to authenticated;

-- 全域功能：任一角色有就算有
create or replace function public.gw__my_role_flag(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gw_roles r
    where r.id in (select public.gw_my_role_ids()) and (to_jsonb(r) ->> p_flag)::boolean
  )
$$;
-- 在某个 Business 有没有某项功能
create or replace function public.gw__my_biz_flag(p_group uuid, p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gw_role_businesses rb
    where rb.group_id = p_group
      and rb.role_id in (select public.gw_my_role_ids_in(p_group))
      and (to_jsonb(rb) ->> p_flag)::boolean
  )
$$;
-- 在任何 Business 有某项功能
create or replace function public.gw__my_any_biz_flag(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gw_role_businesses rb
    where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id)) and (to_jsonb(rb) ->> p_flag)::boolean
  )
$$;
-- 角色对某个人的某个模块有某项功能：对方在角色负责的 Business 里，而且那个 Business 有这个模块
create or replace function public.gw__role_module_perm(p_user uuid, p_module uuid, p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gw_role_businesses rb
    join public.gw_group_modules gx on gx.group_id = rb.group_id and gx.module_id = p_module
    join public.gw_group_members gm on gm.group_id = rb.group_id and gm.user_id = p_user
    where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id)) and (to_jsonb(rb) ->> p_flag)::boolean
  )
$$;

create or replace function public.gw_manages_business(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or exists (
      select 1 from public.gw_role_businesses rb
      where rb.group_id = p_group and rb.role_id in (select public.gw_my_role_ids_in(p_group))
    )
$$;

create or replace function public.gw_role_manages_module_access(p_module uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw__my_role_flag('can_manage_module_access')
    and exists (
      select 1 from public.gw_role_businesses rb
      join public.gw_group_modules gx on gx.group_id = rb.group_id and gx.module_id = p_module
      where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id))
    )
$$;

create or replace function public.gw_my_admin_module_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mm.module_id
  from public.gw_module_members mm
  where mm.user_id = auth.uid() and mm.is_admin
    and mm.module_id in (select public.gw__effective_module_ids(auth.uid()))
  union
  select gx.module_id
  from public.gw_role_businesses rb
  join public.gw_group_modules gx on gx.group_id = rb.group_id
  where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id)) and public.gw__my_role_flag('can_manage_module_access')
$$;

create or replace function public.gw_my_managed_module_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gx.module_id
  from public.gw_role_businesses rb
  join public.gw_group_modules gx on gx.group_id = rb.group_id
  where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id))
    and (rb.can_grant_module or rb.can_revoke_module or rb.can_set_module_admin)
  union
  select public.gw_my_admin_module_ids()
$$;

create or replace function public.gw_manages_any()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or exists (
      select 1 from public.gw_role_businesses rb
      where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id))
        and (rb.can_post_notice or rb.can_delete_notice or rb.can_grant_module or rb.can_revoke_module
             or rb.can_set_module_admin or rb.can_add_business_user or rb.can_remove_business_user or rb.can_view_users)
    )
    or exists (
      select 1 from public.gw_roles r
      where r.id in (select public.gw_my_role_ids())
        and (r.can_view_user_group or r.can_view_audit or r.can_edit_module_name or r.can_manage_module_access)
    )
    or exists (select 1 from public.gw_my_admin_module_ids())
$$;

create or replace function public.gw_can_view_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user = auth.uid()
    or public.gw_is_super_admin()
    or public.gw__my_any_biz_flag('can_add_business_user')
    or exists (
      select 1
      from public.gw_role_businesses rb
      join public.gw_group_members gm on gm.group_id = rb.group_id and gm.user_id = p_user
      where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id))
        and (rb.can_view_users or rb.can_remove_business_user or rb.can_grant_module or rb.can_revoke_module or rb.can_set_module_admin
             or public.gw__my_role_flag('can_view_user_group') or public.gw__my_role_flag('can_manage_module_access'))
    )
    or (
      exists (select 1 from public.gw_my_admin_module_ids())
      and exists (
        select 1
        from public.gw_group_members mine
        join public.gw_group_members theirs on theirs.group_id = mine.group_id and theirs.user_id = p_user
        where mine.user_id = auth.uid()
      )
    )
$$;

-- 以下这些只透过 gw__my_biz_flag / gw__role_module_perm 判断，重建一次确保用到新版本
create or replace function public.gw_can_manage_group_member(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or (
      p_user <> auth.uid()
      and public.gw__my_biz_flag(p_group, 'can_add_business_user')
      and not exists (select 1 from public.gw_profiles t where t.id = p_user and t.role = 'super_admin')
    )
$$;

create or replace function public.gw_can_remove_group_member(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or (
      p_user <> auth.uid()
      and public.gw__my_biz_flag(p_group, 'can_remove_business_user')
      and not exists (select 1 from public.gw_profiles t where t.id = p_user and t.role = 'super_admin')
    )
$$;

create or replace function public.gw_can_manage_module_member(p_user uuid, p_module uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or (
      p_user <> auth.uid()
      and not exists (select 1 from public.gw_profiles t where t.id = p_user and t.role = 'super_admin')
      and (public.gw__role_module_perm(p_user, p_module, 'can_grant_module') or public.gw__module_admin_reaches(p_user, p_module))
    )
$$;

create or replace function public.gw_can_revoke_module_member(p_user uuid, p_module uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or (
      p_user <> auth.uid()
      and not exists (select 1 from public.gw_profiles t where t.id = p_user and t.role = 'super_admin')
      and (public.gw__role_module_perm(p_user, p_module, 'can_revoke_module') or public.gw__module_admin_reaches(p_user, p_module))
    )
$$;

create or replace function public.gw_can_set_module_admin(p_user uuid, p_module uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.gw_is_super_admin()
    or (
      p_user <> auth.uid()
      and not exists (select 1 from public.gw_profiles t where t.id = p_user and t.role = 'super_admin')
      and public.gw__role_module_perm(p_user, p_module, 'can_set_module_admin')
    )
$$;

create or replace function public.gw_can_post_notice(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin() or (p_group is not null and public.gw__my_biz_flag(p_group, 'can_post_notice'))
$$;
create or replace function public.gw_can_delete_notice(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin() or (p_group is not null and public.gw__my_biz_flag(p_group, 'can_delete_notice'))
$$;

create or replace function public.gw_rename_module(p_module uuid, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.gw_is_super_admin()
    or (public.gw__my_role_flag('can_edit_module_name')
        and exists (
          select 1 from public.gw_role_businesses rb
          join public.gw_group_modules gx on gx.group_id = rb.group_id and gx.module_id = p_module
          where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id))))
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'gw: name required' using errcode = '22023';
  end if;
  update public.gw_modules set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), '') where id = p_module;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- 角色：每个人看得到自己（任何一个）角色的设定
drop policy if exists gw_roles_select on public.gw_roles;
create policy gw_roles_select on public.gw_roles
  for select to authenticated
  using ((select public.gw_is_super_admin()) or id in (select public.gw_my_role_ids()));
drop policy if exists gw_role_businesses_select on public.gw_role_businesses;
create policy gw_role_businesses_select on public.gw_role_businesses
  for select to authenticated
  using ((select public.gw_is_super_admin()) or role_id in (select public.gw_my_role_ids()));

-- 模块：看得到自己能用的、管得到的、负责的 Business 里的（有改名权限时）
drop policy if exists gw_modules_select on public.gw_modules;
create policy gw_modules_select on public.gw_modules
  for select to authenticated
  using (
    (select public.gw_is_super_admin())
    or id in (select public.gw_my_module_ids())
    or id in (select public.gw_my_managed_module_ids())
    or (
      (select public.gw__my_role_flag('can_edit_module_name'))
      and exists (
        select 1 from public.gw_role_businesses rb
        join public.gw_group_modules gx on gx.group_id = rb.group_id and gx.module_id = gw_modules.id
        where rb.role_id in (select public.gw_my_role_ids_in(rb.group_id))
      )
    )
  );

-- 改 Company 列的角色：能加人进这个 Business 的人（和 super_admin）
drop policy if exists gw_member_companies_update on public.gw_member_companies;
create policy gw_member_companies_update on public.gw_member_companies
  for update to authenticated
  using ((select public.gw_can_manage_group_member(group_id, user_id)))
  with check ((select public.gw_can_manage_group_member(group_id, user_id)));
