# 资料库更新（Supabase migrations）怎么跑

网站（GitHub Pages）和 Edge Functions 推到 `main` 就会自动发布；**资料库不会**。
每个资料库更新都是 `supabase/migrations/` 里的一个 `.sql` 档，要有人手动在 Supabase 跑。

## 跑一个新的更新

1. Supabase → **MJM Intranet** 项目（ref `briqzyxfxsvulyizzbiu`）→ **SQL Editor**
2. 把那个 `.sql` 档整个贴上 → **Run**
3. 一次跑一个，照档名（日期）顺序；每个档都可以重复跑
4. 最后的检查结果照档案最下面的说明（通常应该是 true / 0）

## 查哪些还没跑

跑 [`check-database.sql`](check-database.sql)：结果是 **No rows** 就代表全部都跑过了。
它比对的是资料表 `gw_migrations`（每个更新档最后一行会把自己的名字记进去）。

## 写新的更新档（给开发的人）

- 档名：`YYYYMMDDHHMMSS_说明.sql`，放在 `supabase/migrations/`
- 要可以重复执行（`if not exists`、`create or replace`、`drop ... if exists`）
- 不要用旧版本盖掉之后档案改过的函式
- 档案最后一定加：
  ```sql
  insert into public.gw_migrations (name) values ('<档名，不含 .sql>') on conflict (name) do nothing;
  notify pgrst, 'reload schema';
  ```
- 在 `docs/check-database.sql` 的清单最后加一行同样的档名

## 历史

2026-11 检查时发现线上漏跑了 20261201110000、20261201120000、20261201130000、20261201140000、
20261201200000、20261203100000（当时旧的 `run-these-sql-in-order.sql` 只列了 6 个旧档）。
已在 20261211100000～20261213100000 补齐，`gw_migrations` 从 20261213100000 开始记录。
