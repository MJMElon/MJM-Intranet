-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261119100000_gw_member_company_roles.sql first.
-- =====================================================================
-- 模块权限改成「按 Business」
--  以前：gw_module_members (user_id, module_id) 一个人对一个模块只有一行，不分 Business。
--        所以把人加进另一个有同样模块的 Business，他在那里马上就能用那个模块。
--  现在：gw_module_members 多一栏 group_id，一行 = 这个人在这个 Business 可以用这个模块。
--        把人加进 Business 只是进 Business；要在那个 Business 的「+ Add module」另外开，他才看得到那个 Icon。
--        is_admin 也是按 Business：在这个 Business 是这个模块的管理员，才能在这个 Business 开 / 收回别人的权限。
--  旧资料：每一行搬成「他所属、而且有这个模块的每个 Business」各一行（现有的人照旧能用，什么都不会少）。
--        没有任何 Business 对得上的旧行本来就没有作用，一并清掉。
--  谁能开 / 收回 / 设 Admin（同一套规则在 RLS 和画面上）：
--        super_admin；角色在这个 Business 有 can_grant_module / can_revoke_module / can_set_module_admin；
--        或在这个 Business 是这个模块的管理员（开 / 收回）。
-- 可以重复执行。
-- =====================================================================

-- 1. 多一栏 group_id，旧资料搬过去
alter table public.gw_module_members add column if not exists group_id uuid references public.gw_groups (id) on delete cascade;
alter table public.gw_module_members drop constraint if exists gw_module_members_pkey;

insert into public.gw_module_members (user_id, module_id, group_id, is_admin, created_at)
select mm.user_id, mm.module_id, gm.group_id, mm.is_admin, mm.created_at
  from public.gw_module_members mm
  join public.gw_group_members gm on gm.user_id = mm.user_id
  join public.gw_group_modules gx on gx.group_id = gm.group_id and gx.module_id = mm.module_id
 where mm.group_id is null
   and not exists (
     select 1 from public.gw_module_members x
      where x.user_id = mm.user_id and x.module_id = mm.module_id and x.group_id = gm.group_id
   );

delete from public.gw_module_members where group_id is null;

alter table public.gw_module_members alter column group_id set not null;
alter table public.gw_module_members add primary key (user_id, module_id, group_id);
-- 移出 Business 时，他在那个 Business 的模块权限一起消失
alter table public.gw_module_members drop constraint if exists gw_module_members_group_member_fkey;
alter table public.gw_module_members
  add constraint gw_module_members_group_member_fkey
  foreign key (group_id, user_id) references public.gw_group_members (group_id, user_id) on delete cascade;
create index if not exists gw_module_members_group_idx on public.gw_module_members (group_id, module_id);

-- 2. 这个人能用哪些模块（首页、token、RLS 的源头）：
--    super_admin 全部；其他人 = 在某个 Business 被开了这个模块，而且那个 Business 有这个模块
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
      or exists (
        select 1
        from public.gw_module_members mm
        join public.gw_group_members gm on gm.group_id = mm.group_id and gm.user_id = mm.user_id
        join public.gw_group_modules gx on gx.group_id = mm.group_id and gx.module_id = mm.module_id
        where mm.user_id = p_user and mm.module_id = m.id
      )
    )
$$;

-- 3. 在某个 Business 里，我能不能动这个人这个模块的权限
-- 我在这个 Business 是这个模块的管理员
create or replace function public.gw__module_admin_in(p_group uuid, p_module uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gw_module_members mm
    where mm.user_id = auth.uid() and mm.module_id = p_module and mm.group_id = p_group and mm.is_admin
  )
$$;

-- 对方在这个 Business、这个 Business 有这个模块、对方不是自己也不是 super_admin
create or replace function public.gw__module_target_ok(p_user uuid, p_module uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user <> auth.uid()
    and not exists (select 1 from public.gw_profiles t where t.id = p_user and t.role = 'super_admin')
    and exists (select 1 from public.gw_group_members gm where gm.group_id = p_group and gm.user_id = p_user)
    and exists (select 1 from public.gw_group_modules gx where gx.group_id = p_group and gx.module_id = p_module)
$$;

create or replace function public.gw_can_manage_module_member(p_user uuid, p_module uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
    or (
      public.gw__module_target_ok(p_user, p_module, p_group)
      and (public.gw__my_biz_flag(p_group, 'can_grant_module') or public.gw__module_admin_in(p_group, p_module))
    )
$$;

create or replace function public.gw_can_revoke_module_member(p_user uuid, p_module uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
    or (
      public.gw__module_target_ok(p_user, p_module, p_group)
      and (public.gw__my_biz_flag(p_group, 'can_revoke_module') or public.gw__module_admin_in(p_group, p_module))
    )
$$;

create or replace function public.gw_can_set_module_admin(p_user uuid, p_module uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
    or (
      public.gw__module_target_ok(p_user, p_module, p_group)
      and public.gw__my_biz_flag(p_group, 'can_set_module_admin')
    )
$$;

revoke all on function
  public.gw__module_admin_in(uuid, uuid), public.gw__module_target_ok(uuid, uuid, uuid),
  public.gw_can_manage_module_member(uuid, uuid, uuid), public.gw_can_revoke_module_member(uuid, uuid, uuid),
  public.gw_can_set_module_admin(uuid, uuid, uuid)
from public, anon;
grant execute on function
  public.gw__module_admin_in(uuid, uuid), public.gw__module_target_ok(uuid, uuid, uuid),
  public.gw_can_manage_module_member(uuid, uuid, uuid), public.gw_can_revoke_module_member(uuid, uuid, uuid),
  public.gw_can_set_module_admin(uuid, uuid, uuid)
to authenticated;

-- 4. RLS：按 (人, 模块, Business) 检查
drop policy if exists gw_module_members_insert on public.gw_module_members;
create policy gw_module_members_insert on public.gw_module_members
  for insert to authenticated
  with check (
    (select public.gw_can_manage_module_member(user_id, module_id, group_id))
    and (not is_admin or (select public.gw_can_set_module_admin(user_id, module_id, group_id)))
  );
drop policy if exists gw_module_members_update on public.gw_module_members;
create policy gw_module_members_update on public.gw_module_members
  for update to authenticated
  using ((select public.gw_can_set_module_admin(user_id, module_id, group_id)))
  with check ((select public.gw_can_set_module_admin(user_id, module_id, group_id)));
drop policy if exists gw_module_members_delete on public.gw_module_members;
create policy gw_module_members_delete on public.gw_module_members
  for delete to authenticated
  using (
    (select public.gw_can_revoke_module_member(user_id, module_id, group_id))
    and (not is_admin or (select public.gw_can_set_module_admin(user_id, module_id, group_id)))
  );

-- 确认：每个人在哪个 Business 有哪些模块
select p.full_name, g.name as business, m.name as module, mm.is_admin
  from public.gw_module_members mm
  join public.gw_profiles p on p.id = mm.user_id
  join public.gw_groups g on g.id = mm.group_id
  join public.gw_modules m on m.id = mm.module_id
 order by p.full_name, g.name, m.name;
