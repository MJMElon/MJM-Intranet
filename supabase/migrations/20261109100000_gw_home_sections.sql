-- =====================================================================
-- 主页：每个 Business 一个区块（Section box）
--  - gw_user_sections：每个人每个 Business 区块是展开还是收起
--  - gw_user_section_items：区块里的东西和顺序（App、文件夹、便条）；
--    App 没有记录时，主页自动按默认顺序补在后面
-- 只新增；每个人只能看、改自己的资料。
-- =====================================================================

create table public.gw_user_sections (
  user_id   uuid not null references public.gw_profiles (id) on delete cascade,
  group_id  uuid not null references public.gw_groups (id) on delete cascade,
  expanded  boolean not null default false,
  primary key (user_id, group_id)
);

create table public.gw_user_section_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.gw_profiles (id) on delete cascade,
  group_id    uuid not null references public.gw_groups (id) on delete cascade,
  kind        text not null check (kind in ('module', 'folder', 'note')),
  module_id   uuid references public.gw_modules (id) on delete cascade,
  parent_id   uuid references public.gw_user_section_items (id) on delete cascade,
  name        text check (char_length(name) <= 40),
  body        text check (char_length(body) <= 2000),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  check ((kind = 'module') = (module_id is not null))
);
create unique index gw_user_section_items_module_uq on public.gw_user_section_items (user_id, group_id, module_id) where kind = 'module';
create index gw_user_section_items_user_idx on public.gw_user_section_items (user_id, group_id);

alter table public.gw_user_sections enable row level security;
alter table public.gw_user_section_items enable row level security;
revoke all on public.gw_user_sections, public.gw_user_section_items from anon;

create policy gw_user_sections_own on public.gw_user_sections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy gw_user_section_items_own on public.gw_user_section_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
