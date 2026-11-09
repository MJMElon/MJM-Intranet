-- 贴到 Supabase SQL Editor 执行。里面有两段，各自独立：
--   1) AI Connector（20261116）：只能执行一次（已执行过的请跳过这一段，否则会报 already exists）
--   2) Super Admin 全模块（20261118）：可以重复执行
--   3) 角色按 Business ＋ Company 指派（20261119）：可以重复执行
--   4) 谁可以删除 Business / Company / 模块（20261121）：可以重复执行
-- 只是新增 / 覆盖函数，不会改动或删除现有资料。

-- ============ 20261116100000_gw_mcp ============
-- =====================================================================
-- AI Connector（让用户用自己的 AI 助手连到公司资料）
--  - gw_settings：全站开关（super_admin 在 Master 里开关），目前只有 ai_connector
--  - gw_mcp_tokens：每个用户自己的连接链接（只存杂凑值，原文只在建立时给用户看一次）
--  - gw_mcp_create / gw_mcp_list / gw_mcp_revoke：用户在 Settings 里建立、查看、撤销；super_admin 可看全部、撤销全部
--  - gw_mcp_resolve：只给 Edge Function（service_role）用：链接 → 用户；停用的用户、已撤销、开关关闭都回传空
-- 只新增，不改动任何现有资料表。
-- =====================================================================

create table public.gw_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.gw_profiles (id) on delete set null
);
alter table public.gw_settings enable row level security;
create policy gw_settings_read on public.gw_settings for select to authenticated using (true);
create policy gw_settings_write on public.gw_settings for all to authenticated
  using ((select public.gw_is_super_admin())) with check ((select public.gw_is_super_admin()));

create function public.gw_mcp_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value ->> 'enabled')::boolean from public.gw_settings where key = 'ai_connector'), false)
$$;
revoke execute on function public.gw_mcp_enabled() from public, anon;
grant execute on function public.gw_mcp_enabled() to authenticated, service_role;

create table public.gw_mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.gw_profiles (id) on delete cascade,
  token_hash   text not null unique,
  label        text not null default 'My AI',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index gw_mcp_tokens_user_idx on public.gw_mcp_tokens (user_id);
alter table public.gw_mcp_tokens enable row level security;
revoke all on public.gw_mcp_tokens from anon, authenticated;

-- 建立链接：回传 { id, token }；token 原文只在这里出现一次
create function public.gw_mcp_create(p_label text default 'My AI')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.gw_profiles where id = auth.uid() and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.gw_mcp_enabled() then
    raise exception 'connector_off' using errcode = 'P0001';
  end if;
  if (select count(*) from public.gw_mcp_tokens where user_id = auth.uid() and revoked_at is null) >= 5 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  v_token := 'gwm_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.gw_mcp_tokens (user_id, token_hash, label)
  values (auth.uid(), encode(sha256(convert_to(v_token, 'utf8')), 'hex'), left(coalesce(nullif(trim(p_label), ''), 'My AI'), 40))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;
revoke execute on function public.gw_mcp_create(text) from public, anon;
grant execute on function public.gw_mcp_create(text) to authenticated;

-- 自己的链接（super_admin 看全部）；不含杂凑值
create function public.gw_mcp_list()
returns table (id uuid, user_id uuid, user_name text, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.user_id, p.full_name, t.label, t.created_at, t.last_used_at, t.revoked_at
  from public.gw_mcp_tokens t
  join public.gw_profiles p on p.id = t.user_id
  where auth.uid() is not null and (t.user_id = auth.uid() or public.gw_is_super_admin())
  order by t.created_at desc
$$;
revoke execute on function public.gw_mcp_list() from public, anon;
grant execute on function public.gw_mcp_list() to authenticated;

create function public.gw_mcp_revoke(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gw_mcp_tokens
  set revoked_at = now()
  where id = p_id and revoked_at is null and auth.uid() is not null and (user_id = auth.uid() or public.gw_is_super_admin())
$$;
revoke execute on function public.gw_mcp_revoke(uuid) from public, anon;
grant execute on function public.gw_mcp_revoke(uuid) to authenticated;

-- Edge Function 用：杂凑值 → 用户 id（无效、已撤销、用户停用、开关关闭都回传空）
create function public.gw_mcp_resolve(p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_user uuid;
  v_last timestamptz;
begin
  select t.id, t.user_id, t.last_used_at into v_id, v_user, v_last
  from public.gw_mcp_tokens t
  join public.gw_profiles p on p.id = t.user_id and p.status = 'active'
  where t.token_hash = p_hash and t.revoked_at is null;
  if v_id is null or not public.gw_mcp_enabled() then
    return null;
  end if;
  if v_last is null or v_last < now() - interval '1 minute' then
    update public.gw_mcp_tokens set last_used_at = now() where id = v_id;
  end if;
  return v_user;
end;
$$;
revoke execute on function public.gw_mcp_resolve(text) from public, anon, authenticated;
grant execute on function public.gw_mcp_resolve(text) to service_role;

-- ============ 20261118100000_gw_super_admin_all_modules ============
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

-- ============ 20261119100000_gw_member_company_roles（可以重复执行）============
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

-- ============ 20261121100000_gw_master_delete_rights（可以重复执行）============
-- =====================================================================
-- 谁可以删除 Business / Company / 模块（Master Manage）
--  - gw_profiles 多三个勾：can_delete_business、can_delete_company、can_delete_module
--    （super_admin 在 Admin Console 用户资料里勾；super_admin 自己永远可以）
--  - 三张主资料表各加一条「for delete」policy：勾了的人可以删
--  - gw_profiles_guard 已用白名单保护：一般用户改不了自己的这三栏
-- 可以重复执行。
-- =====================================================================

alter table public.gw_profiles
  add column if not exists can_delete_business boolean not null default false,
  add column if not exists can_delete_company  boolean not null default false,
  add column if not exists can_delete_module   boolean not null default false;

-- 我（登录的人）有没有某个删除权
create or replace function public.gw_my_delete_right(p_what text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_what
             when 'business' then p.can_delete_business
             when 'company'  then p.can_delete_company
             when 'module'   then p.can_delete_module
             else false
           end
    from public.gw_profiles p
    where p.id = auth.uid() and p.status = 'active'
  ), false);
$$;
revoke all on function public.gw_my_delete_right(text) from public;
grant execute on function public.gw_my_delete_right(text) to authenticated;

drop policy if exists gw_groups_delete_right on public.gw_groups;
create policy gw_groups_delete_right on public.gw_groups
  for delete to authenticated
  using ((select public.gw_my_delete_right('business')));

drop policy if exists gw_companies_delete_right on public.gw_companies;
create policy gw_companies_delete_right on public.gw_companies
  for delete to authenticated
  using ((select public.gw_my_delete_right('company')));

drop policy if exists gw_modules_delete_right on public.gw_modules;
create policy gw_modules_delete_right on public.gw_modules
  for delete to authenticated
  using ((select public.gw_my_delete_right('module')));
