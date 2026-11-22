-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261201120000_gw_folder_business_share.sql first.
-- =====================================================================
-- 安全修正（分享文件夹）
--  1) 被分享的人只能改自己在主页的位置（sort_order），不能把自己从 Viewer 升成 Editor
--  2) 文件夹拥有者可以改分享名单上每个人的 Viewer / Editor（以前改了没存进去）
--  3) 文件夹只能分享给自己所在的 Business（super_admin 不限），Company 要属于那个 Business
-- 可以重复执行。
-- =====================================================================

-- 我是不是这个 Business 的人（super_admin 一律算是）
create or replace function public.gw__in_business(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
      or exists (select 1 from public.gw_group_members gm where gm.group_id = p_group and gm.user_id = auth.uid())
$$;
revoke all on function public.gw__in_business(uuid) from public, anon;
grant execute on function public.gw__in_business(uuid) to authenticated;

-- 1 + 2：分享名单的修改
drop policy if exists gw_folder_shares_update on public.gw_folder_shares;
create policy gw_folder_shares_update on public.gw_folder_shares
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  );

-- 只有拥有者能改权限（role）；资料库内部的函数（例如转移拥有者）不受限
create or replace function public.gw__folder_share_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.role is distinct from old.role or new.folder_id <> old.folder_id or new.user_id <> old.user_id)
     and not exists (select 1 from public.gw_user_folders f where f.id = old.folder_id and f.user_id = auth.uid()) then
    raise exception 'gw: only the folder owner can change access' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists gw_folder_shares_guard on public.gw_folder_shares;
create trigger gw_folder_shares_guard before update on public.gw_folder_shares
  for each row execute function public.gw__folder_share_guard();

-- 3：分享给 Business 要是自己的 Business
create or replace function public.gw__folder_tag_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.tag_group_id is not null
     and (tg_op = 'INSERT' or new.tag_group_id is distinct from old.tag_group_id or new.tag_company_id is distinct from old.tag_company_id) then
    if not public.gw__in_business(new.tag_group_id) then
      raise exception 'gw: you can only share with your own business' using errcode = '42501';
    end if;
    if new.tag_company_id is not null and not exists (
      select 1 from public.gw_business_companies bc where bc.group_id = new.tag_group_id and bc.company_id = new.tag_company_id
    ) then
      raise exception 'gw: that company is not in this business' using errcode = '22023';
    end if;
  end if;
  if new.tag_group_id is null then
    new.tag_company_id := null;
  end if;
  return new;
end $$;
drop trigger if exists gw_user_folders_tag_guard on public.gw_user_folders;
create trigger gw_user_folders_tag_guard before insert or update on public.gw_user_folders
  for each row execute function public.gw__folder_tag_guard();

select tgname from pg_trigger where tgname in ('gw_folder_shares_guard', 'gw_user_folders_tag_guard') order by 1;
