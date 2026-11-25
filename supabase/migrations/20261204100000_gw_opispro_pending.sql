-- 第一次用 OPIS PRO 登入、Intranet 还没有帐号的人：自动开一个「等待批准」的帐号（status = disabled + pending_approval）
-- 管理员在 Users 看到「Waiting for approval」，按「Approve」（= 启用帐号）之后才能进来；启用时 pending_approval 会清掉
alter table public.gw_profiles add column if not exists pending_approval boolean not null default false;
