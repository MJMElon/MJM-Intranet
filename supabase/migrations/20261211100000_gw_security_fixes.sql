-- =====================================================================
-- 安全修补（2026-11 检查）：可以重复执行。
-- 1) 旧的「每家 Company 一个角色」（gw_member_companies.role_id）不再算权限，也不能再写入
--    （以前 Business 管理员可以借这个栏位把任何角色给别人）
-- 2) 分享的文件夹：只有拥有者 / Editor 能放东西进去；Viewer 只能看
--    （以前 Viewer 可以把自己的连结 / App 放进别人的文件夹，其他人都看得到）
-- 3) 公告的发布人一定是自己（以前可以写别人的 id，假冒别人发公告）
-- 4) 小清理：用 id 查名字只限有按过公告反应的人；两个函式不给未登入的人执行
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 角色只看个人的 gw_profiles.role_id
-- ---------------------------------------------------------------------
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
$$;

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
$$;

revoke execute on function public.gw_my_role_ids_in(uuid), public.gw_my_role_ids() from public, anon;
grant execute on function public.gw_my_role_ids_in(uuid), public.gw_my_role_ids() to authenticated;

-- 旧栏位清空，而且以后不能再填（栏位留着，免得旧的程式 / 检视坏掉）
update public.gw_member_companies set role_id = null where role_id is not null;
alter table public.gw_member_companies drop constraint if exists gw_member_companies_role_id_unused;
alter table public.gw_member_companies add constraint gw_member_companies_role_id_unused check (role_id is null);

-- ---------------------------------------------------------------------
-- 2) 文件夹里的东西一定属于文件夹的拥有者（Editor 新增的连结本来就记在拥有者名下）
-- ---------------------------------------------------------------------
create or replace function public.gw__folder_item_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.folder_id is not null
     and new.user_id is distinct from (select f.user_id from public.gw_user_folders f where f.id = new.folder_id) then
    raise exception 'Only the folder owner or an Editor can add items to this folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.gw__folder_item_guard() from public, anon, authenticated;

drop trigger if exists gw_user_links_folder_guard on public.gw_user_links;
create trigger gw_user_links_folder_guard
  before insert or update of folder_id, user_id on public.gw_user_links
  for each row execute function public.gw__folder_item_guard();

drop trigger if exists gw_user_layout_folder_guard on public.gw_user_layout;
create trigger gw_user_layout_folder_guard
  before insert or update of folder_id, user_id on public.gw_user_layout
  for each row execute function public.gw__folder_item_guard();

-- 连结：自己的连结只能放在自己的文件夹（或不放文件夹）；Editor 的权限在 gw_user_links_editor
drop policy if exists gw_user_links_write on public.gw_user_links;
create policy gw_user_links_write on public.gw_user_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (folder_id is null or exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid())))
  );

-- 以前被放进别人文件夹的东西：拿出来（回到放的人自己的主画面，不删除）
update public.gw_user_links l set folder_id = null
 where l.folder_id is not null
   and l.user_id is distinct from (select f.user_id from public.gw_user_folders f where f.id = l.folder_id);
update public.gw_user_layout l set folder_id = null
 where l.folder_id is not null
   and l.user_id is distinct from (select f.user_id from public.gw_user_folders f where f.id = l.folder_id);

-- ---------------------------------------------------------------------
-- 3) 公告发布人 = 登入的人；改公告时不能换发布人
-- ---------------------------------------------------------------------
create or replace function public.gw__announcement_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- 后台（SQL Editor / 服务）照原样
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
revoke all on function public.gw__announcement_author() from public, anon, authenticated;

drop trigger if exists gw_announcements_author on public.gw_announcements;
create trigger gw_announcements_author
  before insert or update on public.gw_announcements
  for each row execute function public.gw__announcement_author();

-- ---------------------------------------------------------------------
-- 4) 小清理
-- ---------------------------------------------------------------------
-- 用 id 查名字：只给有按过公告反应的人（公告上本来就显示他们的名字）
create or replace function public.gw__display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.gw_profiles p
   where p.id = p_user
     and exists (select 1 from public.gw_notice_reactions r where r.user_id = p_user)
$$;
revoke execute on function public.gw__display_name(uuid) from public, anon;
grant execute on function public.gw__display_name(uuid) to authenticated;

-- 未登入的人不能执行（Supabase 预设会直接给 anon 执行权，只 revoke public 不够）
do $$
begin
  if to_regprocedure('public.gw_my_add_right(text)') is not null then
    revoke execute on function public.gw_my_add_right(text) from anon;
  end if;
  if to_regprocedure('public.gw_my_delete_right(text)') is not null then
    revoke execute on function public.gw_my_delete_right(text) from anon;
  end if;
end $$;

notify pgrst, 'reload schema';

-- 检查：应该都是 0
select
  (select count(*) from public.gw_member_companies where role_id is not null) as old_company_roles_left,
  (select count(*) from public.gw_user_links l join public.gw_user_folders f on f.id = l.folder_id where l.user_id <> f.user_id) as foreign_links_in_folders,
  (select count(*) from public.gw_user_layout l join public.gw_user_folders f on f.id = l.folder_id where l.user_id <> f.user_id) as foreign_apps_in_folders;
