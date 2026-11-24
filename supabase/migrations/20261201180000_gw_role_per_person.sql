-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 1) 大头照：gw_profiles.avatar_url（只放 Intranet 自己储存里的图片）
-- 2) Intranet 角色改成「一个人一个」（gw_profiles.role_id），跟 Business / Company 无关
--    以前在每家 Company 选的角色（gw_member_companies.role_id）：
--      这个人还没有个人角色的话，用他在 Company 里最常用的那个角色当个人角色；然后全部清掉
--    角色能做什么、在哪些 Business 有效，照 Master Manage → Roles 里的设定（不变）
-- 可以重复执行。
-- =====================================================================

alter table public.gw_profiles add column if not exists avatar_url text;
alter table public.gw_profiles drop constraint if exists gw_profiles_avatar_url_check;
alter table public.gw_profiles
  add constraint gw_profiles_avatar_url_check
  check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url like 'https://briqzyxfxsvulyizzbiu.supabase.co/storage/v1/object/public/%'));

update public.gw_profiles p
   set role_id = (
     select mc.role_id
       from public.gw_member_companies mc
      where mc.user_id = p.id and mc.role_id is not null
      group by mc.role_id
      order by count(*) desc, mc.role_id
      limit 1
   )
 where p.role = 'user'
   and p.role_id is null
   and exists (select 1 from public.gw_member_companies mc where mc.user_id = p.id and mc.role_id is not null);

update public.gw_member_companies set role_id = null where role_id is not null;

-- 检查：每个人的 Intranet 角色
select p.full_name, p.email,
       case when p.role = 'super_admin' then 'Super Admin' else coalesce(r.name, 'User') end as intranet_role
  from public.gw_profiles p
  left join public.gw_roles r on r.id = p.role_id
 order by (p.role = 'super_admin') desc, p.full_name;
