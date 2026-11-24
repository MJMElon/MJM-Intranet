-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 不用 Intranet 里的「模块 Admin」了：模块权限只由 Super Admin 开 / 收回
--   （模块里面谁是管理员，在模块自己的 User Access 设定；Intranet 的 Super Admin 在每个模块都是 Super Admin）
-- 现有的 Admin 勾全部拿掉。可以重复执行。
-- =====================================================================

update public.gw_module_members set is_admin = false where is_admin;

select count(*) as module_admins_left from public.gw_module_members where is_admin;
