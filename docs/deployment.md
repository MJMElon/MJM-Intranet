# 上线步骤

线上 Supabase 项目：**MJM Intranet**（原 NASA Dashboard，ref `briqzyxfxsvulyizzbiu`）。
网站发布在 **GitHub Pages**：`https://mjmelon.github.io/MJM-Intranet/`（纯 HTML，不需要建置）。

## 架构

- 网站是纯 HTML + JavaScript（跟 mjm-ai-system 同样做法），浏览器直接向 Supabase 读写资料，**所有权限都由数据库 RLS 检查**。
- 需要 service_role 的动作在 Supabase Edge Functions 执行：

| Function | 用途 |
| --- | --- |
| `gw-auth` | 密码登录（超级管理员备用）、改密码（要现在的密码；第一次强制改密码除外） |
| `gw-admin` | 建立用户、Excel 批量导入、停用/启用、重设密码、模块 API Key |
| `gw-issue-token` | 第 2 级接入：签发 60 秒 Token |
| `gw-check-access` | 目标系统兑换 Token / 查询权限 |
| `gw-jwks` | Token 公钥 |
| `gw-opispro` | 用 OPIS PRO 登录（OIDC）；第一次登录的新员工建立「等待批准」帐号（见 opispro-sso.md） |
| `gw-master-data` | 给其他系统读 Business / Company / Location 与模块用户（模块 API Key） |
| `gw-mcp` | AI Connector：用户自己的 AI 助手读资料（连结 180 天过期） |
| `gw-ai-chat` | 主画面 AI 助手（还没开放） |

## 1. 数据库 migration

依序在 Supabase SQL Editor 跑 `supabase/migrations/` 里的档案。步骤和「查哪些还没跑」见 [database-updates.md](database-updates.md)。

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

## 交接 / 安全检查清单

- GitHub（MJMElon）和 Supabase 项目的拥有者用公司帐号
- 换掉前任知道的金钥：GitHub secret `SUPABASE_ACCESS_TOKEN`、Edge Function secrets（`GW_TOKEN_PRIVATE_JWK`、OPIS PRO client secret、AI key）、Admin 里的模块 API Key
- Supabase → Authentication：关闭「Allow new users to sign up」
- 检查超级管理员名单、AI Connector 连结（Admin → AI Connector）
- 跑 [check-database.sql](check-database.sql)，确认没有漏跑的资料库更新

