-- Gateway 权限测试（本地执行：npx supabase test db）
begin;
create extension if not exists pgtap with schema extensions;
select plan(127);

-- ---------------------------------------------------------------------
-- 测试资料
--  Business c1「Plantation」：模块 WIKI、HR、OLD（已下架）
--  Business c2「Fleet」：模块 DIESEL
--  a1 super_admin；a2 角色 HR（管 c1、c1 的 WIKI、可发公告）；a5 角色 Diesel Admin（管 c2、DIESEL、不可发公告）
--  a3 在 c1、c2；a4 在 c1；a6 还没放进任何 Business
-- ---------------------------------------------------------------------
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'hr@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'user.both@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'user.ops@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a5', 'diesel.admin@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a6', 'pending@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a7', 'viewer@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

insert into public.gw_modules (id, code, name, url) values
  ('00000000-0000-0000-0000-0000000000b1', 'FUEL', 'Fuel', 'https://fuel.example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'HR', '人事系统', 'https://hr.example.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'WIKI', '公司知识库', 'https://wiki.example.com'),
  ('00000000-0000-0000-0000-0000000000b4', 'OLD', '旧系统', 'https://old.example.com');
update public.gw_modules set is_active = false where code = 'OLD';

insert into public.gw_groups (id, name) values
  ('00000000-0000-0000-0000-0000000000c1', 'Plantation'),
  ('00000000-0000-0000-0000-0000000000c2', 'Fleet');

insert into public.gw_group_modules (group_id, module_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b4'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1');

-- 角色（功能按 Business 设定）：
--  HR：Plantation 全部功能；Diesel Admin：Fleet 可以加人进模块、加人进 Business；Viewer：Fleet 只看名单 + 看操作记录
insert into public.gw_roles (id, name, can_view_user_group, can_view_audit) values
  ('00000000-0000-0000-0000-0000000000f1', 'HR', true, false),
  ('00000000-0000-0000-0000-0000000000f2', 'Diesel Admin', true, false),
  ('00000000-0000-0000-0000-0000000000f3', 'Viewer', false, true);
insert into public.gw_role_businesses (role_id, group_id, can_post_notice, can_delete_notice, can_grant_module, can_revoke_module, can_set_module_admin, can_add_business_user, can_remove_business_user, can_view_users) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', true, true, true, true, true, true, true, true),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2', false, false, true, false, false, true, false, false),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c2', false, false, false, false, false, false, false, true);

