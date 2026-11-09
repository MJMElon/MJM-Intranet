# MJM Intranet

公司系统统一入口：员工登录一次，就能看到并打开自己有权限的所有系统。
Gateway 只管**认证、授权、导航**，不处理业务资料。

- 网址：https://mjmelon.github.io/MJM-Intranet/
- 前端：纯 HTML + JavaScript（跟 mjm-ai-system 一样），不需要建置；GitHub Pages「从分支发布」
- 函式库（CDN）：Tailwind CSS（@tailwindcss/browser）、supabase-js、SortableJS（拖拉，支持手机长按）、Lucide 图示、ExcelJS（需要时才载入）
- 后端：Supabase 项目 MJM Intranet（ref `briqzyxfxsvulyizzbiu`）：Auth、PostgreSQL、RLS、Edge Functions
- 界面文字：预设英文 `lang/en.js`，另有简体中文 `lang/zh-CN.js`（个人设置可切换）；以后加 `ms.js`

## 档案

```
index.html               主画面（像 iPhone）：App、小工具、文件夹拖拉排版；右下角浮动按钮 Add Widget / Add Apps / New Folder / Edit Home Screen；管理员右上角有齿轮进设置页
login.html               登录封面（MJM 字标 assets/mjm-logo 落下，接着出现白色玻璃登录框）、忘记密码、改密码
library.html             模块库
settings.html            个人设置（语言、浅色/深色、重设首页、改密码）
admin.html               设置页（右上角齿轮）：User & Group Manage（Group Manage、All users）＋ Master Manage（Role、Business、Company、Module）＋ Audit Log；公告在首页 Notice Board 直接发布 / 修改 / 删除
                         Module 只列系统模块（照片、Business / Company 标签）；外部网站由用户在主画面「Add Icon」自己加（gw_user_links）
shared/head.js           每页第一个载入：主题、Tailwind、共用函式库（版本在这里统一改）
shared/config.js         Supabase 网址与 anon key
shared/core.js           登录检查、页面外框、对话框、Edge Function 调用、Excel
shared/home.js           主画面（首页与后台预览共用）；小工具资料存 gw_user_widgets
shared/admin.js          权限后台
lang/en.js lang/zh-CN.js  界面文字（英文 / 简体中文）
supabase/migrations/     数据库 migration（只新增 gw_* 对象）；接入其他系统用 gw_register_system(...)，每个系统一个 *_system_*.sql（见 docs/integration.md）
supabase/functions/      Edge Functions：gw-auth、gw-admin、gw-issue-token、gw-check-access、gw-jwks
supabase/tests/          RLS 权限测试（pgTAP）
scripts/                 产生签名金钥、本地测试资料
docs/                    目标系统接入说明、上线步骤
```

## 权限模型

- **Icon**（`gw_modules`，以前叫「模块」）：`kind` = `system`（MJM Intranet 旗下 / 自家的系统，例如 CMMS 2、Diesel Manage、Stock）或 `link`（任何外部网站）
  - Diesel Manage 已搬到 CMMS 2（repo MJM-Machinery-Portal）；Intranet 上的「Diesel Manage」Icon 直接进入 CMMS 2 的 Diesel Manage 页面（Token 跳转）。旧的 `diesel_*` 资料表仍在资料库里，不再使用。
  - 标签：Business（`gw_group_modules`）＋ Company（`gw_module_companies`）
- **Company**（`gw_companies`）是独立主资料：固定的代码（`code`）、简称、注册号码；可以属于多个 Business（`gw_business_companies`）
  - 对应到现有系统：`gw_company_mappings`（Company × 系统 Icon → 那个系统里的 ID / 名称），之后资料对接用
- **Business**（`gw_groups`）底下有 Icon 和 Company
- 用户放进 Business 后「有机会」用它的模块，但一开始看不到；要逐个模块打开（`gw_module_members`）
  - **有效权限** = 开给他的模块 ∩ 他所属 Business 的模块
  - 每个模块对每个人两个勾：**Access**（可以用）、**Admin**（模块管理员，一定也有 Access）
- 帐号停用或模块下架 → 全部看不到；没有权限的模块连名字都不显示
- 所有检查都在数据库 RLS / 函数里做；网页上的页面保护只负责导航，绕过前端也拿不到没权限的资料
- **权限和版面分开存**：权限关掉的模块不显示，但 `gw_user_layout` 记录保留；权限开回来，原位置还在
- 谁能管
  - `super_admin`：全部（用户、角色、Business、Company、模块、公告、操作记录）
  - **自订角色**（`gw_roles`，例如 HR）：super_admin 命名，勾选功能，并勾选负责的范围
    - 功能：更新公告栏、删除公告、把人加进模块、把人从模块移除、设定模块 Admin、把人放进 Business、看用户名单、看操作记录
    - 范围：负责哪些 Business（`gw_role_businesses`）＋ 每个 Business 底下哪些模块（`gw_role_modules`）；功能只在范围内有效
    - 没有角色的人 = 一般用户
  - **模块 Admin**：可以把这个模块开给 / 收回同一个 Business 的人，但不能指定别人当 Admin
  - 都不能改自己的权限，也不能动 super_admin
- 操作记录 `gw_audit_logs` 由触发器自动写入，不能修改、不能删除（连 service_role 也不行）；只有 super_admin 看得到

## 本地开发

```bash
npm install                          # 只装本地工具（seed、金钥）
npx supabase start                   # 本地 Supabase（需要 Docker），套用 migration
npx supabase test db                 # RLS 权限测试
npx supabase functions serve         # Edge Functions（需要 supabase/functions/.env 的 GW_TOKEN_PRIVATE_JWK）
npm run serve                        # 静态网站 http://localhost:3000
```

在浏览器 Console 执行一次，让本机网页连到本地 Supabase：

```js
localStorage.setItem("gw_local_config", JSON.stringify({ supabaseUrl: "http://127.0.0.1:54321", supabaseAnonKey: "<npx supabase status 显示的 anon key>" }))
```

本地测试帐号：`.env.local` 放 `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 后执行 `npm run seed`（密码 Passw0rd123）。

## 已知限制

- **登录锁定**（连续输错 5 次锁 15 分钟）在 `gw-auth` Edge Function 里执行。anon key 是公开的，直接调用 Supabase Auth API 可以绕过，只受 Supabase 本身的频率限制。要完全堵住需要 Password Verification Hook（部分付费方案才有）。
- **第 3 级（SSO）** 目前和第 1 级一样直接打开网址。
- 模块名称、说明目前只有一种语言（资料库栏位）。

上线步骤见 [docs/deployment.md](docs/deployment.md)，目标系统接入见 [docs/integration.md](docs/integration.md)。
