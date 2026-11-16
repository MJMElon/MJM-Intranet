-- =====================================================================
-- MJMConnect（Office Info Board：公告、请假、Duty、Events…）放到主画面当一个 Icon
-- 独立网站 https://mjmconnect.opispro.com，新分页打开，照常在那边登录（第 1 级外部链接）
-- kind = 'system' → 会出现在 设置页 › Master Manage › Module，可以勾 Business / Company
-- 一开始没有任何 Business，也没开给任何人：到设置页自己分配
-- 只新增；不删任何东西。
-- =====================================================================

insert into public.gw_modules (code, name, icon, url, image_url, description, category, access_level, open_mode, sort_order, kind)
values (
  'MJMCONNECT',
  'MJMConnect',
  'megaphone',
  'https://mjmconnect.opispro.com/',
  'https://mjmconnect.opispro.com/icons/icon-192.png',
  'Announcements, leave, duty roster & events',
  'Office',
  1,
  'new_tab',
  20,
  'system'
)
on conflict (code) do nothing;
