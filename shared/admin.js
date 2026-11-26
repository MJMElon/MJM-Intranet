/* ================================================================
   MJM Intranet — 权限后台
   分页：用户、权限矩阵、群组、模块、部门、公告、操作记录、预览（#preview=用户id）
   读写都以当前用户身份直接连 Supabase，RLS 决定能看、能改什么；
   需要 service_role 的动作（建立用户、重设密码、停用、API Key）走 gw-admin Edge Function。
   ================================================================ */
(async function () {
  const { sb, t, esc, $, $$, icon, moduleIcon, cls, btn, badge, alertBox, modal, confirmDialog, toast, invoke, refreshIcons, fmtDateTime } = GW;
  const me = await GW.requireProfile("manage");
  if (!me) return;
  const isSuper = me.role === "super_admin";
  const main = GW.shell(me, "admin");

  /* 设置页（右上角齿轮进来）：
     super_admin → 两个大按钮：User & Group Manage（全部用户 / 群组列表 / 模块权限）、
                   Master Manage（角色、Business、Company、模块、公告、操作记录）
     自订角色    → 依角色功能：用户名单（只看）、群组列表、模块权限、操作记录
     模块管理员  → 模块权限（自己管理的模块）
     公告直接在首页的 Notice Board 发布、修改、删除 */
  const C = me.can;
  const canAccessPage = isSuper || C.can_view_user_group || C.can_grant_module || C.can_revoke_module || C.can_set_module_admin || me.adminModules > 0;
  const canGroupsPage = isSuper || C.can_view_user_group || C.can_add_business_user || C.can_remove_business_user;
  const canUsersPage = isSuper || C.can_view_users || canAccessPage;
  const SECTIONS = isSuper
    ? [
        ["userGroup", "users-round", ["users"]],
        ["master", "database", ["structure", "roles", "connector"]],
        ["audit", "scroll-text", ["audit"]],
      ]
    : [
        ["userGroup", "users-round", canGroupsPage || canUsersPage || canAccessPage ? ["users"] : []],
        ...(C.can_edit_module_name || C.can_delete_business || C.can_delete_company || C.can_delete_module || C.can_add_business || C.can_add_company || C.can_add_module ? [["master", "database", ["structure"]]] : []),
        ...(C.can_view_audit ? [["audit", "scroll-text", ["audit"]]] : []),
      ].filter(([, , tabs]) => tabs.length);
  const TABS = SECTIONS.flatMap(([, , tabs]) => tabs);

  main.innerHTML = `<div class="space-y-5">
    <div class="relative flex min-h-10 flex-col items-center gap-2 sm:flex-row sm:justify-center">
      <a href="index.html" class="inline-flex self-start sm:absolute sm:left-0 sm:self-auto items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">${icon("arrow-left")} ${esc(t("admin.backToPortal"))}</a>
      <h1 class="text-xl font-semibold sm:text-2xl">${esc(t("admin.pageTitle"))}</h1>
    </div>
    <div id="sections" class="mx-auto w-full max-w-3xl"></div>
    <div id="panel" class="hidden rounded-3xl border border-slate-200 bg-slate-100/70 p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div class="-mx-3 mb-4 overflow-x-auto px-3 sm:text-center">
        <nav id="tabs" class="inline-flex min-w-max gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800"></nav>
      </div>
      <div id="msg"></div>
      <div id="view"></div>
    </div>
  </div>`;
  const view = $("#view");
  let routeSeq = 0;
  // 资料载入完时，若使用者已切到别的分页就不要再画
  const stale = (seq) => seq !== routeSeq;

  function setMsg(text, tone) {
    $("#msg").innerHTML = text ? alertBox(text, tone) : "";
  }

  // ---------------------------------------------------------------- 共用
  const field = (label, input, hint) => `<label class="block space-y-1.5"><span class="${cls.label}">${esc(label)}</span>${input}${
    hint ? `<span class="block text-xs text-slate-500">${esc(hint)}</span>` : ""
  }</label>`;
  const select = (name, options, value, attrs) =>
    `<select name="${name}" class="${cls.input}" ${attrs || ""}>${options
      .map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value == null ? "" : value) ? "selected" : ""}>${esc(l)}</option>`)
      .join("")}</select>`;
  const searchBox = (id, placeholder) => `<div class="relative flex-1">
      <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">${icon("search")}</span>
      <input id="${id}" type="search" placeholder="${esc(placeholder)}" class="${cls.input} pl-9">
    </div>`;
  const empty = (text) => `<div class="${cls.empty}">${esc(text)}</div>`;

  function showSecret(title, body, secret, warning) {
    const m = modal(
      title,
      `<p class="mb-3 text-sm text-slate-600 dark:text-slate-300">${esc(body)}</p>
       <div class="mb-4 rounded-lg bg-slate-100 p-3 text-center font-mono text-lg tracking-wider break-all select-all dark:bg-slate-800">${esc(secret)}</div>
       ${alertBox(warning, "amber")}
       <div class="mt-4 flex justify-end"><button data-done class="${btn("primary")}">${esc(t("admin.users.done"))}</button></div>`,
    );
    m.el.querySelector("[data-done]").onclick = m.close;
  }

  // ---------------------------------------------------------------- 模块权限：Admin / Access 两个勾（共用）
  /* 每个模块对每个人有两个勾：
     Access = 可以用这个模块；Admin = 这个模块的管理员（勾 Admin 一定同时有 Access）。
     谁可以勾（真正的检查在数据库 RLS）：
       Access：super_admin；角色设定里有这个模块（对方在那个 Business）；这个模块的管理员（对方和自己在同一个有这个模块的 Business）
       Admin：super_admin；角色设定里有这个模块
     不能改自己，也不能改 super_admin。 */
  async function loadAccess() {
    const [groups, members, gm, mods, rows, mine, users, coTags, companies] = await Promise.all([
      sb.from("gw_groups").select("id, name").order("sort_order").order("name"),
      sb.from("gw_group_members").select("group_id, user_id"),
      sb.from("gw_group_modules").select("group_id, module_id"),
      sb.from("gw_modules").select("id, code, name, icon, image_url, is_active").order("sort_order").order("name"),
      sb.from("gw_module_members").select("*"),
      Promise.resolve({ data: [] }),
      sb.from("gw_profiles").select("id, full_name, email, role, status, user_code").order("full_name"),
      sb.from("gw_module_companies").select("module_id, company_id"),
      sb.from("gw_companies").select("id, code, name, short_name"),
    ]).then((r) => r.map((x) => x.data || []));
    const coName = new Map(companies.map((c) => [c.id, c.code || c.name]));
    // 模块权限按 Business：一行 = 这个人在这个 Business 可以用这个模块；key = 人:模块:Business
    // 资料库有没有 company_id 栏（模块权限按 Company 的 SQL 跑过没）
    const probe = await sb.from("gw_module_members").select("company_id").limit(1);
    const ctx = { groups, members, gm, mods, users, mine, coTags, companies, companyMode: !probe.error, rows: new Map(rows.map((r) => [accessKey(r.user_id, r.module_id, r.group_id, r.company_id), r])) };
    const inGroup = (uid, gid) => members.some((m) => m.user_id === uid && m.group_id === gid);
    const groupHas = (gid, mid) => gm.some((x) => x.group_id === gid && x.module_id === mid);
    const myAdmin = (gid, mid) => [...ctx.rows.values()].some((r) => r.user_id === me.id && r.module_id === mid && r.group_id === gid && r.is_admin);
    const roleHas = (gid, mid, flag) => me.bizCan(gid, flag) && groupHas(gid, mid);
    const locked = (u) => u.id === me.id || u.role === "super_admin";
    // 在某个 Business 里，我能不能改这个人这个模块的 Access / Admin（规则同数据库 RLS）
    // 角色功能：加进模块 / 从模块移除 / 设定模块 Admin；在这个 Business 是这个模块的管理员：加、移除都可以
    const adminReach = (gid, mid) => myAdmin(gid, mid) && groupHas(gid, mid);
    const targetOk = (u, gid, mid) => !locked(u) && inGroup(u.id, gid) && groupHas(gid, mid);
    ctx.canGrant = (u, gid, mid) => isSuper || (targetOk(u, gid, mid) && (roleHas(gid, mid, "can_grant_module") || adminReach(gid, mid)));
    ctx.canRevoke = (u, gid, mid) => isSuper || (targetOk(u, gid, mid) && (roleHas(gid, mid, "can_revoke_module") || adminReach(gid, mid)));
    ctx.canAdmin = (u, gid, mid) => isSuper || (targetOk(u, gid, mid) && roleHas(gid, mid, "can_set_module_admin"));
    ctx.inGroup = inGroup;
    ctx.companyTags = (mid) => coTags.filter((x) => x.module_id === mid).map((x) => coName.get(x.company_id)).filter(Boolean);
    ctx.groupHas = groupHas;
    // 我管得到的 (Business, 模块) 组合
    ctx.managedPairs = gm.filter((x) => isSuper || ["can_grant_module", "can_revoke_module", "can_set_module_admin"].some((f) => me.bizCan(x.group_id, f)) || myAdmin(x.group_id, x.module_id));
    return ctx;
  }

  // 一行 = 人 × 模块 × Business × Company（Company 空 = 这个 Business 没有 Company / 这个人还没分到 Company）
  const accessKey = (uid, mid, gid, cid) => uid + ":" + mid + ":" + gid + ":" + (cid || "");
  // 改某个 Business（＋ Company）里的 Access / Admin；回传 false 表示失败
  async function saveAccess(ctx, uid, mid, gid, cid, access, admin) {
    const key = accessKey(uid, mid, gid, cid);
    const row = ctx.rows.get(key);
    const match = (q) => {
      q = q.eq("user_id", uid).eq("module_id", mid).eq("group_id", gid);
      return ctx.companyMode ? (cid ? q.eq("company_id", cid) : q.is("company_id", null)) : q;
    };
    let error;
    if (!access) {
      if (row) ({ error } = await match(sb.from("gw_module_members").delete()));
      if (!error) ctx.rows.delete(key);
    } else if (!row) {
      const ins = { user_id: uid, module_id: mid, group_id: gid, is_admin: !!admin, ...(cid ? { company_id: cid } : {}) };
      ({ error } = await sb.from("gw_module_members").insert(ins));
      if (!error) ctx.rows.set(key, { ...ins, company_id: cid || null });
    } else if (!!row.is_admin !== !!admin) {
      ({ error } = await match(sb.from("gw_module_members").update({ is_admin: !!admin })));
      if (!error) row.is_admin = !!admin;
    }
    if (error) toast(t("admin.users.accessDialog.saveFailed") + (error.message ? " (" + error.message + ")" : ""));
    return !error;
  }

  const tick = (attrs, on, enabled, label) =>
    `<label class="inline-flex items-center gap-1.5 text-xs font-medium ${enabled ? "cursor-pointer" : "cursor-not-allowed opacity-40"}">
      <input type="checkbox" ${attrs} ${on ? "checked" : ""} ${enabled ? "" : "disabled"} class="size-4 accent-emerald-600">${esc(label)}
    </label>`;



  // ---------------------------------------------------------------- 进阶搜寻的选择记在 localStorage
  const ugRemember = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* 忽略 */
    }
  };
  const ugRecall = (k) => {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  const byModName = (a, b) => (a.name || "").localeCompare(b.name || "");
  // Super Admin 自动拥有所有模块（资料库 gw__effective_module_ids 也是这样算），画面上一律显示成有权限 + Admin
  const isSuperUser = (u) => !!u && u.role === "super_admin";
  const SUPER_ROW = Object.freeze({ is_admin: true, auto: true });
  const adminMark = () => `<span data-admin-mark title="${esc(t("admin.userWindow.adminOf"))}" class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-sky-500 text-white ring-2 ring-white dark:ring-slate-800">${icon("shield-check", "size-2.5")}</span>`;
  // ---------------------------------------------------------------- 模块小图示、用户资料窗（用户名单、群组管理共用）
  const modLogo = (m, size) =>
    m.image_url
      ? `<img src="${esc(m.image_url)}" alt="${esc(m.name)}" title="${esc(m.name)}" class="${size || "size-5"} shrink-0 rounded-md object-cover">`
      : `<span title="${esc(m.name)}" class="flex ${size || "size-5"} shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-700/20 dark:text-brand-100">${moduleIcon(m.icon, /size-1[0-9]/.test(size || "") ? "size-6" : /size-[89]/.test(size || "") ? "size-4" : "size-3")}</span>`;
  // 我能不能管理某模块里的用户权限（super_admin、模块 Admin、角色有「管理模块用户权限」）
  const canManageModule = (mid) => isSuper || (me.adminModuleIds || []).includes(mid) || (C.can_manage_module_access && (me.roleModules || []).includes(mid));

  /* 用户资料窗：
       标题 = 名字；下面 Login email、User ID；右边一个 Super Admin 徽章（编辑模式变成勾选，没有说明文字；
       Super Admin 自动可以删 Business / Company / 模块，不用另外设定）
       底下跟 Master Manage 一样、一个 Business 一个方块：
         标题列（名称；编辑模式有「移出 Business」）
         → 一排 Company 徽章（"MJMP · HR"；编辑模式点徽章或「+」开小窗改 Company / 角色）
         → 这个人在这个 Business 有权限的模块图示（权限按 Business：加进 Business 不会自动有模块，要在这里「+ Add module」）
           点图示 → 下面开 Access / Admin 勾选
       编辑模式最底下「+ Add business」把人加进别的 Business
       谁能改：名字 / Super Admin = super_admin；Business / Company / 角色 = super_admin 或在那个 Business 能加人的角色；
         模块权限 = super_admin、角色有加 / 移除 / 设定 Admin 的 Business、或是模块 Admin；自己和 Super Admin 只能看。 */
  const PROFILE_COLS = "*"; // 含 avatar_url（资料库还没加这一栏时也不会出错）
  // 大头照：只显示传到 Intranet 自己储存的图片；没有照片就显示名字第一个字
  const ownPhoto = (url) => !!url && String(url).startsWith(GW_CONFIG.supabaseUrl + "/storage/v1/object/public/");
  const avatar = (u, size, text) =>
    ownPhoto(u.avatar_url)
      ? `<img src="${esc(u.avatar_url)}" alt="" class="${size} shrink-0 rounded-full object-cover">`
      : `<span class="flex ${size} shrink-0 items-center justify-center rounded-full bg-slate-200 ${text || "text-sm"} font-semibold dark:bg-slate-700">${esc((u.full_name || "?").slice(0, 1))}</span>`;
  // opts.edit：一开就是编辑模式（名单上的铅笔）
  // 一个人在 Intranet 的角色：super = Super Admin；"" = 一般用户；其他 = 角色 id（跟 Business / Company 无关）
  const roleKey = (u) => (u.role === "super_admin" ? "super" : u.role_id || "");
  async function userWindow(uid, onClose, opts) {
    const tu = (k, v) => t("admin.userWindow." + k, v);
    const ta = (k, v) => t("admin.users.accessDialog." + k, v);
    const ts = (k, v) => t("admin.structure." + k, v);
    // 有没有还没存的改动（名字 / 角色 / OPIS PRO ID / 模块勾选）：点外面、叉、Esc、Cancel 都会先提醒
    const unsaved = () =>
      stagedAcc.size > 0 ||
      !!(editing && draft && ((draft.full_name || "").trim() !== u.full_name || draft.role !== roleKey(u) || (draft.opispro || "").trim() !== (u.opispro_user_id || "")));
    const m = modal("", GW.spinner(), { wide: "xl", onClose, guard: unsaved });
    const [{ data: u0 }, { data: mems0 }, { data: groups }, { data: companies }, { data: mods }, { data: gxRows }, { data: mcs0 }, { data: bizCos }, { data: roles }] = await Promise.all([
      sb.from("gw_profiles").select(PROFILE_COLS).eq("id", uid).maybeSingle(),
      sb.from("gw_group_members").select("group_id").eq("user_id", uid),
      sb.from("gw_groups").select("id, name").order("sort_order").order("name"),
      sb.from("gw_companies").select("id, name, short_name, code").order("sort_order").order("name"),
      sb.from("gw_modules").select("id, code, name, icon, image_url, is_active").order("sort_order").order("name"),
      sb.from("gw_group_modules").select("group_id, module_id"),
      // 资料库还没套用「每个 Company 的角色」migration（没有 role_id 栏）的话，退回只读 Company
      sb.from("gw_member_companies").select("group_id, company_id, role_id").eq("user_id", uid).then((r) => (r.error && /role_id/.test(r.error.message || "") ? sb.from("gw_member_companies").select("group_id, company_id").eq("user_id", uid) : r)),
      sb.from("gw_business_companies").select("group_id, company_id"),
      sb.from("gw_roles").select("id, name").order("sort_order").order("name"),
    ]);
    if (!u0) return m.close();
    const u = u0;
    const setTitle = () => {
      const h = m.el.parentElement.querySelector("h2");
      if (h) h.textContent = u.full_name;
    };
    setTitle();
    const coById = new Map((companies || []).map((c) => [c.id, c]));
    const modById = new Map((mods || []).map((x) => [x.id, x]));
    const roleName = new Map((roles || []).map((r) => [r.id, r.name]));
    const mems = (mems0 || []).map((x) => x.group_id); // 所在的 Business
    const mcs = mcs0 || []; // 这个人的 Company（含角色）
    const bizList = () => (groups || []).filter((g) => mems.includes(g.id));
    // Business 底下全部的 Company：一律照 Company 清单的顺序（Master Manage 的顺序），资料窗和「+」小窗才会一样
    const cosOfBiz = (gid) => {
      const ids = new Set((bizCos || []).filter((x) => x.group_id === gid).map((x) => x.company_id));
      return (companies || []).filter((c) => ids.has(c.id));
    };
    const cosIn = (gid) => cosOfBiz(gid).filter((c) => mcRow(gid, c.id)); // 这个人在的 Company（同样的顺序）
    const mcRow = (gid, cid) => mcs.find((x) => x.group_id === gid && x.company_id === cid);
    const superU = () => isSuperUser(u);
    const locked = () => u.id === me.id || superU();
    const rowOf = (gid, mid, cid) => (superU() ? SUPER_ROW : ctx.rows.get(accessKey(u.id, mid, gid, ctx.companyMode ? cid : ""))); // 这个人在这个 Business（＋ Company）的这个模块
    const selCo = new Map(); // 每个 Business 现在选的 Company（"" = 没有 Company）
    const openBiz = new Set(); // 展开的 Business（一开始全部收起来）
    // 勾 / 取消模块权限：先记在这里（还没存），按 Save 才一起存；key = Business|Company|模块 → 要不要有权限
    const stagedAcc = new Map();
    const canEditAccess = () =>
      !locked() &&
      (isSuper ||
        mems.some((gid) => ["can_grant_module", "can_revoke_module", "can_set_module_admin"].some((f) => me.bizCan(gid, f))) ||
        (gxRows || []).some((g) => mems.includes(g.group_id) && canManageModule(g.module_id)) ||
        (me.adminPairs || []).some((a) => mems.includes(a.group_id) && (gxRows || []).some((g) => g.group_id === a.group_id && g.module_id === a.module_id)));
    const canEditProfile = isSuper; // 改名字 / Super Admin
    const canRolesFor = (gid) => isSuper || me.bizCan(gid, "can_add_business_user");
    const canPlace = (gid) => isSuper || (canRolesFor(gid) && !superU() && u.id !== me.id); // 改这个 Business 的成员 / Company / 角色（规则同数据库）
    const canRolesAny = () => isSuper || (groups || []).some((g) => canRolesFor(g.id));
    const addableBiz = () => (groups || []).filter((g) => !mems.includes(g.id) && canPlace(g.id));
    let ctx = null; // loadAccess()：权限规则 + 模块 × Company 标签
    let editing = false;
    let draft = null; // { full_name, super }
    let saving = false;
    const mkDraft = () => ({ full_name: u.full_name, role: roleKey(u), opispro: u.opispro_user_id || "" });
    if (opts && opts.edit && (canEditProfile || canRolesAny())) ((editing = true), (draft = mkDraft()));

    // 这个 Business 里、这个人能用的模块：标到 Business、启用中；模块有标 Company 的话，这个人要在其中一个 Company
    // 模块的 Company 标签是全域的：只看属于这个 Business 的 Company 标签；这里一个都没标 = 这个 Business 全部 Company 都能用
    const linkedMods = (gid) =>
      (gxRows || [])
        .filter((x) => x.group_id === gid)
        .map((x) => modById.get(x.module_id))
        .filter((mod) => mod && mod.is_active)
        .sort(byModName);
    const coLabel = (c) => c.short_name || c.code || c.name;
    const roleOf = (gid, cid) => {
      const r = mcRow(gid, cid);
      return r && r.role_id ? roleName.get(r.role_id) || t("admin.users.roles.user") : t("admin.users.roles.user");
    };
    const dashedBtn = (attrs, label) =>
      `<button type="button" ${attrs} class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-2 py-2 text-xs font-medium text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:hover:border-white dark:hover:text-white">${icon("plus", "size-3.5")}${esc(label)}</button>`;
    const plusBtn = (attrs, label) =>
      `<button type="button" ${attrs} aria-label="${esc(label)}" title="${esc(label)}" class="flex size-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-brand-500 hover:text-brand-600 dark:border-slate-600">${icon("plus", "size-3.5")}</button>`;

    // 这个 Business 可以选的 Company 分页：这个人在的 Company；还有旧的「没有 Company」权限时多一个「No company」
    function coTabs(g) {
      if (!ctx || !ctx.companyMode || !cosOfBiz(g.id).length) return [];
      const tabs = cosIn(g.id).map((c) => ({ id: c.id, label: coLabel(c), title: c.name, role: mcRow(g.id, c.id) }));
      const legacy = [...ctx.rows.values()].some((r) => r.user_id === u.id && r.group_id === g.id && !r.company_id);
      if (legacy) tabs.push({ id: "", label: tu("noCompanyTab"), title: tu("noCompanyTab"), role: null });
      return tabs;
    }
    // 现在选的 Company：没有 Company 的 Business = ""；有 Company 但还没点 = null（先不显示模块）
    function currentCo(g) {
      const tabs = coTabs(g);
      if (!tabs.length) return "";
      const v = selCo.get(g.id);
      return tabs.some((x) => x.id === v) ? v : null;
    }
    // 这个 Company 用得到的模块：模块在这个 Business 没标 Company → 都可以；有标 → 要标到这个 Company
    const modsForCo = (gid, cid) =>
      linkedMods(gid).filter((mod) => {
        const here = cosOfBiz(gid).map((c) => c.id);
        const tags = ctx.coTags.filter((x) => x.module_id === mod.id && here.includes(x.company_id));
        return !tags.length || (!!cid && tags.some((x) => x.company_id === cid));
      });
    const countIn = (gid, cid) => (superU() ? modsForCo(gid, cid).length : [...ctx.rows.values()].filter((r) => r.user_id === u.id && r.group_id === gid && (r.company_id || "") === cid).length);

    // 一个 Business 方块：先收起来（只有名字），点了才展开
    //   展开：左边一排 Company 简称（滑过去看全名），右边是选中那家的模块清单：Access 勾（按 Save 才存，太多可以往下卷）
    // 模块清单最上面「全选」：只管我有权限改的模块；勾了 = 全部有权限，取消 = 全部拿掉（一样按 Save 才存）
    const accKeyOf = (gid, cid, mid) => gid + "|" + cid + "|" + mid;
    const accOn = (gid, cid, mid) => (stagedAcc.has(accKeyOf(gid, cid, mid)) ? stagedAcc.get(accKeyOf(gid, cid, mid)) : !!rowOf(gid, mid, cid));
    const changeable = (gid, cid, list) => (superU() ? [] : list.filter((mod) => (rowOf(gid, mod.id, cid) ? ctx.canRevoke(u, gid, mod.id) : ctx.canGrant(u, gid, mod.id))));
    function selectAllRow(gid, cid, list) {
      const can = changeable(gid, cid, list);
      if (can.length < 2) return "";
      const all = can.every((mod) => accOn(gid, cid, mod.id));
      return `<div class="flex items-center gap-2 border-b border-slate-100 px-3 py-1 dark:border-slate-800">
        <span class="min-w-0 flex-1"></span>
        <span class="flex w-14 shrink-0 justify-center"><button type="button" data-acc-all="${gid}|${cid}" data-on="${all ? "0" : "1"}" ${saving ? "disabled" : ""} class="whitespace-nowrap text-[11px] font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-100">${esc(tu(all ? "clearAll" : "selectAll"))}</button></span>
      </div>`;
    }
    function bizBox(g) {
      const place = editing && canPlace(g.id);
      const open = openBiz.has(g.id);
      const hasCos = cosOfBiz(g.id).length > 0;
      const tabs = coTabs(g);
      const cid = currentCo(g);
      const needCompany = ctx && ctx.companyMode && hasCos && !tabs.length; // Business 有 Company，但这个人还没被分到任何一家
      const list = ctx && !needCompany && cid !== null ? modsForCo(g.id, cid) : [];
      // 左边一家公司：简称（滑过去看全名）＋「>」（点了右边才出现这家的模块）
      const coItem = (x) => {
        const on = x.id === cid;
        return `<button type="button" data-pick-co="${g.id}|${x.id}" title="${esc(x.title)}" aria-pressed="${on}" class="flex w-full items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-2.5 text-left text-sm ${
          on ? "bg-slate-900 font-semibold text-white dark:bg-white dark:text-slate-900" : "text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
        }"><span class="min-w-0 flex-1 truncate">${esc(x.label)}</span><span class="shrink-0 ${on ? "" : "text-slate-400"}">${icon("chevron-right", "size-4")}</span></button>`;
      };
      const row = (mod) => {
        const r = rowOf(g.id, mod.id, cid);
        const k = g.id + "|" + cid + "|" + mod.id;
        const canAcc = !superU() && (r ? ctx.canRevoke(u, g.id, mod.id) : ctx.canGrant(u, g.id, mod.id));
        const busy = saving;
        const changed = stagedAcc.has(k);
        const on = changed ? stagedAcc.get(k) : !!r;
        const box = (attr, on, ok, color, tip) => `<span class="flex w-14 shrink-0 justify-center"><input type="checkbox" ${attr} ${on ? "checked" : ""} ${ok && !busy ? "" : "disabled"} ${tip ? `title="${esc(tip)}"` : ""} class="size-4 ${ok && !busy ? "cursor-pointer" : "cursor-not-allowed opacity-40"} ${color}"></span>`;
        return `<div class="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-slate-800 ${on ? "bg-emerald-50/60 dark:bg-emerald-900/15" : ""}">
          <span class="shrink-0">${modLogo(mod, "size-7")}</span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium" title="${esc(mod.name)}">${esc(mod.name)}</span>
          ${box(`data-acc="${k}"`, on, canAcc, "accent-emerald-600", canAcc ? "" : tu("noRightAccess"))}
        </div>`;
      };
      const coName = cid ? (coById.get(cid) || {}).name || "" : "";
      const modulesPart = !ctx
        ? GW.spinner()
        : needCompany
          ? `<p class="p-3 text-xs text-amber-700 dark:text-amber-300">${esc(tu("pickCompanyFirst"))}</p>`
          : cid === null
            ? `<div class="h-full p-1.5"><div class="flex h-full min-h-[4.5rem] items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 text-center text-sm text-slate-400 dark:border-slate-700">${esc(tu("pickCompanyToSee"))}</div></div>`
            : `<div class="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase dark:border-slate-800">
              <span class="min-w-0 flex-1 truncate" title="${esc(coName)}">${esc(coName ? tu("modulesInShort", { company: coName }) : tu("withAccess"))}</span>
              <span class="w-14 shrink-0 text-center">${esc(tu("colAccess"))}</span>
            </div>
            ${list.length ? `${selectAllRow(g.id, cid, list)}<div class="max-h-80 overflow-y-auto">${list.map(row).join("")}</div>` : `<p class="p-3 text-xs text-slate-400">${esc(tu("noModulesHere"))}</p>`}`;
      const showCos = hasCos && ctx && ctx.companyMode;
      const addCo = (place || (canPlace(g.id) && !superU())) && hasCos;
      return `<section data-biz="${g.id}" class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div class="flex items-center gap-2 px-3 py-2.5">
          <button type="button" data-toggle-biz="${g.id}" aria-expanded="${open}" class="flex min-w-0 flex-1 items-center gap-2 text-left">
            ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
            <h3 class="min-w-0 truncate font-semibold">${esc(g.name)}</h3>
            <span class="ml-auto shrink-0 text-slate-400">${icon(open ? "chevron-up" : "chevron-down", "size-4")}</span>
          </button>
          ${place ? `<button type="button" data-rm-biz="${g.id}" aria-label="${esc(t("admin.userGroups.removeMember"))}" title="${esc(t("admin.userGroups.removeMember"))}" class="${btn("ghost", "sm")} text-red-600 dark:text-red-400">${icon("trash-2")}</button>` : ""}
        </div>
        ${
          open
            ? showCos
              ? `<div class="grid grid-cols-[9rem_1fr] border-t border-slate-100 sm:grid-cols-[14rem_1fr] dark:border-slate-800">
                  <div class="max-h-80 space-y-0.5 overflow-y-auto border-r border-slate-100 bg-slate-50 p-1.5 dark:border-slate-800 dark:bg-slate-800/40">
                    ${tabs.map(coItem).join("")}
                    ${!tabs.length ? `<p class="px-2 py-1.5 text-xs text-slate-400">${esc(tu("noCompany"))}</p>` : ""}
                    ${addCo ? `<button type="button" data-co-dlg="${g.id}" title="${esc(tu("editCompanies"))}" aria-label="${esc(tu("editCompanies"))}" class="mt-1 flex h-8 w-full items-center justify-center rounded-lg border border-dashed border-slate-400 text-slate-500 opacity-50 transition hover:opacity-100 dark:border-slate-500">${icon("plus", "size-4")}</button>` : ""}
                  </div>
                  <div class="flex min-w-0 flex-col [&>*:last-child]:flex-1">${modulesPart}</div>
                </div>`
              : `<div class="border-t border-slate-100 dark:border-slate-800">${modulesPart}</div>`
            : ""
        }
      </section>`;
    }

    function draw() {
      const note = superU() ? tu("superNote") : locked() ? tu("selfNote") : !canEditAccess() ? tu("viewOnlyNote") : "";
      const bl = bizList();
      // 角色：编辑模式（Super Admin、不是自己）是下拉；其他时候是徽章
      const roleName = (k) => (k === "super" ? t("admin.users.roles.super_admin") : k ? (roles || []).find((x) => x.id === k)?.name || t("admin.users.roles.user") : t("admin.users.roles.user"));
      const curRole = editing && draft ? draft.role : roleKey(u);
      const rolePart =
        editing && isSuper && u.id !== me.id
          ? `<select data-draft-role aria-label="${esc(tu("role"))}" class="h-9 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              <option value="" ${curRole === "" ? "selected" : ""}>${esc(t("admin.users.roles.user"))}</option>
              <option value="super" ${curRole === "super" ? "selected" : ""}>${esc(t("admin.users.roles.super_admin"))}</option>
              ${(roles || []).map((r) => `<option value="${r.id}" ${curRole === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
            </select>`
          : badge(roleName(curRole), curRole === "super" ? "red" : curRole ? "amber" : "slate");
      const canPhoto = editing && isSuper;
      // 资料一行一样高；编辑时没有框的值（User ID、Email…）往右靠，跟框里面的字对齐（框 = 1px 边 + 12px 内距）
      const row = editing ? "flex h-9 min-w-0 items-center" : "flex min-h-7 min-w-0 items-center";
      const pad = editing ? "px-[13px]" : "";
      const head = `<div class="flex items-center gap-8">
          <div class="relative shrink-0">
            ${avatar(u, "size-24", "text-3xl")}
            ${
              canPhoto
                ? `<label title="${esc(tu("photo"))}" class="absolute right-0 bottom-0 flex size-8 cursor-pointer items-center justify-center rounded-full bg-slate-900 text-white shadow ring-2 ring-white dark:bg-white dark:text-slate-900 dark:ring-slate-900">${icon("camera", "size-4")}<input type="file" data-avatar accept="image/*" class="hidden"></label>`
                : ""
            }
          </div>
          <div class="min-w-0 flex-1 space-y-2.5">
            <dl class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-slate-500">${esc(tu("userId"))}</dt><dd class="${row} ${pad} font-mono font-medium">${esc(u.user_code || "—")}</dd>
              <dt class="text-slate-500">${esc(tu("loginEmail"))}</dt><dd class="${row} ${pad} font-medium"><span class="truncate">${esc(u.email)}</span></dd>
              <dt class="text-slate-500">${esc(tu("opisproId"))}</dt><dd class="${row} ${pad}">${
                // 名字和 OPIS PRO ID 在这里不能改（只显示）
                u.opispro_user_id
                    ? `<span class="font-mono font-medium">${esc(u.opispro_user_id)}</span>`
                    : `<span class="truncate text-slate-400">${esc(tu("opisproNotLinked"))}</span>`
              }</dd>
              <dt class="text-slate-500">${esc(tu("role"))}</dt><dd class="${row} ${editing && isSuper && u.id !== me.id ? "" : pad}">${rolePart}</dd>
            </dl>
            ${canPhoto && ownPhoto(u.avatar_url) ? `<button type="button" data-no-photo class="text-xs text-red-600 hover:underline dark:text-red-400">${esc(tu("removePhoto"))}</button>` : ""}
          </div>
        </div>`;
      // 等待批准的人（第一次用 OPIS PRO 登入）：没有 Cancel / Save，只有一个和「Add Business」一样大小的「Allow access to Intranet」
      const pending = isSuper && u.id !== me.id && u.pending_approval && u.status === "disabled";
      const allowBtn = `<button type="button" data-set-status class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-2 py-2 text-xs font-semibold text-emerald-700 hover:border-emerald-500 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" ${saving ? "disabled" : ""}>${saving ? `<span class="size-3.5 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700"></span>${esc(t("admin.users.approving"))}` : `${icon("user-check", "size-3.5")}${esc(t("admin.users.approve"))}`}</button>`;
      const statusBtn =
        isSuper && u.id !== me.id && !pending
          ? `<button data-set-status ${saving ? "disabled" : ""} class="${btn(u.status === "disabled" ? "secondary" : "ghost")} mr-auto ${u.status === "disabled" ? "" : "text-red-600 dark:text-red-400"}">${icon(u.status === "disabled" ? "user-check" : "user-x", "size-4")} ${esc(t(u.status === "disabled" ? "admin.users.enableAccount" : "admin.users.disableAccount"))}</button>`
          : "";
      if (m.head) m.head.innerHTML = ""; // Cancel / Save 一律放在最下面
      const buttons = pending
        ? `${allowBtn}${editing ? "" : `<div class="flex flex-wrap items-center justify-end gap-2">
            ${canEditProfile || canRolesAny() ? `<button data-edit class="${btn("secondary")}">${icon("pencil", "size-4")} ${esc(t("admin.users.edit"))}</button>` : ""}
            <button data-done class="${btn("primary")}">${esc(t("admin.users.done"))}</button>
          </div>`}`
        : editing
        ? `<div class="flex flex-wrap items-center justify-end gap-2">
            ${statusBtn}
            <button data-cancel class="${btn("secondary")}" ${saving ? "disabled" : ""}>${esc(t("admin.users.cancel"))}</button>
            <button data-save class="${btn("primary")}" ${saving ? "disabled" : ""}>${esc(t("admin.users.save"))}</button>
          </div>`
        : `<div class="flex flex-wrap items-center justify-end gap-2">
            ${statusBtn}
            ${canEditProfile || canRolesAny() ? `<button data-edit class="${btn("secondary")}">${icon("pencil", "size-4")} ${esc(t("admin.users.edit"))}</button>` : ""}
            <button data-done class="${btn("primary")}">${esc(t("admin.users.done"))}</button>
          </div>`;
      m.el.innerHTML = `<div class="space-y-4" data-mode="${editing ? "edit" : "view"}">
        ${head}
        ${note ? `<p class="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">${esc(note)}</p>` : ""}
        ${bl.length ? `<div class="space-y-3">${bl.map(bizBox).join("")}</div>` : empty(tu("noBusiness"))}
        ${editing && addableBiz().length ? dashedBtn("data-add-biz", ts("addBusiness")) : ""}
        ${buttons}
      </div>`;
      refreshIcons();
    }

    // 大头照：传到 Intranet 的图片储存，再记在这个人的资料（马上存）
    async function uploadAvatar(file) {
      if (!/^image\//.test(file.type)) return toast(tu("photoType"));
      if (file.size > 2 * 1024 * 1024) return toast(tu("photoTooBig"));
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
      const path = `${me.id}/avatar-${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from("link-icons").upload(path, file, { contentType: file.type });
      if (up.error) return toast(t("admin.users.errors.forbidden") + " (" + (up.error.message || "") + ")");
      await setAvatar(sb.storage.from("link-icons").getPublicUrl(path).data.publicUrl);
    }
    async function setAvatar(url) {
      const { error } = await sb.from("gw_profiles").update({ avatar_url: url }).eq("id", uid);
      if (error) return toast(/avatar_url/.test(error.message || "") ? tu("photoNeedsDb") : t("admin.users.errors.forbidden"));
      u.avatar_url = url;
      toast(t("admin.users.savedOk"));
      draw();
    }

    // 停用 / 启用帐号（只有 Super Admin；不能停用自己）。停用前先问
    // 按钮在存的时候锁住、显示「处理中」：按两下也只会送一次
    let statusBusy = false;
    async function setStatus() {
      if (statusBusy || saving) return;
      statusBusy = true;
      try {
        await setStatusNow();
      } finally {
        statusBusy = false;
        saving = false;
        draw();
      }
    }
    async function setStatusNow() {
      // 批准时还在编辑：先把改过的名字 / 角色 / 模块存起来（没有另外的 Save 按钮）；存不成功就不批准
      if (u.pending_approval && u.status === "disabled" && editing && draft) {
        await save(true);
        if (editing) return;
      }
      const status = u.status === "disabled" ? "active" : "disabled";
      if (status === "disabled" && !(await confirmDialog(t("admin.users.disableAccount"), t("admin.users.disableBody", { name: u.full_name }), t("admin.users.disableAccount"), t("admin.users.cancel")))) return;
      saving = true;
      draw();
      const r = await invoke("gw-admin", { action: "set_status", id: u.id, status });
      saving = false;
      if (!(r && r.ok)) return toast(t("admin.users.errors." + ((r && r.error) || "forbidden")));
      const wasPending = !!u.pending_approval;
      u.status = status;
      if (status === "active") u.pending_approval = false;
      toast(status === "disabled" ? t("admin.users.disabledOk") : wasPending ? t("admin.users.approvedOk") : t("admin.users.enabledOk"));
      draw();
    }

    // 存：名字 + Super Admin（Super Admin 自动可以删 Business / Company / 模块，不用另外存）
    async function save(quiet) {
      const name = (draft.full_name || "").trim();
      if (!name) return;
      const patch = {};
      if (name !== u.full_name) patch.full_name = name;
      const op = isSuper ? (draft.opispro || "").trim() : u.opispro_user_id || "";
      if (op && !/^\d{1,20}$/.test(op)) return toast(tu("opisproBad"), "error");
      if (isSuper && op !== (u.opispro_user_id || "")) patch.opispro_user_id = op || null;
      if (u.id !== me.id && isSuper && draft.role !== roleKey(u)) {
        if (draft.role === "super") ((patch.role = "super_admin"), (patch.role_id = null));
        else ((patch.role = "user"), (patch.role_id = draft.role || null));
      }
      saving = true;
      draw();
      let changed = false;
      if (Object.keys(patch).length) {
        const { data, error } = await sb.from("gw_profiles").update(patch).eq("id", uid).select(PROFILE_COLS);
        if (error || !data || !data.length) {
          saving = false;
          if (error && (error.code === "23505" || /opispro_user_id/.test(error.message || ""))) toast(tu(error.code === "23505" ? "opisproTaken" : "opisproNeedsDb"), "error");
          else setMsg(t("admin.users.errors.forbidden"));
          return draw();
        }
        Object.assign(u, data[0]);
        changed = true;
      }
      // 模块权限：把勾过 / 取消过的一起存（取消 Access 也会取消 Admin）；有一格存不成功就留在编辑模式
      for (const [k, access] of [...stagedAcc]) {
        const [gid, cid, mid] = k.split("|");
        if (!(await saveAccess(ctx, uid, mid, gid, cid, access, false))) {
          saving = false;
          return draw();
        }
        stagedAcc.delete(k);
        changed = true;
      }
      saving = false;
      if (changed && !quiet) toast(t("admin.users.savedOk")); // 批准时只出一个「已批准」
      editing = false;
      draft = null;
      setTitle();
      draw();
    }

    const fail = (error) => toast(t("admin.groups.saveFailed") + (error && error.message ? " (" + error.message + ")" : ""));
    // 回传 null = 已经是（或刚加进）这个 Business 的成员；否则回传错误
    const ensureMember = async (gid) => {
      if (mems.includes(gid)) return null;
      const { error } = await sb.from("gw_group_members").insert({ group_id: gid, user_id: uid });
      if (error) return error;
      mems.push(gid);
      return null;
    };

    // Business 只有一个 Company：加进 Business 时顺便加进那个 Company（一般用户），不用再另外勾
    const autoCompany = async (gid) => {
      const cos = cosOfBiz(gid);
      if (cos.length !== 1 || mcRow(gid, cos[0].id)) return;
      const cid = cos[0].id;
      let { error } = await sb.from("gw_member_companies").insert({ group_id: gid, user_id: uid, company_id: cid, role_id: null });
      if (error && /role_id/.test(error.message || "")) ({ error } = await sb.from("gw_member_companies").insert({ group_id: gid, user_id: uid, company_id: cid }));
      if (error) return fail(error);
      mcs.push({ group_id: gid, company_id: cid, role_id: null });
    };

    // + Add business：列还没加进去、而且我能加人的 Business
    function addBusinessDialog() {
      const list = addableBiz();
      const pm = modal(
        tu("addBusinessTitle", { name: u.full_name }),
        `<div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${list
          .map(
            (g) => `<div class="flex items-center gap-3 px-3 py-2">
              ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
              <span class="min-w-0 flex-1 truncate text-sm font-medium">${esc(g.name)}</span>
              <button data-pick-biz="${g.id}" class="${btn("secondary", "sm")}">${icon("plus", "size-4")} ${esc(ts("add"))}</button>
            </div>`,
          )
          .join("")}</div>`,
      );
      refreshIcons();
      pm.el.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pick-biz]");
        if (!b) return;
        b.disabled = true;
        const e1 = await ensureMember(b.dataset.pickBiz);
        if (e1) return ((b.disabled = false), fail(e1));
        await autoCompany(b.dataset.pickBiz);
        // 小窗不关：按钮变成「✓ Added」，可以继续加别的 Business
        b.className = "pointer-events-none inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
        b.innerHTML = `${icon("check", "size-4")} ${esc(ts("added"))}`;
        refreshIcons();
        draw();
      });
    }

    // Company 小窗：这个 Business 底下每个 Company 一个勾（勾了 = 在这个 Company，预设一般用户），右边下拉可以换角色
    //   → 立刻写 gw_member_companies(role_id)
    function companyDialog(g) {
      const cos = cosOfBiz(g.id);
      // 先记在画面上（in = 在这个 Company，role_id = 角色，null = 一般用户），按 Save 一次写入
      const snap = () => new Map(cos.map((c) => { const r = mcRow(g.id, c.id); return [c.id, { in: !!r, role_id: r ? r.role_id || null : null }]; }));
      const orig = snap();
      const st = snap();
      const dirty = () => cos.some((c) => st.get(c.id).in !== orig.get(c.id).in || (st.get(c.id).in && st.get(c.id).role_id !== orig.get(c.id).role_id));
      let busy = false;
      const pm = modal(tu("companies", { business: g.name }), "", { wide: true, guard: dirty });
      const paint = () => {
        const allIn = cos.length > 0 && cos.every((c) => st.get(c.id).in);
        pm.el.innerHTML = `<div class="space-y-4">
          ${
            cos.length
              ? `<div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${
                  cos.length > 1
                    ? `<div class="px-3 py-1.5"><button type="button" data-co-all data-on="${allIn ? "0" : "1"}" ${busy ? "disabled" : ""} class="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-100">${esc(tu(allIn ? "clearAll" : "selectAll"))}</button></div>`
                    : ""
                }${cos
                  .map((c) => {
                    const v = st.get(c.id);
                    return `<div class="flex items-center gap-3 px-3 py-2">
                      <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input type="checkbox" data-co-in="${c.id}" ${v.in ? "checked" : ""} class="size-4 accent-emerald-600">
                        <span class="min-w-0 flex-1 truncate text-sm font-medium">${esc(c.name)}</span>
                      </label>
                    </div>`;
                  })
                  .join("")}</div>`
              : `<p class="text-sm text-slate-400">${esc(t("admin.users.noCompanies"))}</p>`
          }
          <div class="flex justify-end gap-2">
            <button type="button" data-co-cancel class="${btn("secondary")}" ${busy ? "disabled" : ""}>${esc(t("admin.users.cancel"))}</button>
            <button type="button" data-co-save class="${btn("primary")}" ${dirty() && !busy ? "" : "disabled"}>${esc(t("admin.users.save"))}</button>
          </div>
        </div>`;
      };
      paint();
      pm.el.addEventListener("change", (e) => {
        const el = e.target;
        if (el.dataset.coIn) {
          const v = st.get(el.dataset.coIn);
          v.in = el.checked;
          if (!v.in) v.role_id = null;
        } else if (el.dataset.roleSel) st.get(el.dataset.roleSel).role_id = el.value === "user" ? null : el.value;
        else return;
        paint();
      });
      pm.el.addEventListener("click", async (e) => {
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        if ("coAll" in b.dataset) {
          const on = b.dataset.on === "1";
          cos.forEach((c) => {
            const v = st.get(c.id);
            v.in = on;
            if (!on) v.role_id = null;
          });
          return paint();
        }
        if ("coCancel" in b.dataset) {
          if (dirty() && !(await confirmDialog(t("unsaved.title"), t("unsaved.body"), t("unsaved.leave"), t("unsaved.stay")))) return;
          return pm.close();
        }
        if (!("coSave" in b.dataset)) return;
        busy = true;
        paint();
        const stop = (error) => ((busy = false), fail(error), paint(), draw());
        for (const c of cos) {
          const was = orig.get(c.id), now = st.get(c.id);
          const cur = mcRow(g.id, c.id);
          if (now.in && !was.in) {
            const e1 = await ensureMember(g.id);
            if (e1) return stop(e1);
            let { error } = await sb.from("gw_member_companies").insert({ group_id: g.id, user_id: uid, company_id: c.id, role_id: now.role_id });
            if (error && /role_id/.test(error.message || "")) ({ error } = await sb.from("gw_member_companies").insert({ group_id: g.id, user_id: uid, company_id: c.id })); // 没有 role_id 栏的旧资料库
            if (error) return stop(error);
            mcs.push({ group_id: g.id, company_id: c.id, role_id: now.role_id });
          } else if (!now.in && was.in) {
            if (cur) {
              const { error } = await sb.from("gw_member_companies").delete().eq("group_id", g.id).eq("user_id", uid).eq("company_id", c.id);
              if (error) return stop(error);
              mcs.splice(mcs.indexOf(cur), 1);
              if (ctx) for (const [k, r] of [...ctx.rows]) if (r.user_id === uid && r.group_id === g.id && r.company_id === c.id) ctx.rows.delete(k);
            }
          } else if (now.in && cur && (cur.role_id || null) !== now.role_id) {
            const { error } = await sb.from("gw_member_companies").update({ role_id: now.role_id }).eq("group_id", g.id).eq("user_id", uid).eq("company_id", c.id);
            if (error) return stop(error);
            cur.role_id = now.role_id;
          }
          orig.set(c.id, { ...now });
        }
        toast(t("admin.users.savedOk"));
        pm.close();
        draw();
      });
    }

    // 移出 Business：先删这个 Business 的 Company，再删 Business 成员（模块权限不动，跟 Group Manage 一样）
    async function removeBusiness(g) {
      if (!(await confirmDialog(t("admin.userGroups.removeMember"), tu("removeBusinessBody", { name: u.full_name, business: g.name }), t("admin.userGroups.removeMember"), t("admin.users.cancel")))) return;
      if (mcs.some((x) => x.group_id === g.id)) {
        const { error } = await sb.from("gw_member_companies").delete().eq("group_id", g.id).eq("user_id", uid);
        if (error) return fail(error);
      }
      const { error } = await sb.from("gw_group_members").delete().eq("group_id", g.id).eq("user_id", uid);
      if (error) return fail(error);
      for (let i = mcs.length - 1; i >= 0; i--) if (mcs[i].group_id === g.id) mcs.splice(i, 1);
      mems.splice(mems.indexOf(g.id), 1);
      if (ctx) for (const [k, r] of [...ctx.rows]) if (r.user_id === uid && r.group_id === g.id) ctx.rows.delete(k);
      draw();
    }

    // 标题列的 Cancel / Save（编辑模式）
    if (m.head)
      m.head.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        if ("cancel" in b.dataset) return cancelEdit();
        if ("save" in b.dataset) return save();
      });
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      const d = b.dataset;
      if ("done" in d) return m.close();
      if ("setStatus" in d) return setStatus();
      if ("noPhoto" in d) return setAvatar(null);
      if ("edit" in d) {
        editing = true;
        draft = mkDraft();
        return draw();
      }
      if ("cancel" in d) return cancelEdit();
      if ("save" in d) return save();
      if ("addBiz" in d) return addBusinessDialog();
      if (d.accAll) {
        // 「Select all」全部勾；全部已经勾了就是「Clear all」全部取消（一样按 Save 才存）
        if (saving) return;
        const on = d.on === "1";
        const [gid, cid] = d.accAll.split("|");
        for (const mod of changeable(gid, cid, modsForCo(gid, cid))) {
          const k = accKeyOf(gid, cid, mod.id);
          if (on === !!rowOf(gid, mod.id, cid)) stagedAcc.delete(k);
          else stagedAcc.set(k, on);
        }
        if (!editing) ((editing = true), (draft = mkDraft()));
        return draw();
      }
      if (d.toggleBiz) {
        openBiz.has(d.toggleBiz) ? openBiz.delete(d.toggleBiz) : openBiz.add(d.toggleBiz);
        return draw();
      }
      if (d.pickCo) {
        const [gid, cid] = d.pickCo.split("|");
        selCo.set(gid, cid);
        return draw();
      }
      const g = (groups || []).find((x) => x.id === (d.coDlg || d.rmBiz));
      if (g && d.coDlg) return companyDialog(g);
      if (g && d.rmBiz) return removeBusiness(g);
    });
    // Cancel：有没存的改动先问；放弃就回到原来的样子
    async function cancelEdit() {
      if (unsaved() && !(await confirmDialog(t("unsaved.title"), t("unsaved.body"), t("unsaved.leave"), t("unsaved.stay")))) return;
      editing = false;
      draft = null;
      stagedAcc.clear();
      draw();
    }
    // 勾 / 取消模块：先不存，记下来（勾回原来的样子就等于没改）；进编辑模式，按 Save 才存、Cancel 就放弃
    function tickAccess(k, access) {
      if (saving) return;
      const [gid, cid, mid] = k.split("|");
      if (access === !!rowOf(gid, mid, cid)) stagedAcc.delete(k);
      else stagedAcc.set(k, access);
      if (!editing) ((editing = true), (draft = mkDraft()));
      draw();
    }
    m.el.addEventListener("input", (e) => {
      if (e.target.matches("[data-draft-name]") && draft) draft.full_name = e.target.value;
      if (e.target.matches("[data-draft-opispro]") && draft) draft.opispro = e.target.value;
    });
    m.el.addEventListener("change", (e) => {
      const box = e.target;
      if (box.matches("[data-draft-role]") && draft) return ((draft.role = box.value), draw());
      if (box.matches("[data-avatar]") && box.files[0]) return uploadAvatar(box.files[0]);
      if (box.dataset.acc) return tickAccess(box.dataset.acc, box.checked);

    });
    draw();
    ctx = await loadAccess();
    draw();
  }

  // ================================================================ 用户名单（User Manage 只有这一个画面）
  /* 上面：搜寻框 ＋「Advanced search」钮。按了下面出现三排筛选：
       Business（全部列出，点一个亮起）→ Company（这个 Business 的全部 Company，全名）→ 模块（这个 Business ＋ Company 能用的模块，图示＋名称）
       选到哪一层就筛到哪一层：在那个 Business / 在那个 Company / 有那个模块权限（Super Admin 算全部模块都有）
     名单：一行一个人：头像、名字（底下 Email）、角色徽章；动作固定靠右、每行同一个位置：查看 / 编辑 / 停用
       停用的人不在主名单，放最底下另一个「Disabled」名单（可以 Enable）
     点名字或查看 → 用户资料窗（Business / Company / 模块的设定都在那里）；旧的 #groups / #access 也进这里 */
  const USERS_HASHES = ["users", "groups", "access"];
  async function usersScreen() {
    const seq = routeSeq;
    const tu = (k, v) => t("admin.users." + k, v);
    const [users, allGroups, companies, links, members, memberCos, roles, mods, mm, gxRows, coTags] = await Promise.all([
      sb.from("gw_profiles").select("*").order("full_name"),
      sb.from("gw_groups").select("id, name").order("sort_order").order("name"),
      sb.from("gw_companies").select("id, code, name, short_name").eq("is_active", true).order("sort_order").order("name"),
      sb.from("gw_business_companies").select("group_id, company_id"),
      sb.from("gw_group_members").select("group_id, user_id"),
      sb.from("gw_member_companies").select("group_id, user_id, company_id"),
      sb.from("gw_roles").select("id, name").order("sort_order").order("name"),
      sb.from("gw_modules").select("id, code, name, icon, image_url, is_active").order("sort_order").order("name"),
      sb.from("gw_module_members").select("user_id, module_id, group_id, is_admin"),
      sb.from("gw_group_modules").select("group_id, module_id"),
      sb.from("gw_module_companies").select("module_id, company_id"),
    ]).then((r) => r.map((x) => x.data || []));
    if (stale(seq)) return;
    if (!(canUsersPage || canGroupsPage || canAccessPage)) return (view.innerHTML = empty(t("admin.access.empty")));
    // 角色只看到自己管的 Business
    const groups = allGroups.filter((g) => isSuper || (me.businessIds || []).includes(g.id));
    const companiesOf = (gid) => companies.filter((c) => links.some((l) => l.group_id === gid && l.company_id === c.id));
    const modById = new Map(mods.map((x) => [x.id, x]));
    // 这个 Business（＋ Company）能用的模块：标到 Business、启用中；模块有标 Company 的话，选的 Company 要在里面
    // 模块的 Company 标签是全域的：只看属于这个 Business 的 Company 标签；这里一个都没标 = 全部 Company 都能用
    const modulesIn = (gid, cid) => {
      const here = companiesOf(gid).map((c) => c.id);
      return gxRows
        .filter((x) => x.group_id === gid)
        .map((x) => modById.get(x.module_id))
        .filter((mod) => mod && mod.is_active !== false)
        .filter((mod) => {
          const tags = coTags.filter((x) => x.module_id === mod.id && here.includes(x.company_id));
          return !cid || !tags.length || tags.some((x) => x.company_id === cid);
        })
        .sort(byModName);
    };
    const hasMod = (u, mid, gid) => isSuperUser(u) || mm.some((r) => r.user_id === u.id && r.module_id === mid && r.group_id === gid);
    const roleName = new Map(roles.map((r) => [r.id, r.name]));
    const roleBadge = (u) => (u.role_id && !isSuperUser(u) ? badge(roleName.get(u.role_id) || tu("roles.user"), "amber") : "");
    const superMark = (u) => (isSuperUser(u) ? `<span title="${esc(tu("roles.super_admin"))}" aria-label="${esc(tu("roles.super_admin"))}" class="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300">${icon("shield-check", "size-3.5")}</span>` : "");
    // Super Admin 排最上面（名字 A→Z），其他人接着 A→Z
    const byRank = (a, b) => (isSuperUser(b) ? 1 : 0) - (isSuperUser(a) ? 1 : 0) || (a.full_name || "").localeCompare(b.full_name || "");
    const canEdit = isSuper || C.can_add_business_user; // 编辑钮：开资料窗的编辑模式
    // 进阶搜寻：开没开、选了哪个 Business / Company / 模块（记住上次）
    const adv = { open: ugRecall("gw_adv_open") === "1", gid: ugRecall("gw_ug_business") || "", cid: ugRecall("gw_ug_company") || "", mid: ugRecall("gw_adv_module") || "" };
    if (!groups.some((g) => g.id === adv.gid)) Object.assign(adv, { gid: "", cid: "", mid: "" });
    let q = "";

    view.innerHTML = `<div class="space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row">
        ${searchBox("q", tu("search"))}
        <button type="button" id="adv-toggle" class="shrink-0"></button>
      </div>
      <div id="adv"></div>
      <div id="list"></div>
    </div>`;

    function paintToggle() {
      const b = $("#adv-toggle");
      b.className = `${btn(adv.open ? "primary" : "secondary")} shrink-0`;
      b.setAttribute("aria-expanded", adv.open);
      b.innerHTML = `${icon("sliders-horizontal")} ${esc(tu("advancedSearch"))}`;
    }
    function drawAdv() {
      paintToggle();
      if (!adv.open) return ($("#adv").innerHTML = "");
      const comps = adv.gid ? companiesOf(adv.gid) : [];
      if (adv.cid && !comps.some((c) => c.id === adv.cid)) adv.cid = "";
      const modsHere = adv.gid ? modulesIn(adv.gid, adv.cid) : [];
      if (adv.mid && !modsHere.some((x) => x.id === adv.mid)) adv.mid = "";
      const chip = (attr, val, label, on) => `<button type="button" data-${attr}="${val}" aria-pressed="${on}" class="max-w-full truncate rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        on ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      }">${esc(label)}</button>`;
      const tile = (mod) => {
        const on = adv.mid === mod.id;
        return `<button type="button" data-pick-mod="${mod.id}" aria-pressed="${on}" title="${esc(mod.name)}" class="flex max-w-full items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors ${
          on ? "border-brand-500 bg-white ring-2 ring-brand-500 dark:bg-slate-900" : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        }">${modLogo(mod, "size-9")}<span class="min-w-0 text-xs leading-tight font-medium [overflow-wrap:normal] [word-break:normal]">${esc(mod.name)}</span></button>`;
      };
      const row = (ic, label, inner) => `<div class="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start">
          <p class="flex w-24 shrink-0 items-center gap-1.5 pt-1 text-[11px] font-bold tracking-wider text-slate-500 uppercase">${icon(ic, "size-3.5")}${esc(label)}</p>
          <div class="flex min-w-0 flex-1 flex-wrap gap-1.5">${inner}</div>
        </div>`;
      const none = (text) => `<span class="pt-1 text-sm text-slate-400">${esc(text)}</span>`;
      $("#adv").innerHTML = `<div class="${cls.card} divide-y divide-slate-100 dark:divide-slate-800">
        ${row("briefcase-business", t("admin.tabs.business"), groups.length ? groups.map((g) => chip("pick-biz", g.id, g.name, adv.gid === g.id)).join("") : none(t("admin.userGroups.noBusiness")))}
        ${adv.gid ? row("building-2", t("admin.tabs.company"), comps.length ? comps.map((c) => chip("pick-co", c.id, c.name, adv.cid === c.id)).join("") : none(tu("noCompanies"))) : ""}
        ${adv.gid ? row("layout-grid", t("admin.tabs.modules"), modsHere.length ? modsHere.map(tile).join("") : none(t("admin.userWindow.noModulesHere"))) : ""}
      </div>`;
      refreshIcons();
    }

    const match = (u) => {
      const s = q.trim().toLowerCase();
      if (s && !(u.full_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || (u.user_code || "").toLowerCase().includes(s))) return false;
      if (!adv.open || !adv.gid) return true;
      if (adv.mid && isSuperUser(u)) return true; // Super Admin 每个模块都有
      if (!members.some((m) => m.group_id === adv.gid && m.user_id === u.id)) return false;
      if (adv.cid && !memberCos.some((m) => m.group_id === adv.gid && m.user_id === u.id && m.company_id === adv.cid)) return false;
      return !adv.mid || hasMod(u, adv.mid, adv.gid);
    };

    function drawList() {
      const list = users.filter(match).sort(byRank);
      const active = list.filter((u) => u.status !== "disabled");
      // 第一次用 OPIS PRO 登入自动开的帐号：等管理员批准（放最上面）
      const waiting = list.filter((u) => u.status === "disabled" && u.pending_approval);
      const off = list.filter((u) => u.status === "disabled" && !u.pending_approval);
      const row = (u) => `<div data-user="${u.id}" class="flex items-center gap-3 p-3 sm:p-4 ${u.status === "disabled" && !u.pending_approval ? "opacity-60" : ""}">
          ${avatar(u, "size-10")}
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
            ${superMark(u)}
            <button data-window="${u.id}" class="truncate font-medium hover:underline">${esc(u.full_name)}</button>
            <span class="hidden text-slate-300 sm:inline dark:text-slate-600">|</span>
            <span class="min-w-0 basis-full truncate text-xs text-slate-500 sm:basis-auto sm:text-sm">${esc(u.email)}</span>
            ${roleBadge(u)}
          </div>
          <div class="flex shrink-0 items-center justify-end gap-1">
            <button data-window="${u.id}" aria-label="${esc(tu("details"))}" title="${esc(tu("details"))}" class="${btn("ghost", "sm")}">${icon("search")}</button>
            ${canEdit ? `<button data-edit-user="${u.id}" aria-label="${esc(tu("edit"))}" title="${esc(tu("edit"))}" class="${btn("ghost", "sm")}">${icon("pencil")}</button>` : ""}
          </div>
        </div>`;
      const card = (arr) => `<div class="${cls.card} divide-y divide-slate-200 dark:divide-slate-800">${arr.map(row).join("")}</div>`;
      $("#list").innerHTML = `${
          waiting.length
            ? `<div class="mb-6 space-y-2">
                <p class="flex items-center gap-1.5 px-1 text-[11px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400">${icon("user-plus", "size-3.5")}${esc(tu("waiting"))} <span class="font-normal text-slate-400 normal-case">(${waiting.length})</span></p>
                <p class="px-1 text-xs text-slate-500">${esc(tu("waitingHint"))}</p>
                <div class="${cls.card} divide-y divide-amber-200 ring-1 ring-amber-300 dark:divide-amber-900 dark:ring-amber-800">${waiting.map(row).join("")}</div>
              </div>`
            : ""
        }${active.length ? card(active) : empty(tu("empty"))}
        ${
          off.length
            ? `<div class="mt-6 space-y-2">
                <p class="flex items-center gap-1.5 px-1 text-[11px] font-bold tracking-wider text-slate-500 uppercase">${icon("user-x", "size-3.5")}${esc(tu("status.disabled"))} <span class="font-normal text-slate-400 normal-case">(${off.length})</span></p>
                ${card(off)}
              </div>`
            : ""
        }`;
      refreshIcons();
    }

    // 资料窗关掉 / 停用之后：重抓会变的资料再画
    async function reload() {
      const [p, m, gm, mc] = await Promise.all([
        sb.from("gw_profiles").select("*").order("full_name"),
        sb.from("gw_module_members").select("user_id, module_id, group_id, is_admin"),
        sb.from("gw_group_members").select("group_id, user_id"),
        sb.from("gw_member_companies").select("group_id, user_id, company_id"),
      ]);
      if (p.data) users.splice(0, users.length, ...p.data);
      if (m.data) mm.splice(0, mm.length, ...m.data);
      if (gm.data) members.splice(0, members.length, ...gm.data);
      if (mc.data) memberCos.splice(0, memberCos.length, ...mc.data);
      if (!stale(seq)) drawList();
    }
    const remember = () => (ugRemember("gw_adv_open", adv.open ? "1" : "0"), ugRemember("gw_ug_business", adv.gid), ugRemember("gw_ug_company", adv.cid), ugRemember("gw_adv_module", adv.mid));

    $("#q").addEventListener("input", (e) => ((q = e.target.value), drawList()));
    $("#adv-toggle").onclick = () => ((adv.open = !adv.open), remember(), drawAdv(), drawList());
    $("#adv").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const d = b.dataset;
      if (d.pickBiz) Object.assign(adv, { gid: adv.gid === d.pickBiz ? "" : d.pickBiz, cid: "", mid: "" });
      else if (d.pickCo) adv.cid = adv.cid === d.pickCo ? "" : d.pickCo;
      else if (d.pickMod) adv.mid = adv.mid === d.pickMod ? "" : d.pickMod;
      else return;
      remember();
      drawAdv();
      drawList();
    });
    $("#list").addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      const back = () => !stale(seq) && reload();
      if (b.dataset.window) return userWindow(b.dataset.window, back);
      if (b.dataset.editUser) return userWindow(b.dataset.editUser, back, { edit: true });
    });
    drawAdv();
    drawList();
  }

  // ================================================================ 角色（Master Manage；super_admin 命名角色，按 Business 勾功能）
  /* 弹出视窗：
       名称、说明
       Notice Board：每个 Business 勾「更新 / 删除」
       Module（全域，范围 = 负责的 Business 里的模块）：管理模块内用户权限、改模块名称
       User & Group Manage：勾了才出现 Business 列表；每个 Business 勾：加人进模块、移除、设定模块 Admin、加人进 Business、移出、看全部用户名单
         （勾了任何一项就自动算有 User & Group Manage）
       View audit log */
  async function rolesTab() {
    const seq = routeSeq;
    const tr = (k, v) => t("admin.roles." + k, v);
    const tg = (k, v) => t("admin.groups." + k, v);
    const [roles, rb, groups] = await Promise.all([
      sb.from("gw_roles").select("*").order("sort_order").order("name"),
      sb.from("gw_role_businesses").select("*"),
      sb.from("gw_groups").select("id, name").order("sort_order").order("name"),
    ]).then((r) => r.map((x) => x.data || []));
    if (stale(seq)) return;
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const NOTICE = ["can_post_notice", "can_delete_notice"];
    const UG = ["can_grant_module", "can_revoke_module", "can_set_module_admin", "can_add_business_user", "can_remove_business_user", "can_view_users"];
    // 角色的「Manage users」一个勾 = 加 / 移出这个 Business 的人（含 Company）、看名单；模块权限交给模块管理员 / super_admin
    const UG_BIZ = ["can_add_business_user", "can_remove_business_user", "can_view_users"];
    const bizRows = (rid) => rb.filter((x) => x.role_id === rid);
    const hasAny = (row, keys) => keys.some((k) => row[k]);
    const th = (text, extra) => `<th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase ${extra || ""}">${esc(text)}</th>`;

    view.innerHTML = `<div class="space-y-4">
      <div class="flex items-center justify-end">
        <button id="role-add" class="${btn("primary")} shrink-0">${icon("plus")} ${esc(tr("add"))}</button>
      </div>
      ${
        true
          ? `<div class="${cls.card} overflow-x-auto">
              <table class="w-full min-w-[640px] text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-white/5"><tr>
                  ${th(tr("colRole"))}${th(tr("colBusiness"))}${th(tr("colDescription"))}<th class="w-32"></th>
                </tr></thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr class="align-top bg-red-50/40 dark:bg-red-900/10">
                    <td class="px-4 py-3 font-semibold"><span class="inline-flex items-center gap-1.5">${icon("shield", "size-4 text-red-600")}${esc(tr("superName"))}</span></td>
                    <td class="px-4 py-3">${badge(tr("superBiz"), "red")}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-300">${esc(tr("superDesc"))}</td>
                    <td class="px-4 py-3 text-right"><span class="inline-flex items-center gap-1 text-xs text-slate-400">${icon("lock", "size-3.5")}${esc(tr("builtIn"))}</span></td>
                  </tr>${roles
                  .map((r) => {
                    const biz = bizRows(r.id).filter((x) => hasAny(x, [...NOTICE, ...UG]));
                    return `<tr class="align-top">
                      <td class="px-4 py-3 font-semibold">${esc(r.name)}</td>
                      <td class="px-4 py-3">${biz.length ? `<div class="flex flex-wrap gap-1">${biz.map((x) => badge(groupName.get(x.group_id) || "—", "blue")).join("")}</div>` : `<span class="text-xs text-slate-400">${esc(tr("noBusiness"))}</span>`}</td>
                      <td class="px-4 py-3 text-slate-600 dark:text-slate-300">${esc(r.description || "")}</td>
                      <td class="px-2 py-2 text-right whitespace-nowrap">
                        <button data-view="${r.id}" aria-label="${esc(tr("view"))}" title="${esc(tr("view"))}" class="${btn("ghost", "sm")}">${icon("eye")}</button>
                        <button data-edit="${r.id}" aria-label="${esc(tg("edit"))}" title="${esc(tg("edit"))}" class="${btn("ghost", "sm")}">${icon("pencil")}</button>
                        <button data-del="${r.id}" aria-label="${esc(tg("delete"))}" title="${esc(tg("delete"))}" class="${btn("ghost", "sm")} text-red-600 dark:text-red-400">${icon("trash-2")}</button>
                      </td>
                    </tr>`;
                  })
                  .join("")}</tbody>
              </table>
            </div>`
          : empty(tr("empty"))
      }
    </div>`;
    refreshIcons();

    // 角色设定的内容（readOnly = 查看）
    function body(r, readOnly) {
      const rows = r ? bizRows(r.id) : [];
      const row = (gid) => rows.find((x) => x.group_id === gid) || {};
      const dis = readOnly ? "disabled" : "";
      const box = (name, gid, checked) => `<input type="checkbox" name="${name}" data-g="${gid || ""}" ${checked ? "checked" : ""} ${dis} class="size-4 shrink-0 accent-emerald-600">`;
      return `<div class="space-y-4">
        ${
          readOnly
            ? `<div><p class="text-lg font-semibold">${esc(r.name)}</p>${r.description ? `<p class="text-sm text-slate-500">${esc(r.description)}</p>` : ""}</div>`
            : `${field(tr("name"), `<input name="name" required maxlength="60" value="${esc(r ? r.name : "")}" placeholder="${esc(tr("namePlaceholder"))}" class="${cls.input}">`)}
               ${field(tg("descriptionLabel"), `<input name="description" value="${esc(r ? r.description || "" : "")}" class="${cls.input}">`)}`
        }
        <div data-sec="notice" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-xs font-bold tracking-wider text-slate-500 uppercase">${esc(tr("groups.noticeBoard"))}</p>
            ${readOnly || !groups.length ? "" : `<label class="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" data-all class="size-3.5 accent-emerald-600">${esc(t("admin.modules.tickAll"))}</label>`}
          </div>
          ${
            groups.length
              ? `<div class="divide-y divide-slate-100 dark:divide-slate-800">${groups
                  .map(
                    (g) => `<div class="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                      <span class="w-40 truncate text-sm font-medium">${esc(g.name)}</span>
                      ${NOTICE.map((k) => `<label class="flex items-center gap-1.5 text-sm">${box(k, g.id, row(g.id)[k])}${esc(tr("funcs." + k))}</label>`).join("")}
                    </div>`,
                  )
                  .join("")}</div>`
              : `<p class="text-sm text-slate-400">${esc(tr("noBusinessYet"))}</p>`
          }
        </div>
        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <p class="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">${esc(tr("masterData"))}</p>
          <div class="grid gap-x-5 gap-y-1.5 sm:grid-cols-3">${["can_add_business", "can_add_company", "can_add_module", "can_delete_business", "can_delete_company", "can_delete_module"]
            .map((k) => `<label class="flex items-center gap-2 text-sm ${readOnly ? "" : "cursor-pointer"}"><input type="checkbox" name="${k}" ${r && r[k] ? "checked" : ""} ${dis} class="size-4 shrink-0 accent-emerald-600">${esc(tr("funcs." + k))}</label>`)
            .join("")}</div>
        </div>
        <div data-sec="access" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-xs font-bold tracking-wider text-slate-500 uppercase">${esc(tr("manageAccess"))}</p>
            ${readOnly || !groups.length ? "" : `<label class="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" data-all class="size-3.5 accent-emerald-600">${esc(t("admin.modules.tickAll"))}</label>`}
          </div>
          ${
            groups.length
              ? `<div class="divide-y divide-slate-100 dark:divide-slate-800">${groups
                  .map((g) => `<label class="flex items-center gap-2.5 py-1.5 text-sm font-medium ${readOnly ? "" : "cursor-pointer"}">${box("manage_access", g.id, hasAny(row(g.id), UG_BIZ))}${esc(g.name)}</label>`)
                  .join("")}</div>`
              : `<p class="text-sm text-slate-400">${esc(tr("noBusinessYet"))}</p>`
          }
        </div>
      </div>`;
    }

    function viewDialog(r) {
      const m = modal(
        tr("viewTitle"),
        `${body(r, true)}
         <div class="mt-4 flex justify-end gap-2"><button data-edit-now class="${btn("secondary")}">${icon("pencil")} ${esc(tg("edit"))}</button><button data-done class="${btn("primary")}">${esc(t("admin.users.done"))}</button></div>`,
        { wide: true },
      );
      refreshIcons();
      $("[data-done]", m.el).onclick = m.close;
      $("[data-edit-now]", m.el).onclick = () => (m.close(), dialog(r));
    }

    function dialog(r) {
      const m = modal(
        r ? tr("editTitle") : tr("addTitle"),
        `<form class="space-y-4">
          <div data-err></div>
          ${body(r, false)}
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(tg("cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(tg("save"))}</button>
          </div>
        </form>`,
        { wide: true },
      );
      refreshIcons();
      const f = $("form", m.el);
      $("[data-cancel]", m.el).onclick = m.close;
      // 每一区右上角「Tick all」：勾 / 取消这一区全部；个别勾选变动时同步「Tick all」
      const syncAll = (sec) => {
        const all = $("[data-all]", sec);
        if (all) all.checked = $$("input[data-g]", sec).every((x) => x.checked);
      };
      $$("[data-sec]", f).forEach(syncAll);
      f.addEventListener("change", (e) => {
        const el = e.target;
        const sec = el.closest("[data-sec]");
        if (!sec) return;
        if (el.matches("[data-all]")) $$("input[data-g]", sec).forEach((x) => (x.checked = el.checked));
        else syncAll(sec);
      });
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submit = $("button[type=submit]", f);
        submit.disabled = true;
        const fail = (error) => (($("[data-err]", m.el).innerHTML = alertBox(error && error.code === "23505" ? tr("duplicate") : tg("saveFailed"))), (submit.disabled = false));
        const perBiz = {};
        groups.forEach((g) => (perBiz[g.id] = {}));
        // 「Manage users」一个勾 = 加 / 移出这个 Business 的人、看名单；模块相关的角色功能一律关掉（交给模块管理员）
        $$("input[data-g]", f).forEach((x) => {
          if (!x.dataset.g) return;
          if (x.name === "manage_access") UG.forEach((k) => (perBiz[x.dataset.g][k] = x.checked && UG_BIZ.includes(k)));
          else perBiz[x.dataset.g][x.name] = x.checked;
        });
        const anyUg = Object.values(perBiz).some((p) => hasAny(p, UG));
        const row = {
          name: f.name.value.trim(),
          description: f.description.value.trim() || null,
          can_view_user_group: anyUg,
          can_view_audit: false,
          can_manage_module_access: false,
          can_edit_module_name: false,
          can_delete_business: f.can_delete_business.checked,
          can_delete_company: f.can_delete_company.checked,
          can_delete_module: f.can_delete_module.checked,
          can_add_business: f.can_add_business.checked,
          can_add_company: f.can_add_company.checked,
          can_add_module: f.can_add_module.checked,
        };
        const put = (x) => (r ? sb.from("gw_roles").update(x).eq("id", r.id).select().single() : sb.from("gw_roles").insert(x).select().single());
        let saved = await put(row);
        // 资料库还没加「新增」这几栏（20261203）：先存其他的，提醒跑 SQL
        if (saved.error && /can_add_(business|company|module)/.test(saved.error.message || "")) {
          ["can_add_business", "can_add_company", "can_add_module"].forEach((k) => delete row[k]);
          saved = await put(row);
          if (!saved.error) toast(tr("addNeedsDb"));
        }
        // 资料库还没加「删除」这几栏：先存其他的，提醒跑 SQL
        if (saved.error && /can_delete/.test(saved.error.message || "")) {
          ["can_delete_business", "can_delete_company", "can_delete_module"].forEach((k) => delete row[k]);
          saved = await put(row);
          if (!saved.error) toast(tr("deleteNeedsDb"));
        }
        if (saved.error) return fail(saved.error);
        const id = saved.data.id;
        // 每个 Business 一行：有勾任何功能的保留 / 新增，全部没勾的拿掉
        const keep = groups.filter((g) => hasAny(perBiz[g.id], [...NOTICE, ...UG])).map((g) => ({ role_id: id, group_id: g.id, ...perBiz[g.id] }));
        const drop = groups.filter((g) => !hasAny(perBiz[g.id], [...NOTICE, ...UG])).map((g) => g.id);
        const [r1, r2] = await Promise.all([
          keep.length ? sb.from("gw_role_businesses").upsert(keep, { onConflict: "role_id,group_id" }) : Promise.resolve({}),
          drop.length ? sb.from("gw_role_businesses").delete().eq("role_id", id).in("group_id", drop) : Promise.resolve({}),
        ]);
        if (r1.error || r2.error) return fail(r1.error || r2.error);
        m.close();
        rolesTab();
      });
    }

    view.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.id === "role-add") return dialog(null);
      const r = roles.find((x) => x.id === (b.dataset.view || b.dataset.edit || b.dataset.del));
      if (!r) return;
      if (b.dataset.view) return viewDialog(r);
      if (b.dataset.edit) return dialog(r);
      if (!(await confirmDialog(tr("deleteTitle"), tr("deleteBody", { name: r.name }), tg("delete"), tg("cancel")))) return;
      const { error } = await sb.from("gw_roles").delete().eq("id", r.id);
      if (error) setMsg(tg("saveFailed"));
      rolesTab();
    };
  }

  // ---------------------------------------------------------------- Company 资料窗（Company 页、Business 页、群组列表共用）
  /* 永远显示同一组基本资料：名称、代码、说明、注册号码，以及它属于的每个 Business 和面积。
     fromGroupId：从某个 Business 点进来时，那个 Business 当标题、先显示，其他 Business 放后面。 */
  async function companyInfo(companyId, fromGroupId) {
    const tc = (k, v) => t("admin.company." + k, v);
    const m = modal("", GW.spinner());
    const [{ data: c }, { data: links }, { data: groups }, { data: mems }, { data: locs }] = await Promise.all([
      sb.from("gw_companies").select("*").eq("id", companyId).maybeSingle(),
      sb.from("gw_business_companies").select("group_id, area, area_unit").eq("company_id", companyId),
      sb.from("gw_groups").select("id, name, code").order("sort_order").order("name"),
      sb.from("gw_member_companies").select("group_id").eq("company_id", companyId),
      sb.from("gw_company_locations").select("*").eq("company_id", companyId).order("sort_order").order("name"), // 资料库还没更新时就是空的
    ]);
    if (!c) return m.close();
    const gName = new Map((groups || []).map((g) => [g.id, g]));
    const rows = (links || [])
      .map((l) => ({ ...l, g: gName.get(l.group_id) }))
      .filter((l) => l.g)
      .sort((a, b) => (a.group_id === fromGroupId ? -1 : b.group_id === fromGroupId ? 1 : 0));
    const area = (l) => (l.area != null ? `${Number(l.area).toLocaleString(GW.LOCALE)} ${esc(l.area_unit || "")}` : "—");
    const people = (gid) => (mems || []).filter((x) => x.group_id === gid).length;
    // 每个 Business 底下的 Location（还没分 Business 的旧 Location 算在第一个 Business）
    const firstGid = rows.length ? [...rows].sort((a, b) => (groups || []).findIndex((g) => g.id === a.group_id) - (groups || []).findIndex((g) => g.id === b.group_id))[0].group_id : null;
    const locsOf = (gid) => (locs || []).filter((x) => x.group_id === gid || (!x.group_id && gid === firstGid));
    const from = fromGroupId ? gName.get(fromGroupId) : null;
    const h = m.el.parentElement.querySelector("h2");
    if (h) h.textContent = from ? from.name : c.name;
    m.el.innerHTML = `<div class="space-y-4">
      <div class="flex items-start gap-3">
        <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-6")}</span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><span class="text-lg font-semibold">${esc(c.name)}</span>${c.code ? `<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">${esc(c.code)}</span>` : ""}${c.is_active ? "" : badge(tc("inactive"))}</div>
          <p class="text-sm text-slate-500">${esc([c.short_name, c.registration_no].filter(Boolean).join(" · "))}</p>
          ${c.description ? `<p class="mt-1 text-sm">${esc(c.description)}</p>` : ""}
        </div>
      </div>
      <div class="space-y-2">
        ${
          rows.length
            ? rows
                .map((l, i) => {
                  const ls = locsOf(l.group_id);
                  const can = c.has_locations && ls.length > 0;
                  return `<div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 ${i === 0 && from ? "ring-1 ring-brand-500/40" : ""}">
                    <button type="button" ${can ? `data-exp="${l.group_id}" aria-expanded="false"` : "disabled"} class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${can ? "hover:bg-slate-50 dark:hover:bg-white/5" : "cursor-default"}">
                      <span data-chev class="shrink-0 text-slate-400 transition-transform ${can ? "" : "invisible"}">${icon("chevron-right", "size-4")}</span>
                      ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
                      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(l.g.name)}</span><span class="block text-xs text-slate-500">${esc(tc("members", { count: people(l.group_id) }))}${c.has_locations ? " · " + esc(ls.length === 1 ? tc("oneLocation") : ls.length ? tc("locationCount", { count: ls.length }) : tc("noLocationYet")) : c.location_id ? " · " + esc(tc("opisproLocationId")) + " " + esc(c.location_id) : ""}</span></span>
                      <span class="text-sm"><span class="text-xs text-slate-500">${esc(tc("area"))} </span><span class="font-medium">${area(l)}</span></span>
                    </button>
                    ${
                      can
                        ? `<div data-exp-body="${l.group_id}" class="hidden border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-white/5">
                        <div class="grid grid-cols-[8rem_1fr_5rem_auto] gap-2 pb-1 text-[11px] font-medium text-slate-500"><span>${esc(tc("opisproLocationId"))}</span><span>${esc(tc("locationName"))}</span><span>${esc(tc("locationShortName"))}</span><span class="text-right">${esc(tc("area"))}</span></div>
                        ${ls
                          .map(
                            (x) => `<div class="grid grid-cols-[8rem_1fr_5rem_auto] gap-2 border-t border-slate-200/70 py-1.5 text-sm dark:border-slate-700/60">
                              <span class="truncate font-mono text-xs leading-5 text-slate-500">${esc(x.location_id || "—")}</span>
                              <span class="truncate">${esc(x.name)}</span>
                              <span class="truncate text-slate-500">${esc(x.short_name || "—")}</span>
                              <span class="text-right tabular-nums">${x.area != null ? `${Number(x.area).toLocaleString(GW.LOCALE)} ${esc(tc("unitHa"))}` : "—"}</span>
                            </div>`,
                          )
                          .join("")}
                      </div>`
                        : ""
                    }
                  </div>`;
                })
                .join("")
            : `<p class="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400 dark:border-slate-700">${esc(tc("noBusinessYet"))}</p>`
        }
      </div>
      <div class="flex justify-end"><button data-done class="${btn("primary")}">${esc(t("admin.users.done"))}</button></div>
    </div>`;
    refreshIcons();
    $("[data-done]", m.el).onclick = m.close;
    // 点 Business：展开 / 收起它底下的 Location
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-exp]");
      if (!b) return;
      const body = $(`[data-exp-body="${b.dataset.exp}"]`, m.el);
      const open = body.classList.toggle("hidden") === false;
      b.setAttribute("aria-expanded", open ? "true" : "false");
      $("[data-chev]", b).classList.toggle("rotate-90", open);
    });
  }

  // 拖拉排顺序（Business、Company 卡片）：拖完把新的顺序存进 sort_order
  function sortableCards(container, table, onSaved) {
    if (!isSuper || !container || !window.Sortable) return null;
    return window.Sortable.create(container, {
      handle: "[data-grip]",
      animation: 150,
      delay: 150,
      delayOnTouchOnly: true,
      onEnd: async () => {
        const ids = $$("[data-card]", container).map((el) => el.dataset.card);
        await Promise.all(ids.map((id, i) => sb.from(table).update({ sort_order: i }).eq("id", id)));
        if (onSaved) onSaved();
      },
    });
  }
  const grip = () => `<span data-grip title="${esc(t("admin.company.dragOrder"))}" class="cursor-grab touch-none rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing">${icon("grip-vertical", "size-4")}</span>`;

  // ================================================================ Business & Module（Master Manage；一页看完 Business → Company → Sector → 模块）
  /* 每个 Business 一个方块，由上往下排：标题列（名称、代码、改名、删除），底下一排 Company 短名（点开改资料；「+」加 Company），
     再底下是 Sector 直栏（每个 Sector 一栏，最后一栏「No sector」，标题上的「+」新增 Sector），模块图示＋名称放在所属的 Sector 栏里。
     「No sector」也放还没加进这个 Business 的模块（淡色虚线框）：拖进某个 Sector 栏 = 加进这个 Business；
     已加进的拖到别栏 = 换 Sector。要从 Business 拿掉模块：开模块编辑窗取消勾选。模块不显示说明文字；点模块才开编辑窗。
     Business / Company 的代码是流水号（01、02…）自动给。删除 Business / Company / 模块：super admin，或用户资料里勾了可以删的人。 */
  async function structureTab() {
    const seq = routeSeq;
    const ts = (k, v) => t("admin.structure." + k, v);
    const tb = (k, v) => t("admin.business." + k, v);
    const tc = (k, v) => t("admin.company." + k, v);
    const tmod = (k, v) => t("admin.modules." + k, v);
    const tsec = (k, v) => t("admin.sector." + k, v);
    const tg = (k, v) => t("admin.groups." + k, v);
    // Sector / 负责人两栏要数据库更新过才有；还没更新时照常显示，只是少了 Sector 直栏
    const sectorRes = await sb.from("gw_sectors").select("*").order("sort_order").order("name");
    const sectorsReady = !sectorRes.error;
    const sectors = sectorsReady ? sectorRes.data || [] : [];
    const [groups, companies, links, modules, bizTags, coTags, people, locationRows] = await Promise.all([
      sb.from("gw_groups").select("*").order("sort_order").order("name"),
      sb.from("gw_companies").select("*").order("sort_order").order("name"),
      sb.from("gw_business_companies").select("group_id, company_id, area, area_unit"),
      sb.from("gw_modules").select("*").eq("kind", "system").order("sort_order").order("name"),
      sb.from("gw_group_modules").select(sectorsReady ? "group_id, module_id, sector_id, lead_user_id" : "group_id, module_id"),
      sb.from("gw_module_companies").select("module_id, company_id"),
      sb.from("gw_profiles").select("id, full_name").eq("status", "active").order("full_name"),
      sb.from("gw_company_locations").select("*").order("sort_order").order("name"), // 资料库还没更新时就是空的
    ]).then((r) => r.map((x) => x.data || []));
    if (stale(seq)) return;
    const locations = locationRows; // 每家 Company 的 Location（勾了 has_locations 的公司才有）

    const modById = new Map(modules.map((m) => [m.id, m]));
    const coById = new Map(companies.map((c) => [c.id, c]));
    const personName = new Map(people.map((x) => [x.id, x.full_name]));
    const coShort = (c) => c.short_name || c.code || c.name;
    const linksOf = (cid) => links.filter((l) => l.company_id === cid);
    const companiesIn = (gid) =>
      links
        .filter((l) => l.group_id === gid && coById.has(l.company_id))
        .map((l) => coById.get(l.company_id))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
    const tagOf = (gid, mid) => bizTags.find((x) => x.group_id === gid && x.module_id === mid);
    const canRename = (mid) => isSuper || (C.can_edit_module_name && (me.roleModules || []).includes(mid));
    // 删除 Business / Company / 模块：Super Admin，或角色（Master Manage → Role）有勾这一项
    const canDelBiz = isSuper || !!C.can_delete_business;
    const canDelCo = isSuper || !!C.can_delete_company;
    const canDelMod = isSuper || !!C.can_delete_module;
    // 新增 Business / Company / 模块（加进 Business）：Super Admin，或角色有勾（20261203）
    const canAddBiz = isSuper || !!C.can_add_business;
    const canAddCo = isSuper || !!C.can_add_company;
    const canAddMod = isSuper || !!C.can_add_module;
    // 流水号：现有代码里最大的数字 + 1，至少两位（01、02 … 10、11）
    const nextCode = (list) => String(Math.max(0, ...list.map((x) => (/^\d+$/.test(x.code || "") ? Number(x.code) : 0))) + 1).padStart(2, "0");
    const logo = (m, size) =>
      m.image_url
        ? `<img src="${esc(m.image_url)}" alt="" class="${size} shrink-0 rounded-xl object-cover">`
        : `<span class="flex ${size} shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-700/20 dark:text-brand-100">${moduleIcon(m.icon, "size-5")}</span>`;
    const sorters = [];

    // ---- 一个模块图示（拖拉用；点一下开编辑窗）
    function tile(g, m) {
      const tag = g ? tagOf(g.id, m.id) : null;
      const lead = tag && tag.lead_user_id ? personName.get(tag.lead_user_id) : "";
      const title = [m.name, lead ? ts("lead", { name: lead }) : ""].filter(Boolean).join(" · ");
      return `<div data-mod="${m.id}" title="${esc(title)}" class="st-tile group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-left select-none dark:border-slate-700 dark:bg-slate-900 ${
        isSuper ? "cursor-grab active:cursor-grabbing" : ""
      } ${m.is_active ? "" : "opacity-60"}">
        ${logo(m, "size-8")}
        <span class="min-w-0 flex-1 text-xs leading-tight font-medium">${esc(m.name)}</span>
        ${canRename(m.id) ? `<button data-edit-mod="${m.id}" aria-label="${esc(tmod("edit"))}" title="${esc(tmod("edit"))}" class="shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10">${icon("pencil", "size-3.5")}</button>` : ""}
      </div>`;
    }
    // ---- 一个 Sector 直栏（sid 为空 = No sector）
    function column(g, sid, label) {
      const mods = modules.filter((m) => {
        const tag = tagOf(g.id, m.id);
        return !!tag && (sectorsReady ? (tag.sector_id || null) === (sid || null) : true);
      });
      const canAddMore = !sid && canAddMod && modules.some((m) => !tagOf(g.id, m.id));
      return `<div class="flex min-w-0 flex-col rounded-xl bg-slate-50 p-1.5 dark:bg-white/5">
        <div class="flex items-center gap-1 px-1 pb-1.5">
          <p class="min-w-0 flex-1 truncate text-[11px] font-bold tracking-wider text-slate-500 uppercase" title="${esc(label)}">${esc(label)}</p>
          ${
            !isSuper || !sectorsReady
              ? ""
              : sid
                ? `<button data-edit-sector="${sid}" aria-label="${esc(tsec("editTitle"))}" title="${esc(tsec("editTitle"))}" class="rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-white/10">${icon("pencil", "size-3")}</button>`
                : `<button data-add-sector aria-label="${esc(tsec("add"))}" title="${esc(tsec("add"))}" class="flex size-5 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-brand-500 hover:text-brand-600 dark:border-slate-600">${icon("plus", "size-3")}</button>`
          }
        </div>
        <div data-drop="${g.id}" data-sector="${sid || ""}" class="st-drop flex min-h-14 flex-1 flex-col gap-1.5 rounded-lg">${mods.map((m) => tile(g, m)).join("")}</div>
        ${canAddMore ? `<button data-add-mod="${g.id}" class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-2 py-2 text-xs font-medium text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:hover:border-white dark:hover:text-white">${icon("plus", "size-3.5")}${esc(ts("addModule"))}</button>` : ""}
      </div>`;
    }
    // ---- 一个 Business 方块
    function bizBox(g) {
      const cos = companiesIn(g.id);
      const cols = sectorsReady ? [...sectors.map((s) => [s.id, s.name]), ["", ts("noSector")]] : [["", t("admin.tabs.modules")]];
      return `<section data-card="${g.id}" data-biz="${g.id}" class="st-biz flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" style="--st-cols:${cols.length}">
        <header class="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
          ${isSuper ? grip() : ""}
          ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
          <h3 class="min-w-0 flex-1 truncate font-semibold">${esc(g.name)}</h3>
          ${g.code ? `<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">${esc(g.code)}</span>` : ""}
          ${isSuper ? `<button data-edit-biz="${g.id}" aria-label="${esc(tg("edit"))}" title="${esc(tg("edit"))}" class="${btn("ghost", "sm")}">${icon("pencil")}</button>` : ""}
          ${canDelBiz ? `<button data-del-biz="${g.id}" aria-label="${esc(tg("delete"))}" title="${esc(tg("delete"))}" class="${btn("ghost", "sm")} text-red-600 dark:text-red-400">${icon("trash-2")}</button>` : ""}
        </header>
        <div class="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          ${icon("building-2", "size-3.5 shrink-0 text-slate-400")}
          ${cos
            .map(
              (c) =>
                `<button data-co="${c.id}" data-from="${g.id}" title="${esc(c.name)}" class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-white/5 dark:hover:bg-white/10 ${c.is_active ? "" : "line-through opacity-60"}">${esc(coShort(c))}</button>`,
            )
            .join("")}
          ${cos.length ? "" : `<span class="text-xs text-slate-400">${esc(ts("noCompany"))}</span>`}
          ${canAddCo ? `<button data-add-co="${g.id}" aria-label="${esc(ts("addCompany"))}" title="${esc(ts("addCompany"))}" class="flex size-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-brand-500 hover:text-brand-600 dark:border-slate-600">${icon("plus", "size-3.5")}</button>` : ""}
          ${g.all_companies ? `<p class="flex basis-full items-center gap-1 pt-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">${icon("layers", "size-3.5 shrink-0")}${esc(ts("sharedAcross"))}</p>` : ""}
        </div>
        <div class="st-sectors grid flex-1 gap-2 p-3">${cols.map(([sid, label]) => column(g, sid, label)).join("")}</div>
      </section>`;
    }

    function draw() {
      sorters.splice(0).forEach((s) => s.destroy());
      view.innerHTML = `<div class="space-y-4">
        ${canAddBiz ? `<div class="flex justify-end"><button id="st-add-biz" class="${btn("primary")}">${icon("plus")} ${esc(ts("addBusiness"))}</button></div>` : ""}
        ${groups.length ? `<div id="st-board" class="flex flex-col gap-4">${groups.map(bizBox).join("")}</div>` : empty(tb("empty"))}
        ${!sectorsReady ? `<p class="text-xs text-amber-600">${esc(tsec("notReady"))}</p>` : ""}
      </div>`;
      refreshIcons();
      if (!isSuper || !window.Sortable) return;
      // Business 方块上下拖拉排顺序
      sorters.push(sortableCards($("#st-board"), "gw_groups", () => toast(t("admin.company.orderSaved"))));
      // 模块只能在同一个 Business 里的 Sector 栏之间拖
      $$("[data-drop]").forEach((list) => {
        sorters.push(
          window.Sortable.create(list, {
            group: "st-" + list.dataset.drop,
            animation: 150,
            delay: 120,
            delayOnTouchOnly: true,
            filter: "[data-edit-mod]",
            preventOnFilter: false,
            ghostClass: "sortable-ghost",
            onEnd: (evt) => evt.from !== evt.to && moved(evt),
          }),
        );
      });
    }

    // 模块拖到别的栏位：存进 gw_group_modules
    async function moved(evt) {
      const mid = evt.item.dataset.mod;
      const gid = evt.to.dataset.drop;
      const to = evt.to.dataset.sector;
      const g = groups.find((x) => x.id === gid);
      const m = modById.get(mid);
      if (!g || !m) return draw();
      const tag = tagOf(gid, mid);
      let res;
      if (!tag) {
        const row = { group_id: gid, module_id: mid, ...(sectorsReady ? { sector_id: to || null } : {}) };
        res = await sb.from("gw_group_modules").insert(row);
        if (!res.error) bizTags.push(row);
      } else {
        res = await sb.from("gw_group_modules").update({ sector_id: to || null }).eq("group_id", gid).eq("module_id", mid);
        if (!res.error) tag.sector_id = to || null;
      }
      if (res.error) setMsg(tg("saveFailed"));
      else toast(ts("saved"));
      draw();
    }

    // ---------------------------------------------------------- 「+ Add module」：列出还没加进这个 Business 的模块，点一下加进「No sector」
    // 「+ Add module」：列还没加进这个 Business 的模块；按 Add 马上写入、原地显示「Added」，窗不关，可以继续加别的
    function addModuleDialog(g) {
      const free = modules.filter((m) => !tagOf(g.id, m.id));
      const m = modal(
        ts("addModuleTitle", { name: g.name }),
        `<div class="space-y-3">
          <p class="text-sm text-slate-500">${esc(ts("addModuleHint"))}</p>
          <div data-err></div>
          ${free.length ? "" : `<p class="text-sm text-slate-400">${esc(ts("allModulesAdded"))}</p>`}
          <div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800 ${free.length ? "" : "hidden"}">${free
            .map(
              (x) => `<div class="flex items-center gap-3 px-3 py-2">
                ${logo(x, "size-9")}
                <span class="min-w-0 flex-1 truncate text-sm font-medium">${esc(x.name)}</span>
                <button data-pick-mod="${x.id}" class="${btn("secondary", "sm")}">${icon("plus", "size-4")} ${esc(ts("add"))}</button>
              </div>`,
            )
            .join("")}</div>
        </div>`,
      );
      refreshIcons();
      m.el.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pick-mod]");
        if (!b) return;
        b.disabled = true;
        // 一个模块只有一个 Sector：别的 Business 已经有设定就沿用
        const sid = sectorsReady ? (bizTags.find((x) => x.module_id === b.dataset.pickMod && x.sector_id) || {}).sector_id || null : undefined;
        const row = { group_id: g.id, module_id: b.dataset.pickMod, ...(sectorsReady ? { sector_id: sid } : {}) };
        const { error } = await sb.from("gw_group_modules").insert(row);
        if (error) return (($("[data-err]", m.el).innerHTML = alertBox(tg("saveFailed"))), (b.disabled = false));
        bizTags.push(row);
        b.outerHTML = `<span class="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">${icon("check", "size-4")}${esc(ts("added"))}</span>`;
        refreshIcons();
        draw();
      });
    }

    // ---------------------------------------------------------- Business 新增 / 修改
    function bizDialog(g) {
      const m = modal(
        g ? tb("editTitle") : tb("addTitle"),
        `<form class="space-y-4">
          <div data-err></div>
          <div class="grid gap-4 sm:grid-cols-[10rem_1fr]">
            ${field(tb("code"), `<input name="code" required maxlength="20" value="${esc(g ? g.code || nextCode(groups) : nextCode(groups))}" readonly class="${cls.input} bg-slate-50 font-mono dark:bg-slate-800">`, ts("codeAuto"))}
            ${field(tb("name"), `<input name="name" required value="${esc(g ? g.name : "")}" class="${cls.input}">`)}
          </div>
          ${field(tg("descriptionLabel"), `<input name="description" value="${esc(g ? g.description || "" : "")}" class="${cls.input}">`)}
          <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <input type="checkbox" name="all_companies" ${g && g.all_companies ? "checked" : ""} class="mt-0.5 size-4 accent-emerald-600">
            <span><span class="block text-sm font-medium">${esc(tb("shareAll"))}</span><span class="block text-xs text-slate-500">${esc(tb("shareAllHint"))}</span></span>
          </label>
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(tg("cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(tg("save"))}</button>
          </div>
        </form>`,
      );
      $("[data-cancel]", m.el).onclick = m.close;
      $("[name=name]", m.el).focus();
      $("form", m.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const row = { code: f.code.value.trim().toUpperCase(), name: f.name.value.trim(), description: f.description.value.trim() || null };
        // Share to all selected companies（不用切换 Company）：资料库还没加这一栏时就先不存它
        if (f.all_companies.checked || (g && "all_companies" in g)) row.all_companies = f.all_companies.checked;
        const { error } = g ? await sb.from("gw_groups").update(row).eq("id", g.id) : await sb.from("gw_groups").insert({ ...row, sort_order: groups.length });
        if (error && /all_companies/.test(error.message || "")) return ($("[data-err]", m.el).innerHTML = alertBox(tb("allCompaniesNeedsDb")));
        if (error) return ($("[data-err]", m.el).innerHTML = alertBox(error.code === "23505" ? tb("duplicate") : error.code === "23514" ? tb("badCode") : tg("saveFailed")));
        m.close();
        structureTab();
      });
    }

    // ---------------------------------------------------------- 「+」这个 Business 有哪些 Company：打勾选 / 取消
    /* 列出所有 Company，勾了就是在这个 Business 里。
       下面「Share to all selected companies」（gw_groups.all_companies）：打开后这个 Business 的人
       不用切换 Company，一起看自己被分到的所有 Company 的模块。 */
    function addCompanyDialog(g) {
      const shareReady = "all_companies" in g;
      const before = new Set(links.filter((l) => l.group_id === g.id).map((l) => l.company_id));
      const label = (c) => (c.code ? c.code + " · " : "") + c.name;
      const m = modal(
        ts("companiesTitle", { name: g.name }),
        `<div class="space-y-4"><div data-err></div>
          ${
            companies.length
              ? `<div class="grid max-h-[45vh] gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2 dark:border-slate-700">${companies
                  .map((c) => `<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-white/5"><input type="checkbox" name="co" value="${c.id}" ${before.has(c.id) ? "checked" : ""} class="size-4 accent-brand-600"><span class="truncate">${esc(label(c))}</span></label>`)
                  .join("")}</div>`
              : `<p class="text-sm text-slate-500">${esc(ts("noCompany"))}</p>`
          }
          ${
            shareReady
              ? `<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <input type="checkbox" name="share" ${g.all_companies ? "checked" : ""} class="mt-0.5 size-4 accent-brand-600">
                  <span><span class="block text-sm font-medium">${esc(tb("shareAll"))}</span><span class="block text-xs text-slate-500">${esc(tb("shareAllHint"))}</span></span>
                </label>`
              : ""
          }
          <div class="flex flex-wrap items-center justify-between gap-2">
            <button type="button" data-new-co class="${btn("secondary")}">${icon("plus")} ${esc(ts("newCompany"))}</button>
            <span class="flex gap-2"><button type="button" data-cancel class="${btn("secondary")}">${esc(t("admin.users.cancel"))}</button><button type="button" data-save class="${btn("primary")}">${esc(ts("save"))}</button></span>
          </div>
        </div>`,
        { wide: true },
      );
      refreshIcons();
      $("[data-cancel]", m.el).onclick = m.close;
      $("[data-new-co]", m.el).onclick = () => {
        m.close();
        companyDialog(null, g.id);
      };
      const save = $("[data-save]", m.el);
      save.onclick = async () => {
        const fail = () => (($("[data-err]", m.el).innerHTML = alertBox(tg("saveFailed"))), (save.disabled = false));
        const after = new Set($$("[name=co]:checked", m.el).map((x) => x.value));
        const add = [...after].filter((x) => !before.has(x));
        const drop = [...before].filter((x) => !after.has(x));
        // 取消勾选：在这个 Business 里分到这家 Company 的人会失去它，先问
        if (drop.length) {
          const names = drop.map((id) => (companies.find((c) => c.id === id) || {}).name || "—").join(", ");
          if (!(await confirmDialog(ts("removeCoTitle"), ts("removeCoBody", { names, name: g.name }), ts("removeCoOk"), t("admin.users.cancel")))) return;
        }
        save.disabled = true;
        if (add.length) {
          const { error } = await sb.from("gw_business_companies").insert(add.map((id) => ({ group_id: g.id, company_id: id })));
          if (error) return fail();
        }
        if (drop.length) {
          const { error } = await sb.from("gw_business_companies").delete().eq("group_id", g.id).in("company_id", drop);
          if (error) return fail();
        }
        const share = $("[name=share]", m.el);
        if (share && share.checked !== !!g.all_companies) {
          const { error } = await sb.from("gw_groups").update({ all_companies: share.checked }).eq("id", g.id);
          if (error) return fail();
        }
        m.close();
        toast(ts("saved"));
        structureTab();
      };
    }

    // ---------------------------------------------------------- Company 新增 / 修改
    /* 第 1 段：公司名（标题，旁边铅笔才能改）＋ 注册号码；短名、备注；公司代码、Opispro 公司编号；属于哪些 Business（含面积）
       第 2 段：Billing details（地址、电话、传真）
       第 3 段：这家公司有多个 Location → 一行一个（Opispro Location ID、名称），「+ Add row」再加；按 Save 一起存 */
    /* Company 窗口（标题 = 公司名，旁边铅笔：标题本身变成输入框改名）：
         Company code | Opispro Company ID；Registration No. | Short name；Remark（整行）
         Billing details
         Business：已加的 Business 标签 +「+」；每个 Business 一行面积（Ha）
           勾「This company has multiple locations」：每个 Business 下面 Opispro Location ID / Location name / 面积（Ha），可以加列；
           这时 Business 的面积 = 它底下 Location 面积的总和（自动算，不能手改）
         两个分页（点上面的分页切换）：Company details（公司资料＋Billing details）、Business details（每个 Business 一行：名称、面积、X 移出；
           「Add to a business」加到别的 Business；勾了「多个 Location」时点 Business 展开它底下的 Location）
         Location ID / 名称的输入框不放范例字
       全部先记在画面上，按 Save 一次写入 */
    function companyDialog(c, presetGroupId) {
      const v = c || { code: "", name: "", short_name: "", registration_no: "", description: "", opispro_id: "", location_id: "", has_locations: false, billing_address: "", phone: "", fax: "" };
      const mine = c ? linksOf(c.id) : [];
      const link = (gid) => mine.find((l) => l.group_id === gid);
      const bizSel = new Set(c ? mine.map((l) => l.group_id) : presetGroupId ? [presetGroupId] : []); // 这家公司在哪些 Business（按 Save 才存）
      const myLocs = c ? locations.filter((x) => x.company_id === c.id) : [];
      // 还没分 Business 的旧 Location：先放在第一个 Business 底下（按 Save 就记下来）
      const firstBiz = (groups.find((g) => bizSel.has(g.id)) || {}).id;
      const locsOf = (gid) => myLocs.filter((x) => x.group_id === gid || (!x.group_id && gid === firstBiz));
      const numVal = (x) => (x == null ? "" : esc(String(x)));
      const ha = `<span class="text-xs text-slate-400">${esc(tc("unitHa"))}</span>`;
      const locRow = (x) => `<div data-loc-row data-loc-rowid="${x ? x.id : ""}" class="grid grid-cols-[8rem_1fr_6.5rem_7.5rem_auto] items-center gap-2">
          <input data-loc-id maxlength="40" value="${esc(x ? x.location_id || "" : "")}" aria-label="${esc(tc("opisproLocationId"))}" class="${cls.input} h-9 font-mono">
          <input data-loc-name maxlength="100" value="${esc(x ? x.name : "")}" aria-label="${esc(tc("locationName"))}" class="${cls.input} h-9">
          <input data-loc-short maxlength="20" value="${esc(x ? x.short_name || "" : "")}" aria-label="${esc(tc("locationShortName"))}" class="${cls.input} h-9">
          <span class="flex items-center gap-1"><input data-loc-area type="number" min="0" step="0.01" value="${x ? numVal(x.area) : ""}" placeholder="0" aria-label="${esc(tc("area"))}" class="${cls.input} h-9 min-w-0">${ha}</span>
          <button type="button" data-loc-row-del aria-label="${esc(tg("delete"))}" title="${esc(tg("delete"))}" class="${btn("ghost", "sm")} text-red-600 dark:text-red-400">${icon("x")}</button>
        </div>`;
      // 一个 Business 一行：名称、面积、X；勾了「多个 Location」时名称前面有箭头，点开看 / 改这个 Business 底下的 Location
      const bizRow = (g) => {
        const l = link(g.id);
        const rows = locsOf(g.id);
        return `<div data-area-box="${g.id}" class="${bizSel.has(g.id) ? "" : "hidden"} overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <div class="flex items-center gap-2 px-2 py-1.5">
            <button type="button" data-loc-toggle="${g.id}" aria-expanded="false" class="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/5">
              <span data-chev class="shrink-0 text-slate-400 transition-transform">${icon("chevron-right", "size-4")}</span>
              ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
              <span class="truncate text-sm font-semibold">${esc(g.name)}</span>
              <span data-loc-count class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300"></span>
            </button>
            <span data-area-sum="${g.id}" class="hidden text-[11px] font-medium text-emerald-700 dark:text-emerald-300">${esc(tc("sumOfLocations"))}</span>
            <span data-single-loc class="${v.has_locations ? "hidden" : ""} flex shrink-0 items-center gap-1"><span class="text-xs text-slate-500">${esc(tc("locationIdShort"))}</span><span class="w-24 shrink-0"><input data-co-loc maxlength="40" value="${esc(v.location_id || "")}" aria-label="${esc(tc("opisproLocationId"))}" title="${esc(tc("opisproLocationId"))}" class="${cls.input} h-8 px-2 font-mono text-xs"></span></span>
            <span class="text-xs text-slate-500">${esc(tc("area"))}</span>
            <span class="w-28 shrink-0"><input data-area="${g.id}" type="number" min="0" step="0.01" placeholder="0" aria-label="${esc(g.name + " " + tc("area"))}" value="${l ? numVal(l.area) : ""}" class="${cls.input} h-8"></span>${ha}
            <input data-unit="${g.id}" type="hidden" value="${esc(l ? l.area_unit || "ha" : "ha")}">
            <button type="button" data-biz-rm="${g.id}" aria-label="${esc(tc("removeFromBusiness"))}" title="${esc(tc("removeFromBusiness"))}" class="flex size-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">${icon("x", "size-4")}</button>
          </div>
          <div data-loc-biz="${g.id}" class="hidden border-t border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-white/5">
            <div data-loc-head class="${rows.length ? "grid" : "hidden"} mb-1 grid-cols-[8rem_1fr_6.5rem_7.5rem_auto] gap-2 text-[11px] font-medium text-slate-500"><span>${esc(tc("opisproLocationId"))}</span><span>${esc(tc("locationName"))}</span><span>${esc(tc("locationShortName"))}</span><span>${esc(tc("area"))}</span><span class="w-8"></span></div>
            <div data-loc-rows class="space-y-2">${rows.map(locRow).join("")}</div>
            <button type="button" data-loc-row-add="${g.id}" class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-100">${icon("plus", "size-3.5")} ${esc(tc("addLocation"))}</button>
          </div>
        </div>`;
      };
      const tabBtn = (k, ic, text) =>
        `<button type="button" role="tab" data-tab="${k}" class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition">${icon(ic, "size-4")}${esc(text)}</button>`;
      const m = modal(
        c ? c.name : tc("addTitle"),
        `<form class="space-y-4"><div data-err></div>
          <div data-name-box class="${c ? "hidden" : ""}">${field(tc("name"), `<input name="name" required maxlength="100" value="${esc(v.name)}" class="${cls.input}">`)}</div>
          <div role="tablist" class="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
            ${tabBtn("co", "building-2", tc("details"))}
            ${tabBtn("biz", "briefcase-business", tc("businessDetails"))}
          </div>
          <div data-pane="co" class="min-h-[22rem] space-y-3">
            <div class="grid gap-3 sm:grid-cols-3">
              ${field(tc("code"), `<input name="code" required maxlength="20" value="${esc(v.code || nextCode(companies))}" readonly class="${cls.input} bg-slate-50 font-mono dark:bg-slate-800">`)}
              ${field(tc("shortName"), `<input name="short_name" maxlength="40" value="${esc(v.short_name || "")}" class="${cls.input}">`)}
              ${field(tc("registrationNo"), `<input name="registration_no" maxlength="40" value="${esc(v.registration_no || "")}" class="${cls.input}">`)}
              ${field(tc("opisproId"), `<input name="opispro_id" maxlength="40" value="${esc(v.opispro_id || "")}" class="${cls.input} font-mono">`)}
              ${field(tc("phone"), `<input name="phone" maxlength="60" value="${esc(v.phone || "")}" class="${cls.input}">`)}
              ${field(tc("fax"), `<input name="fax" maxlength="60" value="${esc(v.fax || "")}" class="${cls.input}">`)}
            </div>
            ${field(tc("billingAddress"), `<textarea name="billing_address" rows="2" maxlength="400" class="${cls.input} h-auto py-2">${esc(v.billing_address || "")}</textarea>`)}
            ${field(tc("remark"), `<textarea name="description" rows="2" maxlength="300" class="${cls.input} h-auto py-2">${esc(v.description || "")}</textarea>`)}
          </div>
          <div data-pane="biz" class="hidden min-h-[22rem] space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <label class="flex cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" name="has_locations" ${v.has_locations ? "checked" : ""} class="size-4 accent-slate-900 dark:accent-white">${esc(tc("hasLocations"))}</label>
            </div>
            <div class="space-y-2">${groups.map(bizRow).join("")}</div>
            <p data-biz-none class="${bizSel.size ? "hidden" : ""} rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700">${esc(tc("noBusinessYet"))}</p>
            <button type="button" data-biz-add class="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-100">${icon("plus", "size-3.5")} ${esc(tc("addToBusiness"))}</button>
          </div>
          <div class="flex justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            ${c && canDelCo ? `<button type="button" data-del class="${btn("ghost")} text-red-600 dark:text-red-400">${icon("trash-2")} ${esc(tg("delete"))}</button>` : "<span></span>"}
            <div class="flex gap-2"><button type="button" data-cancel class="${btn("secondary")}">${esc(tg("cancel"))}</button><button type="submit" class="${btn("primary")}">${esc(tg("save"))}</button></div>
          </div>
        </form>`,
        { wide: "xl" },
      );
      // 两个分页：Company details / Business details（切换只是显示，资料都留在画面上，Save 一起存）
      const showTab = (k) => {
        $$("[data-tab]", m.el).forEach((tb) => {
          const on = tb.dataset.tab === k;
          tb.setAttribute("aria-selected", on ? "true" : "false");
          ["bg-white", "shadow-sm", "text-slate-900", "dark:bg-slate-800", "dark:text-white"].forEach((x) => tb.classList.toggle(x, on));
          tb.classList.toggle("text-slate-500", !on);
        });
        $$("[data-pane]", m.el).forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== k));
      };
      showTab("co");
      const openLoc = new Set(); // 点开了的 Business（看得到它的 Location）
      // 标题旁边的铅笔：点了标题本身变成输入框（直接在标题改名，不另外开一行）
      if (c && m.head) {
        m.head.innerHTML = `<button type="button" data-name-edit aria-label="${esc(tc("editName"))}" title="${esc(tc("editName"))}" class="${btn("ghost", "sm")}">${icon("pencil")}</button>`;
        m.head.onclick = (e) => {
          if (!e.target.closest("[data-name-edit]")) return;
          const h2 = m.el.parentElement.querySelector("h2");
          const hidden = $("[name=name]", m.el);
          h2.classList.remove("truncate");
          h2.classList.add("flex-1");
          h2.innerHTML = `<input data-title-name maxlength="100" value="${esc(hidden.value)}" aria-label="${esc(tc("name"))}" class="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-lg font-semibold outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-white">`;
          const inp = h2.querySelector("input");
          inp.addEventListener("input", () => (hidden.value = inp.value.trim() ? inp.value : c.name)); // 清空 = 保留原名
          inp.addEventListener("keydown", (ev) => ev.key === "Enter" && ev.preventDefault());
          inp.focus();
          inp.select();
          m.head.innerHTML = "";
        };
      }
      refreshIcons();
      $("[data-cancel]", m.el).onclick = m.close;
      if (!c) $("[name=name]", m.el).focus();
      // 有多个 Location：Business 的面积 = 底下 Location 面积加起来（自动算、不能手改）；没有 Location 列就照旧手填
      const syncAreas = () => {
        const hasLoc = $("[name=has_locations]", m.el).checked;
        groups.forEach((g) => {
          const inp = $(`[data-area="${g.id}"]`, m.el);
          const rows = $$(`[data-loc-biz="${g.id}"] [data-loc-row]`, m.el);
          const auto = hasLoc && rows.length > 0;
          if (auto) {
            const sum = rows.reduce((t, r) => t + (Number($("[data-loc-area]", r).value) || 0), 0);
            inp.value = sum ? String(Math.round(sum * 100) / 100) : "";
          }
          inp.readOnly = auto;
          inp.classList.toggle("bg-slate-100", auto);
          inp.classList.toggle("dark:bg-slate-800", auto);
          $(`[data-area-sum="${g.id}"]`, m.el).classList.toggle("hidden", !auto);
        });
      };
      // 箭头、Location 数目、点开 / 收起（只有勾了「多个 Location」才能点开）
      const syncLoc = () => {
        const hasLoc = $("[name=has_locations]", m.el).checked;
        groups.forEach((g) => {
          const box = $(`[data-area-box="${g.id}"]`, m.el);
          const n = $$(`[data-loc-biz="${g.id}"] [data-loc-row]`, m.el).length;
          const isOpen = hasLoc && openLoc.has(g.id);
          const tg2 = $("[data-loc-toggle]", box);
          tg2.disabled = !hasLoc;
          tg2.setAttribute("aria-expanded", isOpen ? "true" : "false");
          tg2.title = hasLoc ? (isOpen ? tc("hideLocations") : tc("showLocations")) : "";
          $("[data-chev]", box).classList.toggle("invisible", !hasLoc);
          $("[data-chev]", box).classList.toggle("rotate-90", isOpen);
          const cnt = $("[data-loc-count]", box);
          cnt.classList.toggle("hidden", !hasLoc);
          cnt.textContent = n === 1 ? tc("oneLocation") : n ? tc("locationCount", { count: n }) : tc("noLocationYet");
          $(`[data-loc-biz="${g.id}"]`, m.el).classList.toggle("hidden", !isOpen);
        });
        syncAreas();
      };
      syncLoc(); // only after it is defined (called earlier it threw, and Cancel / Save never got wired)
      m.el.addEventListener("input", (e) => e.target.matches("[data-loc-area]") && syncAreas());
      m.el.addEventListener("input", (e) => { if (e.target.matches("[data-co-loc]")) $$("[data-co-loc]", m.el).forEach((x) => { if (x !== e.target) x.value = e.target.value; }); });
      // Business 加入 / 拿掉：那一行出现 / 收起
      const syncBiz = () => {
        $("[data-biz-none]", m.el).classList.toggle("hidden", bizSel.size > 0);
        groups.forEach((g) => $(`[data-area-box="${g.id}"]`, m.el).classList.toggle("hidden", !bizSel.has(g.id)));
        syncLoc();
        refreshIcons();
        m.touch();
      };
      const pickBusiness = () => {
        const free = groups.filter((g) => !bizSel.has(g.id));
        if (!free.length) return toast(tc("allBizAdded"));
        // 标题：Add "公司名" to a new business；底下列还能加的 Business，每个一个「Add to this business」
        const coName = ($("[name=name]", m.el).value || "").trim() || tc("thisCompany");
        const pm = modal(
          tc("addToBizTitle", { name: coName }),
          `<p class="mb-2 text-sm text-slate-500">${esc(tc("addToBizHint"))}</p>
          <div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${free
            .map((g) => `<div class="flex items-center gap-3 px-3 py-2"><span class="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">${icon("briefcase-business", "size-3.5 shrink-0 text-slate-400")}${esc(g.name)}</span><button type="button" data-pick="${g.id}" class="${btn("secondary", "sm")}">${icon("plus", "size-4")} ${esc(tc("addToThisBusiness"))}</button></div>`)
            .join("")}</div>`,
        );
        refreshIcons();
        pm.el.addEventListener("click", (e) => {
          const b = e.target.closest("[data-pick]");
          if (!b) return;
          bizSel.add(b.dataset.pick);
          syncBiz();
          b.outerHTML = `<span class="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-50 px-3 text-sm font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">${icon("check", "size-4")} ${esc(ts("added"))}</span>`;
          refreshIcons();
        });
      };
      m.el.addEventListener("click", (e) => {
        const b = e.target.closest("button[type=button]");
        if (!b) return;
        if (b.dataset.tab) return showTab(b.dataset.tab);
        if ("bizAdd" in b.dataset) return pickBusiness();
        if (b.dataset.bizRm) return (bizSel.delete(b.dataset.bizRm), openLoc.delete(b.dataset.bizRm), syncBiz());
        if (b.dataset.locToggle) {
          const gid = b.dataset.locToggle;
          openLoc.has(gid) ? openLoc.delete(gid) : openLoc.add(gid);
          return syncLoc();
        }
        if ("locRowAdd" in b.dataset) {
          const blk = $(`[data-loc-biz="${b.dataset.locRowAdd}"]`, m.el);
          const host = $("[data-loc-rows]", blk);
          host.insertAdjacentHTML("beforeend", locRow(null));
          $("[data-loc-head]", blk).classList.replace("hidden", "grid");
          refreshIcons();
          const rows = $$("[data-loc-row]", host);
          syncLoc();
          m.touch();
          return $("[data-loc-id]", rows[rows.length - 1]).focus();
        }
        if ("locRowDel" in b.dataset) {
          const blk = b.closest("[data-loc-biz]");
          b.closest("[data-loc-row]").remove();
          if (!$("[data-loc-row]", blk)) $("[data-loc-head]", blk).classList.replace("grid", "hidden"); // 没有 Location 就空白
          syncLoc();
          m.touch();
        }
      });
      // 勾了「有多个 Location」：每个 Business 前面出现箭头；还没有 Location 的 Business 先点开，方便加
      m.el.addEventListener("change", (e) => {
        if (e.target.name === "has_locations") {
          $$("[data-single-loc]", m.el).forEach((x) => x.classList.toggle("hidden", e.target.checked));
          if (e.target.checked) bizSel.forEach((gid) => !$(`[data-loc-biz="${gid}"] [data-loc-row]`, m.el) && openLoc.add(gid));
          syncLoc();
        }
      });

      if (c && $("[data-del]", m.el))
        $("[data-del]", m.el).onclick = async () => {
          if (!(await confirmDialog(tc("deleteTitle"), tc("deleteBody", { name: c.name }), tg("delete"), tg("cancel")))) return;
          const { error } = await sb.from("gw_companies").delete().eq("id", c.id);
          if (error) return ($("[data-err]", m.el).innerHTML = alertBox(tc("inUse")));
          m.close();
          structureTab();
        };

      $("form", m.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const submit = $("button[type=submit]", f);
        // 「要先跑 SQL」只在资料库真的少了栏位 / 表时才说；其他错误照实显示原因
        const missing = (error) => ["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code);
        const fail = (error) => (
          ($("[data-err]", m.el).innerHTML = alertBox(
            error.code === "loc-dup"
              ? tc("locationDuplicate")
              : error.code === "23505"
                ? tc("duplicate")
                : error.code === "23514"
                  ? tc("badCode")
                  : missing(error) && /billing_address|phone|fax/.test(error.message || "")
                    ? tc("billingNotReady")
                    : missing(error) && /opispro_id|has_locations|gw_company_locations|group_id|area/.test(error.message || "")
                      ? tc("locationsNotReady")
                      : error.code === "42501" || /row-level security/i.test(error.message || "")
                        ? tc("noRight")
                        : error.message
                          ? tg("saveFailed") + " (" + error.message + ")"
                          : tg("saveFailed"),
          )),
          (submit.disabled = false),
          (submit.textContent = tg("save"))
        );
        const areaOf = (el) => (el && el.value !== "" ? Number(el.value) : null);
        const hasLoc = f.has_locations.checked;
        // 只收现在这家公司所在 Business 底下的 Location（整列空白的略过；有填的一定要有名字）
        const locRows = hasLoc
          ? $$("[data-loc-biz]", f)
              .filter((bx) => bizSel.has(bx.dataset.locBiz))
              .flatMap((bx) =>
                $$("[data-loc-row]", bx).map((r) => ({ id: r.dataset.locRowid || null, group_id: bx.dataset.locBiz, location_id: $("[data-loc-id]", r).value.trim(), name: $("[data-loc-name]", r).value.trim(), short_name: $("[data-loc-short]", r).value.trim(), area: areaOf($("[data-loc-area]", r)) })),
              )
              .filter((r) => r.location_id || r.name || r.short_name || r.area != null)
          : [];
        if (locRows.some((r) => !r.name)) {
          locRows.filter((r) => !r.name).forEach((r) => openLoc.add(r.group_id));
          syncLoc();
          showTab("biz");
          return ($("[data-err]", m.el).innerHTML = alertBox(tc("locationIncomplete")));
        }
        submit.disabled = true;
        submit.innerHTML = `<span class="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>`;
        const row = {
          code: f.code.value.trim().toUpperCase(),
          name: f.name.value.trim(),
          short_name: f.short_name.value.trim() || null,
          registration_no: f.registration_no.value.trim() || null,
          description: f.description.value.trim() || null,
          opispro_id: f.opispro_id.value.trim() || null,
          location_id: hasLoc ? null : ($$("[data-co-loc]", m.el).map((x) => x.value.trim()).find(Boolean) || null), // the company itself is its one location
          has_locations: hasLoc,
          billing_address: f.billing_address.value.trim() || null,
          phone: f.phone.value.trim() || null,
          fax: f.fax.value.trim() || null,
        };
        const save = (r) => (c ? sb.from("gw_companies").update(r).eq("id", c.id).select().single() : sb.from("gw_companies").insert({ ...r, sort_order: companies.length }).select().single());
        let saved = await save(row);
        // 资料库还没加 location_id 这一栏：先不存（提示要跑 SQL）
        if (saved.error && ["42703", "PGRST204"].includes(saved.error.code) && /location_id/.test(saved.error.message || "")) {
          const { location_id: _x, ...rest } = row;
          saved = await save(rest);
          if (!saved.error && row.location_id) toast(tc("locationIdNeedsDb"));
        }
        if (saved.error) return fail(saved.error);
        const id = saved.data.id;
        // Business 连结 + 面积：加进来的新增 / 更新，拿掉的删除（拿掉前先确认有没有人放在里面）
        const want = [...bizSel];
        const drop = mine.filter((l) => !want.includes(l.group_id)).map((l) => l.group_id);
        const rows = want
          .map((gid) => ({ group_id: gid, company_id: id, area: areaOf($(`[data-area="${gid}"]`, m.el)), area_unit: $(`[data-unit="${gid}"]`, m.el).value.trim() || "ha" }))
          .filter((r) => {
            const l = link(r.group_id);
            return !l || Number(l.area) !== Number(r.area) || (l.area == null) !== (r.area == null) || (l.area_unit || "ha") !== r.area_unit;
          });
        if (drop.length) {
          const { count: n } = await sb.from("gw_member_companies").select("user_id", { count: "exact", head: true }).eq("company_id", id).in("group_id", drop);
          if (n && !(await confirmDialog(tc("unlinkTitle"), tc("unlinkBody", { count: n }), tc("unlink"), tg("cancel")))) return fail({});
        }
        const [r1, r2] = await Promise.all([
          drop.length ? sb.from("gw_business_companies").delete().eq("company_id", id).in("group_id", drop) : Promise.resolve({}),
          rows.length ? (c ? sb.from("gw_business_companies").upsert(rows, { onConflict: "group_id,company_id" }) : sb.from("gw_business_companies").insert(rows)) : Promise.resolve({}),
        ]);
        if (r1.error || r2.error) return fail(r1.error || r2.error);
        // Location：画面上有的新增 / 更新，画面上没有的（或整段没勾）删掉
        const keepIds = new Set(locRows.filter((r) => r.id).map((r) => r.id));
        const gone = myLocs.filter((x) => !keepIds.has(x.id)).map((x) => x.id);
        const sameArea = (x, r) => (x.area == null ? null : Number(x.area)) === r.area;
        const adds = locRows.filter((r) => !r.id).map((r, i) => ({ company_id: id, group_id: r.group_id, location_id: r.location_id || null, name: r.name, short_name: r.short_name || null, area: r.area, sort_order: myLocs.length + i }));
        const edits = locRows.filter((r) => r.id && myLocs.some((x) => x.id === r.id && ((x.location_id || "") !== r.location_id || x.name !== r.name || (x.short_name || "") !== r.short_name || x.group_id !== r.group_id || !sameArea(x, r))));
        // 资料库还没加 Location 面积这一栏：先不存面积
        // 资料库还没加 short_name 这一栏：先不存简称
        let withShort = true;
        const trim = (x) => {
          const y = { ...x };
          if (!withArea0) delete y.area;
          if (!withShort) delete y.short_name;
          return y;
        };
        let withArea0 = true;
        const run = (withArea) => {
          withArea0 = withArea;
          const ops = [];
          if (gone.length) ops.push(sb.from("gw_company_locations").delete().in("id", gone));
          if (adds.length) ops.push(sb.from("gw_company_locations").insert(adds.map(trim)));
          edits.forEach((r) => ops.push(sb.from("gw_company_locations").update(trim({ group_id: r.group_id, location_id: r.location_id || null, name: r.name, short_name: r.short_name || null, area: r.area })).eq("id", r.id)));
          return Promise.all(ops);
        };
        let bad = (await run(true)).find((r) => r.error);
        if (bad && missing(bad.error) && /short_name/.test(bad.error.message || "")) {
          withShort = false;
          bad = (await run(true)).find((r) => r.error);
          if (!bad) toast(tc("locationShortNeedsDb"));
        }
        if (bad && missing(bad.error) && /area/.test(bad.error.message || "")) {
          bad = (await run(false)).find((r) => r.error);
          if (!bad) toast(tc("locationAreaNeedsDb"));
        }
        if (bad) return fail(bad.error.code === "23505" ? { code: "loc-dup" } : bad.error);
        m.close();
        structureTab();
      });
    }

    // ---------------------------------------------------------- 模块编辑窗（名称、说明、照片、停用、Business 标签 + Sector + 负责人、Company 标签）
    // ---------------------------------------------------------- 模块编辑窗：标题 = 模块名
    /* 上面：图示、种类 / 代码、名称、说明、Sector（一个模块只有一个 Sector，写到它每个 Business 的标签上）、启用
       底下一个 Business 一个方块（这个模块有开的 Business）：Company 徽章（没有 = 这个 Business 全部 Company 都能用）、
         「+」勾 Company、负责人；最底下「+ Add business」开给别的 Business
       Business / Company 的改动先记在画面上，按 Save 一次写入 */
    // 编辑窗里的一个方块：标题条（图示 + 粗体标题，右边可以放东西）+ 内容
    const modBox = (ic, title, body, extra = "") =>
      `<section class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <div class="-mx-3 -mt-3 mb-3 flex items-center gap-2 rounded-t-xl border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-white/5">${icon(ic, "size-4 shrink-0 text-brand-600")}<p class="text-sm font-bold tracking-tight text-slate-900 dark:text-white">${esc(title)}</p>${extra}</div>
        ${body}
      </section>`;
    function moduleDialog(mod) {
      const bizOn0 = new Set(bizTags.filter((x) => x.module_id === mod.id).map((x) => x.group_id));
      const coOn0 = new Set(coTags.filter((x) => x.module_id === mod.id).map((x) => x.company_id));
      const bizOn = new Set(bizOn0);
      const coOn = new Set(coOn0);
      const tagIn = (gid) => tagOf(gid, mod.id) || {};
      const leadOf = new Map([...bizOn].map((gid) => [gid, tagIn(gid).lead_user_id || ""]));
      const sector0 = sectorsReady ? [...bizOn].map((gid) => tagIn(gid).sector_id).find(Boolean) || "" : "";
      const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur || "") ? "selected" : ""}>${esc(l)}</option>`).join("");
      let photo = null; // 新选的照片
      const m = modal(
        tmod("editTitleNamed", { name: mod.name }),
        `<form class="space-y-3">
          <div data-err></div>
          ${modBox(
            "layout-grid",
            tmod("detailsBox"),
            `<div class="flex items-start gap-3">
              <div class="flex shrink-0 flex-col items-center gap-1.5">
                <div data-preview>${logo(mod, "size-14")}</div>
                ${isSuper ? `<label class="cursor-pointer text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-100">${esc(tmod("uploadPhoto"))}<input type="file" name="photo" accept="image/*" class="hidden"></label>` : ""}
              </div>
              <div class="grid min-w-0 flex-1 gap-2.5 sm:grid-cols-6">
                <div class="sm:col-span-3">${field(tmod("name"), `<input name="name" required maxlength="60" value="${esc(mod.name)}" class="${cls.input} h-9">`)}</div>
                <div class="sm:col-span-3">${field(tmod("descriptionLabel"), `<input name="description" maxlength="120" value="${esc(mod.description || "")}" class="${cls.input} h-9">`)}</div>
                <div class="sm:col-span-2">${field(tmod("kind"), `<input value="${esc(tmod("kinds." + mod.kind))}" readonly class="${cls.input} h-9 bg-slate-50 dark:bg-slate-800">`)}</div>
                <div class="sm:col-span-2">${field(tmod("code"), `<input value="${esc(mod.code)}" readonly class="${cls.input} h-9 bg-slate-50 font-mono dark:bg-slate-800">`)}</div>
                ${isSuper && sectorsReady ? `<div class="sm:col-span-2">${field(tmod("sector"), `<select name="sector" class="${cls.input} h-9">${opt([["", "—"], ...sectors.map((x) => [x.id, x.name])], sector0)}</select>`)}</div>` : ""}
              </div>
            </div>`,
            isSuper ? `<label class="ml-auto flex items-center gap-1.5 text-xs font-medium"><input type="checkbox" name="is_active" ${mod.is_active ? "checked" : ""} class="size-4 accent-emerald-600">${esc(tmod("activeLabel"))}</label>` : "",
          )}
          ${
            isSuper && mod.kind === "system"
              ? modBox(
                  "plug",
                  tmod("connectionBox"),
                  `<div class="grid gap-2.5 sm:grid-cols-[1fr_13rem]">
                    ${field(tmod("url"), `<input name="url" type="url" maxlength="500" value="${esc(mod.url || "")}" placeholder="https://" class="${cls.input} h-9 font-mono text-xs">`)}
                    ${field(tmod("accessLevel"), `<select name="access_level" class="${cls.input} h-9">${opt([[1, tmod("levels.1")], [2, tmod("levels.2")], [3, tmod("levels.3")]], mod.access_level || 1)}</select>`)}
                  </div>
                  <div data-key-box class="mt-2.5 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-white/5">
                    <div class="flex items-center justify-between gap-2"><span data-key-state class="text-slate-500">…</span>
                      <button type="button" data-gen-key class="${btn("secondary", "sm")}">${icon("key", "size-3.5")} ${esc(tmod("generateKey"))}</button></div>
                    <div data-key-out class="hidden"></div>
                  </div>`,
                )
              : ""
          }
          ${isSuper ? modBox("briefcase-business", tmod("businessTags"), `<div data-biz-area class="space-y-2.5"></div>`) : ""}
          <div class="flex justify-between gap-2">
            ${canDelMod ? `<button type="button" data-del class="${btn("ghost")} text-red-600 dark:text-red-400">${icon("trash-2")} ${esc(tg("delete"))}</button>` : "<span></span>"}
            <div class="flex gap-2">
              <button type="button" data-cancel class="${btn("secondary")}">${esc(tmod("cancel"))}</button>
              <button type="submit" class="${btn("primary")}">${esc(tmod("save"))}</button>
            </div>
          </div>
        </form>`,
        { wide: true },
      );
      const f = $("form", m.el);
      const bizArea = $("[data-biz-area]", m.el);
      const plusBtn = (attrs, label) =>
        `<button type="button" ${attrs} aria-label="${esc(label)}" title="${esc(label)}" class="flex size-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-brand-500 hover:text-brand-600 dark:border-slate-600">${icon("plus", "size-3.5")}</button>`;
      // 负责人：一个搜寻框，打字就列出符合的名字，点一个就选
      const leadName = (gid) => ((people.find((x) => x.id === leadOf.get(gid)) || {}).full_name || "");
      const showLeadList = (gid, q) => {
        const box = $(`[data-lead-list="${gid}"]`, m.el);
        if (!box) return;
        const s = (q || "").trim().toLowerCase();
        const list = people.filter((x) => !s || (x.full_name || "").toLowerCase().includes(s)).slice(0, 30);
        box.innerHTML = list.length
          ? list.map((x) => `<button type="button" data-lead-pick="${gid}:${x.id}" class="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${x.id === leadOf.get(gid) ? "font-semibold text-brand-600" : ""}">${esc(x.full_name)}</button>`).join("")
          : `<p class="px-2.5 py-1.5 text-sm text-slate-400">${esc(t("admin.users.empty"))}</p>`;
        box.classList.remove("hidden");
      };
      const hideLeadLists = () => $$("[data-lead-list]", m.el).forEach((x) => x.classList.add("hidden"));
      function paintBiz() {
        if (!bizArea) return;
        const on = groups.filter((g) => bizOn.has(g.id));
        const free = groups.filter((g) => !bizOn.has(g.id));
        const allChip = (gid, c, canOff) => `<span class="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/60 py-0.5 ${canOff ? "pr-1.5" : "pr-2.5"} pl-2.5 text-xs font-medium dark:border-emerald-900 dark:bg-emerald-900/20" title="${esc(c.name)}"><span class="truncate">${esc(c.name)}</span>${canOff ? `<button type="button" data-co-off-all="${gid}|${c.id}" aria-label="${esc(tg("delete"))}" class="rounded-full p-0.5 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-white/10">${icon("x", "size-3")}</button>` : ""}</span>`;
        const chip = (c) => `<span class="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pr-1.5 pl-2.5 text-xs font-medium dark:border-slate-700 dark:bg-white/5" title="${esc(c.name)}"><span class="truncate">${esc(c.name)}</span><button type="button" data-co-off="${c.id}" aria-label="${esc(tg("delete"))}" class="rounded-full p-0.5 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-white/10">${icon("x", "size-3")}</button></span>`;
        bizArea.innerHTML = `${on
          .map((g) => {
            const cos = companiesIn(g.id);
            const mine = cos.filter((c) => coOn.has(c.id));
            return `<section data-biz-box="${g.id}" class="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <header class="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
                ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
                <h3 class="min-w-0 flex-1 truncate font-semibold">${esc(g.name)}</h3>
                <button type="button" data-biz-off="${g.id}" aria-label="${esc(tmod("removeBusiness"))}" title="${esc(tmod("removeBusiness"))}" class="${btn("ghost", "sm")} text-red-600 dark:text-red-400">${icon("trash-2")}</button>
              </header>
              <div class="flex flex-wrap items-center gap-1.5 px-3 py-2">
                ${icon("building-2", "size-3.5 shrink-0 text-slate-400")}
                ${
                  mine.length
                    ? mine.map(chip).join("") + (cos.some((c) => !coOn.has(c.id)) ? plusBtn(`data-co-add="${g.id}"`, ts("addCompany")) : "")
                    : cos.length
                      ? // 没有选特定 Company = 这个 Business 的全部 Company 都能用：全部列出来；拿掉一个 = 只开给其他的
                        `<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">${esc(tmod("allShort"))}</span>` + cos.map((c) => allChip(g.id, c, cos.length > 1)).join("")
                      : `<span class="text-xs text-slate-400">${esc(tmod("noCompanies"))}</span>`
                }
              </div>
              ${
                sectorsReady
                  ? `<div class="flex items-center gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                      <span class="w-24 shrink-0 text-xs text-slate-500">${esc(tmod("lead"))}</span>
                      <div data-lead-box="${g.id}" class="relative min-w-0 flex-1">
                        <input type="text" data-lead-q="${g.id}" data-no-dirty autocomplete="off" value="${esc(leadName(g.id))}" placeholder="${esc(tmod("searchName"))}" class="${cls.input} h-9 pr-8">
                        ${leadOf.get(g.id) ? `<button type="button" data-lead-clear="${g.id}" aria-label="${esc(tg("delete"))}" class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-red-600">${icon("x", "size-4")}</button>` : ""}
                        <div data-lead-list="${g.id}" class="absolute top-full right-0 left-0 z-10 mt-1 hidden max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"></div>
                      </div>
                    </div>`
                  : ""
              }
            </section>`;
          })
          .join("")}
          ${
            free.length
              ? `<button type="button" data-biz-add class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-2 py-2 text-xs font-medium text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:hover:border-white dark:hover:text-white">${icon("plus", "size-3.5")}${esc(ts("addBusiness"))}</button>`
              : on.length
                ? ""
                : `<p class="text-xs text-slate-400">${esc(tmod("noOptions"))}</p>`
          }`;
        refreshIcons();
      }
      paintBiz();
      // 「+」：勾这个 Business 还没开的 Company，按 Add 加进来（一个都没加 = 这个 Business 全部 Company 都能用）
      function companyPick(g) {
        const cos = companiesIn(g.id).filter((c) => !coOn.has(c.id));
        const pm = modal(
          ts("addCompanyTitle", { name: g.name }),
          `<div class="space-y-3">
            <p class="text-xs text-slate-500">${esc(tmod("companyPickHint"))}</p>
            <label class="flex items-center gap-2 px-1 text-xs text-slate-500"><input type="checkbox" data-all class="size-3.5 accent-emerald-600">${esc(tmod("tickAll"))}</label>
            <div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${cos
              .map((c) => `<label class="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm"><input type="checkbox" data-co="${c.id}" class="size-4 accent-emerald-600"><span class="min-w-0 flex-1 truncate font-medium">${esc(c.name)}</span></label>`)
              .join("")}</div>
            <div class="flex justify-end"><button type="button" data-add-picked disabled class="${btn("primary")}">${icon("plus")} ${esc(ts("add"))}</button></div>
          </div>`,
        );
        refreshIcons();
        const picked = () => $$("[data-co]:checked", pm.el);
        pm.el.addEventListener("change", (e) => {
          if (e.target.matches("[data-all]")) $$("[data-co]", pm.el).forEach((x) => (x.checked = e.target.checked));
          else $("[data-all]", pm.el).checked = $$("[data-co]", pm.el).every((x) => x.checked);
          $("[data-add-picked]", pm.el).disabled = !picked().length;
        });
        $("[data-add-picked]", pm.el).onclick = () => {
          picked().forEach((x) => coOn.add(x.dataset.co));
          m.touch();
          pm.close();
          paintBiz();
        };
      }
      // 「+ Add business」：列还没开的 Business
      function bizPick() {
        const free = groups.filter((g) => !bizOn.has(g.id));
        const pm = modal(
          ts("addBusiness"),
          `<div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${free
            .map(
              (g) => `<div class="flex items-center gap-3 px-3 py-2">
                ${icon("briefcase-business", "size-4 shrink-0 text-brand-600")}
                <span class="min-w-0 flex-1 truncate text-sm font-medium">${esc(g.name)}</span>
                <button type="button" data-pick-biz="${g.id}" class="${btn("secondary", "sm")}">${icon("plus", "size-4")} ${esc(ts("add"))}</button>
              </div>`,
            )
            .join("")}</div>`,
        );
        refreshIcons();
        pm.el.addEventListener("click", (e) => {
          const b = e.target.closest("[data-pick-biz]");
          if (!b) return;
          bizOn.add(b.dataset.pickBiz);
          leadOf.set(b.dataset.pickBiz, "");
          m.touch();
          pm.close();
          paintBiz();
        });
      }
      refreshIcons();
      $("[data-cancel]", m.el).onclick = m.close;
      if ($("[data-del]", m.el))
        $("[data-del]", m.el).onclick = async () => {
          if (!(await confirmDialog(tmod("deleteTitle"), tmod("deleteBody", { name: mod.name }), tg("delete"), tg("cancel")))) return;
          const { error } = await sb.from("gw_modules").delete().eq("id", mod.id);
          if (error) return ($("[data-err]", m.el).innerHTML = alertBox(tmod("saveFailed")));
          m.close();
          structureTab();
        };
      m.el.addEventListener("click", async (e) => {
        if (!e.target.closest("[data-lead-box]")) hideLeadLists();
        const b = e.target.closest("button[type=button]");
        if (!b || !bizArea || !bizArea.contains(b)) return;
        const d = b.dataset;
        // 从 Business 拿掉模块：那个 Business 的人都会看不到这个图示 → 先问一下
        if (d.bizOff) {
          const g = groups.find((x) => x.id === d.bizOff);
          if (!(await confirmDialog(tmod("removeBusiness"), tmod("removeBusinessBody", { module: mod.name, business: g ? g.name : "" }), tmod("removeBusiness"), tg("cancel")))) return;
        }
        if (d.leadPick) {
          const [gid, uid] = d.leadPick.split(":");
          leadOf.set(gid, uid);
          m.touch();
          return paintBiz();
        }
        if (d.leadClear) {
          leadOf.set(d.leadClear, "");
          m.touch();
          return paintBiz();
        }
        if ("bizAdd" in d) return bizPick();
        if (d.coAdd) return companyPick(groups.find((g) => g.id === d.coAdd));
        if (d.coOff) coOn.delete(d.coOff);
        if (d.coOffAll) {
          // 「全部 Company」里拿掉一个：改成只开给这个 Business 的其他 Company
          const [gid, cid] = d.coOffAll.split("|");
          companiesIn(gid).forEach((c) => c.id !== cid && coOn.add(c.id));
          m.touch();
          return paintBiz();
        }
        if (d.coOff || d.bizOff) m.touch();
        if (d.bizOff) {
          bizOn.delete(d.bizOff);
          // 这个 Business 的 Company 标签也拿掉（别的还开着的 Business 也有的 Company 留着）
          companiesIn(d.bizOff).forEach((c) => [...bizOn].some((gid) => companiesIn(gid).some((x) => x.id === c.id)) || coOn.delete(c.id));
        }
        paintBiz();
      });
      m.el.addEventListener("input", (e) => {
        if (e.target.dataset.leadQ) showLeadList(e.target.dataset.leadQ, e.target.value);
      });
      m.el.addEventListener("focusin", (e) => {
        if (e.target.dataset.leadQ) ((e.target.select()), showLeadList(e.target.dataset.leadQ, ""));
      });
      m.el.addEventListener("change", (e) => {
        const el = e.target;
        if (el.name === "photo" && el.files[0]) {
          photo = el.files[0];
          $("[data-preview]", m.el).innerHTML = `<img src="${URL.createObjectURL(photo)}" alt="" class="size-14 rounded-xl object-cover">`;
        }
      });
      // API key for the target system: shown once after generating (the Intranet keeps only a hash)
      const keyBox = $("[data-key-box]", m.el);
      if (keyBox) {
        const state = $("[data-key-state]", keyBox), out = $("[data-key-out]", keyBox);
        invoke("gw-admin", { action: "list_api_keys" }).then((r) => {
          const k = r && r.ok && (r.keys || []).find((x) => x.module_id === mod.id);
          state.textContent = k ? tmod("apiKeySet", { prefix: k.key_prefix }) : tmod("apiKeyMissing");
          if (k) $("[data-gen-key]", keyBox).innerHTML = `${icon("key", "size-3.5")} ${esc(tmod("rotateKey"))}`;
        });
        $("[data-gen-key]", keyBox).addEventListener("click", async (ev) => {
          ev.preventDefault();
          if (!confirm(tmod("apiKeyWarning"))) return;
          const r = await invoke("gw-admin", { action: "generate_api_key", module_id: mod.id });
          if (!r || !r.ok || !r.key) return alert(tmod("saveFailed"));
          state.textContent = tmod("apiKeySet", { prefix: r.key.slice(0, 10) });
          out.classList.remove("hidden");
          out.innerHTML = `<p class="mt-2 text-slate-600 dark:text-slate-300">${esc(tmod("apiKeyBody"))}</p>
            <div class="mt-1 flex items-center gap-2"><code data-key-text class="flex-1 select-all break-all rounded-lg bg-slate-100 px-2 py-1.5 font-mono dark:bg-slate-800">${esc(r.key)}</code>
            <button type="button" data-copy-key class="${btn("secondary", "sm")}">${icon("copy", "size-3.5")}</button></div>
            <p class="mt-1 text-amber-700 dark:text-amber-400">${esc(tmod("apiKeyWarning"))}</p>`;
          $("[data-copy-key]", out).addEventListener("click", () => navigator.clipboard && navigator.clipboard.writeText(r.key));
        });
      }
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submit = $("button[type=submit]", f);
        submit.disabled = true;
        const err = (k) => (($("[data-err]", m.el).innerHTML = alertBox(tmod(k))), (submit.disabled = false));
        // 名称 / 说明：经过 gw_rename_module（角色权限在数据库检查）
        const { error } = await sb.rpc("gw_rename_module", { p_module: mod.id, p_name: f.name.value.trim(), p_description: f.description.value.trim() });
        if (error) return err("saveFailed");
        if (isSuper) {
          if (photo) {
            const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : photo.type === "image/svg+xml" ? "svg" : "jpg";
            const path = `${mod.code.toLowerCase()}-${Date.now()}.${ext}`;
            const up = await sb.storage.from("module-icons").upload(path, photo, { contentType: photo.type });
            if (up.error) return err("uploadFailed");
            const { data: pub } = sb.storage.from("module-icons").getPublicUrl(path);
            const { error: e2 } = await sb.from("gw_modules").update({ image_url: pub.publicUrl }).eq("id", mod.id);
            if (e2) return err("saveFailed");
          }
          if (f.url && f.url.value.trim() && f.url.value.trim() !== (mod.url || "")) {
            const { error: e4 } = await sb.from("gw_modules").update({ url: f.url.value.trim() }).eq("id", mod.id);
            if (e4) return err("saveFailed");
          }
          if (f.access_level && Number(f.access_level.value) !== Number(mod.access_level || 1)) {
            const { error: e5 } = await sb.from("gw_modules").update({ access_level: Number(f.access_level.value) }).eq("id", mod.id);
            if (e5) return err("saveFailed");
          }
          if (f.is_active.checked !== !!mod.is_active) {
            const { error: e3 } = await sb.from("gw_modules").update({ is_active: f.is_active.checked }).eq("id", mod.id);
            if (e3) return err("saveFailed");
          }
          // Business：新增 / 拿掉；留着的看 Sector 和负责人有没有改（Sector 是整个模块一个）
          const sector = sectorsReady && f.sector ? f.sector.value || null : null;
          const metaOf = (gid) => (sectorsReady ? { sector_id: sector, lead_user_id: leadOf.get(gid) || null } : {});
          const addBiz = [...bizOn].filter((x) => !bizOn0.has(x));
          const dropBiz = [...bizOn0].filter((x) => !bizOn.has(x));
          if (addBiz.length) {
            const { error } = await sb.from("gw_group_modules").insert(addBiz.map((gid) => ({ module_id: mod.id, group_id: gid, ...metaOf(gid) })));
            if (error) return err("saveFailed");
          }
          if (dropBiz.length) {
            const { error } = await sb.from("gw_group_modules").delete().eq("module_id", mod.id).in("group_id", dropBiz);
            if (error) return err("saveFailed");
          }
          if (sectorsReady)
            for (const gid of [...bizOn].filter((x) => bizOn0.has(x))) {
              const now = metaOf(gid);
              const was = tagIn(gid);
              if ((was.sector_id || null) === now.sector_id && (was.lead_user_id || null) === now.lead_user_id) continue;
              const { error } = await sb.from("gw_group_modules").update(now).eq("module_id", mod.id).eq("group_id", gid);
              if (error) return err("saveFailed");
            }
          // Company 标签：新增 / 拿掉
          const addCo = [...coOn].filter((x) => !coOn0.has(x));
          const dropCo = [...coOn0].filter((x) => !coOn.has(x));
          if (addCo.length) {
            const { error } = await sb.from("gw_module_companies").insert(addCo.map((x) => ({ module_id: mod.id, company_id: x })));
            if (error) return err("saveFailed");
          }
          if (dropCo.length) {
            const { error } = await sb.from("gw_module_companies").delete().eq("module_id", mod.id).in("company_id", dropCo);
            if (error) return err("saveFailed");
          }
        }
        m.close();
        structureTab();
      });
    }

    // ---------------------------------------------------------- Sector 新增 / 改名 / 删除（「No sector」标题的「+」新增；Sector 标题的铅笔改）
    function sectorDialog(x) {
      const m = modal(
        x ? tsec("editTitle") : tsec("addTitle"),
        `<form class="space-y-4">
          <div data-err></div>
          ${field(tsec("name"), `<input name="name" required maxlength="40" value="${esc(x ? x.name : "")}" placeholder="${esc(tsec("placeholder"))}" class="${cls.input}">`)}
          <div class="flex justify-between gap-2">
            ${x ? `<button type="button" data-del class="${btn("ghost")} text-red-600 dark:text-red-400">${icon("trash-2")} ${esc(tg("delete"))}</button>` : "<span></span>"}
            <div class="flex gap-2">
              <button type="button" data-cancel class="${btn("secondary")}">${esc(tg("cancel"))}</button>
              <button type="submit" class="${btn("primary")}">${esc(tg("save"))}</button>
            </div>
          </div>
        </form>`,
      );
      refreshIcons();
      $("[data-cancel]", m.el).onclick = m.close;
      $("[name=name]", m.el).focus();
      if (x)
        $("[data-del]", m.el).onclick = async () => {
          if (!(await confirmDialog(tsec("deleteTitle"), tsec("deleteBody", { name: x.name }), tg("delete"), tg("cancel")))) return;
          const { error } = await sb.from("gw_sectors").delete().eq("id", x.id);
          if (error) return ($("[data-err]", m.el).innerHTML = alertBox(tg("saveFailed")));
          m.close();
          structureTab();
        };
      $("form", m.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        const { error } = x ? await sb.from("gw_sectors").update({ name }).eq("id", x.id) : await sb.from("gw_sectors").insert({ name, sort_order: sectors.length });
        if (error) return ($("[data-err]", m.el).innerHTML = alertBox(error.code === "23505" ? tsec("duplicate") : tg("saveFailed")));
        m.close();
        structureTab();
      });
    }

    view.onclick = async (e) => {
      const b = e.target.closest("button, [data-mod]");
      if (!b) return;
      const d = b.dataset;
      if (b.id === "st-add-biz") return bizDialog(null);
      if ("addSector" in d) return sectorDialog(null);
      if (d.editSector) return sectorDialog(sectors.find((x) => x.id === d.editSector));
      if (d.editBiz) return bizDialog(groups.find((x) => x.id === d.editBiz));
      if (d.delBiz && canDelBiz) {
        const g = groups.find((x) => x.id === d.delBiz);
        if (!(await confirmDialog(tb("deleteTitle"), tb("deleteBody", { name: g.name }), tg("delete"), tg("cancel")))) return;
        const { error } = await sb.from("gw_groups").delete().eq("id", g.id);
        if (error) setMsg(tg("saveFailed"));
        return structureTab();
      }
      // Super Admin：勾这个 Business 有哪些 Company；只有「新增 Company」权：直接开新 Company 窗（放进这个 Business）
      if (d.addCo) return isSuper ? addCompanyDialog(groups.find((x) => x.id === d.addCo)) : companyDialog(null, d.addCo);
      if (d.addMod) return addModuleDialog(groups.find((x) => x.id === d.addMod));
      if (d.co) return isSuper ? companyDialog(coById.get(d.co)) : companyInfo(d.co, d.from || null);
      if (d.editMod) return canRename(d.editMod) && moduleDialog(modById.get(d.editMod));
      if (d.mod) return canRename(d.mod) && moduleDialog(modById.get(d.mod));
    };
    draw();
  }

  // ================================================================ AI Connector（Master）：全站开关 + 全部链接
  async function connectorTab() {
    const seq = routeSeq;
    const tk = (k, v) => t("admin.connector." + k, v);
    const [setting, list] = await Promise.all([sb.from("gw_settings").select("value").eq("key", "ai_connector").maybeSingle(), sb.rpc("gw_mcp_list")]);
    if (stale(seq)) return;
    if (setting.error || list.error) return (view.innerHTML = empty(tk("notReady")));
    let on = !!setting.data?.value?.enabled;
    const links = list.data || [];
    const paint = () => {
      view.innerHTML = `<div class="space-y-4">
        <div class="${cls.card} flex items-center gap-4 p-4">
          <div class="min-w-0 flex-1"><p class="font-semibold">${esc(tk("switchTitle"))}</p><p class="text-sm text-slate-500">${esc(tk("switchDesc"))}</p></div>
          <button id="cn-switch" role="switch" aria-checked="${on}" aria-label="${esc(tk("switchTitle"))}" class="relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700"}"><span class="absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}"></span></button>
          <span class="w-8 text-sm text-slate-500">${esc(on ? tk("on") : tk("off"))}</span>
        </div>
        <p class="text-sm font-semibold">${esc(tk("links"))} <span class="font-normal text-slate-400">(${links.filter((x) => !x.revoked_at).length})</span></p>
        ${
          links.length
            ? `<div class="${cls.card} divide-y divide-slate-100 dark:divide-slate-800">${links
                .map(
                  (x) => `<div class="flex items-center gap-3 px-3 py-3 text-sm">
                    <span class="min-w-0 flex-1"><span class="block truncate font-semibold${x.revoked_at ? " text-slate-400 line-through" : ""}">${esc(x.user_name || "—")} <span class="font-normal text-slate-500">· ${esc(x.label)}</span></span>
                    <span class="block text-xs text-slate-500">${esc(tk("created", { time: fmtDateTime(x.created_at) }))} · ${esc(x.revoked_at ? tk("revoked") : x.expires_at && new Date(x.expires_at) < new Date() ? tk("expired") : x.last_used_at ? tk("lastUsed", { time: fmtDateTime(x.last_used_at) }) : tk("neverUsed"))}</span></span>
                    ${x.revoked_at ? "" : `<button data-revoke="${x.id}" class="${btn("ghost", "sm")} text-red-600 dark:text-red-400">${esc(tk("revoke"))}</button>`}
                  </div>`,
                )
                .join("")}</div>`
            : empty(tk("empty"))
        }
      </div>`;
    };
    paint();
    view.onclick = async (e) => {
      if (e.target.closest("#cn-switch")) {
        const next = !on;
        const { error } = await sb.from("gw_settings").upsert({ key: "ai_connector", value: { enabled: next }, updated_at: new Date().toISOString(), updated_by: me.id });
        if (error) return setMsg(t("admin.groups.saveFailed"));
        on = next;
        paint();
        return toast(tk("saved"));
      }
      const b = e.target.closest("[data-revoke]");
      if (!b) return;
      if (!(await confirmDialog(tk("switchTitle"), tk("revokeConfirm"), tk("revoke"), t("admin.groups.cancel")))) return;
      const { error } = await sb.rpc("gw_mcp_revoke", { p_id: b.dataset.revoke });
      if (error) return setMsg(t("admin.groups.saveFailed"));
      connectorTab();
    };
  }

  // ================================================================ 操作记录
  async function auditTab() {
    const seq = routeSeq;
    const tl = (k, v) => t("admin.audit." + k, v);
    const PAGE = 50;
    const TARGETS = ["auth", "profiles", "roles", "role_businesses", "groups", "group_members", "companies", "business_companies", "company_mappings", "modules", "group_modules", "module_companies", "sectors", "module_members", "announcements"];
    let filters = { from: "", to: "", actor: "", action: "", target: "" };
    let page = 1;

    // 依筛选条件查询（以当前用户身份，RLS 决定看得到哪些）
    function query() {
      let q = sb.from("gw_audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false });
      if (filters.from) q = q.gte("created_at", new Date(filters.from + "T00:00:00").toISOString());
      if (filters.to) q = q.lt("created_at", new Date(new Date(filters.to + "T00:00:00").getTime() + 86400000).toISOString());
      if (filters.action) q = q.ilike("action", filters.action + "%");
      if (filters.actor) q = q.ilike("actor_email", "%" + filters.actor + "%");
      if (filters.target) q = q.eq("target_type", filters.target);
      return q;
    }
    const targetLabel = (x) => (TARGETS.includes(x) ? tl("targets." + x) : x);

    if (stale(seq)) return;
    view.innerHTML = `<div class="space-y-4">
      <form id="filters" class="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto_auto]">
        <input type="date" name="from" title="${esc(tl("from"))}" aria-label="${esc(tl("from"))}" class="${cls.input}">
        <input type="date" name="to" title="${esc(tl("to"))}" aria-label="${esc(tl("to"))}" class="${cls.input}">
        <input name="actor" placeholder="${esc(tl("actor"))}" class="${cls.input}">
        <input name="action" placeholder="${esc(tl("action"))}" class="${cls.input}">
        <select name="target" class="${cls.input} col-span-2 lg:col-span-1"><option value="">${esc(tl("allTargets"))}</option>${TARGETS.map((x) => `<option value="${x}">${esc(tl("targets." + x))}</option>`).join("")}</select>
        <button type="submit" class="${btn("primary")}">${esc(tl("filter"))}</button>
        <button type="button" id="export" class="${btn("secondary")}">${icon("download")} ${esc(tl("export"))}</button>
      </form>
      <div id="rows">${GW.spinner()}</div>
    </div>`;

    function diff(before, after) {
      const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(
        (k) => k !== "updated_at" && k !== "created_at" && JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]),
      );
      if (!keys.length) return `<p class="mt-2 text-xs text-slate-400">${esc(tl("noDetails"))}</p>`;
      const show = (v) => (v === undefined ? "—" : JSON.stringify(v));
      return `<div class="mt-2 overflow-x-auto"><table class="text-xs">
        <thead><tr class="text-left text-slate-500"><th class="pr-4 font-medium">${esc(tl("field"))}</th><th class="pr-4 font-medium">${esc(tl("before"))}</th><th class="font-medium">${esc(tl("after"))}</th></tr></thead>
        <tbody class="font-mono">${keys.map((k) => `<tr><td class="pr-4 text-slate-500">${esc(k)}</td><td class="pr-4 text-red-600 dark:text-red-400">${esc(show((before || {})[k]))}</td><td class="text-emerald-700 dark:text-emerald-400">${esc(show((after || {})[k]))}</td></tr>`).join("")}</tbody>
      </table></div>`;
    }

    async function load() {
      const { data, count } = await query().range((page - 1) * PAGE, page * PAGE - 1);
      if (stale(seq) || !$("#rows")) return;
      const rows = data || [];
      const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
      $("#rows").innerHTML = `<p class="mb-4 text-sm text-slate-500">${esc(tl("total", { count: count || 0 }))}</p>
        ${
          rows.length
            ? `<div class="${cls.card} divide-y divide-slate-200 dark:divide-slate-800">${rows
                .map(
                  (r) => `<details class="p-3 text-sm">
                    <summary class="flex cursor-pointer list-none flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span class="w-40 shrink-0 text-xs text-slate-500 tabular-nums">${esc(fmtDateTime(r.created_at, { dateStyle: "short", timeStyle: "medium" }))}</span>
                      <span class="w-48 shrink-0 truncate">${esc(r.actor_email || tl("system"))}</span>
                      <span class="flex flex-1 flex-wrap items-center gap-1.5">${badge(r.action, "blue")}${badge(targetLabel(r.target_type))}<span class="truncate text-slate-600 dark:text-slate-300">${esc(r.target_label || "")}</span></span>
                    </summary>
                    ${diff(r.before_data, r.after_data)}
                  </details>`,
                )
                .join("")}</div>`
            : empty(tl("empty"))
        }
        ${
          pages > 1
            ? `<div class="mt-4 flex items-center justify-center gap-2 text-sm">
                ${page > 1 ? `<button data-page="${page - 1}" class="${btn("secondary", "sm")}">${esc(tl("prev"))}</button>` : ""}
                <span class="text-slate-500">${esc(tl("page", { page, pages }))}</span>
                ${page < pages ? `<button data-page="${page + 1}" class="${btn("secondary", "sm")}">${esc(tl("next"))}</button>` : ""}
              </div>`
            : ""
        }`;
    }

    $("#filters").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      filters = Object.fromEntries(Object.keys(filters).map((k) => [k, String(f.get(k) || "").trim()]));
      page = 1;
      load();
    });
    $("#rows").addEventListener("click", (e) => {
      const b = e.target.closest("[data-page]");
      if (b) ((page = Number(b.dataset.page)), load());
    });
    $("#export").addEventListener("click", async (e) => {
      e.target.disabled = true;
      const rows = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const { data } = await query().range(offset, offset + 999);
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      await GW.downloadXlsx(`gateway-audit-${new Date().toISOString().slice(0, 10)}.xlsx`, (wb) => {
        const sheet = wb.addWorksheet("audit");
        sheet.columns = [
          { header: tl("time"), key: "time", width: 22 },
          { header: tl("actor"), key: "actor", width: 28 },
          { header: tl("action"), key: "action", width: 24 },
          { header: tl("target"), key: "target", width: 22 },
          { header: tl("targetLabel"), key: "label", width: 28 },
          { header: tl("before"), key: "before", width: 50 },
          { header: tl("after"), key: "after", width: 50 },
        ];
        sheet.getRow(1).font = { bold: true };
        rows.forEach((r) =>
          sheet.addRow({
            time: new Date(r.created_at),
            actor: r.actor_email || tl("system"),
            action: r.action,
            target: r.target_type,
            label: r.target_label || r.target_id || "",
            before: r.before_data ? JSON.stringify(r.before_data) : "",
            after: r.after_data ? JSON.stringify(r.after_data) : "",
          }),
        );
        sheet.getColumn("time").numFmt = "yyyy-mm-dd hh:mm:ss";
      });
      e.target.disabled = false;
    });
    refreshIcons();
    load();
  }

  // ================================================================ 以此人身份预览（只读）
  // ---------------------------------------------------------------- 分页切换（#users、#groups …）
  const HANDLERS = { users: usersScreen, roles: rolesTab, structure: structureTab, connector: connectorTab, audit: auditTab };
  // 旧书签（#business、#company、#sectors、#modules）都进同一页
  const LEGACY_HASH = { business: "structure", company: "structure", sectors: "structure", modules: "structure" };
  /* 上面的大按钮（User & Group Manage / Master Manage / Audit Log）：永远一排、位置固定不换。
       当前的大而深色，其他的小而淡；点别的就互换样式（CSS 过渡）。手机上小的只显示图示。 */
  function paintSections(activeKey) {
    const box = $("#sections");
    if (SECTIONS.length < 2) return (box.innerHTML = "");
    const base = "flex w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-semibold transition-all duration-300 ease-out";
    const big = `${base} bg-slate-900 px-3 py-2.5 text-sm text-white shadow-md sm:px-4 sm:py-3.5 sm:text-base dark:bg-white dark:text-slate-900`;
    const small = `${base} border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800 sm:px-4 sm:py-2.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200`;
    box.innerHTML = `<div class="mx-auto grid max-w-3xl grid-cols-3 items-center gap-2">${SECTIONS.map(([k, ic, tabs]) => {
      const on = k === activeKey;
      return `<a data-sec="${k}" href="#${tabs[0]}" aria-current="${on ? "page" : "false"}" title="${esc(t("admin.sections." + k))}" class="${on ? big : small}">${icon(ic, on ? "size-5 shrink-0" : "size-4 shrink-0")}<span class="${on ? "line-clamp-2 text-left text-xs leading-tight whitespace-normal sm:truncate sm:text-center sm:text-base sm:whitespace-nowrap" : "hidden truncate sm:inline"}">${esc(t("admin.sections." + k))}</span></a>`;
    }).join("")}</div>`;
    refreshIcons();
  }
  let activeSection = null;
  async function route() {
    const hash = location.hash.slice(1) || TABS[0];
    routeSeq++;
    view.onclick = null;
    view.onsubmit = null;
    view.onchange = null;
    view.oninput = null;
    setMsg("");
    const name0 = LEGACY_HASH[hash.split("=")[0]] || hash.split("=")[0];
    // #groups / #access 是 Users 画面里的切换
    const name = USERS_HASHES.includes(name0) ? "users" : name0;
    const active = HANDLERS[name] && TABS.includes(name) ? name : TABS[0];
    const section = SECTIONS.find(([, , tabs]) => tabs.includes(active));
    activeSection = section[0];
    paintSections(activeSection);
    $("#panel").classList.remove("hidden");
    $("#tabs").parentElement.classList.toggle("hidden", section[2].length < 2);
    $("#tabs").innerHTML = section[2]
      .map(
        (k) => `<a href="#${k}" class="rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap ${
          k === active ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        }">${esc(t("admin.tabs." + k))}</a>`,
      )
      .join("");
    view.innerHTML = GW.spinner();
    await HANDLERS[active]();
  }
  window.addEventListener("hashchange", route);
  route();
})();
