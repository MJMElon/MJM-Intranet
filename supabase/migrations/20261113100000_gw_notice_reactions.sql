-- =====================================================================
-- Notice Board 的表情反应：👍（like）、❤️（love）、🎉（congrats）
--  - gw_notice_reactions：谁对哪一则公告按了哪个反应（每人每则每种最多一个）
--  - 看得到那则公告的人，才看得到它的反应、也才能按反应；只能改自己的
--  - gw_get_notice_reactions(ids)：一次拿多则公告的反应，附上按的人的名字（点反应时显示是谁按的）
-- 只新增。
-- =====================================================================

create table public.gw_notice_reactions (
  announcement_id  uuid not null references public.gw_announcements (id) on delete cascade,
  user_id          uuid not null references public.gw_profiles (id) on delete cascade,
  emoji            text not null check (emoji in ('like', 'love', 'congrats')),
  created_at       timestamptz not null default now(),
  primary key (announcement_id, user_id, emoji)
);
create index gw_notice_reactions_user_idx on public.gw_notice_reactions (user_id);

alter table public.gw_notice_reactions enable row level security;
revoke all on public.gw_notice_reactions from anon;

-- 看得到公告（公告自己的 RLS）就看得到它的反应
create policy gw_notice_reactions_select on public.gw_notice_reactions
  for select to authenticated
  using (exists (select 1 from public.gw_announcements a where a.id = announcement_id));
create policy gw_notice_reactions_insert on public.gw_notice_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.gw_announcements a where a.id = announcement_id)
  );
create policy gw_notice_reactions_delete on public.gw_notice_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- 名字：一般用户看不到别人的个人资料，所以用 definer 函数只取名字
create function public.gw__display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.gw_profiles p where p.id = p_user
$$;

-- 用调用者的身份查（RLS 照常生效），所以只会拿到看得到的公告的反应
create function public.gw_get_notice_reactions(p_ids uuid[])
returns table (announcement_id uuid, emoji text, user_id uuid, full_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.announcement_id, r.emoji, r.user_id, public.gw__display_name(r.user_id)
  from public.gw_notice_reactions r
  where r.announcement_id = any (p_ids)
  order by r.created_at
$$;

revoke execute on function public.gw__display_name(uuid), public.gw_get_notice_reactions(uuid[]) from public, anon;
grant execute on function public.gw__display_name(uuid), public.gw_get_notice_reactions(uuid[]) to authenticated;
