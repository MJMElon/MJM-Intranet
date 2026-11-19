/* ================================================================
   MJM Connect — 主画面（像 iPhone 的主画面）
   Notice Board 固定在最上面；下面是固定格子的棋盘，App 图标、小工具、文件夹可以拖到任何空格（手机长按），会自动对齐。
   右下角浮动按钮：Add Widget、Add Apps（把 App 拖到想放的位置）、New Folder、Edit Home Screen。
   位置：App 存 gw_user_layout、文件夹存 gw_user_folders、小工具存 gw_user_widgets，sort_order = 第几格（slot）。
   权限关掉的 App 不显示，但位置记录保留。
   ================================================================ */
window.GWHome = (function () {
  const { sb, t, esc, $, $$, icon, moduleIcon, cls, btn, modal, confirmDialog, toast, openModule, refreshIcons } = GW;

  // App 图标底色（依模块代码固定挑一个）
  const TILE = [
    "from-sky-400 to-blue-600",
    "from-emerald-400 to-green-600",
    "from-teal-400 to-cyan-600",
    "from-indigo-400 to-violet-600",
    "from-amber-400 to-orange-500",
    "from-rose-400 to-pink-600",
    "from-slate-500 to-slate-700",
    "from-lime-400 to-emerald-600",
  ];
  const tileColor = (code) => TILE[[...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE.length];

  // 小工具种类与可选大小
  const WIDGETS = {
    greeting: { sizes: ["medium"], icon: "sun" },
    clock: { sizes: ["small", "medium"], icon: "clock" },
    search: { sizes: ["medium"], icon: "search" },
    recent: { sizes: ["small", "medium"], icon: "history" },
    // Notice Board：固定在最上面，只能调大小，不能移动、不能删除，也不能再加第二个
    announcements: { sizes: ["medium", "large"], icon: "megaphone", hidden: true, pinned: true },
    calendar: { sizes: ["small", "medium"], icon: "calendar" },
    notes: { sizes: ["small", "medium", "large"], icon: "sticky-note" },
    // 管理入口已改为右上角齿轮；旧的管理小工具仍照常显示，但不再提供新增
    admin: { sizes: ["medium"], icon: "shield-check", hidden: true },
  };
  // 格子大小：App 1×1；小 2×2；中 4×2；大 4×4
  const SPAN = { small: "col-span-2 row-span-2", medium: "col-span-4 row-span-2", large: "col-span-4 row-span-4" };

  function render(root, data, opts) {
    const readOnly = !!(opts && opts.readOnly);
    const profile = (opts && opts.profile) || data.profile;
    const isSuper = profile.role === "super_admin";
    const isAdmin = isSuper || !!profile.manages;
    const canPost = isSuper || !!profile.canPost;
    // 公告能不能改 / 删：super_admin 全部；角色按每个 Business 的功能
    const bizCan = (gid, f) => (profile.bizCan ? profile.bizCan(gid, f) : isSuper);
    const canEditNotice = (a) => !readOnly && (isSuper || (a.group_id && bizCan(a.group_id, "can_post_notice")));
    const canDeleteNotice = (a) => !readOnly && (isSuper || (a.group_id && bizCan(a.group_id, "can_delete_notice")));
    const widgetsEnabled = !!(opts && Array.isArray(opts.widgets));
    const uninitialized = readOnly && !data.profile.layout_initialized;

    const modules = new Map(data.modules.map((m) => [m.id, m]));
    let folders = data.folders.map((f) => ({ ...f }));
    let widgets = widgetsEnabled ? opts.widgets.map((w) => ({ ...w })) : [];
    // 个人连结图示（用户自己加的网址）
    let links = ((opts && opts.links) || []).map((l) => ({ ...l }));
    // App 位置（只记录目前有权限的）
    let layout = new Map(data.layout.map((l) => [l.module_id, { folder_id: l.folder_id, sort_order: l.sort_order }]));
    if (uninitialized) data.modules.forEach((m, i) => layout.set(m.id, { folder_id: null, sort_order: i + 1 }));

    let editing = false;
    let sheet = null; // "apps" | "widgets" | null
    let fabOpen = false;
    let lastDragEnd = 0;
    let clockTimer = null;

    // ------------------------------------------------------------ 月历：MJMConnect 的请假 / 去 Estate
    /* 有 MJMConnect（代码 MJMCONNECT）权限的人，月历小工具会显示 MJMConnect 的资料：
       紫点 = 有人请假，绿点 = 有人去 Estate；按日期看名单。资料由 MJMConnect 的 intranet-calendar 函数提供，
       那边会再用 Intranet 的登录 Token 检查一次权限（说明见 mjmconnect-app 的 docs/intranet-calendar-setup.md）。 */
    const CAL_URL = GW_CONFIG.mjmconnectCalendarUrl;
    const calEnabled = !readOnly && !!CAL_URL && data.modules.some((m) => m.code === "MJMCONNECT");
    const cal = { month: null, loading: false, leave: {}, estate: {} };
    async function loadCal(month, days) {
      cal.loading = true;
      const leave = {};
      const estate = {};
      try {
        const { data: s } = await sb.auth.getSession();
        const token = s && s.session && s.session.access_token;
        if (token) {
          const res = await fetch(CAL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ from: month + "-01", days }),
          });
          const r = res.ok ? await res.json() : null;
          if (r && r.ok) {
            (r.leave || []).forEach((x) => (leave[x.date] = leave[x.date] || []).push(x));
            (r.estate || []).forEach((x) => (estate[x.date] = estate[x.date] || []).push(x));
          }
        }
      } catch (e) {
        /* 拿不到就显示普通月历 */
      }
      Object.assign(cal, { month, loading: false, leave, estate });
      if (!editing && root.isConnected) draw();
    }
    function calDay(date) {
      const lv = cal.leave[date] || [];
      const es = cal.estate[date] || [];
      const title = new Intl.DateTimeFormat(GW.LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
      const row = (dot, name, sub) =>
        `<li class="flex items-center gap-3 py-2"><span class="size-2.5 shrink-0 rounded-full ${dot}"></span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(name)}</span><span class="block truncate text-xs text-slate-500">${esc(sub)}</span></span></li>`;
      const leaveType = (x) => {
        const k = "widgets.leaveTypes." + x.leave_type;
        const name = t(k) === k ? x.leave_type : t(k);
        return x.day_type && x.day_type !== "FULL" ? `${name} · ${x.day_type === "AM" || x.day_type === "PM" ? x.day_type : t("widgets.hourly")}` : name;
      };
      const section = (label, items) => (items.length ? `<p class="mt-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">${esc(label)} (${items.length})</p><ul class="divide-y divide-slate-100 dark:divide-slate-800">${items.join("")}</ul>` : "");
      const m = modal(
        title,
        lv.length || es.length
          ? section(t("widgets.calLeave"), lv.map((x) => row("bg-violet-500", x.name, leaveType(x)))) + section(t("widgets.calEstate"), es.map((x) => row("bg-emerald-500", x.name, t("widgets.goingTo", { place: x.estate || "—" }))))
          : `<p class="py-4 text-center text-sm text-slate-400">${esc(t("widgets.calNone"))}</p>`,
      );
      refreshIcons();
      return m;
    }

    // ------------------------------------------------------------ 资料：格子位置（slot）
    /* 主画面是一个固定格子的棋盘（手机 4 栏、平板 6 栏、电脑 8 栏）。
       每个东西记一个 slot（= 第几格，从 0 开始）：row = slot ÷ 栏数，col = slot mod 栏数。
       App / 文件夹占 1×1；小工具 small 2×2、medium 4×2、large 4×4。
       Notice Board 固定在棋盘上方，不在格子里。 */
    const isPinned = (w) => !!(w && WIDGETS[w.widget_type] && WIDGETS[w.widget_type].pinned);
    const board = () => widgets.find(isPinned) || null;
    const SIZES = { small: [2, 2], medium: [4, 2], large: [4, 4] };
    const cols = () => (matchMedia("(min-width: 1024px)").matches ? 8 : matchMedia("(min-width: 640px)").matches ? 6 : 4);

    function rootItems() {
      const items = [];
      layout.forEach((l, id) => modules.has(id) && !l.folder_id && items.push({ kind: "app", id, slot: l.sort_order, w: 1, h: 1 }));
      links.forEach((l) => items.push({ kind: "link", id: l.id, slot: l.sort_order, w: 1, h: 1 }));
      folders.forEach((f) => items.push({ kind: "folder", id: f.id, slot: f.sort_order, w: 1, h: 1 }));
      widgets.filter((w) => !isPinned(w)).forEach((w) => items.push({ kind: "widget", id: w.id, slot: w.sort_order, w: SIZES[w.size][0], h: SIZES[w.size][1] }));
      return items.sort((a, b) => a.slot - b.slot || a.kind.localeCompare(b.kind));
    }
    const folderApps = (fid) =>
      [...layout.entries()]
        .filter(([id, l]) => l.folder_id === fid && modules.has(id))
        .sort((a, b) => a[1].sort_order - b[1].sort_order)
        .map(([id]) => id);

    // 把 slot 换算成实际位置；重叠的（例如换了装置、栏数不同）往后找空位，只影响显示不改资料
    function positions(skip) {
      const n = cols();
      const taken = new Set();
      const free = (c, r, w, h) => {
        for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken.has(y * n + x)) return false;
        return true;
      };
      const take = (c, r, w, h) => {
        for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) taken.add(y * n + x);
      };
      const pos = new Map();
      rootItems().forEach((it) => {
        if (skip && skip.kind === it.kind && skip.id === it.id) return;
        let slot = Math.max(0, it.slot || 0);
        let c = Math.min(slot % n, n - it.w);
        let r = Math.floor(slot / n);
        while (!free(c, r, it.w, it.h)) {
          slot++;
          c = Math.min(slot % n, n - it.w);
          r = Math.floor(slot / n);
        }
        take(c, r, it.w, it.h);
        pos.set(it.kind + ":" + it.id, { c, r, w: it.w, h: it.h, slot: r * n + c });
      });
      return { pos, taken, n, free, take };
    }
    const rowsUsed = (P) => Math.max(0, ...[...P.pos.values()].map((p) => p.r + p.h));
    // 第一个放得下的空位
    function nextSlot(w, h, P) {
      P = P || positions();
      for (let slot = 0; ; slot++) {
        const c = slot % P.n, r = Math.floor(slot / P.n);
        if (c + w > P.n) continue;
        if (P.free(c, r, w, h)) return r * P.n + c;
      }
    }

    async function saveApps(items) {
      if (readOnly || !items.length) return;
      const { error } = await sb.rpc("gw_save_layout", { p_items: items.map((i) => ({ ...i, card_size: "large" })) });
      if (error) toast(t("home.saveFailed"));
    }
    // 记住某个东西的位置
    async function saveSlot(kind, id, slot) {
      if (readOnly) return;
      if (kind === "app") {
        layout.set(id, { folder_id: null, sort_order: slot });
        return saveApps([{ module_id: id, folder_id: null, sort_order: slot }]);
      }
      if (kind === "folder") {
        const f = folders.find((x) => x.id === id);
        if (f) f.sort_order = slot;
        return sb.from("gw_user_folders").update({ sort_order: slot }).eq("id", id);
      }
      if (kind === "link") {
        const l = links.find((x) => x.id === id);
        if (l) l.sort_order = slot;
        return sb.from("gw_user_links").update({ sort_order: slot }).eq("id", id);
      }
      const w = widgets.find((x) => x.id === id);
      if (w) w.sort_order = slot;
      return sb.from("gw_user_widgets").update({ sort_order: slot }).eq("id", id);
    }

    async function addApp(id, slot) {
      if (layout.has(id) && modules.has(id)) return;
      if (slot == null) slot = nextSlot(1, 1);
      layout.set(id, { folder_id: null, sort_order: slot });
      draw();
      await saveApps([{ module_id: id, folder_id: null, sort_order: slot }]);
      sb.rpc("gw_mark_seen", { p_modules: [id] });
      toast(t("home.added"));
    }

    async function removeApp(id) {
      layout.delete(id);
      draw();
      const { error } = await sb.from("gw_user_layout").delete().eq("module_id", id).eq("user_id", data.profile.id);
      if (error) toast(t("home.saveFailed"));
    }

    async function moveIntoFolder(id, fid) {
      const order = folderApps(fid).length + 1;
      layout.set(id, { folder_id: fid, sort_order: order });
      draw();
      await saveApps([{ module_id: id, folder_id: fid, sort_order: order }]);
    }

    async function addWidget(type, size) {
      if (!widgetsEnabled) return toast(t("widgets.unavailable"));
      const [w, h] = SIZES[size];
      const { data: row, error } = await sb
        .from("gw_user_widgets")
        .insert({ user_id: data.profile.id, widget_type: type, size, sort_order: nextSlot(w, h), config: {} })
        .select()
        .single();
      if (error) return toast(t("home.saveFailed"));
      widgets.push(row);
      sheet = null;
      draw();
      toast(t("widgets.added"));
      setTimeout(() => {
        const el = root.querySelector(`[data-kind="widget"][data-id="${row.id}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }

    async function removeWidget(id) {
      if (isPinned(widgets.find((w) => w.id === id))) return;
      widgets = widgets.filter((w) => w.id !== id);
      draw();
      await sb.from("gw_user_widgets").delete().eq("id", id);
    }

    async function resizeWidget(id) {
      const w = widgets.find((x) => x.id === id);
      const sizes = WIDGETS[w.widget_type].sizes;
      w.size = sizes[(sizes.indexOf(w.size) + 1) % sizes.length];
      draw();
      await sb.from("gw_user_widgets").update({ size: w.size }).eq("id", id);
    }

    // ------------------------------------------------------------ App / 文件夹 / 小工具外观
    const newDot = (m) => (m.is_new ? `<span class="absolute -top-1 -right-1 size-3 rounded-full border-2 border-white bg-rose-500 dark:border-slate-900"></span>` : "");
    const badge = (attr, ic, label, pos) =>
      `<button type="button" ${attr} aria-label="${esc(label)}" class="no-drag absolute ${pos} z-10 flex size-6 items-center justify-center rounded-full bg-slate-700/90 text-white shadow ring-2 ring-white dark:ring-slate-900">${icon(ic, "size-3.5")}</button>`;

    function appIcon(m, size) {
      if (m.image_url)
        return `<span class="relative flex ${size || "size-14 sm:size-16"} overflow-hidden rounded-[26%] bg-white shadow-md shadow-slate-900/10"><img src="${esc(m.image_url)}" alt="" class="size-full object-cover">${newDot(m)}</span>`;
      return `<span class="relative flex ${size || "size-14 sm:size-16"} items-center justify-center rounded-[26%] bg-gradient-to-br ${tileColor(m.code)} text-white shadow-md shadow-slate-900/10">
        ${m.icon === "link" ? icon("link", "size-7 sm:size-8") : moduleIcon(m.icon, "size-7 sm:size-8")}${newDot(m)}
      </span>`;
    }

    // 个人连结图示
    function linkTile(l) {
      return `<div data-kind="link" data-id="${l.id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-open-link="${l.id}" class="flex flex-col items-center gap-1.5" title="${esc(l.url)}">
          ${appIcon({ code: l.name, icon: l.icon, image_url: l.image_url })}
          <span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(l.name)}</span>
        </button>
        ${editing ? badge(`data-remove-link="${l.id}"`, "minus", t("home.removeFromHome"), "top-0 left-1/2 -translate-x-[2.4rem]") + badge(`data-edit-link="${l.id}"`, "pencil", t("home.editLink"), "top-0 left-1/2 translate-x-[1rem]") : ""}
      </div>`;
    }

    function appTile(id) {
      const m = modules.get(id);
      return `<div data-kind="app" data-id="${id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-open="${id}" class="flex flex-col items-center gap-1.5" title="${esc(m.description || m.name)}">
          ${appIcon(m)}
          <span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(m.name)}</span>
        </button>
        ${editing ? badge(`data-remove-app="${id}"`, "minus", t("home.removeFromHome"), "top-0 left-1/2 -translate-x-[2.4rem]") + badge(`data-app-menu="${id}"`, "ellipsis", t("home.cardMenu"), "top-0 left-1/2 translate-x-[1rem]") : ""}
      </div>`;
    }

    function folderTile(f) {
      const ids = folderApps(f.id);
      const minis = ids.slice(0, 9).map((id) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${tileColor(modules.get(id).code)}"></span>`).join("");
      return `<div data-kind="folder" data-id="${f.id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-folder="${f.id}" class="flex flex-col items-center gap-1.5">
          <span class="grid size-14 grid-cols-3 grid-rows-3 content-start gap-1 rounded-[26%] border border-white/60 bg-white/55 p-2 shadow-md shadow-slate-900/10 backdrop-blur sm:size-16 dark:border-white/10 dark:bg-white/10">${minis}</span>
          <span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(f.name)}</span>
        </button>
        ${editing ? badge(`data-remove-folder="${f.id}"`, "minus", t("home.deleteFolder"), "top-0 left-1/2 -translate-x-[2.4rem]") : ""}
      </div>`;
    }

    const glass =
      "relative h-full overflow-hidden rounded-3xl border border-white/70 bg-white/75 p-4 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70";
    const wTitle = (ic, text) => `<div class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">${icon(ic, "size-3.5")}${esc(text)}</div>`;

    function widgetBody(w) {
      const now = new Date();
      const tz = GW_CONFIG.timeZone;
      const fmt = (o) => new Intl.DateTimeFormat(GW.LOCALE, { timeZone: tz, ...o }).format(now);
      switch (w.widget_type) {
        case "greeting": {
          const h = Number(fmt({ hour: "numeric", hour12: false }));
          const key = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
          const count = [...layout.keys()].filter((id) => modules.has(id)).length;
          return `<div class="flex h-full flex-col justify-between">
            <div>
              <div class="text-sm text-slate-500">${esc(fmt({ weekday: "long", day: "numeric", month: "long" }))}</div>
              <div class="mt-1 text-xl font-bold sm:text-2xl">${esc(t("widgets.greeting." + key, { name: profile.full_name }))}</div>
            </div>
            <div class="text-sm text-slate-500">${esc(t("widgets.appsOnHome", { count }))}</div>
          </div>`;
        }
        case "clock":
          return `<div class="flex h-full flex-col justify-center ${w.size === "small" ? "items-center text-center" : ""}">
            <div data-clock class="font-bold tabular-nums ${w.size === "small" ? "text-3xl" : "text-5xl"}">${esc(fmt({ hour: "2-digit", minute: "2-digit", hour12: false }))}</div>
            <div class="mt-1 text-sm text-slate-500">${esc(fmt({ weekday: "short", day: "numeric", month: "short" }))}</div>
          </div>`;
        case "search":
          return `${wTitle("search", t("widgets.types.search"))}
            <input data-widget-search type="search" placeholder="${esc(t("home.searchPlaceholder"))}" class="${cls.input} no-drag rounded-xl bg-white/80 dark:bg-slate-800/80">
            <div data-search-results class="mt-2 flex gap-3 overflow-x-auto"></div>`;
        case "recent": {
          const ids = data.recent.filter((id) => modules.has(id)).slice(0, w.size === "small" ? 4 : 5);
          return `${wTitle("history", t("home.recent"))}
            ${
              ids.length
                ? `<div class="${w.size === "small" ? "grid grid-cols-2 gap-2" : "flex gap-3 overflow-x-auto"}">${ids
                    .map((id) => `<button type="button" data-open="${id}" class="no-drag flex flex-col items-center gap-1">${appIcon(modules.get(id), "size-11")}${w.size === "small" ? "" : `<span class="w-14 truncate text-center text-[11px]">${esc(modules.get(id).name)}</span>`}</button>`)
                    .join("")}</div>`
                : `<p class="text-sm text-slate-400">${esc(t("widgets.noRecent"))}</p>`
            }`;
        }
        case "announcements": {
          // Notice Board：公告；管理员可以直接在这里发布
          const when = (d) => (d ? new Intl.DateTimeFormat(GW.LOCALE, { day: "numeric", month: "short" }).format(new Date(d)) : "");
          return `<div class="mb-2 flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-100">${icon("megaphone", "size-4 text-brand-600 dark:text-brand-400")}${esc(t("widgets.types.announcements"))}</div>
              ${canPost && !readOnly && !editing ? `<button type="button" data-post class="no-drag flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">${icon("plus", "size-3.5")}${esc(t("widgets.post"))}</button>` : ""}
            </div>
            ${
              data.announcements.length
                ? `<ul class="no-drag -mr-2 space-y-2 overflow-y-auto pr-2 h-[calc(100%-2.25rem)]">${data.announcements
                    .map(
                      (a) => `<li class="flex gap-2.5 rounded-xl px-3 py-2 text-sm ${a.level === "warning" ? "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "bg-slate-50 dark:bg-white/5"}">${icon(a.level === "warning" ? "triangle-alert" : "info", `mt-0.5 size-4 shrink-0 ${a.level === "warning" ? "text-amber-500" : "text-sky-500"}`)}<div class="min-w-0 flex-1"><p class="whitespace-pre-line break-words">${esc(a.message)}</p><p class="mt-0.5 text-[11px] text-slate-400">${esc([when(a.starts_at), a.author].filter(Boolean).join(" · "))}</p></div>${
                        !editing && (canEditNotice(a) || canDeleteNotice(a))
                          ? `<span class="flex shrink-0 items-start gap-0.5">${canEditNotice(a) ? `<button type="button" data-edit-notice="${a.id}" aria-label="${esc(t("widgets.editNotice"))}" title="${esc(t("widgets.editNotice"))}" class="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-white/10">${icon("pencil", "size-3.5")}</button>` : ""}${canDeleteNotice(a) ? `<button type="button" data-del-notice="${a.id}" aria-label="${esc(t("widgets.deleteNotice"))}" title="${esc(t("widgets.deleteNotice"))}" class="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-white/10">${icon("trash-2", "size-3.5")}</button>` : ""}</span>`
                          : ""
                      }</li>`,
                    )
                    .join("")}</ul>`
                : `<div class="flex h-[calc(100%-2.25rem)] flex-col items-center justify-center gap-1 text-center text-sm text-slate-400">${icon("inbox", "size-6")}<span>${esc(t("widgets.noAnnouncements"))}</span></div>`
            }`;
        }
        case "calendar": {
          const y = Number(fmt({ year: "numeric" }));
          const mo = Number(fmt({ month: "numeric" })) - 1;
          const today = Number(fmt({ day: "numeric" }));
          const first = new Date(Date.UTC(y, mo, 1)).getUTCDay();
          const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
          const names = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(GW.LOCALE, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + i))));
          const cells = [...Array(first).fill(""), ...[...Array(days)].map((_, i) => i + 1)];
          const month = `${y}-${String(mo + 1).padStart(2, "0")}`;
          if (calEnabled && cal.month !== month && !cal.loading) loadCal(month, days);
          const dateOf = (d) => `${month}-${String(d).padStart(2, "0")}`;
          const dots = (d) => {
            const lv = (cal.leave[dateOf(d)] || []).length;
            const es = (cal.estate[dateOf(d)] || []).length;
            return lv || es
              ? `<span class="pointer-events-none absolute -bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">${lv ? `<span class="size-1 rounded-full bg-violet-500"></span>` : ""}${es ? `<span class="size-1 rounded-full bg-emerald-500"></span>` : ""}</span>`
              : "";
          };
          const cell = (d) => {
            if (!d) return "<span></span>";
            const num = `<span class="${d === today ? "mx-auto flex size-5 items-center justify-center rounded-full bg-rose-500 font-bold text-white" : ""}">${d}</span>`;
            const mark = dots(d);
            return mark && !editing
              ? `<button type="button" data-cal-day="${dateOf(d)}" class="no-drag relative rounded-md pb-1 hover:bg-slate-900/5 dark:hover:bg-white/10">${num}${mark}</button>`
              : `<span class="relative pb-1">${num}${mark}</span>`;
          };
          const legend =
            calEnabled && w.size !== "small"
              ? `<span class="flex items-center gap-2 text-[10px] font-medium text-slate-500"><span class="flex items-center gap-1"><span class="size-1.5 rounded-full bg-violet-500"></span>${esc(t("widgets.calLeave"))}</span><span class="flex items-center gap-1"><span class="size-1.5 rounded-full bg-emerald-500"></span>${esc(t("widgets.calEstate"))}</span></span>`
              : "";
          return `<div class="mb-1 flex items-center justify-between gap-2"><span class="text-sm font-semibold text-rose-500">${esc(fmt({ month: "long" }))}</span>${legend}</div>
            <div class="grid grid-cols-7 gap-y-0.5 text-center ${w.size === "small" ? "text-[10px]" : "text-xs"}">
              ${names.map((n) => `<span class="font-semibold text-slate-400">${esc(n)}</span>`).join("")}
              ${cells.map(cell).join("")}
            </div>`;
        }
        case "notes":
          return `${wTitle("sticky-note", t("widgets.types.notes"))}
            <textarea data-note="${w.id}" ${readOnly ? "disabled" : ""} placeholder="${esc(t("widgets.notesPlaceholder"))}" class="no-drag h-[calc(100%-1.75rem)] w-full resize-none bg-transparent text-sm outline-none">${esc((w.config && w.config.text) || "")}</textarea>`;
        case "admin":
          return `${wTitle("shield-check", t("home.adminSection"))}
            <div class="grid content-start gap-2 ${isSuper ? "grid-cols-2" : "grid-cols-1"}">
              ${isAdmin ? `<a href="admin.html#users" class="no-drag flex items-center gap-2 rounded-2xl bg-sky-50 px-3 py-4 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-200">${icon("user-cog", "size-6 shrink-0")}<span class="text-sm font-semibold">${esc(t("home.userAccess"))}</span></a>` : `<p class="text-sm text-slate-400">${esc(t("widgets.adminOnly"))}</p>`}
              ${isSuper ? `<a href="admin.html#modules" class="no-drag flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-4 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200">${icon("crown", "size-6 shrink-0")}<span class="text-sm font-semibold">${esc(t("home.superAdmin"))}</span></a>` : ""}
            </div>`;
      }
      return "";
    }

    function widgetTile(w, p) {
      return `<div data-kind="widget" data-id="${w.id}" class="gw-item relative" style="grid-column:${p.c + 1} / span ${p.w};grid-row:${p.r + 1} / span ${p.h}">
        <div class="${glass}">${widgetBody(w)}</div>
        ${editing ? badge(`data-remove-widget="${w.id}"`, "minus", t("widgets.remove"), "-top-2 -left-2") : ""}
        ${editing && WIDGETS[w.widget_type].sizes.length > 1 ? badge(`data-resize="${w.id}"`, "scaling", t("widgets.resize"), "-right-2 -bottom-2") : ""}
      </div>`;
    }

    // Notice Board：固定在最上面、占满整行；只能调高度
    function boardHtml() {
      const w = board();
      if (!w) return "";
      return `<div data-kind="widget" data-id="${w.id}" class="gw-pinned relative mb-4 ${w.size === "large" ? "h-[22rem]" : "h-[13rem]"}">
        <div class="${glass}">${widgetBody(w)}</div>
        ${editing ? badge(`data-resize="${w.id}"`, "scaling", t("widgets.resize"), "-right-2 -bottom-2") : ""}
      </div>`;
    }

    // ------------------------------------------------------------ 新增 App / 小工具 面板
    function appsSheet() {
      const onHome = new Set([...layout.keys()].filter((id) => modules.has(id)));
      return `<div class="mb-3 flex items-center justify-between"><h3 class="font-semibold">${esc(t("fab.addApps"))}</h3>${iconBtn("data-close-sheet", t("home.close"), "x")}</div>
        <p class="mb-3 text-xs text-slate-500">${esc(t("fab.addAppsHint"))}</p>
        <input data-sheet-search type="search" placeholder="${esc(t("home.searchPlaceholder"))}" class="${cls.input} mb-3">
        ${
          data.modules.length
            ? `<div class="gw-sheet-apps grid grid-cols-4 gap-x-2 gap-y-4">${data.modules
                .map((m) => {
                  const added = onHome.has(m.id);
                  return `<div data-lib="${m.id}" data-name="${esc((m.name + " " + m.code).toLowerCase())}" class="${added ? "gw-added opacity-50" : "cursor-grab"} relative flex flex-col items-center gap-1">
                    ${appIcon(m, "size-14")}
                    <span class="w-full truncate text-center text-[11px]">${esc(m.name)}</span>
                    ${added ? `<span class="absolute top-0 right-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">${icon("check", "size-3")}</span>` : `<button type="button" data-add="${m.id}" aria-label="${esc(t("home.addToHome"))}" class="no-drag absolute top-0 right-1 flex size-5 items-center justify-center rounded-full bg-slate-700 text-white">${icon("plus", "size-3")}</button>`}
                  </div>`;
                })
                .join("")}</div>`
            : `<div class="${cls.empty}">${esc(t("home.noModules"))}</div>`
        }`;
    }

    function widgetsSheet() {
      const types = Object.entries(WIDGETS).filter(([, d]) => !d.hidden);
      return `<div class="mb-3 flex items-center justify-between"><h3 class="font-semibold">${esc(t("fab.addWidget"))}</h3>${iconBtn("data-close-sheet", t("home.close"), "x")}</div>
        <p class="mb-3 text-xs text-slate-500">${esc(t("fab.addWidgetHint"))}</p>
        <div class="space-y-2">${types
          .map(
            ([type, d]) => `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">${icon(d.icon, "size-5")}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold">${esc(t("widgets.types." + type))}</span>
                <span class="block text-xs text-slate-500">${esc(t("widgets.desc." + type))}</span>
              </span>
              <span class="flex gap-1">${d.sizes.map((s) => `<button type="button" data-add-widget="${type}" data-size="${s}" class="${btn("secondary", "sm")} px-2">${esc(t("widgets.sizes." + s))}</button>`).join("")}</span>
            </div>`,
          )
          .join("")}</div>`;
    }

    const iconBtn = (attr, label, name) =>
      `<button type="button" ${attr} aria-label="${esc(label)}" class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">${icon(name)}</button>`;

    // ------------------------------------------------------------ 浮动按钮
    function fabHtml() {
      if (readOnly) return "";
      if (editing) {
        return `<button type="button" data-done class="fixed right-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex h-12 items-center gap-2 rounded-full bg-slate-900 px-5 font-semibold text-white shadow-xl sm:bottom-8 dark:bg-white dark:text-slate-900">${icon("check")} ${esc(t("fab.done"))}</button>`;
      }
      const items = [
        ["add-link", "link", t("fab.addLink")],
        ["add-widget", "layout-dashboard", t("fab.addWidget")],
        ["add-apps", "layout-grid", t("fab.addApps")],
        ["new-folder", "folder-plus", t("fab.newFolder")],
        ["edit", "move", t("fab.edit")],
      ];
      return `<div class="fixed right-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2 sm:bottom-8">
        ${
          fabOpen
            ? items
                .map(
                  ([k, ic, label]) => `<button type="button" data-fab="${k}" class="flex items-center gap-2 rounded-full border border-white/70 bg-white/90 py-2 pr-4 pl-3 text-sm font-medium shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-800/90">${icon(ic)} ${esc(label)}</button>`,
                )
                .join("")
            : ""
        }
        <button type="button" data-fab-toggle aria-label="${esc(t("fab.menu"))}" aria-expanded="${fabOpen}" class="flex size-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl transition-transform dark:bg-white dark:text-slate-900 ${fabOpen ? "rotate-45" : ""}">${icon("plus", "size-6")}</button>
      </div>`;
    }

    // ------------------------------------------------------------ 整页

    function draw() {
      clearInterval(clockTimer);
      // 还没被分配到任何群组：主画面什么都不显示，只显示等待分配
      if (opts && opts.pending) {
        root.innerHTML = `<div class="mx-auto mt-[12vh] max-w-md rounded-3xl border border-white/70 bg-white/80 p-8 text-center shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/70">
          <span class="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">${icon("hourglass", "size-7")}</span>
          <h2 class="text-lg font-semibold">${esc(t("home.pendingTitle"))}</h2>
          <p class="mt-2 text-sm text-slate-500">${esc(t("home.pendingBody"))}</p>
          <p class="mt-4 text-xs text-slate-400">${esc(profile.email)}</p>
        </div>`;
        return refreshIcons();
      }
      const P = positions();
      const items = rootItems();
      // 棋盘下面多留两行空位，可以把东西拖到更下面
      const rows = rowsUsed(P) + (readOnly ? 0 : 2);
      const tile = (it) => {
        const p = P.pos.get(it.kind + ":" + it.id);
        const at = `style="grid-column:${p.c + 1} / span ${p.w};grid-row:${p.r + 1} / span ${p.h}"`;
        if (it.kind === "app") return appTile(it.id).replace('class="gw-item', at + ' class="gw-item');
        if (it.kind === "folder") return folderTile(folders.find((f) => f.id === it.id)).replace('class="gw-item', at + ' class="gw-item');
        if (it.kind === "link") return linkTile(links.find((l) => l.id === it.id)).replace('class="gw-item', at + ' class="gw-item');
        return widgetTile(widgets.find((w) => w.id === it.id), p);
      };
      root.innerHTML = `
        ${uninitialized ? `<div class="mb-4 rounded-2xl bg-white/70 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">${esc(t("home.previewUninitialized"))}</div>` : ""}
        ${boardHtml()}
        ${editing ? `<p class="mb-3 text-center text-xs text-slate-500">${esc(t("fab.editHint"))}</p>` : ""}
        <div id="gw-grid" data-cols="${P.n}" class="${editing ? "gw-editing" : ""} relative grid gap-x-2 gap-y-4 [grid-auto-rows:5.25rem] sm:[grid-auto-rows:5.75rem]"
             style="grid-template-columns:repeat(${P.n},minmax(0,1fr));grid-template-rows:repeat(${Math.max(rows, 1)},var(--gw-row,5.25rem))">
          ${items.map(tile).join("")}
          <div data-drop-hint class="pointer-events-none hidden rounded-2xl border-2 border-dashed"></div>
        </div>
        ${items.length === 0 ? `<div class="${cls.empty} mt-2 bg-white/60 dark:bg-slate-900/40">${esc(data.modules.length ? t("fab.emptyHome") : t("home.noModules"))}</div>` : ""}
        ${
          sheet
            ? `<aside class="gw-sheet fixed inset-x-0 bottom-0 z-50 max-h-[62vh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:inset-x-auto sm:top-20 sm:right-4 sm:bottom-4 sm:max-h-none sm:w-96 sm:rounded-3xl dark:border-slate-800 dark:bg-slate-900">${sheet === "apps" ? appsSheet() : widgetsSheet()}</aside>`
            : ""
        }
        ${fabHtml()}`;
      refreshIcons();
      if ($("[data-clock]", root)) {
        clockTimer = setInterval(() => {
          const now = new Intl.DateTimeFormat(GW.LOCALE, { timeZone: GW_CONFIG.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
          $$("[data-clock]", root).forEach((el) => (el.textContent = now));
        }, 15000);
      }
    }
    // 栏数随视窗宽度变（手机 4、平板 6、电脑 8）
    let lastCols = cols();
    addEventListener("resize", () => {
      if (cols() !== lastCols) ((lastCols = cols()), draw());
    });

    // ------------------------------------------------------------ 拖拉（像 iPhone：长按拿起，放到任何空格；格子会对齐）
    /* 规则：放到空格 → 移过去；App 放到文件夹上 → 收进文件夹；
             1×1 的东西放到另一个 1×1 上 → 两个交换；小工具要整块空位才放得下。
       从「Add Apps」面板也可以直接拖到想放的格子。 */
    let drag = null;
    const cellOf = (grid, x, y) => {
      const rect = grid.getBoundingClientRect();
      const cs = getComputedStyle(grid);
      const n = Number(grid.dataset.cols);
      const gx = parseFloat(cs.columnGap) || 0, gy = parseFloat(cs.rowGap) || 0;
      const rowH = parseFloat(cs.gridTemplateRows.split(" ")[0]) || 84;
      const cellW = (rect.width - gx * (n - 1)) / n;
      const rows = cs.gridTemplateRows.split(" ").length;
      return {
        c: Math.max(0, Math.min(n - 1, Math.floor((x - rect.left) / (cellW + gx)))),
        r: Math.max(0, Math.min(rows - 1, Math.floor((y - rect.top) / (rowH + gy)))),
        n, rows, cellW, rowH, gx, gy, rect,
      };
    };
    function dragTarget(e) {
      const grid = $("#gw-grid", root);
      const g = cellOf(grid, e.clientX, e.clientY);
      let c = Math.max(0, Math.min(g.n - drag.w, g.c - drag.offC));
      let r = Math.max(0, g.r - drag.offR);
      const P = positions(drag.kind === "lib" ? null : { kind: drag.kind, id: drag.id });
      // 这个位置上有什么
      const hits = new Set();
      P.pos.forEach((p, key) => {
        if (c < p.c + p.w && c + drag.w > p.c && r < p.r + p.h && r + drag.h > p.r) hits.add(key);
      });
      let action = null;
      if (!hits.size) action = { type: "place", slot: r * g.n + c };
      else if (hits.size === 1) {
        const key = [...hits][0];
        const [kind, id] = key.split(":");
        const p = P.pos.get(key);
        if (kind === "folder" && (drag.kind === "app" || drag.kind === "lib")) action = { type: "folder", fid: id };
        else if (drag.w === 1 && drag.h === 1 && p.w === 1 && p.h === 1 && drag.kind !== "lib") action = { type: "swap", kind, id, theirSlot: p.slot, mySlot: drag.slot };
      }
      return { c, r, g, action };
    }
    function showHint(tg) {
      const hint = $("[data-drop-hint]", root);
      if (!hint) return;
      hint.classList.remove("hidden");
      hint.className = `pointer-events-none rounded-2xl border-2 border-dashed ${tg.action ? "border-brand-500/70 bg-brand-500/10" : "border-rose-400/70 bg-rose-400/10"}`;
      hint.style.gridColumn = `${tg.c + 1} / span ${drag.w}`;
      hint.style.gridRow = `${tg.r + 1} / span ${drag.h}`;
    }
    function startDrag(e, el) {
      const lib = el.dataset.lib;
      const rect = el.getBoundingClientRect();
      const grid = $("#gw-grid", root);
      const g = cellOf(grid, rect.left, rect.top);
      let w = 1, h = 1;
      if (el.dataset.kind === "widget") [w, h] = SIZES[widgets.find((x) => x.id === el.dataset.id).size];
      const cur = lib ? null : positions().pos.get(el.dataset.kind + ":" + el.dataset.id);
      drag = {
        kind: lib ? "lib" : el.dataset.kind,
        id: lib || el.dataset.id,
        slot: cur ? cur.slot : null,
        el, w, h,
        // 手指抓在东西的第几格（宽的小工具才有差）
        offC: lib ? 0 : Math.min(w - 1, Math.floor((e.clientX - rect.left) / (g.cellW + g.gx))),
        offR: lib ? 0 : Math.min(h - 1, Math.floor((e.clientY - rect.top) / (g.rowH + g.gy))),
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        target: null,
      };
      const ghost = el.cloneNode(true);
      ghost.removeAttribute("data-kind");
      ghost.style.cssText = `position:fixed;left:0;top:0;width:${rect.width}px;height:${rect.height}px;z-index:60;pointer-events:none;transform:translate(${rect.left}px,${rect.top}px) scale(1.08);opacity:.95;transition:none;margin:0`;
      ghost.className = ghost.className.replace("gw-item", "gw-ghost");
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      el.classList.add("opacity-30");
      document.body.classList.add("gw-dragging");
      if (sheet) $(".gw-sheet", root).classList.add("opacity-40", "pointer-events-none");
    }
    function moveDrag(e) {
      drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px,${e.clientY - drag.dy}px) scale(1.08)`;
      // 靠近上下边缘时自动卷动
      if (e.clientY < 90) scrollBy(0, -14);
      else if (e.clientY > innerHeight - 90) scrollBy(0, 14);
      drag.target = dragTarget(e);
      showHint(drag.target);
    }
    async function endDrag(cancelled) {
      const d = drag;
      drag = null;
      d.ghost.remove();
      d.el.classList.remove("opacity-30");
      document.body.classList.remove("gw-dragging");
      lastDragEnd = Date.now();
      const a = !cancelled && d.target && d.target.action;
      if (!a) return draw();
      if (d.kind === "lib") {
        if (a.type === "folder") {
          if (layout.has(d.id)) return draw();
          layout.set(d.id, { folder_id: a.fid, sort_order: folderApps(a.fid).length + 1 });
          draw();
          await saveApps([{ module_id: d.id, folder_id: a.fid, sort_order: layout.get(d.id).sort_order }]);
          sb.rpc("gw_mark_seen", { p_modules: [d.id] });
          return toast(t("home.added"));
        }
        return addApp(d.id, a.slot);
      }
      if (a.type === "place") {
        const saving = saveSlot(d.kind, d.id, a.slot); // 先改记忆中的位置再重画
        draw();
        return saving;
      }
      if (a.type === "folder") return moveIntoFolder(d.id, a.fid);
      if (a.type === "swap") {
        const saving = Promise.all([saveSlot(d.kind, d.id, a.theirSlot), saveSlot(a.kind, a.id, a.mySlot)]);
        draw();
        return saving;
      }
      draw();
    }
    // 长按（手机）或拖动（滑鼠）开始
    let press = null;
    root.addEventListener("pointerdown", (e) => {
      if (readOnly || drag || e.button !== 0) return;
      const el = e.target.closest("#gw-grid > .gw-item, .gw-sheet-apps [data-lib]:not(.gw-added)");
      if (!el || e.target.closest(".no-drag")) return;
      const touch = e.pointerType !== "mouse";
      press = { el, x: e.clientX, y: e.clientY, id: e.pointerId, touch };
      if (touch) press.timer = setTimeout(() => press && ((press.hold = true), startDrag(e, el), moveDrag(e)), 280);
    });
    root.addEventListener("pointermove", (e) => {
      if (drag) return moveDrag(e);
      if (!press || e.pointerId !== press.id) return;
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8;
      if (press.touch && far) ((clearTimeout(press.timer)), (press = null)); // 手指在滑动页面，不是要拖
      else if (!press.touch && far) ((startDrag(e, press.el)), moveDrag(e), (press = null));
    });
    const up = (e) => {
      if (press) ((clearTimeout(press.timer)), (press = null));
      if (drag) endDrag(e.type === "pointercancel");
    };
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    addEventListener("pointerup", (e) => drag && up(e));
    // 拖拉中不让页面跟着手指卷动；长按不要跳出系统选单
    document.addEventListener("touchmove", (e) => drag && e.preventDefault(), { passive: false });
    root.addEventListener("contextmenu", (e) => (drag || press) && e.preventDefault());

    // ------------------------------------------------------------ App 选单 / 文件夹
    // 个人连结图示：名称、网址、图示
    function linkDialog(link) {
      let chosen = link ? link.icon : "link";
      const dlg = modal(
        link ? t("home.editLink") : t("fab.addLink"),
        `<form class="space-y-4">
          <div data-err></div>
          <label class="block space-y-1.5"><span class="${cls.label}">${esc(t("home.linkName"))}</span><input name="name" required maxlength="40" value="${esc(link ? link.name : "")}" class="${cls.input}"></label>
          <label class="block space-y-1.5"><span class="${cls.label}">${esc(t("home.linkUrl"))}</span><input name="url" type="url" required value="${esc(link ? link.url : "https://")}" class="${cls.input}"></label>
          <div>
            <p class="mb-1.5 ${cls.label}">${esc(t("home.linkIcon"))}</p>
            <div class="flex flex-wrap gap-1.5">${["link", ...Object.keys(GW.MODULE_ICONS)].filter((v, i, a) => a.indexOf(v) === i).map((k) => `<button type="button" data-pick-icon="${k}" class="flex size-9 items-center justify-center rounded-lg border"></button>`).join("")}</div>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(t("home.save"))}</button>
          </div>
        </form>`,
      );
      const paint = () =>
        $$("[data-pick-icon]", dlg.el).forEach((b) => {
          b.className = `flex size-9 items-center justify-center rounded-lg border ${b.dataset.pickIcon === chosen ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-700/20 dark:text-brand-100" : "border-slate-200 text-slate-500 dark:border-slate-700"}`;
          b.innerHTML = b.dataset.pickIcon === "link" ? icon("link", "size-4") : moduleIcon(b.dataset.pickIcon, "size-4");
        });
      paint();
      refreshIcons();
      $$("[data-pick-icon]", dlg.el).forEach((b) => b.addEventListener("click", () => ((chosen = b.dataset.pickIcon), paint(), refreshIcons())));
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      $("form", dlg.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const row = { name: f.name.value.trim(), url: f.url.value.trim(), icon: chosen };
        if (!/^https?:\/\//i.test(row.url)) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.badUrl")));
        if (link) {
          const { error } = await sb.from("gw_user_links").update(row).eq("id", link.id);
          if (error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.saveFailed")));
          Object.assign(link, row);
        } else {
          const { data: created, error } = await sb
            .from("gw_user_links")
            .insert({ ...row, user_id: data.profile.id, sort_order: nextSlot(1, 1) })
            .select()
            .single();
          if (error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.saveFailed")));
          links.push(created);
        }
        dlg.close();
        draw();
      });
    }

    async function removeLink(id) {
      links = links.filter((l) => l.id !== id);
      draw();
      await sb.from("gw_user_links").delete().eq("id", id);
    }

    function appMenu(id) {
      const m = modules.get(id);
      const current = layout.get(id).folder_id || "";
      const dlg = modal(
        m.name,
        `<div class="space-y-4">
          <label class="block space-y-1.5"><span class="${cls.label}">${esc(t("home.moveTo"))}</span>
            <select data-move class="${cls.input}">
              <option value="">${esc(t("fab.homeScreen"))}</option>
              ${folders.map((f) => `<option value="${f.id}" ${current === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
            </select>
          </label>
          <button data-remove class="${btn("ghost")} w-full text-red-600 dark:text-red-400">${icon("trash-2")} ${esc(t("home.removeFromHome"))}</button>
        </div>`,
      );
      $("[data-move]", dlg.el).addEventListener("change", async (e) => {
        const folderId = e.target.value || null;
        const order = folderId ? folderApps(folderId).length + 1 : nextSlot(1, 1);
        layout.set(id, { folder_id: folderId, sort_order: order });
        dlg.close();
        draw();
        await saveApps([{ module_id: id, folder_id: folderId, sort_order: order }]);
      });
      $("[data-remove]", dlg.el).onclick = () => (dlg.close(), removeApp(id));
    }

    // 文件夹：像 iPhone 一样放大成一个浮动窗，名字在上面
    function openFolder(fid) {
      const f = folders.find((x) => x.id === fid);
      const ids = folderApps(fid);
      const wrap = document.createElement("div");
      wrap.setAttribute("role", "dialog");
      wrap.className = "fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 p-6 backdrop-blur-md";
      wrap.innerHTML = `
        <h2 class="mb-5 max-w-full truncate px-4 text-3xl font-bold text-white drop-shadow sm:text-4xl">${esc(f.name)}</h2>
        <div data-win class="w-full max-w-md rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75">
          ${
            ids.length
              ? `<div class="grid grid-cols-3 gap-5 sm:grid-cols-4">${ids
                  .map(
                    (id) => `<div class="relative flex flex-col items-center gap-1.5">
                      <button type="button" data-open="${id}" class="flex flex-col items-center gap-1.5">${appIcon(modules.get(id), "size-14 sm:size-16")}<span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(modules.get(id).name)}</span></button>
                      ${readOnly ? "" : `<button type="button" data-out="${id}" title="${esc(t("fab.moveOut"))}" aria-label="${esc(t("fab.moveOut"))}" class="absolute -top-1 right-1 flex size-6 items-center justify-center rounded-full bg-slate-700/90 text-white shadow ring-2 ring-white dark:ring-slate-900">${icon("arrow-up-right", "size-3.5")}</button>`}
                    </div>`,
                  )
                  .join("")}</div>`
              : `<p class="py-6 text-center text-sm text-slate-500">${esc(t("fab.emptyFolder"))}</p>`
          }
        </div>
        ${readOnly ? "" : `<button type="button" data-rename class="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow backdrop-blur dark:bg-slate-800/80 dark:text-slate-200">${icon("pencil", "size-4")} ${esc(t("home.editFolder"))}</button>`}`;
      document.body.appendChild(wrap);
      refreshIcons();
      const close = () => wrap.remove();
      const onKey = (e) => e.key === "Escape" && (close(), document.removeEventListener("keydown", onKey));
      document.addEventListener("keydown", onKey);
      wrap.addEventListener("click", async (e) => {
        const b = e.target.closest("button");
        if (!b) {
          if (!e.target.closest("[data-win]")) close();
          return;
        }
        if (b.dataset.open) return close(), open(b.dataset.open);
        if (b.dataset.out) {
          const id = b.dataset.out;
          const slot = nextSlot(1, 1);
          layout.set(id, { folder_id: null, sort_order: slot });
          close();
          draw();
          await saveApps([{ module_id: id, folder_id: null, sort_order: slot }]);
          return openFolder(fid);
        }
        if ("rename" in b.dataset) {
          close();
          folderDialog(f);
        }
      });
    }

    // 在 Notice Board 直接发布 / 修改公告：super_admin 可发全公司或某个 Business；角色只能发给自己负责的 Business
    async function postNotice(notice) {
      const { data: groups } = await sb.from("gw_groups").select("id, name").order("sort_order").order("name");
      const targets = [
        ...(isSuper ? [["", t("widgets.postEveryone")]] : []),
        ...(groups || []).filter((g) => isSuper || bizCan(g.id, "can_post_notice")).map((g) => [g.id, g.name]),
      ];
      if (!targets.length) return toast(t("widgets.postFailed"));
      const cur = notice || { message: "", group_id: "", level: "info" };
      const dlg = modal(
        notice ? t("widgets.editNotice") : t("widgets.postTitle"),
        `<form class="space-y-4">
          <div data-err></div>
          <textarea name="message" required maxlength="500" rows="4" placeholder="${esc(t("widgets.postPlaceholder"))}" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900">${esc(cur.message)}</textarea>
          <label class="block space-y-1.5"><span class="${cls.label}">${esc(t("widgets.postAudience"))}</span>
            <select name="group_id" class="${cls.input}">${targets.map(([v, l]) => `<option value="${esc(v)}" ${v === (cur.group_id || "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          </label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="important" ${cur.level === "warning" ? "checked" : ""} class="size-4 accent-amber-500"> ${esc(t("widgets.postImportant"))}</label>
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("settings.cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(notice ? t("widgets.save") : t("widgets.post"))}</button>
          </div>
        </form>`,
      );
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      $("form", dlg.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const groupId = f.group_id.value || null;
        const fields = { message: f.message.value.trim(), level: f.important.checked ? "warning" : "info", group_id: groupId };
        const { data: row, error } = notice
          ? await sb.from("gw_announcements").update(fields).eq("id", notice.id).select("id, message, level, starts_at, group_id, created_by").single()
          : await sb.from("gw_announcements").insert({ ...fields, created_by: profile.id }).select("id, message, level, starts_at, group_id, created_by").single();
        if (error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("widgets.postFailed")));
        dlg.close();
        if (notice) {
          Object.assign(notice, row);
          draw();
          return toast(t("widgets.saved"));
        }
        row.author = profile.full_name;
        // 发给自己不在的 Business 时，自己的公告栏不会显示，只提示已发布
        if (!groupId || (opts && opts.memberOf && opts.memberOf.includes(groupId))) {
          data.announcements = [row, ...data.announcements];
          draw();
        }
        toast(t("widgets.posted"));
      });
    }

    async function deleteNotice(id) {
      if (!(await confirmDialog(t("widgets.deleteNotice"), t("widgets.deleteNoticeBody"), t("widgets.delete"), t("settings.cancel")))) return;
      const { error } = await sb.from("gw_announcements").delete().eq("id", id);
      if (error) return toast(t("widgets.postFailed"));
      data.announcements = data.announcements.filter((a) => a.id !== id);
      draw();
    }

    function folderDialog(folder) {
      const dlg = modal(
        folder ? t("home.editFolder") : t("fab.newFolder"),
        `<form class="space-y-4">
          <input name="name" maxlength="40" required value="${esc(folder ? folder.name : "")}" placeholder="${esc(t("home.folderName"))}" class="${cls.input}">
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(t("home.save"))}</button>
          </div>
        </form>`,
      );
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      const input = $("[name=name]", dlg.el);
      input.focus();
      $("form", dlg.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        if (folder) {
          folder.name = name;
          await sb.from("gw_user_folders").update({ name }).eq("id", folder.id);
        } else {
          const { data: created, error } = await sb
            .from("gw_user_folders")
            .insert({ user_id: data.profile.id, name, color: "slate", sort_order: nextSlot(1, 1) })
            .select("id, name, color, sort_order, collapsed")
            .single();
          if (error) return toast(t("home.saveFailed"));
          folders.push(created);
        }
        dlg.close();
        draw();
      });
    }

    async function deleteFolder(fid) {
      const f = folders.find((x) => x.id === fid);
      const ok = await confirmDialog(t("home.deleteFolderTitle"), t("home.deleteFolderBody", { name: f.name }), t("home.delete"), t("home.cancel"));
      if (!ok) return;
      // 文件夹里的 App 回到主画面的空格
      const ids = folderApps(fid);
      folders = folders.filter((x) => x.id !== fid);
      const moved = ids.map((id) => {
        const slot = nextSlot(1, 1);
        layout.set(id, { folder_id: null, sort_order: slot });
        return { module_id: id, folder_id: null, sort_order: slot };
      });
      draw();
      const { error } = await sb.from("gw_user_folders").delete().eq("id", fid);
      if (error) return toast(t("home.saveFailed"));
      await saveApps(moved);
    }

    async function open(id) {
      if (readOnly || editing || Date.now() - lastDragEnd < 300) return;
      const m = modules.get(id);
      data.recent = [id, ...data.recent.filter((x) => x !== id)].slice(0, 5);
      if (m.is_new) m.is_new = false;
      const ok = await openModule(m);
      if (!ok) toast(t("home.openFailed"));
    }

    // ------------------------------------------------------------ 事件（委派）
    let noteTimer;
    root.addEventListener("click", (e) => {
      if (Date.now() - lastDragEnd < 400) return; // 刚拖完，不算点击
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) {
        if (fabOpen && !e.target.closest("[data-fab-toggle]")) ((fabOpen = false), draw());
        return;
      }
      const d = b.dataset;
      if (d.open) return open(d.open);
      if (d.calDay) return editing ? null : calDay(d.calDay);
      if (d.openLink) {
        if (editing || Date.now() - lastDragEnd < 300) return;
        const l = links.find((x) => x.id === d.openLink);
        return l && window.open(l.url, "_blank", "noopener,noreferrer");
      }
      if (d.editLink) return linkDialog(links.find((x) => x.id === d.editLink));
      if (d.removeLink) return removeLink(d.removeLink);
      if (d.folder) return editing ? null : openFolder(d.folder);
      if (d.appMenu) return appMenu(d.appMenu);
      if (d.removeApp) return removeApp(d.removeApp);
      if (d.removeWidget) return removeWidget(d.removeWidget);
      if (d.removeFolder) return deleteFolder(d.removeFolder);
      if (d.resize) return resizeWidget(d.resize);
      if ("post" in d) return postNotice();
      if (d.editNotice) return postNotice(data.announcements.find((a) => a.id === d.editNotice));
      if (d.delNotice) return deleteNotice(d.delNotice);
      if ("fabToggle" in d) return ((fabOpen = !fabOpen), draw());
      if (d.fab) {
        fabOpen = false;
        if (d.fab === "add-widget") sheet = "widgets";
        else if (d.fab === "add-apps") sheet = "apps";
        else if (d.fab === "edit") ((editing = true), (sheet = null));
        else if (d.fab === "new-folder") return draw(), folderDialog(null);
        else if (d.fab === "add-link") return draw(), linkDialog(null);
        return draw();
      }
      if ("done" in d) return ((editing = false), draw());
      if ("closeSheet" in d) return ((sheet = null), draw());
      if (d.add) return addApp(d.add);
      if (d.addWidget) return addWidget(d.addWidget, d.size);
    });
    root.addEventListener("input", (e) => {
      const el = e.target;
      if (el.matches("[data-sheet-search]")) {
        const q = el.value.trim().toLowerCase();
        $$("[data-lib]", root).forEach((x) => x.classList.toggle("hidden", !!q && !x.dataset.name.includes(q)));
      } else if (el.matches("[data-widget-search]")) {
        const q = el.value.trim().toLowerCase();
        const box = el.parentElement.querySelector("[data-search-results]");
        const hits = q ? data.modules.filter((m) => [m.name, m.code, m.description].some((v) => v && v.toLowerCase().includes(q))).slice(0, 6) : [];
        box.innerHTML = q && !hits.length
          ? `<p class="text-sm text-slate-400">${esc(t("home.noResults"))}</p>`
          : hits.map((m) => `<button type="button" data-open="${m.id}" class="no-drag flex shrink-0 flex-col items-center gap-1">${appIcon(m, "size-11")}<span class="w-14 truncate text-center text-[11px]">${esc(m.name)}</span></button>`).join("");
        refreshIcons();
      } else if (el.matches("[data-note]")) {
        // 便条：停止输入一秒后自动保存
        const w = widgets.find((x) => x.id === el.dataset.note);
        w.config = { ...(w.config || {}), text: el.value.slice(0, 2000) };
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id), 1000);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && (sheet || fabOpen || editing)) {
        sheet = null;
        fabOpen = false;
        editing = false;
        draw();
      }
    });

    draw();
  }

  return { render, WIDGETS };
})();
