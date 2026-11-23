-- =====================================================================
-- AI Connector（让用户用自己的 AI 助手连到公司资料）
--  - gw_settings：全站开关（super_admin 在 Master 里开关），目前只有 ai_connector
--  - gw_mcp_tokens：每个用户自己的连接链接（只存杂凑值，原文只在建立时给用户看一次）
--  - gw_mcp_create / gw_mcp_list / gw_mcp_revoke：用户在 Settings 里建立、查看、撤销；super_admin 可看全部、撤销全部
--  - gw_mcp_resolve：只给 Edge Function（service_role）用：链接 → 用户；停用的用户、已撤销、开关关闭都回传空
-- 只新增，不改动任何现有资料表。
-- =====================================================================

create table public.gw_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.gw_profiles (id) on delete set null
);
alter table public.gw_settings enable row level security;
create policy gw_settings_read on public.gw_settings for select to authenticated using (true);
create policy gw_settings_write on public.gw_settings for all to authenticated
  using ((select public.gw_is_super_admin())) with check ((select public.gw_is_super_admin()));

create function public.gw_mcp_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value ->> 'enabled')::boolean from public.gw_settings where key = 'ai_connector'), false)
$$;
revoke execute on function public.gw_mcp_enabled() from public, anon;
grant execute on function public.gw_mcp_enabled() to authenticated, service_role;

create table public.gw_mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.gw_profiles (id) on delete cascade,
  token_hash   text not null unique,
  label        text not null default 'My AI',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index gw_mcp_tokens_user_idx on public.gw_mcp_tokens (user_id);
alter table public.gw_mcp_tokens enable row level security;
revoke all on public.gw_mcp_tokens from anon, authenticated;

-- 建立链接：回传 { id, token }；token 原文只在这里出现一次
create function public.gw_mcp_create(p_label text default 'My AI')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.gw_profiles where id = auth.uid() and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.gw_mcp_enabled() then
    raise exception 'connector_off' using errcode = 'P0001';
  end if;
  if (select count(*) from public.gw_mcp_tokens where user_id = auth.uid() and revoked_at is null) >= 5 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  v_token := 'gwm_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.gw_mcp_tokens (user_id, token_hash, label)
  values (auth.uid(), encode(sha256(convert_to(v_token, 'utf8')), 'hex'), left(coalesce(nullif(trim(p_label), ''), 'My AI'), 40))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;
revoke execute on function public.gw_mcp_create(text) from public, anon;
grant execute on function public.gw_mcp_create(text) to authenticated;

-- 自己的链接（super_admin 看全部）；不含杂凑值
create function public.gw_mcp_list()
returns table (id uuid, user_id uuid, user_name text, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.user_id, p.full_name, t.label, t.created_at, t.last_used_at, t.revoked_at
  from public.gw_mcp_tokens t
  join public.gw_profiles p on p.id = t.user_id
  where auth.uid() is not null and (t.user_id = auth.uid() or public.gw_is_super_admin())
  order by t.created_at desc
$$;
revoke execute on function public.gw_mcp_list() from public, anon;
grant execute on function public.gw_mcp_list() to authenticated;

create function public.gw_mcp_revoke(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gw_mcp_tokens
  set revoked_at = now()
  where id = p_id and revoked_at is null and auth.uid() is not null and (user_id = auth.uid() or public.gw_is_super_admin())
$$;
revoke execute on function public.gw_mcp_revoke(uuid) from public, anon;
grant execute on function public.gw_mcp_revoke(uuid) to authenticated;

-- Edge Function 用：杂凑值 → 用户 id（无效、已撤销、用户停用、开关关闭都回传空）
create function public.gw_mcp_resolve(p_hash text)
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
  where t.token_hash = p_hash and t.revoked_at is null;
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