insert into public.gw_profiles (id, email, full_name, role, role_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', '超级管理员', 'super_admin', null),
  ('00000000-0000-0000-0000-0000000000a2', 'hr@test.local', 'HR', 'user', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000a3', 'user.both@test.local', '两边都有', 'user', null),
  ('00000000-0000-0000-0000-0000000000a4', 'user.ops@test.local', '营运员工', 'user', null),
  ('00000000-0000-0000-0000-0000000000a5', 'diesel.admin@test.local', 'Diesel 管理员', 'user', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000a6', 'pending@test.local', '待分配', 'user', null),
  ('00000000-0000-0000-0000-0000000000a7', 'viewer@test.local', '只看名单', 'user', '00000000-0000-0000-0000-0000000000f3');

insert into public.gw_group_members (group_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4');

insert into public.gw_module_members (user_id, module_id) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b4'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b1');

-- 模拟登录身份
create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
create function pg_temp.logout() returns void language sql as $$
  reset role;
  select set_config('request.jwt.claims', null, true);
$$;

-- ---------------------------------------------------------------------
-- 1. 权限计算：开给他的模块 ∩ 他所属 Business 的模块
-- ---------------------------------------------------------------------
select set_eq(
  $$ select code from public.gw_modules where id in (select public.gw__effective_module_ids('00000000-0000-0000-0000-0000000000a3')) $$,
  array['FUEL', 'WIKI'],
  '两个 Business 都在：开给他的模块都看得到'
);
select set_eq(
  $$ select code from public.gw_modules where id in (select public.gw__effective_module_ids('00000000-0000-0000-0000-0000000000a4')) $$,
  array['WIKI'],
  '下架的模块、不在他 Business 里的模块（DIESEL）都不算'
);
select is(
  (select count(*) from public.gw__effective_module_ids('00000000-0000-0000-0000-0000000000a6'))::int, 0,
  '还没放进 Business：什么都看不到'
);

-- ---------------------------------------------------------------------
-- 2. 一般用户
-- ---------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select set_eq($$ select code from public.gw_modules $$, array['FUEL', 'WIKI'], '用户只看到自己有权限的模块（连名字都看不到其他的）');
select is((select count(*) from public.gw_profiles)::int, 1, '用户只看到自己的资料');
select is((select count(*) from public.gw_audit_logs)::int, 0, '一般用户看不到操作记录');
select throws_ok(
  $$ update public.gw_profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-0000000000a3' $$,
  '42501', null, '用户不能改自己的角色'
);
select throws_ok(
  $$ update public.gw_profiles set role_id = '00000000-0000-0000-0000-0000000000f1' where id = '00000000-0000-0000-0000-0000000000a3' $$,
  '42501', null, '用户不能给自己设定自订角色'
);
select lives_ok(
  $$ update public.gw_profiles set theme = 'dark', locale = 'en' where id = '00000000-0000-0000-0000-0000000000a3' $$,
  '用户可以改自己的语言和主题'
);
select throws_ok(
  $$ insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b2') $$,
  '42501', null, '用户不能把模块开给自己'
);
select throws_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a6') $$,
  '42501', null, '用户不能把人放进 Business'
);
select throws_ok($$ select * from public.gw_login_attempts $$, '42501', null, '客户端不能读登录记录表');
select is((select count(*) from public.gw_roles)::int, 0, '没有角色的用户看不到任何角色设定');

-- 第一次登录：按 Business 自动排版（两个 Business → 两个文件夹）
select lives_ok($$ select public.gw_init_layout() $$, '初始化首页');
select is((select count(*) from public.gw_user_folders)::int, 2, '按 Business 建立 2 个文件夹');
select is(jsonb_array_length(public.gw_get_home() -> 'modules'), 2, 'gw_get_home 回传 2 个模块');
select throws_ok(
  $$ select public.gw_get_home('00000000-0000-0000-0000-0000000000a4') $$,
  '42501', null, '用户不能预览别人的首页'
);
select throws_ok(
  $$ select public.gw_save_layout('[{"module_id":"00000000-0000-0000-0000-0000000000b2","sort_order":1}]') $$,
  '42501', null, '不能把没权限的模块加进版面'
);
select pg_temp.logout();

-- ---------------------------------------------------------------------
-- 3. 模块收回 → 不显示但版面保留；开回来位置还在
-- ---------------------------------------------------------------------
update public.gw_user_layout set sort_order = 42 where module_id = '00000000-0000-0000-0000-0000000000b1';
delete from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a3' and module_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(jsonb_array_length(public.gw_get_home() -> 'layout'), 1, '收回的模块不出现在首页');
select pg_temp.logout();
select is((select count(*) from public.gw_user_layout where user_id = '00000000-0000-0000-0000-0000000000a3')::int, 2, '版面记录仍保留');
insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select ok(
  (public.gw_get_home() -> 'layout') @> '[{"module_id":"00000000-0000-0000-0000-0000000000b1","sort_order":42}]',
  '模块开回来，原位置还在'
);
select pg_temp.logout();

update public.gw_profiles set status = 'disabled' where id = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*) from public.gw_modules)::int, 0, '停用帐号看不到任何模块');
select pg_temp.logout();
update public.gw_profiles set status = 'active' where id = '00000000-0000-0000-0000-0000000000a3';

