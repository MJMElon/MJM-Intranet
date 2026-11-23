-- =====================================================================
-- MJM Intranet 模块：Stock、Management Report（同一个 Plantation Stock 系统）、Mantap（Worker Portal）
-- 用 kind = 'system'，才会出现在 Admin → Master Manage → Module，
-- 可以加 Business / Company 标签，再在 User Access 逐个用户打开。
-- 只新增；已经有同样 code 就不动。
-- =====================================================================

insert into public.gw_modules (code, name, icon, url, description, category, access_level, open_mode, sort_order, kind)
values
  ('STOCK', 'Stock', 'package',
   'https://oliviawsc.github.io/plantationstockmanagementsystem/?module=stock',
   'Plantation stock, field operations, rainfall and tools', 'Plantation', 1, 'new_tab', 20, 'system'),
  ('MGMT_REPORT', 'Management Report', 'chart-line',
   'https://oliviawsc.github.io/plantationstockmanagementsystem/?module=report',
   'Central place for all operation reports', 'Reports', 1, 'new_tab', 21, 'system'),
  ('MANTAP', 'Mantap', 'hard-hat',
   'https://mjmelon.github.io/Mantap/',
   'Worker Portal: workers, worker access and mobile modules', 'Workers', 1, 'new_tab', 22, 'system')
on conflict (code) do nothing;
