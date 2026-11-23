-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 清掉旧的 Diesel Claims（已经搬到 CMMS 2 / Machinery Portal 自己的资料库）
--  先看第 1 段的数量；确定不要这些旧资料了，再把第 2 段前面的 /* */ 拿掉执行。
--  这会删掉：diesel_* 六张表、它们的函数和 RLS。收据的 storage bucket 要在 Storage 画面手动删。
--  删掉就不能复原：要留底的话，先在 Table Editor 把每张表 Export 成 CSV。
-- =====================================================================

-- 1. 旧表里还有多少资料
select 'diesel_vehicles' as t, count(*) from public.diesel_vehicles
union all select 'diesel_claims', count(*) from public.diesel_claims
union all select 'diesel_cards', count(*) from public.diesel_cards
union all select 'diesel_card_reloads', count(*) from public.diesel_card_reloads
union all select 'diesel_card_usage', count(*) from public.diesel_card_usage
union all select 'diesel_user_access', count(*) from public.diesel_user_access
union all select 'receipt files', count(*) from storage.objects where bucket_id = 'diesel-receipts';

/*
-- 2. 真的要删才执行这一段
drop table if exists public.diesel_card_usage cascade;
drop table if exists public.diesel_card_reloads cascade;
drop table if exists public.diesel_cards cascade;
drop table if exists public.diesel_claims cascade;
drop table if exists public.diesel_user_access cascade;
drop table if exists public.diesel_vehicles cascade;
drop function if exists public.diesel_can_use() cascade;
drop function if exists public.diesel_is_admin() cascade;
drop function if exists public.diesel_user_has_access(uuid) cascade;
drop function if exists public.diesel_can_claim() cascade;
drop function if exists public.diesel_can_report() cascade;
drop function if exists public.diesel_people() cascade;
drop function if exists public.diesel_claims_guard() cascade;
select 'old diesel tables removed' as done;
-- 收据的 storage bucket（diesel-receipts）不能用 SQL 删：到 Supabase → Storage，把档案全选删掉，再删 bucket。
*/