-- ---------------------------------------------------------------------
-- 4. 自订角色 HR：管 Plantation（里面所有模块），可以发公告
-- ---------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.gw_profiles)::int, 7, '可以放人进 Business 的角色看得到全部用户（才找得到还没分配的人）');
select set_eq($$ select name from public.gw_groups $$, array['Plantation'], 'HR 只看到自己管的 Business');
select set_eq($$ select code from public.gw_modules $$, array['WIKI', 'HR', 'OLD'], 'HR 看到自己管的 Business 里的所有模块');
select is((select name from public.gw_roles), 'HR', '看得到自己的角色设定');
select lives_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a6') $$,
  'HR 可以把人放进自己管的 Business'
);
select throws_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a6') $$,
  '42501', null, 'HR 不能把人放进别的 Business'
);
select throws_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'HR 不能动 super_admin'
);
select throws_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2') $$,
  '42501', null, 'HR 不能把自己放进 Business'
);
select lives_ok(
  $$ insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b3') $$,
  'HR 可以把自己管的模块开给 Business 里的人'
);
select throws_ok(
  $$ insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b1') $$,
  '42501', null, 'HR 不能开别的 Business 的模块（Fleet 的 FUEL）'
);
select throws_ok(
  $$ insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b3') $$,
  '42501', null, 'HR 不能把模块开给自己'
);
update public.gw_profiles set full_name = '被改掉' where id = '00000000-0000-0000-0000-0000000000a4';
select lives_ok(
  $$ insert into public.gw_announcements (message, group_id) values ('Plantation 明天停电', '00000000-0000-0000-0000-0000000000c1') $$,
  'HR 可以发公告给自己管的 Business'
);
select throws_ok(
  $$ insert into public.gw_announcements (message) values ('全公司') $$,
  '42501', null, 'HR 不能发全公司公告'
);
select throws_ok(
  $$ insert into public.gw_announcements (message, group_id) values ('Fleet', '00000000-0000-0000-0000-0000000000c2') $$,
  '42501', null, 'HR 不能发公告给别的 Business'
);
select throws_ok(
  $$ insert into public.gw_modules (code, name, url) values ('NEWMOD', '新模块', 'https://x') $$,
  '42501', null, '角色不能管理模块主资料'
);
select throws_ok(
  $$ insert into public.gw_roles (name) values ('Boss') $$,
  '42501', null, '角色不能新增角色'
);
select is((select count(*) from public.gw_audit_logs)::int, 0, '角色看不到操作记录');
select pg_temp.logout();
select is((select full_name from public.gw_profiles where id = '00000000-0000-0000-0000-0000000000a4'), '营运员工', '角色不能改别人的资料');
select set_eq(
  $$ select code from public.gw_modules where id in (select public.gw__effective_module_ids('00000000-0000-0000-0000-0000000000a6')) $$,
  array['WIKI'], '被 HR 放进 Business 并开模块后看得到'
);

