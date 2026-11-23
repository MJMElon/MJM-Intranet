-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261201130000_gw_folder_share_guards.sql first.
-- =====================================================================
-- 安全加强
--  1) 「必须改密码」：用户不能自己清掉（只有伺服器在真的改完密码后才清）
--  2) 连结图示照片：只接受传到 Intranet 自己的照片（旧资料不检查，之后新增 / 修改才检查）
--  3) AI Connector 连结：180 天后过期（旧的从建立日算起）
--  4) 转移文件夹拥有者：改成「请求 → 对方接受」，不能直接塞给别人
-- 可以重复执行。
-- =====================================================================

-- ---------- 1) 自己只能改：语言、主题、版面初始化
create or replace function public.gw_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_self_cols constant text[] := array['locale', 'theme', 'layout_initialized', 'updated_at'];
begin
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  if new.id <> old.id or lower(new.email) <> lower(old.email) then
    raise exception 'gw: id/email cannot be changed here' using errcode = '42501';
  end if;

  if public.gw_is_super_admin() then
    if old.id = auth.uid() and (new.role <> old.role or new.status <> old.status or new.role_id is distinct from old.role_id) then
      raise exception 'gw: super_admin cannot change own role or status' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.id = auth.uid() and (to_jsonb(new) - v_self_cols) = (to_jsonb(old) - v_self_cols) then
    return new;
  end if;
  raise exception 'gw: you can only change your own preferences' using errcode = '42501';
end;
$$;

-- ---------- 2) 连结照片只能是 Intranet 储存里的
alter table public.gw_user_links drop constraint if exists gw_user_links_image_own_storage;
alter table public.gw_user_links
  add constraint gw_user_links_image_own_storage
  check (image_url is null or image_url like 'https://briqzyxfxsvulyizzbiu.supabase.co/storage/v1/object/public/%') not valid;

-- ---------- 3) AI Connector 连结过期
alter table public.gw_mcp_tokens add column if not exists expires_at timestamptz;
alter table public.gw_mcp_tokens alter column expires_at set default (now() + interval '180 days');
update public.gw_mcp_tokens set expires_at = created_at + interval '180 days' where expires_at is null;

create or replace function public.gw_mcp_resolve(p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_user uuid;
  v_last timestamptz;
begin
  select t.id, t.user_id, t.last_used_at into v_id, v_user, v_last
  from public.gw_mcp_tokens t
  join public.gw_profiles p on p.id = t.user_id and p.status = 'active'
  where t.token_hash = p_hash and t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
  if v_id is null or not public.gw_mcp_enabled() then
    return null;
  end if;
  if v_last is null or v_last < now() - interval '1 minute' then
    update public.gw_mcp_tokens set last_used_at = now() where id = v_id;
  end if;
  return v_user;
end;
$$;
revoke execute on function public.gw_mcp_resolve(text) from public, anon, authenticated;
grant execute on function public.gw_mcp_resolve(text) to service_role;

drop function if exists public.gw_mcp_list();
create function public.gw_mcp_list()
returns table (id uuid, user_id uuid, user_name text, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.user_id, p.full_name, t.label, t.created_at, t.last_used_at, t.revoked_at, t.expires_at
  from public.gw_mcp_tokens t
  join public.gw_profiles p on p.id = t.user_id
  where auth.uid() is not null and (t.user_id = auth.uid() or public.gw_is_super_admin())
  order by t.created_at desc
$$;
revoke execute on function public.gw_mcp_list() from public, anon;
grant execute on function public.gw_mcp_list() to authenticated;

-- ---------- 4) 转移拥有者：请求 → 接受
create table if not exists public.gw_folder_transfers (
  folder_id  uuid primary key references public.gw_user_folders (id) on delete cascade,
  from_user  uuid not null references public.gw_profiles (id) on delete cascade,
  to_user    uuid not null references public.gw_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.gw_folder_transfers enable row level security;
revoke all on public.gw_folder_transfers from anon;
drop policy if exists gw_folder_transfers_select on public.gw_folder_transfers;
create policy gw_folder_transfers_select on public.gw_folder_transfers
  for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));

