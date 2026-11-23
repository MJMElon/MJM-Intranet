-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 模块权限改成「按 Business ＋ Company」
--  以前：一行 = 这个人在这个 Business 可以用这个模块（这个 Business 的每个 Company 都一样）
--  现在：gw_module_members 多一栏 company_id，一行 = 这个人在这个 Business 的这个 Company 可以用这个模块
--        同一个 Business，A 公司可以用、B 公司不能用 → 只开 A 那一行
--        company_id 空 = 这个 Business 没有 Company（或这个人还没被分到 Company）时的权限
--  旧资料：每一行展开成「这个人在那个 Business 的每个 Company」各一行（模块有标 Company 的，只开给标到的 Company）
--        → 现在能用的照旧能用，什么都不会少
--  这个人被移出某个 Company 时，他在那个 Company 的模块权限一起消失
--  谁能开 / 收回 / 设 Admin：规则不变（按 Business）
-- 可以重复执行。
-- =====================================================================

alter table public.gw_module_members add column if not exists company_id uuid;

-- 一行一个（人、模块、Business、Company）
alter table public.gw_module_members drop constraint if exists gw_module_members_pkey;

-- 旧的「整个 Business」权限 → 展开到这个人在那个 Business 的每个 Company
insert into public.gw_module_members (user_id, module_id, group_id, company_id, is_admin, created_at)
select mm.user_id, mm.module_id, mm.group_id, mc.company_id, mm.is_admin, mm.created_at
  from public.gw_module_members mm
  join public.gw_member_companies mc on mc.group_id = mm.group_id and mc.user_id = mm.user_id
 where mm.company_id is null
   and (
     -- 模块在这个 Business 没有标 Company → 每个 Company 都可以
     not exists (
       select 1 from public.gw_module_companies t
         join public.gw_business_companies bc on bc.company_id = t.company_id and bc.group_id = mm.group_id
        where t.module_id = mm.module_id
     )
     -- 有标 → 只开给标到的 Company
     or exists (select 1 from public.gw_module_companies t where t.module_id = mm.module_id and t.company_id = mc.company_id)
   )
   and not exists (
     select 1 from public.gw_module_members x
      where x.user_id = mm.user_id and x.module_id = mm.module_id and x.group_id = mm.group_id and x.company_id = mc.company_id
   );

-- 已经展开的旧行拿掉（这个人在那个 Business 没有 Company 的，留着当「没有 Company」的权限）
delete from public.gw_module_members mm
 where mm.company_id is null
   and exists (select 1 from public.gw_member_companies mc where mc.group_id = mm.group_id and mc.user_id = mm.user_id);

create unique index if not exists gw_module_members_uq
  on public.gw_module_members (user_id, module_id, group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists gw_module_members_company_idx on public.gw_module_members (company_id);

-- Company 一定是这个人在这个 Business 的 Company；他被移出那个 Company，这些权限一起删
alter table public.gw_module_members drop constraint if exists gw_module_members_member_company_fkey;
alter table public.gw_module_members
  add constraint gw_module_members_member_company_fkey
  foreign key (group_id, user_id, company_id) references public.gw_member_companies (group_id, user_id, company_id) on delete cascade;

-- 检查：每个人在每个 Business / Company 的模块
select p.full_name, g.name as business, coalesce(c.name, '(no company)') as company, m.name as module, mm.is_admin
  from public.gw_module_members mm
  join public.gw_profiles p on p.id = mm.user_id
  join public.gw_groups g on g.id = mm.group_id
  join public.gw_modules m on m.id = mm.module_id
  left join public.gw_companies c on c.id = mm.company_id
 order by p.full_name, g.name, company, m.name;