-- 模块管理员：a4 是 WIKI 的 Admin（同时一定有 Access）
update public.gw_module_members set is_admin = true where user_id = '00000000-0000-0000-0000-0000000000a4' and module_id = '00000000-0000-0000-0000-0000000000b3';
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.gw_profiles)::int, 3, '模块管理员只看得到同一个 Business 的人');
select lives_ok(
  $$ delete from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b3' $$,
  '模块管理员可以收回同一个 Business 的人的 Access'
);
select lives_ok(
  $$ insert into public.gw_module_members (user_id, module_id) values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b3') $$,
  '模块管理员可以把 Access 开给同一个 Business 的人'
);
select throws_ok(
  $$ insert into public.gw_module_members (user_id, module_id, is_admin) values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b2', false) $$,
  '42501', null, '模块管理员不能开别的模块'
);
update public.gw_module_members set is_admin = true where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b3';
select pg_temp.logout();
select is(
  (select is_admin from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b3'),
  false, '模块管理员不能指定别人当管理员'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ update public.gw_module_members set is_admin = true where user_id = '00000000-0000-0000-0000-0000000000a3' and module_id = '00000000-0000-0000-0000-0000000000b3' $$,
  'HR 可以指定模块管理员'
);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
delete from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a3' and module_id = '00000000-0000-0000-0000-0000000000b3';
select pg_temp.logout();
select is(
  (select count(*) from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a3' and module_id = '00000000-0000-0000-0000-0000000000b3')::int,
  1, '模块管理员不能收回另一个管理员'
);

-- ---------------------------------------------------------------------
-- 5. 自订角色 Diesel Admin：只管 Fleet 的 DIESEL，不能发公告
-- ---------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b1') $$,
  '42501', null, '对方不在 Fleet：不能开 DIESEL 给他'
);
select lives_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a6') $$,
  'Diesel Admin 把人放进 Fleet'
);
select lives_ok(
  $$ insert into public.gw_module_members values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b1') $$,
  '放进 Fleet 后可以开 DIESEL'
);
delete from public.gw_group_members where group_id = '00000000-0000-0000-0000-0000000000c2' and user_id = '00000000-0000-0000-0000-0000000000a3';
select is((select count(*) from public.gw_group_members where group_id = '00000000-0000-0000-0000-0000000000c2' and user_id = '00000000-0000-0000-0000-0000000000a3')::int, 1, '没有「移出 Business」功能不能把人移出');
delete from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b1';
select is((select count(*) from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b1')::int, 1, '没有「移除」功能的角色不能收回 Access');
select is(
  (select count(*) from public.gw_module_members where module_id = '00000000-0000-0000-0000-0000000000b3')::int, 0,
  'Diesel Admin 看不到不归他管的模块开给了谁'
);
select throws_ok(
  $$ insert into public.gw_announcements (message, group_id) values ('Fleet', '00000000-0000-0000-0000-0000000000c2') $$,
  '42501', null, '没勾「可发公告」的角色不能发公告'
);
select pg_temp.logout();
select set_eq(
  $$ select code from public.gw_modules where id in (select public.gw__effective_module_ids('00000000-0000-0000-0000-0000000000a6')) $$,
  array['WIKI', 'FUEL'], '两个角色各自开的模块都生效'
);

-- 移出 Business：那个 Business 的模块自动收回
delete from public.gw_group_members where group_id = '00000000-0000-0000-0000-0000000000c2' and user_id = '00000000-0000-0000-0000-0000000000a6';
select is(
  (select count(*) from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b1')::int, 0,
  '移出 Fleet 后 DIESEL 自动收回'
);
select is(
  (select count(*) from public.gw_module_members where user_id = '00000000-0000-0000-0000-0000000000a6' and module_id = '00000000-0000-0000-0000-0000000000b3')::int, 1,
  '还在 Plantation：WIKI 保留'
);

-- 公告只给那个 Business 的人
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.gw_announcements)::int, 1, 'Plantation 的人看得到 HR 的公告');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*) from public.gw_announcements)::int, 0, '不在 Plantation 的人看不到');
select pg_temp.logout();

