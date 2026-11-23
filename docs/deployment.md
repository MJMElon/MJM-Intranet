# 上线步骤

线上 Supabase 项目：**MJM Intranet**（原 NASA Dashboard，ref `briqzyxfxsvulyizzbiu`）。
网站发布在 **GitHub Pages**：`https://mjmelon.github.io/MJM-Intranet/`（纯 HTML，不需要建置）。

## 架构

- 网站是纯 HTML + JavaScript（跟 mjm-ai-system 同样做法），浏览器直接向 Supabase 读写资料，**所有权限都由数据库 RLS 检查**。
- 需要 service_role 的动作在 Supabase Edge Functions 执行：

| Function | 用途 |
| --- | --- |
| `gw-auth` | 登录（含连续输错 5 次锁 15 分钟）、改密码后清除强制改密码标记 |
| `gw-admin` | 建立用户、Excel 批量导入、停用/启用、重设密码、模块 API Key |
| `gw-issue-token` | 第 2 级接入：签发 60 秒 Token |
| `gw-check-access` | 目标系统兑换 Token / 查询权限 |
| `gw-jwks` | Token 公钥 |

## 1. 数据库 migration

依序套用 `supabase/migrations/` 里的档案（只新增 `gw_*` 对象）。
`20261029120000_drop_ai_management.sql` 是移除项目里原本不再使用的「AI 管理」表的记录。

## 2. 第一位超级管理员

```sql
insert into public.gw_profiles (id, email, full_name, role, must_change_password)
select id, email, '名字', 'super_admin', false
from auth.users
where email = 'you@example.com';
```

（目前是 coco.lau@puigroups.com）

## 3. Edge Functions

GitHub → Actions → **Deploy Edge Functions**（需要 repo secret `SUPABASE_ACCESS_TOKEN`；改到 `supabase/functions/` 推到 main 也会自动跑）。或用终端：

```bash
npx supabase functions deploy gw-auth gw-admin gw-issue-token gw-check-access gw-jwks gw-master-data --project-ref briqzyxfxsvulyizzbiu --no-verify-jwt --yes
```

第 2 级 Token 需要签名私钥：

```bash
node scripts/generate-token-key.mjs
```

把输出贴到 Supabase → Edge Functions → Secrets，名称 `GW_TOKEN_PRIVATE_JWK`。

## 4. GitHub Pages

GitHub repo → Settings → Pages → Build and deployment：
- Source：**Deploy from a branch**
- Branch：**main**，资料夹 **/ (root)**

之后每次推送到 `main`，1–2 分钟后网站就会更新（repo 根目录的 `index.html` 就是首页）。

## 5. Supabase Auth 设定（忘记密码需要）

- Authentication → URL Configuration
  - Site URL：`https://mjmelon.github.io/MJM-Intranet/`
  - Redirect URLs：加入 `https://mjmelon.github.io/MJM-Intranet/**`
- Authentication → Emails：设定 SMTP（内建邮件每小时只能寄很少封）
