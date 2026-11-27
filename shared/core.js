/* ================================================================
   MJM Intranet — 共用核心
   Supabase 连线、登录检查、多语言、页面外框（顶栏 / 手机底部导航）、
   对话框、提示、Edge Function 调用、Excel。
   所有资料权限都由数据库 RLS 检查；这里的页面保护只负责导航。
   ================================================================ */
window.GW = (function () {
  const cfg = window.GW_CONFIG;
  // 网站根目录（模块页面放在子资料夹，例如 diesel/，连结都要从根目录算）
  const BASE = document.currentScript ? document.currentScript.src.replace(/shared\/core\.js.*$/, "") : "";
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // ---------------------------------------------------------------- 多语言
  // 系统只用英文（中文文字档保留在 lang/zh-CN.js，之后要开放再加回语言选项）
  const LOCALE = "en";
  const LANG = window.GW_LANG[LOCALE];
  document.documentElement.lang = LOCALE;

  function t(key, vars) {
    const value = key.split(".").reduce((o, k) => (o == null ? o : o[k]), LANG);
    if (typeof value !== "string") return key;
    return vars ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : vars[k])) : value;
  }

  // ---------------------------------------------------------------- 小工具
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function icon(name, cls) {
    return `<i data-lucide="${esc(name)}" class="${esc(cls || "size-4")}"></i>`;
  }
  function refreshIcons() {
    window.lucide.createIcons();
  }

  function fmtDateTime(iso, opts) {
    return new Intl.DateTimeFormat(LOCALE, { timeZone: cfg.timeZone, dateStyle: "medium", timeStyle: "short", ...opts }).format(
      new Date(iso),
    );
  }

  // 页面网址不带 .html：index.html → 首页（…/）、admin.html#x → admin#x
  const pretty = (path) => String(path).replace(/^index\.html(?=[?#]|$)/, "").replace(/^([a-z0-9-]+)\.html(?=[?#]|$)/, "$1");
  function go(path) {
    location.href = BASE + pretty(path);
  }

  // ---------------------------------------------------------------- 主题
  function applyTheme(theme) {
    try {
      localStorage.setItem("gw_theme", theme);
    } catch (e) {
      /* 忽略 */
    }
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  // ---------------------------------------------------------------- 登录状态
  async function loadProfile() {
    // ?gw_logout=1: a module (e.g. Plantation Operation) asked to sign out of the Intranet too
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("gw_logout")) {
        u.searchParams.delete("gw_logout");
        history.replaceState(null, "", u.pathname + u.search + u.hash);
        await sb.auth.signOut();
        go("login.html");
        return { session: null, profile: null };
      }
    } catch (e) { /* ignore */ }
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) return { session: null, profile: null };
    // 一次请求拿到：个人资料 ＋ 角色 ＋ 角色的 Business 功能；模块管理员资料同时一起拿
    // 我在哪些 Business ＋ Company（角色只看个人的 gw_profiles.role_id）
    const [{ data: profile }, { data: adm }, { data: mcs }] = await Promise.all([
      sb.from("gw_profiles").select("*, gw_roles(*, gw_role_businesses(*))").eq("id", session.user.id).maybeSingle(),
      sb.from("gw_module_members").select("module_id, group_id").eq("user_id", session.user.id).eq("is_admin", true),
      sb.from("gw_member_companies").select("group_id, company_id").eq("user_id", session.user.id),
    ]);
    if (profile) {
      const role = profile.gw_roles || null;
      const biz = role ? role.gw_role_businesses || [] : [];
      delete profile.gw_roles;
      // 每个 Company 的角色：{ group_id, company_id, role_id, role }
      profile.companyRoles = (mcs || []).map((x) => ({ group_id: x.group_id, company_id: x.company_id, role_id: null, role: null }));
      // 自订角色：管哪些 Business、能不能发公告（RLS 只给看自己的角色）
      profile.isSuper = profile.role === "super_admin";
      profile.roleName = null;
      profile.businessIds = [];
      profile.roleModules = [];
      profile.adminModuleIds = [];
      profile.adminPairs = []; // 我在哪个 Business 是哪个模块的管理员 [{ group_id, module_id }]
      profile.adminModules = 0;
      // 角色功能：全域的（gw_roles）＋ 按 Business 的（gw_role_businesses）；super_admin 全部都有
      const GLOBAL = ["can_view_user_group", "can_view_audit", "can_edit_module_name", "can_manage_module_access", "can_delete_business", "can_delete_company", "can_delete_module", "can_add_business", "can_add_company", "can_add_module"];
      const PER_BIZ = ["can_post_notice", "can_delete_notice", "can_grant_module", "can_revoke_module", "can_set_module_admin", "can_add_business_user", "can_remove_business_user", "can_view_users"];
      profile.can = Object.fromEntries([...GLOBAL, ...PER_BIZ].map((f) => [f, profile.isSuper]));
      profile.perms = {}; // group_id → { can_post_notice, ... }
      if (!profile.isSuper) {
        // 模块管理员：可以开 / 收回自己管理的模块的权限
        profile.adminPairs = (adm || []).map((x) => ({ group_id: x.group_id, module_id: x.module_id }));
        profile.adminModuleIds = [...new Set(profile.adminPairs.map((x) => x.module_id))];
        profile.adminModules = profile.adminModuleIds.length;
      }
      const perBizRoles = profile.isSuper ? [] : profile.companyRoles.filter((x) => x.role);
      if (!profile.isSuper && (role || perBizRoles.length)) {
        profile.roleName = role ? role.name : perBizRoles[0].role.name;
        const addBiz = (b) => {
          if (!profile.perms[b.group_id]) profile.perms[b.group_id] = Object.fromEntries(PER_BIZ.map((f) => [f, false]));
          PER_BIZ.forEach((f) => {
            if (b[f]) ((profile.perms[b.group_id][f] = true), (profile.can[f] = true)); // can.xxx = 在任何一个 Business 有
          });
        };
        if (role) {
          GLOBAL.forEach((f) => (profile.can[f] = !!role[f]));
          biz.forEach(addBiz);
        }
        // 在 (Business, Company) 指派的角色：全域功能照算，Business 功能只算它被指派的那个 Business
        perBizRoles.forEach((x) => {
          GLOBAL.forEach((f) => x.role[f] && (profile.can[f] = true));
          (x.role.gw_role_businesses || []).filter((b) => b.group_id === x.group_id).forEach(addBiz);
        });
        profile.businessIds = Object.keys(profile.perms);
        if (profile.businessIds.length) {
          const { data: gx } = await sb.from("gw_group_modules").select("module_id").in("group_id", profile.businessIds);
          profile.roleModules = [...new Set((gx || []).map((x) => x.module_id))];
        }
        // 有任何 Business 动作就等于可以看 User & Group Manage
        if (["can_grant_module", "can_revoke_module", "can_set_module_admin", "can_add_business_user", "can_remove_business_user", "can_view_users"].some((f) => profile.can[f])) profile.can.can_view_user_group = true;
      }
      // 在某个 Business 有没有某项功能
      profile.bizCan = (gid, f) => profile.isSuper || !!(profile.perms[gid] && profile.perms[gid][f]);
      profile.canPost = profile.can.can_post_notice;
      profile.canDeleteNotice = profile.can.can_delete_notice;
      // 右上角齿轮（设置页）：super_admin、模块管理员、或角色有设置页里的功能（公告功能在首页 Notice Board，不需要进设置页）
      const c = profile.can;
      profile.manages =
        profile.isSuper ||
        profile.adminModules > 0 ||
        ["can_grant_module", "can_revoke_module", "can_set_module_admin", "can_add_business_user", "can_remove_business_user", "can_view_user_group", "can_view_users", "can_view_audit", "can_edit_module_name", "can_manage_module_access", "can_add_business", "can_add_company", "can_add_module", "can_delete_business", "can_delete_company", "can_delete_module"].some((k) => c[k]);
    }
    return { session, profile };
  }

  // ---------------------------------------------------------------- 闲置自动登出
  /* 4 小时没有动（滑鼠、键盘、触控、卷动）就登出。所有 Intranet 分页一起算（最后动的时间记在 localStorage）；
     最后 2 分钟出现「还在吗？」倒数 + Stay signed in；电脑放一晚再回来，打开就直接登出。 */
  const IDLE_MS = 4 * 60 * 60 * 1000;
  const IDLE_WARN_MS = 2 * 60 * 1000;
  const IDLE_KEY = "gw-last-active";
  const idleGet = () => {
    try {
      return Number(localStorage.getItem(IDLE_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  };
  const idleSet = (v) => {
    try {
      localStorage.setItem(IDLE_KEY, String(v));
    } catch (e) {
      /* 忽略 */
    }
  };
  async function idleSignOut() {
    try {
      await sb.auth.signOut();
    } catch (e) {
      /* 忽略 */
    }
    go("login.html?error=idle");
  }
  // 打开页面时：刚登入（登入时间比记录新）就从现在开始算；已经超过 4 小时 → 回传 true（要登出）
  function idleExpired(session) {
    const signedIn = Date.parse((session && session.user && session.user.last_sign_in_at) || "") || 0;
    const last = idleGet();
    if (!last || last < signedIn) {
      idleSet(Date.now());
      return false;
    }
    return Date.now() - last >= IDLE_MS;
  }
  let idleOn = false;
  function startIdleWatch() {
    if (idleOn) return;
    idleOn = true;
    let lastWrite = Date.now();
    let warnEl = null;
    let tick = null;
    let out = false;
    idleSet(Date.now());
    const hideWarn = () => {
      if (warnEl) warnEl.remove();
      warnEl = null;
      clearInterval(tick);
    };
    const touch = () => {
      const n = Date.now();
      if (warnEl || n - lastWrite > 15000) ((lastWrite = n), idleSet(n));
      if (warnEl) hideWarn();
    };
    const fmtLeft = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    const showWarn = () => {
      if (warnEl) return;
      warnEl = document.createElement("div");
      warnEl.className = "fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm";
      warnEl.innerHTML = `<div role="alertdialog" aria-live="assertive" class="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900">
          <div class="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">${icon("clock", "size-5")}</div>
          <h2 class="text-base font-semibold">${esc(t("idle.title"))}</h2>
          <p class="mt-1 text-sm text-slate-500" data-idle-left></p>
          <button type="button" data-idle-stay class="${btn("primary")} mt-4 w-full">${esc(t("idle.stay"))}</button>
        </div>`;
      document.body.appendChild(warnEl);
      refreshIcons();
      warnEl.querySelector("[data-idle-stay]").onclick = touch;
      const paint = () => {
        const left = IDLE_MS - (Date.now() - idleGet());
        const el = warnEl && warnEl.querySelector("[data-idle-left]");
        if (el) el.textContent = t("idle.body", { time: fmtLeft(left) });
        if (left <= 0) check();
      };
      paint();
      tick = setInterval(paint, 1000);
    };
    const check = () => {
      if (out) return;
      const idle = Date.now() - idleGet(); // 别的分页有动也算
      if (idle >= IDLE_MS) {
        out = true;
        hideWarn();
        return idleSignOut();
      }
      if (idle >= IDLE_MS - IDLE_WARN_MS) showWarn();
      else if (warnEl) hideWarn();
    };
    ["mousedown", "keydown", "touchstart", "wheel", "scroll", "mousemove"].forEach((ev) => addEventListener(ev, touch, { passive: true, capture: true }));
    // 电脑睡醒 / 切回这个分页：马上检查一次
    document.addEventListener("visibilitychange", () => !document.hidden && check());
    // 别的分页按了 Stay signed in：这里的提醒也收起来
    addEventListener("storage", (e) => e.key === IDLE_KEY && warnEl && Date.now() - idleGet() < IDLE_MS - IDLE_WARN_MS && hideWarn());
    setInterval(check, 15000);
  }

  /* 页面保护：未登录 → 登录页；没有 Gateway 资料或已停用 → 登录页；
     未改初始密码 → 改密码；权限不足 → 首页。need = "user" | "manage"（super_admin 或有管理权的角色）| "super" */
  async function requireProfile(need) {
    const { session, profile } = await loadProfile();
    if (!session) return go("login.html"), null;
    if (idleExpired(session)) return idleSignOut(), null; // 超过 4 小时没用：登出
    if (!profile || profile.status !== "active") {
      await sb.auth.signOut();
      return go("login.html?error=no_access"), null;
    }
    // 用 OPIS PRO 登入的人不需要 Intranet 密码，不强迫改
    let viaSso = false;
    try { viaSso = localStorage.getItem("gw-sso") === profile.id; } catch (e) {}
    if (profile.must_change_password && !viaSso) return go("login.html?mode=change"), null;
    if ((need === "manage" && !profile.manages) || (need === "super" && !profile.isSuper)) {
      return go(need === "super" && profile.manages ? "admin.html" : "index.html"), null;
    }
    applyTheme(profile.theme);
    welcomeBack(profile);
    startIdleWatch();
    return profile;
  }

  /* 刚登入（登录页留了 gw-welcome 记号）：画面中间浮出「Welcome back」，后面的主页模糊，
     约两秒后字和模糊一起退掉，就可以开始用。只播一次。
     不想等：点一下滑鼠（或按任何键、滑动）马上消失（那一下不会点到后面的东西）。 */
  function welcomeBack(profile) {
    try {
      if (!sessionStorage.getItem("gw-welcome")) return;
      sessionStorage.removeItem("gw-welcome");
    } catch (e) {
      return;
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = document.createElement("style");
    css.textContent = `
      .gw-welcome { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; cursor: pointer;
        background-color: rgba(255, 255, 255, 0); -webkit-backdrop-filter: blur(0); backdrop-filter: blur(0);
        transition: opacity .7s ease, -webkit-backdrop-filter .7s ease, backdrop-filter .7s ease, background-color .7s ease; }
      .gw-welcome.on { background-color: rgba(255, 255, 255, .5); -webkit-backdrop-filter: blur(16px) saturate(130%); backdrop-filter: blur(16px) saturate(130%); }
      .dark .gw-welcome.on { background-color: rgba(2, 6, 23, .55); }
      .gw-welcome-hi { font: 800 clamp(40px, 8vw, 84px)/1.05 "Segoe UI", "SF Pro Display", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
        letter-spacing: -.03em; text-align: center; padding: 0 16px;
        background: linear-gradient(180deg, #4a5868, #1f2933); -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: gw-welcome-in .75s cubic-bezier(.2, .8, .2, 1) both; }
      .dark .gw-welcome-hi { background-image: linear-gradient(180deg, #ffffff, #cbd5e1); }
      .gw-welcome-name { font-size: 15px; font-weight: 600; letter-spacing: .02em; color: #64707c; text-align: center; padding: 0 16px; animation: gw-welcome-in .75s cubic-bezier(.2, .8, .2, 1) .18s both; }
      .dark .gw-welcome-name { color: #94a3b8; }
      @keyframes gw-welcome-in { from { opacity: 0; transform: scale(.55); filter: blur(12px); } to { opacity: 1; transform: none; filter: blur(0); } }
      .gw-welcome.on.out { opacity: 0; background-color: rgba(255, 255, 255, 0); -webkit-backdrop-filter: blur(0); backdrop-filter: blur(0); }
      .gw-welcome.out .gw-welcome-hi, .gw-welcome.out .gw-welcome-name { animation: gw-welcome-out .6s ease-in forwards; }
      @keyframes gw-welcome-out { from { opacity: 1; transform: none; filter: blur(0); } to { opacity: 0; transform: scale(1.18); filter: blur(6px); } }
      .gw-welcome.fast, .gw-welcome.fast .gw-welcome-hi, .gw-welcome.fast .gw-welcome-name { transition-duration: .2s; animation-duration: .2s; }
      @media (prefers-reduced-motion: reduce) { .gw-welcome-hi, .gw-welcome-name, .gw-welcome.out .gw-welcome-hi, .gw-welcome.out .gw-welcome-name { animation: none; } }`;
    const el = document.createElement("div");
    el.className = "gw-welcome";
    el.setAttribute("role", "status");
    const first = String(profile.full_name || "").trim().split(/\s+/)[0];
    el.innerHTML = `<div class="gw-welcome-hi">${esc(t("app.welcomeBack"))}</div>${first ? `<div class="gw-welcome-name">${esc(first)}</div>` : ""}`;
    document.head.appendChild(css);
    document.body.appendChild(el);
    const timers = [];
    let gone = false;
    const end = () => {
      if (gone) return;
      gone = true;
      timers.forEach(clearTimeout);
      ["keydown", "wheel", "touchmove"].forEach((ev) => removeEventListener(ev, skip, true));
      el.remove();
      css.remove();
    };
    // 点一下 / 按键 / 滑动：0.2 秒退掉
    const skip = (e) => {
      if (gone) return;
      if (e && e.type === "pointerdown") (e.preventDefault(), e.stopPropagation());
      timers.forEach(clearTimeout);
      el.style.pointerEvents = "none"; // 退掉的这 0.2 秒里，下一下就可以点到主页了
      el.classList.add("on", "out", "fast");
      timers.push(setTimeout(end, 220));
    };
    el.addEventListener("pointerdown", skip);
    el.addEventListener("click", (e) => (e.preventDefault(), e.stopPropagation()));
    ["keydown", "wheel", "touchmove"].forEach((ev) => addEventListener(ev, skip, true));
    timers.push(setTimeout(() => el.classList.add("on"), reduce ? 0 : 220)); // 字先出来，接着后面的主页变模糊
    timers.push(setTimeout(() => (el.style.pointerEvents = "none", el.classList.add("out")), reduce ? 1300 : 2000));
    timers.push(setTimeout(end, reduce ? 2100 : 2800));
  }

  async function logout() {
    await sb.auth.signOut();
    go("login.html");
  }

  /* 改密码：回传错误代码（too_short / weak / mismatch / same / unknown）或 null */
  async function changePassword(password, confirm, current) {
    if (password.length < 8) return "too_short";
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "weak";
    if (password !== confirm) return "mismatch";
    // 在伺服器改：改成功才会清掉「必须改密码」（不能只清标记不改密码）
    const r = await invoke("gw-auth", { action: "change_password", password, current_password: current || "" });
    if (r && r.ok) return null;
    return r && ["too_short", "weak", "same", "wrong_current"].includes(r.error) ? r.error : "unknown";
  }

  // ---------------------------------------------------------------- 页面外框
  function shell(profile, active) {
    const isAdmin = profile.manages;
    const header = document.createElement("div");
    header.innerHTML = `
      <header class="sticky top-0 z-30 border-b border-white/50 bg-white/55 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-slate-950/55">
        <div class="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <a href="${BASE}" class="text-lg font-bold tracking-tight whitespace-nowrap">${esc(t("app.name"))}</a>
          <div class="ml-auto flex items-center gap-3">
            <a href="${BASE}settings" title="${esc(t("nav.settings"))}" class="flex items-center gap-3">
              <div class="hidden text-right leading-tight md:block">
                <div class="text-sm font-medium">${esc(profile.full_name)}</div>
                <div class="text-xs text-slate-500">${esc(profile.email)}</div>
              </div>
              ${
                profile.avatar_url && String(profile.avatar_url).startsWith(GW_CONFIG.supabaseUrl + "/storage/v1/object/public/")
                  ? `<img src="${esc(profile.avatar_url)}" alt="" class="size-8 rounded-full object-cover">`
                  : `<span class="flex size-8 items-center justify-center rounded-full text-sm font-semibold ${
                      active === "settings" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-200 dark:bg-slate-800"
                    }">${esc(profile.full_name.slice(0, 1))}</span>`
              }
            </a>
            <button type="button" id="gw-theme" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"></button>
            <a href="${BASE}${isAdmin ? "admin" : "settings"}" title="${esc(t(isAdmin ? "nav.admin" : "nav.settings"))}" aria-label="${esc(t(isAdmin ? "nav.admin" : "nav.settings"))}" class="rounded-lg p-2 ${
              active === (isAdmin ? "admin" : "settings") ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            }">${icon("settings", "size-5")}</a>
            <button id="gw-logout" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="${esc(
              t("nav.logout"),
            )}" aria-label="${esc(t("nav.logout"))}">${icon("log-out")}</button>
          </div>
        </div>
      </header>`;
    document.body.prepend(...header.children);
    $("#gw-logout").addEventListener("click", logout);
    // 名字旁边的月亮 / 太阳：一按就换深色 / 浅色，记在自己的设定（下次登入、别的电脑也一样）
    const themeBtn = $("#gw-theme");
    const paintTheme = () => {
      const dark = document.documentElement.classList.contains("dark");
      const label = t(dark ? "nav.lightMode" : "nav.darkMode");
      themeBtn.title = label;
      themeBtn.setAttribute("aria-label", label);
      themeBtn.innerHTML = icon(dark ? "sun" : "moon", "size-5");
      refreshIcons();
    };
    paintTheme();
    themeBtn.addEventListener("click", () => {
      const theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
      applyTheme(theme);
      profile.theme = theme;
      paintTheme();
      sb.from("gw_profiles").update({ theme }).eq("id", profile.id).then(() => {});
    });
    const main = $("#main");
    main.classList.add("mx-auto", "max-w-7xl", "px-4", "py-5", "sm:py-8");
    refreshIcons();
    return main;
  }

  function spinner() {
    return `<div class="flex min-h-[40vh] items-center justify-center"><div class="size-7 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></div></div>`;
  }

  // ---------------------------------------------------------------- 共用样式片段
  const cls = {
    input:
      "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900",
    btn: "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 h-10 px-4 text-sm",
    btnSm: "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 h-8 px-2.5 text-sm",
    primary: "bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200",
    secondary:
      "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
    ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
    danger: "bg-red-600 text-white hover:bg-red-700",
    card: "rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
    label: "text-sm font-medium text-slate-700 dark:text-slate-300",
    empty: "rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700",
  };
  const btn = (variant, size) => `${size === "sm" ? cls.btnSm : cls.btn} ${cls[variant || "primary"]}`;

  const BADGE = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    blue: "bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100",
  };
  const badge = (text, tone) =>
    `<span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${BADGE[tone || "slate"]}">${esc(text)}</span>`;

  const ALERT = {
    red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  };
  const alertBox = (text, tone) => `<div class="rounded-lg border px-3 py-2 text-sm ${ALERT[tone || "red"]}">${esc(text)}</div>`;

  // ---------------------------------------------------------------- 对话框 / 提示
  function modal(title, bodyHtml, opts) {
    const wrap = document.createElement("div");
    wrap.className = "gw-modal fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4";
    wrap.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="${esc(title)}" class="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900 ${
        opts && opts.wide === "xl" ? "sm:max-w-4xl" : opts && opts.wide ? "sm:max-w-2xl" : "sm:max-w-md"
      }">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h2 class="min-w-0 truncate text-lg font-semibold">${esc(title)}</h2>
          <div class="flex shrink-0 items-center gap-2">
            <div data-head-actions class="flex items-center gap-2"></div>
            <button data-close class="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="close">${icon("x", "size-5")}</button>
          </div>
        </div>
        <div data-body>${bodyHtml}</div>
      </div>`;
    const close = () => {
      wrap.remove();
      document.removeEventListener("keydown", onKey);
      if (opts && opts.onClose) opts.onClose();
    };
    /* 还没存的改动：点外面 / 叉 / Esc 先问要不要放弃。
       opts.guard：true = 弹窗里有 input / change 事件就算改过；函数 = 自己判断；false = 不问。
       没给的话，内容是 <form> 的弹窗自动 true。程式自己叫 close()（例如存好了）不会问。m.touch() 可以手动标成改过。 */
    const guard = opts && "guard" in opts ? opts.guard : /^\s*<form\b/.test(bodyHtml || "");
    let touched = false;
    if (guard === true) ["input", "change"].forEach((ev) => wrap.addEventListener(ev, (e) => e.target.closest && e.target.closest("[data-no-dirty]") ? null : (touched = true)));
    const isDirty = () => (typeof guard === "function" ? !!guard() : guard === true && touched);
    const tryClose = async () => {
      if (isDirty() && !(await confirmDialog(t("unsaved.title"), t("unsaved.body"), t("unsaved.leave"), t("unsaved.stay")))) return;
      close();
    };
    // Esc 只关最上面那一个（弹窗叠弹窗时，下面的留着）
    const onKey = (e) => e.key === "Escape" && [...document.querySelectorAll(".gw-modal")].pop() === wrap && tryClose();
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => e.target === wrap && tryClose());
    wrap.querySelector("[data-close]").addEventListener("click", tryClose);
    document.body.appendChild(wrap);
    refreshIcons();
    // head：标题列右边放按钮的地方（例如编辑时的 Cancel / Save）
    return { el: wrap.querySelector("[data-body]"), head: wrap.querySelector("[data-head-actions]"), close, touch: () => (touched = true) };
  }

  function confirmDialog(title, text, confirmLabel, cancelLabel) {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal(
        title,
        `<p class="mb-5 text-sm text-slate-600 dark:text-slate-300">${esc(text)}</p>
         <div class="flex justify-end gap-2">
           <button data-no class="${btn("secondary")}">${esc(cancelLabel)}</button>
           <button data-yes class="${btn("danger")}">${esc(confirmLabel)}</button>
         </div>`,
        { onClose: () => !answered && resolve(false) },
      );
      m.el.querySelector("[data-no]").onclick = () => m.close();
      m.el.querySelector("[data-yes]").onclick = () => {
        answered = true;
        m.close();
        resolve(true);
      };
    });
  }

  let toastTimer;
  function toast(text) {
    let el = $("#gw-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "gw-toast";
      el.className = "pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 sm:bottom-6";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">${esc(text)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.innerHTML = ""), 3000);
  }

  // ---------------------------------------------------------------- Edge Functions
  async function invoke(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      const ctx = error.context;
      if (ctx && typeof ctx.json === "function") {
        try {
          return await ctx.json();
        } catch (e) {
          /* 不是 JSON */
        }
      }
      return { ok: false, error: "network" };
    }
    return data;
  }

  // ---------------------------------------------------------------- Excel（需要时才载入）
  let excelPromise;
  function loadExcel() {
    if (!excelPromise) {
      excelPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = BASE + "shared/vendor/exceljs-4.4.0.min.js";
        s.onload = () => resolve(window.ExcelJS);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return excelPromise;
  }

  async function downloadXlsx(filename, build) {
    const ExcelJS = await loadExcel();
    const workbook = new ExcelJS.Workbook();
    build(workbook);
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      filename,
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function readXlsxRows(file) {
    const ExcelJS = await loadExcel();
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(await file.arrayBuffer());
    } catch (e) {
      return null;
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return null;
    const rows = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const cells = [];
      for (let i = 1; i <= 5; i++) {
        const v = row.getCell(i).value;
        cells.push(v && typeof v === "object" && "text" in v ? String(v.text).trim() : v == null ? "" : String(v).trim());
      }
      rows.push(cells);
    });
    return rows;
  }

  // ---------------------------------------------------------------- 模块图标
  // 模块可选的图标（资料库存 key → lucide 图示名称）
  const MODULE_ICONS = {
    "app-window": "app-window",
    fuel: "fuel",
    truck: "truck",
    tractor: "tractor",
    gauge: "gauge",
    wrench: "wrench",
    factory: "factory",
    "hard-hat": "hard-hat",
    users: "users",
    "file-text": "file-text",
    chart: "chart-column",
    calendar: "calendar",
    "clipboard-list": "clipboard-list",
    database: "database",
    shield: "shield",
    settings: "settings",
    mail: "mail",
    map: "map",
    package: "package",
    "dollar-sign": "dollar-sign",
    building: "building-2",
    "book-open": "book-open",
    "message-square": "message-square",
    camera: "camera",
  };
  const moduleIcon = (key, size) => icon(MODULE_ICONS[key] || "app-window", size);

  // ---------------------------------------------------------------- 打开模块
  /* 第 1 级（外部链接）/ 第 3 级（SSO）：直接打开网址
     第 2 级（Token 跳转）：向 Edge Function 申请 60 秒 Token，再带着 Token 跳转 */
  // 等 Token 的时候给用户看的画面（新分页：写进去取代 about:blank；同分页：盖一层）
  const openingHtml = (name) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title></head>
     <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#e7edf7;color:#334155">
     <div style="text-align:center"><div style="margin:0 auto 14px;width:34px;height:34px;border:3px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:s 0.8s linear infinite"></div>
     <div style="font-size:15px;font-weight:600">Opening ${esc(name)}…</div><div style="font-size:12px;color:#64748b;margin-top:4px">MJM Intranet is signing you in</div></div>
     <style>@keyframes s{to{transform:rotate(360deg)}}</style></body></html>`;
  function openingOverlay(name) {
    const el = document.createElement("div");
    el.className = "fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm";
    el.innerHTML = `<div class="rounded-2xl bg-white px-8 py-6 text-center shadow-xl dark:bg-slate-900"><div class="mx-auto mb-3 size-8 animate-spin rounded-full border-[3px] border-slate-300 border-t-brand-600"></div><div class="text-sm font-semibold">Opening ${esc(name)}…</div></div>`;
    document.body.appendChild(el);
    return () => el.remove();
  }
  // 开模块的网址加上「哪家公司」（gw_company = 那个系统认得的代码或名字，gw_company_name = Intranet 里的名字）
  function withCompany(url, ctx) {
    if (!ctx || !ctx.company) return url;
    try {
      const u = new URL(url);
      u.searchParams.set("gw_company", ctx.company);
      if (ctx.company_name && ctx.company_name !== ctx.company) u.searchParams.set("gw_company_name", ctx.company_name);
      if (ctx.company_short) u.searchParams.set("gw_company_short", ctx.company_short);
      if (ctx.opispro) u.searchParams.set("gw_opispro", ctx.opispro);
      if (ctx.location) u.searchParams.set("gw_location", ctx.location);
      if (ctx.location_id) u.searchParams.set("gw_location_id", ctx.location_id);
      return u.toString();
    } catch (e) {
      return url;
    }
  }
  // Systems that can be signed in to from here, before leaving the Intranet: the
  // Intranet redeems the token with the system's own sign-in endpoint while its
  // small "Opening…" box shows, then opens the system already signed in (the
  // result goes in the address's #hash, which never reaches any server).
  // Plantation Operation (PORT), and Management Report / Mantap through it.
  const HANDOFF = [
    {
      prefix: "https://oliviawsc.github.io/MJM-PORT/",
      endpoint: "https://pxzvayptwpvuvlenmdwp.supabase.co/functions/v1/stock-sso",
      key: "sb_publishable_tKap42sXnzGzmVUoLAw4xQ__bkXq8l_",
      body: (token, u) => {
        const mod = u.searchParams.get("module");
        return { token, module: mod === "report" || mod === "mantap" ? mod : "stock" };
      },
    },
  ];
  const b64url = (text) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // → the address to open (signed in), null when this system has no handoff,
  //   "retry" when its sign-in could not be reached
  async function handoffUrl(redirectUrl, ctx) {
    let u;
    try {
      u = new URL(redirectUrl);
    } catch (e) {
      return null;
    }
    const h = HANDOFF.find((x) => u.href.startsWith(x.prefix));
    const token = u.searchParams.get("gw_token");
    if (!h || !token) return null;
    u.searchParams.delete("gw_token");
    const target = new URL(withCompany(u.toString(), ctx));
    let res;
    try {
      res = await fetch(h.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: h.key, Authorization: "Bearer " + h.key },
        body: JSON.stringify(h.body(token, u)),
      });
    } catch (e) {
      return "retry"; // could not reach it: open with a fresh token, the system signs in by itself
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.session) target.hash = "gw_handoff=" + b64url(JSON.stringify({ session: data.session, auth: data.auth || null }));
    else target.hash = "gw_error=" + encodeURIComponent((data && data.error) || "err_network");
    return target.toString();
  }

  async function openModule(m, ctx) {
    const newTab = m.open_mode === "new_tab";
    if (m.access_level === 2) {
      const win = newTab ? window.open("", "_blank") : null;
      if (win) {
        try {
          win.document.write(openingHtml(m.name));
          win.document.close();
        } catch (e) {
          /* 忽略 */
        }
      }
      const done = win ? () => {} : openingOverlay(m.name);
      const r = await invoke("gw-issue-token", { module_code: m.code });
      if (!r || !r.redirect_url) {
        done();
        if (win) win.close();
        return false;
      }
      let target = await handoffUrl(r.redirect_url, ctx);
      if (target === "retry") {
        // the first token may have been used on the way: ask for a new one
        const r2 = await invoke("gw-issue-token", { module_code: m.code });
        target = r2 && r2.redirect_url ? withCompany(r2.redirect_url, ctx) : null;
      }
      if (!target) target = withCompany(r.redirect_url, ctx);
      if (win) {
        win.opener = null;
        win.location.href = target;
      } else {
        location.assign(target);
      }
      return true;
    }
    const record = sb.rpc("gw_record_open", { p_module: m.id });
    if (newTab) {
      window.open(withCompany(m.url, ctx), "_blank", "noopener,noreferrer");
      await record;
    } else {
      await record;
      location.assign(withCompany(m.url, ctx));
    }
    return true;
  }

  function setLocale(locale) {
    try {
      localStorage.setItem("gw_locale", locale);
    } catch (e) {
      /* 忽略 */
    }
  }

  return {
    sb,
    BASE,
    LOCALE,
    setLocale,
    t,
    esc,
    $,
    $$,
    icon,
    refreshIcons,
    fmtDateTime,
    go,
    applyTheme,
    loadProfile,
    requireProfile,
    welcomeBack,
    logout,
    changePassword,
    shell,
    spinner,
    cls,
    btn,
    badge,
    alertBox,
    modal,
    confirmDialog,
    toast,
    invoke,
    downloadXlsx,
    downloadBlob,
    readXlsxRows,
    MODULE_ICONS,
    moduleIcon,
    openModule,
  };
})();