-- 角色功能：删除公告、只看名单、看操作记录
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.gw_announcements set message = 'Plantation 后天停电' where group_id = '00000000-0000-0000-0000-0000000000c1' $$, '有「更新」功能可以修改公告');
select lives_ok($$ delete from public.gw_announcements where group_id = '00000000-0000-0000-0000-0000000000c1' $$, '有「删除」功能可以删除公告');
select is((select count(*) from public.gw_announcements)::int, 0, '公告已删除');
select pg_temp.logout();
-- 角色功能：改模块名称、管理模块内用户权限
update public.gw_roles set can_edit_module_name = true, can_manage_module_access = true where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.gw_rename_module('00000000-0000-0000-0000-0000000000b1', 'Fuel 2', 'renamed') $$, '有「改模块名称」的角色可以改范围内模块的名称');
select throws_ok($$ select public.gw_rename_module('00000000-0000-0000-0000-0000000000b3', 'X', null) $$, '42501', null, '不能改范围外的模块');
select ok(exists (select 1 from public.gw_my_admin_module_ids() m where m = '00000000-0000-0000-0000-0000000000b1'), '有「管理模块用户权限」= 范围内模块的管理员');
select pg_temp.logout();
select is((select name from public.gw_modules where id = '00000000-0000-0000-0000-0000000000b1'), 'Fuel 2', '模块名称已改');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$ insert into public.gw_user_links (user_id, name, url) values ('00000000-0000-0000-0000-0000000000a3', 'Google', 'https://google.com') $$, '用户可以加自己的连结图示');
select throws_ok($$ insert into public.gw_user_links (user_id, name, url) values ('00000000-0000-0000-0000-0000000000a4', 'X', 'https://x.com') $$, '42501', null, '不能替别人加连结');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select set_eq($$ select email from public.gw_profiles $$, array['viewer@test.local', 'user.both@test.local'], '「看名单」只看得到角色负责的 Business 的人');
select ok((select count(*) from public.gw_audit_logs) > 0, '有「看操作记录」功能可以看操作记录');
select throws_ok(
  $$ insert into public.gw_group_members (group_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a6') $$,
  '42501', null, '没有「放人」功能不能放人进 Business'
);
select pg_temp.logout();

-- ---------------------------------------------------------------------
-- 6. 操作记录、匿名、登录锁定
-- ---------------------------------------------------------------------
select ok((select count(*) from public.gw_audit_logs) > 0, '权限改动自动写入操作记录');
select is(
  (select target_label from public.gw_audit_logs where target_type = 'module_members' and action = 'insert' order by id desc limit 1),
  'FUEL → pending@test.local', '开模块的操作记录有可读的对象说明'
);
select throws_ok($$ delete from public.gw_audit_logs $$, '42501', null, '操作记录不能删除（连数据库管理员也不行）');

set local role anon;
select throws_ok($$ select * from public.gw_modules $$, '42501', null, '未登录不能读取模块');
reset role;

select public.gw_login_failed('Lock@Test.local') from generate_series(1, 5);
select ok(public.gw_login_locked_until('lock@test.local') > now() + interval '14 minutes', '连续输错 5 次锁 15 分钟');

-- ---------------------------------------------------------------------
-- 7. 首页小工具：只能动自己的；重设首页会清掉
-- ---------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ insert into public.gw_user_widgets (user_id, widget_type, size) values ('00000000-0000-0000-0000-0000000000a3', 'clock', 'small') $$,
  '用户可以加自己的小工具'
);
select throws_ok(
  $$ insert into public.gw_user_widgets (user_id, widget_type) values ('00000000-0000-0000-0000-0000000000a4', 'clock') $$,
  '42501', null, '不能替别人加小工具'
);
select pg_temp.logout();
insert into public.gw_user_widgets (user_id, widget_type) values ('00000000-0000-0000-0000-0000000000a4', 'notes');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*) from public.gw_user_widgets)::int, 1, '看不到别人的小工具');
select public.gw_reset_layout();
select is((select count(*) from public.gw_user_widgets)::int, 0, '重设首页会清掉自己的小工具');
select pg_temp.logout();

-- ---------------------------------------------------------------------
-- 8. Company：独立主资料，可以属于多个 Business；对应到现有系统；Icon 标签
-- ---------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ insert into public.gw_companies (id, code, name) values
       ('00000000-0000-0000-0000-0000000000e1', 'MJMP', 'MJM Plantation Sdn Bhd'),
       ('00000000-0000-0000-0000-0000000000e3', 'MJMA', 'MJM Agro Sdn Bhd'),
       ('00000000-0000-0000-0000-0000000000e2', 'FLEET', 'Fleet Co') $$,
  'super_admin 可以新增 Company'
);
select lives_ok(
  $$ insert into public.gw_business_companies (group_id, company_id) values
       ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
       ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e3'),
       ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2'),
       ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1') $$,
  '同一个 Company 可以属于多个 Business'
);
select lives_ok(
  $$ update public.gw_business_companies set area = 1250.5, area_unit = 'ha'
     where group_id = '00000000-0000-0000-0000-0000000000c1' and company_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '每个 Business 底下的 Company 可以记面积'
);
select throws_ok(
  $$ insert into public.gw_companies (code, name) values ('bad code', 'Bad') $$,
  '23514', null, 'Company 代码格式要对（大写英文数字）'
);
select throws_ok(
  $$ update public.gw_group_members set company_id = '00000000-0000-0000-0000-0000000000e2'
     where group_id = '00000000-0000-0000-0000-0000000000c1' and user_id = '00000000-0000-0000-0000-0000000000a4' $$,
  '23503', null, '不能放进没有连结到这个 Business 的 Company'
);
select lives_ok(
  $$ insert into public.gw_company_mappings (company_id, module_id, external_id, external_name) values
       ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', '12', 'MJM PLANTATION') $$,
  'super_admin 可以设定 Company 在现有系统的对应'
);
select throws_ok(
  $$ insert into public.gw_company_mappings (company_id, module_id, external_id) values
       ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000b2', '12') $$,
  '23505', null, '同一个系统的同一个 ID 不能对应到两个 Company'
);
select lives_ok(
  $$ insert into public.gw_module_companies (module_id, company_id) values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1') $$,
  'super_admin 可以给 Icon 加 Company 标签'
);
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ update public.gw_group_members set company_id = '00000000-0000-0000-0000-0000000000e3'
     where group_id = '00000000-0000-0000-0000-0000000000c1' and user_id = '00000000-0000-0000-0000-0000000000a4' $$,
  'HR 可以在自己管的 Business 里换 Company'
);
select throws_ok(
  $$ insert into public.gw_companies (code, name) values ('XX', 'X') $$,
  '42501', null, '角色不能新增 Company'
);
select throws_ok(
  $$ insert into public.gw_business_companies (group_id, company_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2') $$,
  '42501', null, '角色不能改 Company 属于哪个 Business'
);
select is((select count(*) from public.gw_company_mappings)::int, 1, '有管理权的人看得到系统对应');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
select is((select count(*) from public.gw_company_mappings)::int, 0, '一般用户看不到系统对应');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.gw_companies)::int, 3, '所有人都看得到 Company 主资料');
select is((select count(*) from public.gw_module_companies)::int, 1, '看得到自己能用的 Icon 的 Company 标签');
update public.gw_group_members set company_id = null where user_id = '00000000-0000-0000-0000-0000000000a4';
select is((select company_id from public.gw_group_members where user_id = '00000000-0000-0000-0000-0000000000a4'), '00000000-0000-0000-0000-0000000000e3'::uuid, '一般用户不能改自己的 Company');
select pg_temp.logout();

