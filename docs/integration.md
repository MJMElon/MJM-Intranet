# 目标系统接入 Gateway

## 接入级别

| 级别 | 说明 | 目标系统要做什么 |
| --- | --- | --- |
| 1 外部链接 | Gateway 只是打开网址 | 不用改，目标系统照常自己登录 |
| 2 Token 跳转 | Gateway 带 60 秒 Token 跳转，免登录进入 | 验证 Token，见下文 |
| 3 SSO | 目标系统直接用同一个 Supabase Auth | 目前和第 1 级相同，直接打开网址 |

## 用程式码接入（建议）

不用在 Master Manage → Module 里按：每个要接入的系统（repo）在 `supabase/migrations/` 放一个小 migration，
呼叫 `gw_register_system(...)`（见 `20261120100000_gw_register_system.sql`），一次完成新增 / 更新 Icon、
设定 API Key（只存 SHA-256）、标签 Business / Company。范例：`20261120100100_system_machinery_portal.sql`
（Machinery Portal）。可以重复执行。API Key 明文由你自己决定（至少 24 个字），同一把 key 放进目标系统的 secret
（Machinery Portal：`GW_API_KEY`）。

**这些 migration 在 MJM Intranet 的资料库执行**（Supabase 项目 `briqzyxfxsvulyizzbiu`），不是目标系统的资料库。

## 第 2 级：Token 跳转

1. 超级管理员在「权限后台 → 模块」把模块设成「2 · Token 跳转」，并按「产生 API Key」（Key 只显示一次）；
   或者用上面的 `gw_register_system(...)` 由程式码设定。
2. 用户在 Gateway 点模块后，Gateway 调用 `gw-issue-token`，浏览器被导向：

   ```
   https://目标系统网址?gw_token=<JWT>
   ```

3. 目标系统**在服务端**用 API Key 兑换 Token：

   ```http
   POST https://briqzyxfxsvulyizzbiu.supabase.co/functions/v1/gw-check-access
   x-gw-api-key: gwk_...
   Content-Type: application/json

   { "token": "<gw_token>" }
   ```

   回应：

   ```json
   { "allowed": true, "module_code": "DIESEL-HQ",
     "user": { "id": "…", "email": "…", "full_name": "…" } }
   ```

   - 每个 Token 只能兑换一次（第二次回 `409 token_already_used`）
   - Token 60 秒后过期；签名不对、模块不符都回 `invalid_token`
   - 兑换时会再检查一次目前权限（帐号停用、模块下架、个人禁止都会回 `allowed: false`）

4. 兑换成功后，目标系统建立自己的 session，并把网址上的 `gw_token` 去掉。

### Token 内容（ES256 JWT）

| 栏位 | 内容 |
| --- | --- |
| `iss` | `mjm-gateway` |
| `aud` / `mod` | 模块代码，例如 `DIESEL-HQ` |
| `sub` | Gateway 用户 id |
| `email` | 用户 email |
| `jti` | Token 唯一编号 |
| `exp` | 签发后 60 秒 |

如果只想自行验证签名（不经过兑换接口），公钥在 `GET /functions/v1/gw-jwks`。但这样无法保证 Token 只用一次，建议用兑换接口。

## 同步主资料（Business / Company）

接入的系统可以用同一把 API Key 取得 Intranet 的 Business、Company、连结，以及哪些 Company 标签了这个 Icon，
自己同步到它的资料库（CMMS 2 每次有人从 Intranet 登录时同步一次，也有「Sync from MJM Intranet」按钮）：

```http
POST /functions/v1/gw-master-data
x-gw-api-key: gwk_...

{}
```

回应：`{ module_code, module_users: [{id, email, full_name, is_admin}]（目前可以用这个 Icon 的人）, businesses: [{id, name, description, sort_order}], companies: [{id, code, name, short_name, registration_no, description, is_active, sort_order}], links: [{group_id, company_id}], module_company_ids: [...], module_business_ids: [...], exported_at }`

Edge Functions 由 GitHub Actions 部署（`.github/workflows/functions.yml`，需要 repo secret `SUPABASE_ACCESS_TOKEN`）。

## 查询权限

目标系统随时可以确认某人现在还能不能用这个模块（例如每次 session 续期时）：

```http
POST /functions/v1/gw-check-access
x-gw-api-key: gwk_...

{ "user_id": "…" }      或      { "email": "someone@example.com" }
```

API Key 绑定单一模块：一个系统的 Key 不能查询其他模块的权限。
