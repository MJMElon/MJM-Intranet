-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 主页文件夹：分享给同事 ＋ 心智图
--  - gw_user_folders.is_shared：这个文件夹是「分享用」的（新增文件夹时选 Own use / Shared）
--  - gw_user_folders.canvas：文件夹里的心智图（方块、连线、图示的位置；jsonb）
--  - gw_folder_shares：分享给谁（只能分享给跟自己同一个 Business 的人）；sort_order = 对方主页上的位置
--  - 被分享的人：看得到文件夹、里面的连结和 App（App 要自己也有权限才会显示），可以一起编辑心智图；
--    不能改名、不能加 / 移走里面的东西（那是拥有者的）。
--  - gw_folder_share_candidates()：可以分享给谁（同 Business 的在职同事）
--  - gw_save_folder_canvas()：存心智图（拥有者或被分享的人）
-- 可以重复执行。
-- =====================================================================

alter table public.gw_user_folders add column if not exists is_shared boolean not null default false;
alter table public.gw_user_folders add column if not exists canvas jsonb;

create table if not exists public.gw_folder_shares (
  folder_id   uuid not null references public.gw_user_folders (id) on delete cascade,
  user_id     uuid not null references public.gw_profiles (id) on delete cascade,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (folder_id, user_id)
);
create index if not exists gw_folder_shares_user_idx on public.gw_folder_shares (user_id);
alter table public.gw_folder_shares enable row level security;
revoke all on public.gw_folder_shares from anon;

-- 我和这个人有没有同一个 Business
create or replace function public.gw__shares_business(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gw_group_members a
    join public.gw_group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- 分享给了我的文件夹
create or replace function public.gw_my_shared_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.folder_id from public.gw_folder_shares s where s.user_id = auth.uid()
$$;

-- 可以分享给谁：同 Business 的在职同事（不含自己）
create or replace function public.gw_folder_share_candidates()
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.full_name, p.email
  from public.gw_profiles p
  join public.gw_group_members gm on gm.user_id = p.id
  where p.status = 'active'
    and p.id <> auth.uid()
    and gm.group_id in (select g.group_id from public.gw_group_members g where g.user_id = auth.uid())
  order by p.full_name
$$;

-- 存心智图：拥有者或被分享的人
create or replace function public.gw_save_folder_canvas(p_folder uuid, p_canvas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_canvas is not null and pg_column_size(p_canvas) > 300000 then
    raise exception 'gw: canvas too large' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gw_user_folders f
    where f.id = p_folder
      and (f.user_id = auth.uid() or exists (select 1 from public.gw_folder_shares s where s.folder_id = f.id and s.user_id = auth.uid()))
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  update public.gw_user_folders set canvas = p_canvas where id = p_folder;
end $$;

revoke all on function
  public.gw__shares_business(uuid), public.gw_my_shared_folder_ids(),
  public.gw_folder_share_candidates(), public.gw_save_folder_canvas(uuid, jsonb)
from public, anon;
grant execute on function
  public.gw__shares_business(uuid), public.gw_my_shared_folder_ids(),
  public.gw_folder_share_candidates(), public.gw_save_folder_canvas(uuid, jsonb)
to authenticated;

-- 分享名单：自己的文件夹才能分享（而且文件夹要是分享用的）；对方要同一个 Business；被分享的人可以自己退出、改位置
drop policy if exists gw_folder_shares_select on public.gw_folder_shares;
create policy gw_folder_shares_select on public.gw_folder_shares
  for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid())));
drop policy if exists gw_folder_shares_insert on public.gw_folder_shares;
create policy gw_folder_shares_insert on public.gw_folder_shares
  for insert to authenticated
  with check (
    exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()) and f.is_shared)
    and (select public.gw__shares_business(user_id))
  );
drop policy if exists gw_folder_shares_update on public.gw_folder_shares;
create policy gw_folder_shares_update on public.gw_folder_shares
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists gw_folder_shares_delete on public.gw_folder_shares;
create policy gw_folder_shares_delete on public.gw_folder_shares
  for delete to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid())));

-- 文件夹：自己的随便动；分享给我的看得到
drop policy if exists gw_user_folders_own on public.gw_user_folders;
drop policy if exists gw_user_folders_select on public.gw_user_folders;
create policy gw_user_folders_select on public.gw_user_folders
  for select to authenticated
  using (user_id = (select auth.uid()) or id in (select public.gw_my_shared_folder_ids()));
drop policy if exists gw_user_folders_write on public.gw_user_folders;
create policy gw_user_folders_write on public.gw_user_folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 连结：自己的随便动；在分享给我的文件夹里的看得到
drop policy if exists gw_user_links_own on public.gw_user_links;
drop policy if exists gw_user_links_select on public.gw_user_links;
create policy gw_user_links_select on public.gw_user_links
  for select to authenticated
  using (user_id = (select auth.uid()) or folder_id in (select public.gw_my_shared_folder_ids()));
drop policy if exists gw_user_links_write on public.gw_user_links;
create policy gw_user_links_write on public.gw_user_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 版面（App 在哪个文件夹）：在分享给我的文件夹里的看得到
drop policy if exists gw_user_layout_select on public.gw_user_layout;
create policy gw_user_layout_select on public.gw_user_layout
  for select to authenticated
  using (user_id = (select auth.uid()) or folder_id in (select public.gw_my_shared_folder_ids()));

select count(*) as shared_folders from public.gw_user_folders where is_shared;