-- 真正的转移（只给下面的函数用）
create or replace function public.gw__transfer_folder(p_folder uuid, p_old uuid, p_new uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_sort integer;
  v_new_sort integer;
begin
  select f.sort_order into v_old_sort from public.gw_user_folders f where f.id = p_folder and f.user_id = p_old for update;
  if not found then
    raise exception 'gw: folder owner changed' using errcode = '42501';
  end if;
  select s.sort_order into v_new_sort from public.gw_folder_shares s where s.folder_id = p_folder and s.user_id = p_new;
  delete from public.gw_folder_shares s where s.folder_id = p_folder and s.user_id = p_new;
  update public.gw_user_layout l set folder_id = null where l.folder_id = p_folder and l.user_id = p_old;
  update public.gw_user_folders f set user_id = p_new, is_shared = true, sort_order = coalesce(v_new_sort, f.sort_order) where f.id = p_folder;
  update public.gw_user_links k set user_id = p_new where k.folder_id = p_folder;
  insert into public.gw_folder_shares (folder_id, user_id, role, sort_order)
  values (p_folder, p_old, 'edit', coalesce(v_old_sort, 0))
  on conflict (folder_id, user_id) do update set role = 'edit';
end $$;
revoke all on function public.gw__transfer_folder(uuid, uuid, uuid) from public, anon, authenticated;

-- 不能再直接转（以前的版本）
drop function if exists public.gw_transfer_folder(uuid, uuid);

-- 拥有者送出请求
create or replace function public.gw_request_folder_transfer(p_folder uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.gw_user_folders f where f.id = p_folder and f.user_id = auth.uid()) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  if p_to is null or p_to = auth.uid()
     or not exists (select 1 from public.gw_profiles p where p.id = p_to and p.status = 'active') then
    raise exception 'gw: user not found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.gw_folder_shares s where s.folder_id = p_folder and s.user_id = p_to)
     and not exists (select 1 from public.gw_folder_share_candidates() c where c.id = p_to) then
    raise exception 'gw: cannot transfer to this user' using errcode = '42501';
  end if;
  insert into public.gw_folder_transfers (folder_id, from_user, to_user)
  values (p_folder, auth.uid(), p_to)
  on conflict (folder_id) do update set from_user = excluded.from_user, to_user = excluded.to_user, created_at = now();
end $$;

-- 拥有者取消请求
create or replace function public.gw_cancel_folder_transfer(p_folder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.gw_folder_transfers t where t.folder_id = p_folder and t.from_user = auth.uid()
$$;

-- 给我的请求（还看不到文件夹也要知道名字）
create or replace function public.gw_my_folder_transfers()
returns table (folder_id uuid, folder_name text, from_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.folder_id, f.name, p.full_name, t.created_at
  from public.gw_folder_transfers t
  join public.gw_user_folders f on f.id = t.folder_id and f.user_id = t.from_user
  join public.gw_profiles p on p.id = t.from_user
  where t.to_user = auth.uid()
  order by t.created_at
$$;

-- 接受 / 拒绝
create or replace function public.gw_answer_folder_transfer(p_folder uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
begin
  select t.from_user into v_from from public.gw_folder_transfers t where t.folder_id = p_folder and t.to_user = auth.uid() for update;
  if v_from is null then
    raise exception 'gw: no such request' using errcode = '22023';
  end if;
  delete from public.gw_folder_transfers t where t.folder_id = p_folder;
  if p_accept then
    perform public.gw__transfer_folder(p_folder, v_from, auth.uid());
  end if;
end $$;

revoke all on function public.gw_request_folder_transfer(uuid, uuid), public.gw_cancel_folder_transfer(uuid),
  public.gw_my_folder_transfers(), public.gw_answer_folder_transfer(uuid, boolean) from public, anon;
grant execute on function public.gw_request_folder_transfer(uuid, uuid), public.gw_cancel_folder_transfer(uuid),
  public.gw_my_folder_transfers(), public.gw_answer_folder_transfer(uuid, boolean) to authenticated;

-- 检查：应该看到 gw_folder_transfers 和 expires_at
select 'gw_folder_transfers' as item, to_regclass('public.gw_folder_transfers') is not null as ok
union all
select 'gw_mcp_tokens.expires_at', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gw_mcp_tokens' and column_name = 'expires_at');