-- 一个人可以同时在同一个 Business 的好几个 Company（gw_member_companies）
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ insert into public.gw_member_companies (group_id, user_id, company_id) values
       ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1'),
       ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e3') $$,
  '负责这个 Business 的角色可以把一个人放进它的好几个 Company'
);
select is((select count(*) from public.gw_member_companies where user_id = '00000000-0000-0000-0000-0000000000a4')::int, 2, '同一个人在同一个 Business 里有两个 Company');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$ insert into public.gw_member_companies (group_id, user_id, company_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1') $$,
  '42501', null, '一般用户不能给自己加 Company'
);
select pg_temp.logout();

delete from public.gw_business_companies where group_id = '00000000-0000-0000-0000-0000000000c1' and company_id = '00000000-0000-0000-0000-0000000000e3';
select is((select company_id from public.gw_group_members where user_id = '00000000-0000-0000-0000-0000000000a4'), null, 'Company 从 Business 拿掉后，成员还在 Business 里');
select is((select count(*) from public.gw_member_companies where user_id = '00000000-0000-0000-0000-0000000000a4')::int, 1, 'Company 从 Business 拿掉后，那个 Company 的成员记录也跟着没有');

-- Sector 清单：只有 super_admin 可以改；删除 Sector 后，模块上的 Sector 变回空
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into public.gw_sectors (name) values ('Operation') $$, '42501', null, '一般用户不能新增 Sector');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.gw_sectors (id, name) values ('00000000-0000-0000-0000-0000000000d9', 'Operation');
select is((select count(*) from public.gw_sectors)::int, 1, 'super_admin 可以新增 Sector');
update public.gw_group_modules set sector_id = '00000000-0000-0000-0000-0000000000d9', lead_user_id = '00000000-0000-0000-0000-0000000000a3'
  where group_id = '00000000-0000-0000-0000-0000000000c1' and module_id = '00000000-0000-0000-0000-0000000000b3';
delete from public.gw_sectors where id = '00000000-0000-0000-0000-0000000000d9';
select is((select sector_id from public.gw_group_modules where group_id = '00000000-0000-0000-0000-0000000000c1' and module_id = '00000000-0000-0000-0000-0000000000b3'), null::uuid, '删除 Sector 后模块的 Sector 变回空');
select pg_temp.logout();

