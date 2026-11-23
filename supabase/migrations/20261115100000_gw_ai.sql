-- =====================================================================
-- AI 聊天小工具
--  - gw_ai_usage：每人每天问了几次（Edge Function 用 service_role 记；前端不能读写），用来控制费用
--  - gw_ai_take(用户, 每天上限)：次数 +1 并回传还剩几次；超过上限回传 -1
--  - 小工具种类多一种：ai
-- 只新增（小工具种类清单换成多一项的新清单）。
-- =====================================================================

create table public.gw_ai_usage (
  user_id  uuid not null references public.gw_profiles (id) on delete cascade,
  day      date not null,
  calls    integer not null default 0,
  primary key (user_id, day)
);
alter table public.gw_ai_usage enable row level security;
revoke all on public.gw_ai_usage from anon, authenticated;

create function public.gw_ai_take(p_user uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day   date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_calls integer;
begin
  insert into public.gw_ai_usage as u (user_id, day, calls) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set calls = u.calls + 1 where u.calls < p_limit
  returning u.calls into v_calls;
  if v_calls is null then
    return -1;
  end if;
  return p_limit - v_calls;
end;
$$;
revoke execute on function public.gw_ai_take(uuid, integer) from public, anon, authenticated;
grant execute on function public.gw_ai_take(uuid, integer) to service_role;

alter table public.gw_user_widgets drop constraint if exists gw_user_widgets_widget_type_check;
alter table public.gw_user_widgets
  add constraint gw_user_widgets_widget_type_check
  check (widget_type in ('clock', 'greeting', 'announcements', 'recent', 'search', 'admin', 'notes', 'calendar', 'weather', 'ai'));
