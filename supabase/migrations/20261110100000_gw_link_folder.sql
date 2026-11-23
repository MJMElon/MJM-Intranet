-- 个人连结图示（Add Icon）也可以放进主页的文件夹
-- 只新增一栏；文件夹被删除时，里面的连结回到主页（folder_id 变回空）。
alter table public.gw_user_links
  add column folder_id uuid references public.gw_user_folders (id) on delete set null;
