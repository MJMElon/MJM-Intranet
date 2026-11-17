-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 登录密码打错：不再锁 15 分钟
--  - gw_login_failed 只记次数，不再设 locked_until
--  - gw_login_locked_until 永远回 null；现有的锁定全部解除
-- 可以重复执行。
-- =====================================================================

create or replace function public.gw_login_locked_until(p_email text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select null::timestamptz
$$;

create or replace function public.gw_login_failed(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.gw_login_attempts;
begin
  insert into public.gw_login_attempts as a (email, failed_count, updated_at)
  values (v_email, 1, now())
  on conflict (email) do update
    set failed_count = a.failed_count + 1,
        locked_until = null,
        updated_at = now()
  returning * into v_row;
  return jsonb_build_object('failed_count', v_row.failed_count, 'locked_until', null);
end;
$$;

update public.gw_login_attempts set locked_until = null where locked_until is not null;

select count(*) as still_locked from public.gw_login_attempts where locked_until is not null;
