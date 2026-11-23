-- 小工具多一种：weather（天气）
-- 只是把允许的小工具种类清单加一项；现有的小工具不受影响。
alter table public.gw_user_widgets drop constraint if exists gw_user_widgets_widget_type_check;
alter table public.gw_user_widgets
  add constraint gw_user_widgets_widget_type_check
  check (widget_type in ('clock', 'greeting', 'announcements', 'recent', 'search', 'admin', 'notes', 'calendar', 'weather'));
