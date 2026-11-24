-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 文件夹可以分享给「好几个」Business（以前只能一个）
--   gw_folder_business_shares：一行 = 这个文件夹分享给这个 Business（Viewer / Editor）
--   那个 Business 的人都看得到、打得开，而且会出现在首页那个 Business 的方块里
--   以前的单一设定（gw_user_folders.tag_group_id …）自动搬过来
--   只有文件夹拥有者能改；只能分享给自己所在的 Business（Super Admin 不限）
-- 可以重复执行。
-- =====================================================================

create table if not exists public.gw_folder_business_shares (
  folder_id  uuid not null references public.gw_user_folders (id) on delete cascade,
  group_id   uuid not null references public.gw_groups (id) on delete cascade,
  company_id uuid,
  role       text not null default 'view' check (role in ('view', 'edit')),
  created_at timestamptz not null default now(),
  primary key (folder_id, group_id),
  foreign key (group_id, company_id) references public.gw_business_companies (group_id, company_id) on delete cascade
);
create index if not exists gw_folder_business_shares_group_idx on public.gw_folder_business_shares (group_id);
alter table public.gw_folder_business_shares enable row level security;
revoke all on public.gw_folder_business_shares from anon;

-- 以前的单一 Business 设定搬过来（有那些栏位才搬）
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gw_user_folders' and column_name = 'tag_group_id') then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gw_user_folders' and column_name = 'tag_role') then
      execute 'insert into public.gw_folder_business_shares (folder_id, group_id, company_id, role)
               select f.id, f.tag_group_id, f.tag_company_id, coalesce(f.tag_role, ''view'') from public.gw_user_folders f
                where f.tag_group_id is not null
               on conflict (folder_id, group_id) do nothing';
    else
      execute 'insert into public.gw_folder_business_shares (folder_id, group_id, company_id, role)
               select f.id, f.tag_group_id, f.tag_company_id, ''view'' from public.gw_user_folders f
                where f.tag_group_id is not null
               on conflict (folder_id, group_id) do nothing';
    end if;
  end if;
end $$;

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

-- 这一行 Business 分享有没有包括我（在那个 Business；有指定 Company 的话也要在那家 Company）
create or replace function public.gw__biz_share_covers_me(p_group uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gw_is_super_admin()
      or (
        exists (select 1 from public.gw_group_members gm where gm.group_id = p_group and gm.user_id = auth.uid())
        and (
          p_company is null
          or exists (select 1 from public.gw_member_companies mc where mc.group_id = p_group and mc.company_id = p_company and mc.user_id = auth.uid())
        )
      )
$$;

-- 分享给我的文件夹：一个一个人分享的 ＋ 分享给我所在 Business 的
create or replace function public.gw_my_shared_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.folder_id from public.gw_folder_shares s where s.user_id = auth.uid()
  union
  select b.folder_id
    from public.gw_folder_business_shares b
    join public.gw_user_folders f on f.id = b.folder_id
   where f.user_id <> auth.uid() and public.gw__biz_share_covers_me(b.group_id, b.company_id)
$$;

-- 我是 Editor 的文件夹
create or replace function public.gw_my_edit_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.folder_id from public.gw_folder_shares s where s.user_id = auth.uid() and s.role = 'edit'
  union
  select b.folder_id
    from public.gw_folder_business_shares b
    join public.gw_user_folders f on f.id = b.folder_id
   where b.role = 'edit' and f.user_id <> auth.uid() and public.gw__biz_share_covers_me(b.group_id, b.company_id)
$$;

revoke all on function public.gw__in_business(uuid), public.gw__biz_share_covers_me(uuid, uuid), public.gw_my_shared_folder_ids(), public.gw_my_edit_folder_ids() from public, anon;
grant execute on function public.gw__in_business(uuid), public.gw__biz_share_covers_me(uuid, uuid), public.gw_my_shared_folder_ids(), public.gw_my_edit_folder_ids() to authenticated;

-- 谁看得到 / 改得到这些分享设定
drop policy if exists gw_folder_business_shares_select on public.gw_folder_business_shares;
create policy gw_folder_business_shares_select on public.gw_folder_business_shares
  for select to authenticated
  using (
    exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
    or folder_id in (select public.gw_my_shared_folder_ids())
  );
drop policy if exists gw_folder_business_shares_write on public.gw_folder_business_shares;
create policy gw_folder_business_shares_write on public.gw_folder_business_shares
  for all to authenticated
  using (exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.gw_user_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
    and (select public.gw__in_business(group_id))
  );

-- 检查：每个文件夹分享给哪些 Business
select f.name as folder, g.name as business, b.role
  from public.gw_folder_business_shares b
  join public.gw_user_folders f on f.id = b.folder_id
  join public.gw_groups g on g.id = b.group_id
 order by f.name, g.name;