-- Notice Board 反应
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.gw_announcements (id, message) values ('00000000-0000-0000-0000-0000000000d8', 'Reaction test');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ insert into public.gw_notice_reactions (announcement_id, user_id, emoji) values ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000a3', 'like') $$,
  '看得到公告的人可以按反应'
);
select throws_ok(
  $$ insert into public.gw_notice_reactions (announcement_id, user_id, emoji) values ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000a4', 'love') $$,
  '42501', null, '不能替别人按反应'
);
select is((select count(*) from public.gw_get_notice_reactions(array['00000000-0000-0000-0000-0000000000d8']::uuid[]))::int, 1, '读得到这则公告的反应');
select is(
  (select full_name from public.gw_get_notice_reactions(array['00000000-0000-0000-0000-0000000000d8']::uuid[]) limit 1),
  (select full_name from public.gw_profiles where id = '00000000-0000-0000-0000-0000000000a3'),
  '反应附上按的人的名字'
);
select pg_temp.logout();

-- AI 每天次数上限
select is(public.gw_ai_take('00000000-0000-0000-0000-0000000000a3', 2), 1, 'AI：第一次，还剩 1 次');
select is(public.gw_ai_take('00000000-0000-0000-0000-0000000000a3', 2), 0, 'AI：第二次，还剩 0 次');
select is(public.gw_ai_take('00000000-0000-0000-0000-0000000000a3', 2), -1, 'AI：超过上限回传 -1');

-- AI Connector（自己的 AI 连到公司资料）
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.gw_mcp_create('x') $$, 'connector_off', 'AI Connector：开关关闭时不能建立链接');
select throws_ok($$ insert into public.gw_settings (key, value) values ('ai_connector', '{"enabled":true}') $$, '42501', null, 'AI Connector：一般用户不能改全站开关');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.gw_settings (key, value) values ('ai_connector', '{"enabled":true}');
select pg_temp.logout();
select is(public.gw_mcp_enabled(), true, 'AI Connector：super_admin 可以打开开关');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
create temp table mcp_t as select public.gw_mcp_create('laptop') as r;
select ok((select r->>'token' from mcp_t) like 'gwm\_%', 'AI Connector：链接以 gwm_ 开头');
select is((select count(*) from public.gw_mcp_list()), 1::bigint, 'AI Connector：用户看得到自己的链接');
select pg_temp.logout();
select is(public.gw_mcp_resolve(encode(sha256(convert_to((select r->>'token' from mcp_t), 'utf8')), 'hex')), '00000000-0000-0000-0000-0000000000a3'::uuid, 'AI Connector：链接对应到建立它的用户');
select is(public.gw_mcp_resolve('nope'), null, 'AI Connector：乱写的链接没有用户');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.gw_mcp_list()), 0::bigint, 'AI Connector：看不到别人的链接');
select public.gw_mcp_revoke((select (r->>'id')::uuid from mcp_t));
select pg_temp.logout();
select is(public.gw_mcp_resolve(encode(sha256(convert_to((select r->>'token' from mcp_t), 'utf8')), 'hex')), '00000000-0000-0000-0000-0000000000a3'::uuid, 'AI Connector：别人撤销不了你的链接');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select cmp_ok((select count(*) from public.gw_mcp_list()), '>=', 1::bigint, 'AI Connector：super_admin 看得到全部链接');
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select public.gw_mcp_revoke((select (r->>'id')::uuid from mcp_t));
select pg_temp.logout();
select is(public.gw_mcp_resolve(encode(sha256(convert_to((select r->>'token' from mcp_t), 'utf8')), 'hex')), null, 'AI Connector：撤销后链接失效');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
create temp table mcp_t2 as select public.gw_mcp_create('phone') as r;
select pg_temp.logout();
update public.gw_settings set value = '{"enabled":false}' where key = 'ai_connector';
select is(public.gw_mcp_resolve(encode(sha256(convert_to((select r->>'token' from mcp_t2), 'utf8')), 'hex')), null, 'AI Connector：开关关闭后所有链接失效');
update public.gw_settings set value = '{"enabled":true}' where key = 'ai_connector';
update public.gw_profiles set status = 'disabled' where id = '00000000-0000-0000-0000-0000000000a3';
select is(public.gw_mcp_resolve(encode(sha256(convert_to((select r->>'token' from mcp_t2), 'utf8')), 'hex')), null, 'AI Connector：用户被停用后链接失效');

select is((select count(*) from public.gw_profiles where user_code is null), 0::bigint, '每个用户都有代码');
select is((select count(distinct user_code) from public.gw_profiles), (select count(*) from public.gw_profiles), '用户代码不重复');

select * from finish();
rollback;
