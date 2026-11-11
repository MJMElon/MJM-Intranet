/* ================================================================
   MJM Intranet — 主画面（像 iPhone 的主画面）
   Notice Board 固定在最上面；下面是固定格子的棋盘，App 图标、小工具、文件夹可以拖到任何空格（手机长按），会自动对齐。
   右下角浮动按钮：Add Widget、Add Apps（把 App 拖到想放的位置）、New Folder、Edit Home Screen。
   位置：App 存 gw_user_layout、文件夹存 gw_user_folders、小工具存 gw_user_widgets，sort_order = 第几格（slot）。
   权限关掉的 App 不显示，但位置记录保留。
   ================================================================ */
window.GWHome = (function () {
  const { sb, t, esc, $, $$, icon, moduleIcon, cls, btn, modal, confirmDialog, toast, openModule, refreshIcons } = GW;

  /* App 图标底色。每个人可以自己选（记在 Notice Board 小工具的 config.icons，不用改数据库）：
       style：calm（预设，柔和低调）/ colorful（原本的多彩）/ 或固定一个颜色（全部图示同一个颜色）
       apps：个别 App 自己指定的颜色（优先） */
  const PALETTE = {
    slate: ["from-slate-400 to-slate-600", "#64748b"],
    blue: ["from-sky-400 to-blue-500", "#3b82f6"],
    teal: ["from-teal-400 to-teal-600", "#0d9488"],
    green: ["from-emerald-400 to-green-600", "#16a34a"],
    amber: ["from-amber-300 to-amber-500", "#f59e0b"],
    rose: ["from-rose-300 to-rose-500", "#f43f5e"],
    violet: ["from-violet-400 to-violet-600", "#7c3aed"],
    graphite: ["from-zinc-500 to-zinc-700", "#3f3f46"],
  };
  const COLORFUL = [
    "from-sky-400 to-blue-600",
    "from-emerald-400 to-green-600",
    "from-teal-400 to-cyan-600",
    "from-indigo-400 to-violet-600",
    "from-amber-400 to-orange-500",
    "from-rose-400 to-pink-600",
    "from-slate-500 to-slate-700",
    "from-lime-400 to-emerald-600",
  ];
  // 预设「calm」：低饱和的几个蓝灰色调
  const CALM = ["from-slate-400 to-slate-600", "from-sky-400 to-sky-600", "from-slate-500 to-slate-700", "from-teal-400 to-teal-600", "from-indigo-300 to-indigo-500"];
  let ICON = { style: "calm", apps: {} };
  const hashOf = (code) => [...String(code)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const tileColor = (code, id) => {
    const own = id && ICON.apps[id];
    if (own && PALETTE[own]) return PALETTE[own][0];
    if (PALETTE[ICON.style]) return PALETTE[ICON.style][0];
    const list = ICON.style === "colorful" ? COLORFUL : CALM;
    return list[hashOf(code) % list.length];
  };

  // 小工具种类与可选大小
  const WIDGETS = {
    greeting: { sizes: ["medium"], icon: "sun" },
    clock: { sizes: ["small", "medium"], icon: "clock" },
    search: { sizes: ["medium"], icon: "search" },
    recent: { sizes: ["small", "medium"], icon: "history" },
    // Notice Board：固定在最上面，只能调大小，不能移动、不能删除，也不能再加第二个
    announcements: { sizes: ["medium", "large"], icon: "megaphone", hidden: true, pinned: true },
    calendar: { sizes: ["small", "medium"], icon: "calendar" },
    weather: { sizes: ["small", "medium"], icon: "cloud-sun" },
    ai: { sizes: ["medium", "large"], icon: "bot" },
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
    // Notice Board 的表情反应：{ announcement_id, emoji, user_id, full_name }
    let reactions = ((opts && opts.reactions) || []).map((r) => ({ ...r }));
    const reactionsOn = !!(opts && Array.isArray(opts.reactions));
    const REACT = [
      ["like", "👍"],
      ["love", "❤️"],
      ["congrats", "🎉"],
    ];
    {
      const ic = ((opts && opts.widgets) || []).find((w) => w.widget_type === "announcements");
      const saved = ic && ic.config && ic.config.icons;
      ICON = { style: (saved && saved.style) || "calm", apps: { ...((saved && saved.apps) || {}) } };
    }
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
      links.filter((l) => !l.folder_id).forEach((l) => items.push({ kind: "link", id: l.id, slot: l.sort_order, w: 1, h: 1 }));
      folders.forEach((f) => items.push({ kind: "folder", id: f.id, slot: f.sort_order, w: 1, h: 1 }));
      widgets.filter((w) => !isPinned(w) && !isFloating(w)).forEach((w) => items.push({ kind: "widget", id: w.id, slot: w.sort_order, w: SIZES[w.size][0], h: SIZES[w.size][1] }));
      return items.sort((a, b) => a.slot - b.slot || a.kind.localeCompare(b.kind));
    }
    const folderLinks = (fid) => links.filter((l) => l.folder_id === fid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    /* 分享给我的文件夹（folder.shared_by = 拥有者）：文件夹、连结、App 都是对方的，我只能看、打开，位置记在 gw_folder_shares；
       里面的 App 只显示我自己也有权限的。自己的文件夹 is_shared = 分享用（可以选分享给谁）。 */
    const sharedApps = new Map(); // 分享给我的文件夹 → 里面的 App（module id）
    const folderApps = (fid) => {
      const f = folders.find((x) => x.id === fid);
      if (f && f.shared_by) return (sharedApps.get(fid) || []).filter((id) => modules.has(id));
      return [...layout.entries()]
        .filter(([id, l]) => l.folder_id === fid && modules.has(id))
        .sort((a, b) => a[1].sort_order - b[1].sort_order)
        .map(([id]) => id);
    };
    async function loadShared() {
      if (readOnly) return;
      const me = data.profile.id;
      const mineRes = await sb.from("gw_user_folders").select("id, is_shared, canvas").eq("user_id", me);
      let shareRes = await sb.from("gw_folder_shares").select("folder_id, sort_order, role").eq("user_id", me);
      if (shareRes.error && /role/.test(shareRes.error.message || "")) shareRes = await sb.from("gw_folder_shares").select("folder_id, sort_order").eq("user_id", me); // 还没套用 role 的资料库：当作可以改
      if (mineRes.error || shareRes.error) return; // 资料库还没更新：没有分享功能，其他照常
      (mineRes.data || []).forEach((r) => Object.assign(folders.find((f) => f.id === r.id) || {}, { is_shared: !!r.is_shared, canvas: r.canvas }));
      const shares = shareRes.data || [];
      if (shares.length) {
        const ids = shares.map((x) => x.folder_id);
        const [fs, ls, ly] = await Promise.all([
          sb.from("gw_user_folders").select("id, user_id, name, color, collapsed, is_shared, canvas").in("id", ids),
          sb.from("gw_user_links").select("*").in("folder_id", ids),
          sb.from("gw_user_layout").select("module_id, folder_id").in("folder_id", ids),
        ]).then((r) => r.map((x) => x.data || []));
        fs.forEach((f) => {
          if (folders.some((x) => x.id === f.id)) return;
          const sh = shares.find((x) => x.folder_id === f.id);
          folders.push({ ...f, shared_by: f.user_id, sort_order: sh ? sh.sort_order : 0, share_role: sh && sh.role ? sh.role : "edit" });
        });
        ls.forEach((l) => !links.some((x) => x.id === l.id) && links.push({ ...l }));
        ly.forEach((l) => sharedApps.set(l.folder_id, [...(sharedApps.get(l.folder_id) || []), l.module_id]));
      }
      draw();
    }

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
      if (sectionsOn && !P) return homeFreeSlot(); // 区块版：My Home 第一个空格
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
        if (f && f.shared_by) return sb.from("gw_folder_shares").update({ sort_order: slot }).eq("folder_id", id).eq("user_id", data.profile.id);
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

    async function moveLinkToFolder(id, fid) {
      const l = links.find((x) => x.id === id);
      if (!l) return;
      const order = fid ? folderLinks(fid).length + 1 : nextSlot(1, 1);
      l.folder_id = fid;
      l.sort_order = order;
      draw();
      const { error } = await sb.from("gw_user_links").update({ folder_id: fid, sort_order: order }).eq("id", id);
      if (error) {
        l.folder_id = null;
        draw();
        toast(t("home.saveFailed"));
      }
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
      let row = { user_id: data.profile.id, widget_type: type, size, sort_order: sectionsOn ? 0 : nextSlot(w, h), config: {} };
      if (sectionsOn) {
        // 区块版：新增的小工具浮在所有区块上面，之后可以拖到任何位置，或拖进某个区块
        // 先把「新增小工具」面板收起来重画（面板打开时页面会多出一块空的 My Home，量到的位置会偏低）
        if (sheet) ((sheet = null), draw());
        row = { ...row, sort_order: 0, config: { pos: newWidgetPos(type, size) } };
      }
      const { data: created, error } = await sb.from("gw_user_widgets").insert(row).select().single();
      if (error) return toast(t("home.saveFailed"));
      widgets.push(created);
      sheet = null;
      draw();
      toast(t("widgets.added"));
      if (!sectionsOn)
        setTimeout(() => {
          const el = root.querySelector(`[data-kind="widget"][data-id="${created.id}"]`);
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
        return `<span class="gw-icon relative flex ${size || "size-14 sm:size-16"} overflow-hidden rounded-[26%] bg-white"><img src="${esc(m.image_url)}" alt="" class="size-full object-cover">${newDot(m)}</span>`;
      return `<span class="gw-icon relative flex ${size || "size-14 sm:size-16"} items-center justify-center rounded-[26%] bg-gradient-to-br ${tileColor(m.code, m.id)} text-white">
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
      const minis = [
        ...ids.map((id) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${tileColor(modules.get(id).code, id)}"></span>`),
        ...folderLinks(f.id).map((l) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${tileColor(l.name)}"></span>`),
      ].slice(0, 9).join("");
      return `<div data-kind="folder" data-id="${f.id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-folder="${f.id}" class="flex flex-col items-center gap-1.5">
          <span class="grid size-14 grid-cols-3 grid-rows-3 content-start gap-1 gw-icon rounded-[26%] border border-white/60 bg-white/50 p-2 backdrop-blur-xl sm:size-16 dark:border-white/10 dark:bg-white/10">${minis}</span>
          <span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(f.name)}</span>
        </button>
        ${editing ? badge(`data-remove-folder="${f.id}"`, "minus", t("home.deleteFolder"), "top-0 left-1/2 -translate-x-[2.4rem]") : ""}
      </div>`;
    }

    // 毛玻璃外观（区块、小工具共用）
    const glassSkin = "rounded-3xl border border-white/60 bg-white/45 shadow-xl shadow-slate-900/10 ring-1 ring-white/40 backdrop-blur-2xl backdrop-saturate-150 ring-inset dark:border-white/10 dark:bg-slate-900/45 dark:ring-white/5";
    const glass = `relative h-full overflow-hidden p-4 ${glassSkin}`;
    const wTitle = (ic, text) => `<div class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">${icon(ic, "size-3.5")}${esc(text)}</div>`;

    // 表情反应：按表情 = 加 / 取消自己的反应；点旁边的数字 = 看是谁按的
    function reactionBar(a) {
      if (!reactionsOn || readOnly) return "";
      return `<div class="no-drag mt-1.5 flex flex-wrap gap-1.5">${REACT.map(([k, e]) => {
        const rs = reactions.filter((r) => r.announcement_id === a.id && r.emoji === k);
        const mine = rs.some((r) => r.user_id === profile.id);
        return `<span class="inline-flex items-center overflow-hidden rounded-full border text-xs ${mine ? "border-brand-500 bg-brand-50 dark:bg-brand-700/20" : "border-slate-200 bg-white/60 dark:border-slate-700 dark:bg-white/5"}">
          <button type="button" data-react="${a.id}:${k}" aria-label="${esc(t("widgets.react." + k))}" title="${esc(t("widgets.react." + k))}" class="px-2 py-0.5 hover:bg-white/70 dark:hover:bg-white/10">${e}</button>
          ${rs.length ? `<button type="button" data-who="${a.id}:${k}" title="${esc(rs.map((r) => r.full_name || "").filter(Boolean).join(", "))}" class="border-l border-slate-200 px-1.5 py-0.5 font-semibold hover:bg-white/70 dark:border-slate-700 dark:hover:bg-white/10">${rs.length}</button>` : ""}
        </span>`;
      }).join("")}</div>`;
    }
    async function toggleReaction(aid, kind) {
      const mine = reactions.find((r) => r.announcement_id === aid && r.emoji === kind && r.user_id === profile.id);
      if (mine) {
        reactions = reactions.filter((r) => r !== mine);
        draw();
        const { error } = await sb.from("gw_notice_reactions").delete().eq("announcement_id", aid).eq("user_id", profile.id).eq("emoji", kind);
        if (error) toast(t("home.saveFailed"));
        return;
      }
      reactions.push({ announcement_id: aid, emoji: kind, user_id: profile.id, full_name: profile.full_name });
      draw();
      const { error } = await sb.from("gw_notice_reactions").insert({ announcement_id: aid, user_id: profile.id, emoji: kind });
      if (error) {
        reactions = reactions.filter((r) => !(r.announcement_id === aid && r.emoji === kind && r.user_id === profile.id));
        draw();
        toast(t("home.saveFailed"));
      }
    }
    // 谁按了这个反应
    function whoReacted(aid, kind) {
      const emoji = REACT.find(([k]) => k === kind)[1];
      const rs = reactions.filter((r) => r.announcement_id === aid && r.emoji === kind);
      const dlg = modal(
        `${emoji} ${t("widgets.react." + kind)}`,
        rs.length
          ? `<ul class="space-y-1.5">${rs.map((r) => `<li class="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"><span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold dark:bg-slate-700">${esc((r.full_name || "?").slice(0, 1))}</span><span class="truncate">${esc(r.full_name || "—")}${r.user_id === profile.id ? ` <span class="text-xs text-slate-400">(${esc(t("widgets.you"))})</span>` : ""}</span></li>`).join("")}</ul>`
          : `<p class="text-sm text-slate-500">${esc(t("widgets.noReactions"))}</p>`,
      );
      return dlg;
    }

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
            <div data-clock class="font-bold tabular-nums ${w.size === "small" ? "text-3xl" : "text-5xl"}">${esc(fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }))}</div>
            <div class="mt-1 text-sm text-slate-500">${esc(fmt({ weekday: "short", day: "numeric", month: "short" }))}</div>
          </div>`;
        case "ai":
          return aiBody();
        case "weather":
          return `<div data-weather="${w.size === "small" ? "small" : "medium"}" class="h-full">${weatherInner(w.size === "small" ? "small" : "medium")}</div>`;
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
                      (a) => `<li class="flex gap-2.5 rounded-xl px-3 py-2 text-sm ${a.level === "warning" ? "bg-amber-100/60 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "bg-white/50 dark:bg-white/5"}">${icon(a.level === "warning" ? "triangle-alert" : "info", `mt-0.5 size-4 shrink-0 ${a.level === "warning" ? "text-amber-500" : "text-sky-500"}`)}<div class="min-w-0 flex-1"><p class="whitespace-pre-line break-words">${esc(a.message)}</p><p class="mt-0.5 text-[11px] text-slate-400">${esc([when(a.starts_at), a.author].filter(Boolean).join(" · "))}</p>${reactionBar(a)}</div>${
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
          return `<div class="mb-1 text-sm font-semibold text-rose-500">${esc(fmt({ month: "long" }))}</div>
            <div class="grid grid-cols-7 gap-y-0.5 text-center ${w.size === "small" ? "text-[10px]" : "text-xs"}">
              ${names.map((n) => `<span class="font-semibold text-slate-400">${esc(n)}</span>`).join("")}
              ${cells.map((d) => `<span class="${d === today ? "mx-auto flex size-5 items-center justify-center rounded-full bg-rose-500 font-bold text-white" : ""}">${d}</span>`).join("")}
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

    function widgetTile(w, p, key) {
      return `<div data-kind="widget" data-id="${w.id}" ${key ? `data-key="${key}"` : ""} class="gw-item relative ${key ? "p-2" : ""}" style="grid-column:${p.c + 1} / span ${p.w};grid-row:${p.r + 1} / span ${p.h}">
        <div class="${glass}">${widgetBody(w)}</div>
        ${editing ? badge(`data-remove-widget="${w.id}"`, "minus", t("widgets.remove"), "-top-2 -left-2") : ""}
        ${editing && WIDGETS[w.widget_type].sizes.length > 1 ? badge(`data-resize="${w.id}"`, "scaling", t("widgets.resize"), "-right-2 -bottom-2") : ""}
      </div>`;
    }

    // Notice Board：固定在最上面、占满整行；区块版拖拉下缘调高度（高度记在这个小工具的 config.height）
    function boardHtml() {
      const w = board();
      if (!w) return "";
      const h = Number(w.config && w.config.height);
      const sized = sectionsOn && h > 0;
      return `<div data-kind="widget" data-id="${w.id}" class="gw-pinned relative ${sectionsOn ? "mx-2 mb-2" : "mb-4"} ${sized ? "" : w.size === "large" ? "h-[22rem]" : "h-[13rem]"}" ${sized ? `style="height:${Math.round(h)}px"` : ""}>
        <div class="${glass}">${widgetBody(w)}</div>
        ${editing && !sectionsOn ? badge(`data-resize="${w.id}"`, "scaling", t("widgets.resize"), "-right-2 -bottom-2") : ""}
        ${sectionsOn && editing ? `<div data-board-resize title="${esc(t("widgets.resize"))}" aria-label="${esc(t("widgets.resize"))}" class="absolute inset-x-0 -bottom-3 z-10 flex h-6 cursor-ns-resize touch-none items-center justify-center"><span class="h-1.5 w-14 rounded-full bg-slate-400/60 shadow backdrop-blur"></span></div>` : ""}
      </div>`;
    }

    // ------------------------------------------------------------ 新增 App / 小工具 面板
    function appsSheet() {
      const onHome = new Set([...layout.keys()].filter((id) => modules.has(id)));
      return `<div class="mb-3 flex items-center justify-between"><h3 class="font-semibold">${esc(t("fab.addApps"))}</h3>${iconBtn("data-close-sheet", t("home.close"), "x")}</div>
        <p class="mb-3 text-xs text-slate-500">${esc(t("fab.addAppsHint"))}</p>
        ${hiddenAppsHtml()}
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
      // 只放四样；图示颜色在编辑模式（长按图示）的「…」选单里
      const items = [
        ["add-widget", "layout-dashboard", t("fab.addWidget")],
        ["add-link", "link", t("fab.addLink")],
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

    // ------------------------------------------------------------ Business 区块（Section box）
    /* 主页 = 上面固定的 Notice Board，下面每个 Business 一个区块（还有「My Home」）：里面是这个人在这个 Business 里有权限的 App。
       区块有三种大小（只看标题 / 第一行 / 全部）；区块里的东西放在格子上（像 iPad 文件夹：图示和名字之间横竖间距一样）。
       长按（或右下角按钮 Edit Home Screen）进入编辑：东西会抖动，才可以拖拉、调整大小、拿掉。 */
    const S = opts && opts.sections ? opts.sections : null;
    const sectionsOn = !!S && !readOnly;
    let sItems = S ? S.items.map((x) => ({ ...x })) : [];
    const expanded = new Map(S ? S.state.map((x) => [x.group_id, !!x.expanded]) : []);
    let companyMenuGid = null; // 打开着 Company 选单的区块
    // 每个区块选的 Company（"all" = 全部）：记在 Notice Board 小工具的 config.companies；没选过就用自己在那个 Business 的 Company
    const companySel = new Map(Object.entries(((opts && opts.widgets) || []).find((w) => w.widget_type === "announcements")?.config?.companies || {}));
    const companiesOf = (gid) => {
      const ids = new Set(S.bizCompanies.filter((x) => x.group_id === gid).map((x) => x.company_id));
      return S.companies.filter((c) => ids.has(c.id));
    };
    const selectedCompany = (gid) => {
      const list = companiesOf(gid);
      if (list.length < 2) return "all"; // 只有一个 Company：不用选，全部显示
      // 一定选一个 Company：自己选过的 → 自己的 Company → 第一个
      const v = companySel.get(gid) || S.myCompany[gid];
      return list.some((c) => c.id === v) ? v : list[0].id;
    };
    // 模块有标 Company 的，只在选了那个 Company（或选全部）时显示；没标 Company 的模块一律显示
    const shownFor = (gid, moduleId) => {
      const sel = selectedCompany(gid);
      if (sel === "all") return true;
      const tags = S.moduleCompanies.filter((x) => x.module_id === moduleId);
      return !tags.length || tags.some((x) => x.company_id === sel);
    };
    const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
    const modsOfGroup = (gid) => {
      const ids = new Set(S.groupModules.filter((x) => x.group_id === gid).map((x) => x.module_id));
      return data.modules.filter((m) => ids.has(m.id));
    };
    // 从区块拿掉的 App：只是这个区块不显示（权限不变），记在 Notice Board 小工具的 config.hidden = { Business id: [模块 id] }；Add Apps 可以放回去
    const boardCfg = () => (board() && board().config) || {};
    const hiddenIn = (gid) => new Set((boardCfg().hidden && boardCfg().hidden[gid]) || []);
    // 区块最上层的东西：有记录的按记录排；还没记录的 App 按默认顺序补在后面
    function boxItems(gid) {
      const mods = new Map(modsOfGroup(gid).map((m) => [m.id, m]));
      const hid = hiddenIn(gid);
      const visible = (mid) => mods.has(mid) && shownFor(gid, mid) && !hid.has(mid);
      const own = sItems.filter((x) => x.group_id === gid && !x.parent_id && (x.kind !== "module" || visible(x.module_id))).sort(bySort);
      const have = new Set(sItems.filter((x) => x.group_id === gid && x.kind === "module").map((x) => x.module_id));
      let n = own.length ? own[own.length - 1].sort_order : 0;
      const extra = [...mods.values()].filter((m) => !have.has(m.id) && visible(m.id)).map((m) => ({ id: "new:" + m.id, virtual: true, group_id: gid, kind: "module", module_id: m.id, parent_id: null, sort_order: ++n }));
      return [...own, ...extra];
    }
    const folderKids = (fid) => sItems.filter((x) => x.parent_id === fid && modules.has(x.module_id) && shownFor(x.group_id, x.module_id)).sort(bySort);

    // ---- 格子：一格 = 一个图示加名字，横竖间距一样（像 iPad 文件夹）
    /* cw / rh：一格的宽和高；lw：名字的宽；icon：图示大小；
       px / pt / pb：区块左右 / 上 / 下的内距，th / tg：标题高度和标题下面的空隙。
       数字是算好的：区块外框（含外面 8px 的空隙）刚好 = 整数格高、宽 = 整数格 + 半格，
       所以区块和页面上的小工具都在同一个格线上，彼此之间的空隙一样（16px）。 */
    const MET = () =>
      matchMedia("(min-width: 640px)").matches
        ? { cw: 104, rh: 110, lw: 80, icon: 64, px: 17, pt: 20, th: 24, tg: 24, pb: 24 }
        : { cw: 88, rh: 94, lw: 72, icon: 56, px: 13, pt: 14, th: 24, tg: 18, pb: 20 };
    // 页面格线：以半格为单位，页面宽度 = 整数个半格（置中）
    const pageGeo = () => {
      const m = MET();
      const hw = m.cw / 2;
      const halves = Math.max(5, Math.floor((root.clientWidth || 1000) / hw));
      return { ...m, hw, halves, width: halves * hw, fit: Math.max(1, Math.floor((halves - 1) / 2)), wide: m.cw > 100 };
    };
    // ---- 区块的大小（几栏、几行）和模式，记在 Notice Board 小工具的 config.layout
    const secLayout = (key) => ({ w: null, h: null, cols: null, rows: null, mode: null, ...((boardCfg().layout && boardCfg().layout[key]) || {}) });
    // 三种大小：title = 只看标题（Business 和 Company 名字）；row = 第一行 App；full = 全部 App
    const modeOf = (key) => (key === "home" ? "full" : secLayout(key).mode || (expanded.get(key) ? "full" : "row"));
    const MODES = ["title", "row", "full"];
    // 先改画面用的资料（马上重画才会看到），再存到数据库
    function setLayout(key, patch) {
      const bw = board();
      if (!bw) return null;
      const layout = { ...(boardCfg().layout || {}), [key]: { ...secLayout(key), ...patch } };
      bw.config = { ...(bw.config || {}), layout };
      return bw;
    }
    async function saveBoardConfig() {
      const bw = board();
      if (!bw) return;
      const { error } = await sb.from("gw_user_widgets").update({ config: bw.config }).eq("id", bw.id);
      if (error) toast(t("home.saveFailed"));
    }
    function saveLayout(key, patch) {
      return setLayout(key, patch) ? saveBoardConfig() : Promise.resolve();
    }

    // ---- 区块里的东西：每个占几格、存的位置（c 栏、r 行；还没存过 = null）
    // My Home 的位置以前存「第几格」（行 × 装置栏数 + 栏），改成跟 Business 区块一样的「行 × 100 + 栏」（config.homeGrid = 2）
    const homeIsV2 = () => boardCfg().homeGrid === 2;
    const decode = (slot, base) => ({ c: Math.max(0, slot || 0) % base, r: Math.floor(Math.max(0, slot || 0) / base) });
    const fwCell = (w) => ({ key: "fw:" + w.id, kind: "fw", id: w.id, w: w.config.pos.w, h: w.config.pos.h, c: w.config.pos.x, r: w.config.pos.y });
    const boxWidgets = (key) => widgets.filter((w) => isFloating(w) && w.config.pos.box === key);
    function boxModel(key) {
      if (key === "home") {
        const base = homeIsV2() ? 100 : cols();
        return rootItems().map((it) => ({ key: it.kind + ":" + it.id, kind: it.kind, id: it.id, w: it.w, h: it.h, ...decode(it.slot, base) })).concat(boxWidgets("home").map(fwCell));
      }
      return boxItems(key)
        .map((it) => ({ key: it.id, kind: it.kind, id: it.id, item: it, w: it.kind === "note" ? 2 : 1, h: 1, ...(it.virtual ? { c: null, r: null } : decode(it.sort_order, 100)) }))
        .concat(boxWidgets(key).map(fwCell));
    }

    /* 把东西排进 n 栏（最多 R 行，R = null 不限）：
       - 存的位置都放得下 → 照存的位置（重叠的往后找空位）
       - 区块被拉小、放不下 → 照阅读顺序（上到下、左到右）往上 / 往左挤；只影响显示，不改存的位置，区块拉大就回到原位 */
    function packInto(items, n, R) {
      const taken = new Set();
      const pos = new Map();
      const fits = (c, r, w, h) => {
        if (c < 0 || c + w > n) return false;
        for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken.has(y * 1000 + x)) return false;
        return true;
      };
      const put = (it, c, r, w, h) => {
        for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) taken.add(y * 1000 + x);
        pos.set(it.key, { c, r, w, h });
      };
      const scan = (it, r0, c0) => {
        const w = Math.min(it.w, n);
        for (let r = r0; ; r++) for (let c = r === r0 ? c0 : 0; c + w <= n; c++) if (fits(c, r, w, it.h)) return put(it, c, r, w, it.h);
      };
      const fixed = items.filter((it) => it.c != null);
      const reflow = fixed.some((it) => it.c + it.w > n || (R && it.r + it.h > R));
      if (reflow) [...fixed].sort((a, b) => a.r - b.r || a.c - b.c).forEach((it) => scan(it, 0, 0));
      else fixed.forEach((it) => (fits(it.c, it.r, Math.min(it.w, n), it.h) ? put(it, it.c, it.r, Math.min(it.w, n), it.h) : scan(it, it.r, it.c)));
      items.filter((it) => it.c == null).forEach((it) => scan(it, 0, 0));
      return { pos, rows: Math.max(1, ...[...pos.values()].map((p) => p.r + p.h)), reflow };
    }
    // 最少要几行：全部东西挤在一起（只看数量，不看位置）
    const minRowsAt = (model, n) => packInto(model.map((it) => ({ ...it, c: null, r: null })), n, null).rows;

    // 区块现在的大小和里面东西的位置（over = 调整大小时的预览）
    function boxGeo(key, over) {
      const g = pageGeo();
      const lay = secLayout(key);
      const model = boxModel(key);
      // 最窄：放得下最宽的东西，而且至少两栏（标题才放得下）
      const minC = Math.min(g.fit, Math.max(2, ...model.map((it) => it.w)));
      let want = lay.cols;
      if (want == null && lay.w > 0 && lay.w < 1) want = Math.floor((lay.w * g.width - g.hw) / g.cw); // 旧版：宽度存比例
      // 手机上区块一律占满整行（并排太挤）；电脑 / 平板才照存的栏数
      const n = over ? over.n : Math.max(minC, Math.min(g.fit, (g.wide && want) || g.fit));
      // 旧版高度存 px（一行 100px）
      const R = over ? over.R : lay.rows != null ? lay.rows : lay.h > 0 ? Math.max(1, Math.round(lay.h / 100)) : null;
      const L = packInto(model, n, R);
      return { g, n, R, rows: Math.max(L.rows, R || 0), fill: n >= g.fit, model, L, minC };
    }

    // ---- 区块外观
    const LABEL = "w-[72px] truncate text-center text-xs font-medium text-slate-700 sm:w-20 dark:text-slate-200";
    // 编辑时图示左上角 / 右上角的小圆钮（对准图示的角）
    const BADGE_L = "top-0 left-[calc(50%-36px)] sm:top-1 sm:left-[calc(50%-40px)]";
    const BADGE_R = "top-0 right-[calc(50%-36px)] sm:top-1 sm:right-[calc(50%-40px)]";
    const cellCss = (p) => `grid-column:${p.c + 1} / span ${p.w};grid-row:${p.r + 1} / span ${p.h}`;
    const folderIcon = (minis) => `<span class="grid size-14 grid-cols-3 grid-rows-3 content-start gap-1 gw-icon rounded-[26%] border border-white/60 bg-white/50 p-2 backdrop-blur-xl sm:size-16 dark:border-white/10 dark:bg-white/10">${minis}</span>`;
    function cellTile({ key, kind, p, btnAttr, iconHtml, label, title, badges }) {
      return `<div data-key="${key}" data-kind="${kind}" style="${cellCss(p)}" class="gw-item relative flex flex-col items-center justify-center ${editing ? "touch-none" : ""}">
        <button type="button" ${btnAttr} class="flex flex-col items-center gap-1.5" ${title ? `title="${esc(title)}"` : ""}>${iconHtml}<span class="${LABEL}">${esc(label)}</span></button>${editing ? badges || "" : ""}</div>`;
    }
    // Business 区块里的一个东西
    function sTile(gid, it, p) {
      if (it.kind === "module") {
        const m = modules.get(it.module_id);
        return cellTile({ key: it.id, kind: "module", p, btnAttr: `data-open="${m.id}" data-gid="${gid}"`, iconHtml: appIcon(m), label: m.name, title: m.description || m.name, badges: badge(`data-hide-mod="${m.id}" data-gid="${gid}"`, "minus", t("home.removeFromSection"), BADGE_L) });
      }
      const del = badge(`data-del-item="${it.id}"`, "minus", t("home.delete"), BADGE_L);
      if (it.kind === "folder") {
        const minis = folderKids(it.id).slice(0, 9).map((k) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${tileColor(modules.get(k.module_id).code, k.module_id)}"></span>`).join("");
        return cellTile({ key: it.id, kind: "folder", p, btnAttr: `data-open-folder="${it.id}"`, iconHtml: folderIcon(minis), label: it.name || "", badges: del });
      }
      // 便条（占两格宽）
      return `<div data-key="${it.id}" data-kind="note" style="${cellCss(p)}" class="gw-item relative flex items-center px-2 sm:px-3 ${editing ? "touch-none" : ""}">
        <button type="button" data-open-note="${it.id}" class="flex h-[78px] w-full flex-col items-start overflow-hidden gw-icon rounded-2xl border border-white/50 bg-amber-200/60 p-3 text-left text-amber-950 backdrop-blur-xl sm:h-[86px] dark:bg-amber-200/70">
          <span class="flex w-full items-center gap-1.5 text-xs font-semibold">${icon("sticky-note", "size-3.5")}<span class="truncate">${esc(it.name || t("home.noteDefault"))}</span></span>
          <span class="mt-1 line-clamp-3 w-full text-xs whitespace-pre-line break-words">${esc(it.body || "")}</span>
        </button>${editing ? badge(`data-del-item="${it.id}"`, "minus", t("home.delete"), "-top-1 left-0") : ""}</div>`;
    }
    // My Home 里的一个东西（App、连结、文件夹、旧版小工具）
    function homeTile(it, p) {
      if (it.kind === "app") {
        const m = modules.get(it.id);
        return cellTile({ key: it.key, kind: "app", p, btnAttr: `data-open="${m.id}"`, iconHtml: appIcon(m), label: m.name, title: m.description || m.name, badges: badge(`data-remove-app="${m.id}"`, "minus", t("home.removeFromHome"), BADGE_L) + badge(`data-app-menu="${m.id}"`, "ellipsis", t("home.cardMenu"), BADGE_R) });
      }
      if (it.kind === "link") {
        const l = links.find((x) => x.id === it.id);
        return cellTile({ key: it.key, kind: "link", p, btnAttr: `data-open-link="${l.id}"`, iconHtml: appIcon({ code: l.name, icon: l.icon, image_url: l.image_url }), label: l.name, title: l.url, badges: badge(`data-remove-link="${l.id}"`, "minus", t("home.removeFromHome"), BADGE_L) + badge(`data-edit-link="${l.id}"`, "pencil", t("home.editLink"), BADGE_R) });
      }
      if (it.kind === "folder") {
        const f = folders.find((x) => x.id === it.id);
        const minis = [...folderApps(f.id).map((id) => tileColor(modules.get(id).code, id)), ...folderLinks(f.id).map((l) => tileColor(l.name))].slice(0, 9).map((c) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${c}"></span>`).join("");
        const shared = f.is_shared || f.shared_by;
        const iconHtml = shared ? `<span class="relative">${folderIcon(minis)}<span title="${esc(t(f.shared_by ? "home.sharedBy" : "home.sharedBadge"))}" class="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-sky-500 text-white ring-2 ring-white dark:ring-slate-900">${icon("users", "size-3")}</span></span>` : folderIcon(minis);
        return cellTile({ key: it.key, kind: "folder", p, btnAttr: `data-folder="${f.id}"`, iconHtml, label: f.name, badges: badge(`data-remove-folder="${f.id}"`, "minus", t(f.shared_by ? "home.leaveShared" : "home.deleteFolder"), BADGE_L) });
      }
      return widgetTile(widgets.find((w) => w.id === it.id), p, it.key);
    }
    const secGrip = () => `<span class="sec-grip flex size-7 cursor-grab touch-none items-center justify-center rounded-lg text-slate-400 hover:bg-white/60 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-white/10" title="${esc(t("home.moveSection"))}" aria-label="${esc(t("home.moveSection"))}">${icon("grip-vertical", "size-4")}</span>`;
    // 区块（各 Business 和 My Home）的先后顺序，记在 Notice Board 小工具的 config.order
    const sectionOrder = () => (Array.isArray(boardCfg().order) ? boardCfg().order : []);
    // 右下角：拖拉调整区块大小（编辑时才有）
    const resizeGrip = (key) => `<span data-sec-resize="${key}" title="${esc(t("home.resizeSection"))}" aria-label="${esc(t("home.resizeSection"))}" class="absolute right-1.5 bottom-1.5 z-20 flex size-6 cursor-nwse-resize touch-none items-end justify-end p-1 text-slate-400 hover:text-slate-600"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M11 1 1 11M11 6 6 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>`;

    // 区块标题列：标题的左边对准第一个图示，右边是拖拉握把（一直显示，按住就能拖，不用先进编辑）和大小按钮
    function boxHead(key, title, B, mode) {
      const { g, n } = B;
      const wrapW = B.fill ? g.width : (2 * n + 1) * g.hw;
      const extra = Math.max(0, Math.round((wrapW - 18 - 2 * g.px - n * g.cw) / 2));
      const side = extra + (g.cw - g.icon) / 2;
      const step = (dir, ic, label, off) => `<button type="button" data-mode="${dir}" aria-label="${esc(label)}" title="${esc(label)}" ${off ? "disabled" : ""} class="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/60 disabled:pointer-events-none disabled:opacity-25 dark:hover:bg-white/10">${icon(ic, "size-4")}</button>`;
      const steps = key === "home" ? "" : step("less", "chevron-up", t("home.collapse"), mode === "title") + step("more", "chevron-down", t("home.expand"), mode === "full");
      return `<div class="flex min-w-0 items-center gap-2" style="height:${g.th}px;${mode === "title" ? "" : `margin-bottom:${g.tg}px;`}padding:0 ${Math.max(0, side - 6)}px 0 ${side}px">
        <h2 class="min-w-0 truncate text-[15px] leading-6 font-semibold tracking-tight text-slate-800 dark:text-slate-100">${esc(title)}</h2>${key === "home" ? "" : companyPicker(key)}
        <div class="ml-auto flex shrink-0 items-center">${sectionsOn ? secGrip() : ""}${steps}</div></div>`;
    }
    // 一个区块（My Home 也一样）：外框宽 = 整数格 + 半格，高 = 整数格
    function boxShell(key, title, B, tiles) {
      const { g, n } = B;
      const mode = modeOf(key);
      const shownRows = mode === "full" ? B.rows : 1;
      const pad = mode === "title" ? `${g.pt + g.tg / 2}px ${g.px}px ${g.pb + g.tg / 2}px` : `${g.pt}px ${g.px}px ${g.pb}px`;
      const body = tiles || `<p class="col-span-full row-start-1 self-center px-3 text-sm text-slate-500">${esc(t("home.noAppsForCompany"))}</p>`;
      const grid =
        mode === "title"
          ? ""
          : `<div data-list="${key}" data-fw-host="${key}" data-cols="${n}" class="relative mx-auto grid ${mode === "row" ? "overflow-hidden" : ""}" style="width:${n * g.cw}px;grid-template-columns:repeat(${n},${g.cw}px);grid-template-rows:repeat(${shownRows},${g.rh}px);grid-auto-rows:${g.rh}px;${mode === "row" ? `height:${g.rh}px;` : ""}">${body}<div data-box-hint class="pointer-events-none hidden rounded-2xl border-2 border-dashed"></div></div>`;
      return `<div data-sec-wrap data-sec-key="${key}" class="p-2" style="width:${B.fill ? "100%" : (2 * n + 1) * g.hw + "px"};max-width:100%">
        <section data-box="${key}" class="relative ${glassSkin} ${companyMenuGid === key ? "z-30" : ""}" style="padding:${pad}">${boxHead(key, title, B, mode)}${grid}${editing && mode !== "title" ? resizeGrip(key) : ""}</section></div>`;
    }
    // 区块里的格子内容（图示 / 便条 / 小工具）
    function boxTiles(key, B) {
      return B.model
        .map((it) => {
          const p = B.L.pos.get(it.key);
          if (it.kind === "fw") return cellWidget(widgets.find((w) => w.id === it.id), p, B.g);
          return key === "home" ? homeTile(it, p) : sTile(key, it.item, p);
        })
        .join("");
    }
    // 区块标题旁边的 Company 选择
    const companyPicker = (gid) => {
      const list = companiesOf(gid);
      if (!list.length) return "";
      // 只有一个 Company：只显示它的名字，不用下拉选单
      if (list.length === 1) return `<span class="inline-flex max-w-[14rem] min-w-0 items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-3.5 shrink-0")}<span class="truncate">${esc(list[0].name)}</span></span>`;
      const sel = selectedCompany(gid);
      const cur = list.find((c) => c.id === sel);
      const label = cur ? cur.short_name || cur.code || cur.name : list[0].name;
      const row = (id, text) => `<button type="button" data-company-pick="${id}" data-gid="${gid}" class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><span class="truncate">${esc(text)}</span>${sel === id ? icon("check", "size-4 text-emerald-600") : ""}</button>`;
      return `<div class="relative min-w-0">
        <button type="button" data-company-menu="${gid}" class="inline-flex max-w-[11rem] items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-3.5 shrink-0")}<span class="truncate">${esc(label)}</span>${icon("chevron-down", "size-3.5 shrink-0")}</button>
        ${companyMenuGid === gid ? `<div class="absolute top-full left-0 z-30 mt-1 max-h-64 w-60 overflow-y-auto rounded-xl border border-white/60 bg-white/90 p-1.5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90">${list.map((c) => row(c.id, c.name)).join("")}</div>` : ""}
      </div>`;
    };

    // ---- 存位置
    // 区块里的 App 记下新位置（还没记过的先建一笔；先改画面再存，不会闪回去）
    function placeInBox(gid, id, slot, parentId) {
      let it = sItems.find((x) => x.id === id);
      if (it) {
        it.sort_order = slot;
        if (parentId !== undefined) it.parent_id = parentId;
        return sb.from("gw_user_section_items").update(parentId !== undefined ? { sort_order: slot, parent_id: parentId } : { sort_order: slot }).eq("id", id).then(({ error }) => error && toast(t("home.saveFailed")));
      }
      const moduleId = id.slice(4);
      it = { id: "tmp:" + moduleId, user_id: data.profile.id, group_id: gid, kind: "module", module_id: moduleId, parent_id: parentId || null, sort_order: slot };
      sItems.push(it);
      return sb
        .from("gw_user_section_items")
        .insert({ user_id: data.profile.id, group_id: gid, kind: "module", module_id: moduleId, parent_id: parentId || null, sort_order: slot })
        .select()
        .single()
        .then(({ data: created, error }) => {
          if (error) return toast(t("home.saveFailed"));
          it.id = created.id;
        });
    }
    // 小工具的位置（格子单位，v = 2）
    function saveWidgetPos(w, pos) {
      w.config = { ...w.config, pos: { box: pos.box || null, x: pos.x, y: pos.y, w: pos.w, h: pos.h, v: 2 } };
      return sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id).then(({ error }) => error && toast(t("home.saveFailed")));
    }
    // 区块里一个东西放到第 c 栏第 r 行
    function saveCell(key, it, c, r) {
      if (it.kind === "fw") return saveWidgetPos(widgets.find((w) => w.id === it.id), { box: key, x: c, y: r, w: it.w, h: it.h });
      if (key === "home") return saveSlot(it.kind, it.id, r * 100 + c);
      return placeInBox(key, it.id, r * 100 + c);
    }
    // 把区块里现在看到的位置全部记下来（区块被拉小、图示被挤过之后，用户真的移动了东西才会这样做）
    function commitBox(key, L, skip) {
      const legacy = key === "home" && !homeIsV2();
      const model = boxModel(key); // 先拿旧的编码解出来的位置，再切换编码
      const saves = [];
      if (legacy && board()) {
        board().config = { ...board().config, homeGrid: 2 };
        saves.push(saveBoardConfig());
      }
      model.forEach((it) => {
        const p = L.pos.get(it.key);
        if (!p || skip.includes(it.key) || (!legacy && it.c === p.c && it.r === p.r)) return;
        saves.push(saveCell(key, it, p.c, p.r));
      });
      return saves;
    }
    // My Home 第一个空格（新增 App / 连结 / 文件夹用）；第一次用时把 My Home 换成新的位置编码
    function homeFreeSlot() {
      let B = boxGeo("home");
      if (!homeIsV2()) (commitBox("home", B.L, []), (B = boxGeo("home")));
      const fake = { key: "__new", w: 1, h: 1, c: null, r: null };
      const L = packInto([...B.model.map((it) => ({ ...it, ...B.L.pos.get(it.key) })), fake], B.n, null);
      const p = L.pos.get("__new");
      return p.r * 100 + p.c;
    }

    // ------------------------------------------------------------ 编辑模式（像 iPhone）：长按进入，东西会抖动；按 Done、点空白处或 Esc 离开
    function setEditing(on) {
      editing = on;
      if (on) ((sheet = null), (fabOpen = false));
      draw();
    }
    let lp = null; // 长按计时
    const LONG_PRESS = 500;
    root.addEventListener("pointerdown", (e) => {
      if (!sectionsOn || editing || e.button !== 0) return;
      const el = e.target.closest(".gw-item, [data-fw], [data-box]");
      if (!el || e.target.closest("input, textarea, select, a, [data-company-menu], [data-mode], .gw-sheet, .sec-grip")) return; // 握把直接拖区块，不算长按
      lp = { x: e.clientX, y: e.clientY, id: e.pointerId };
      lp.timer = setTimeout(() => {
        lp.fired = true;
        lastDragEnd = Date.now();
        setEditing(true);
      }, LONG_PRESS);
    });
    root.addEventListener("pointermove", (e) => {
      if (lp && !lp.fired && e.pointerId === lp.id && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) (clearTimeout(lp.timer), (lp = null));
    });
    const lpEnd = () => {
      if (!lp) return;
      clearTimeout(lp.timer);
      if (lp.fired) lastDragEnd = Date.now(); // 长按放开的那一下不算点击
      lp = null;
    };
    addEventListener("pointerup", lpEnd);
    addEventListener("pointercancel", lpEnd);
    // 编辑中点页面空白处：离开编辑
    document.addEventListener("click", (e) => {
      if (sectionsOn && editing && downOnEmpty && Date.now() - lastDragEnd > 400 && (e.target === document.body || e.target === document.documentElement || e.target.id === "main")) setEditing(false);
    });
    const EDIT_KEEP = "button, a, input, textarea, select, label, .gw-item, [data-fw], .gw-sheet, [data-sec-resize], .sec-grip, [data-board-resize]";
    // 按下去的地方也要是空白处（在按钮上按下、拖到别处放开，不算点空白）
    let downOnEmpty = false;
    document.addEventListener("pointerdown", (e) => (downOnEmpty = !e.target.closest(EDIT_KEEP)), true);

    // ------------------------------------------------------------ 区块里拖东西（编辑时）：放到哪个空格就留在哪；放到文件夹上 = 收进去；两个 1×1 = 交换
    let bdrag = null;
    let bpress = null;
    function boxTarget(e) {
      const { list, key, id, w, h, B } = bdrag;
      const lr = list.getBoundingClientRect();
      const g = B.g;
      const gc = Math.floor((e.clientX - lr.left) / g.cw);
      const gr = Math.max(0, Math.floor((e.clientY - lr.top) / g.rh));
      const maxR = modeOf(key) === "full" ? B.rows : 0; // 只显示第一行时，只能放在第一行；全部显示时可以放到下面新的一行
      const c = Math.max(0, Math.min(B.n - w, gc - bdrag.offC));
      const r = Math.min(Math.max(0, gr - bdrag.offR), maxR);
      const hits = [];
      B.L.pos.forEach((p, k) => k !== id && c < p.c + p.w && c + w > p.c && r < p.r + p.h && r + h > p.r && hits.push(k));
      let action = null;
      if (!hits.length) action = { type: "place", c, r };
      else if (hits.length === 1) {
        const other = B.model.find((x) => x.key === hits[0]);
        const p = B.L.pos.get(hits[0]);
        if (other.kind === "folder" && ["module", "app", "link"].includes(bdrag.kind)) action = { type: "folder", fid: other.id };
        else if (other.kind !== "fw" && w === 1 && h === 1 && p.w === 1 && p.h === 1) action = { type: "swap", key: hits[0], c: p.c, r: p.r };
      }
      return { c, r, action };
    }
    function startBoxDrag(e, el) {
      const list = el.closest("[data-list]");
      const key = list.dataset.list;
      const id = el.dataset.key;
      const B = boxGeo(key);
      const p = B.L.pos.get(id) || { c: 0, r: 0, w: 1, h: 1 };
      const rect = el.getBoundingClientRect();
      bdrag = { el, list, key, id, kind: el.dataset.kind, B, w: p.w, h: p.h, from: p, offC: Math.min(p.w - 1, Math.floor((e.clientX - rect.left) / B.g.cw)), offR: Math.min(p.h - 1, Math.floor((e.clientY - rect.top) / B.g.rh)), dx: e.clientX - rect.left, dy: e.clientY - rect.top, target: null };
      const ghost = el.cloneNode(true);
      ghost.removeAttribute("data-key");
      ghost.style.cssText = `position:fixed;left:0;top:0;width:${rect.width}px;height:${rect.height}px;z-index:60;pointer-events:none;transform:translate(${rect.left}px,${rect.top}px) scale(1.08);opacity:.95;transition:none;margin:0`;
      ghost.className = ghost.className.replace("gw-item", "gw-ghost");
      document.body.appendChild(ghost);
      bdrag.ghost = ghost;
      el.classList.add("opacity-30");
      document.body.classList.add("gw-dragging");
    }
    function moveBoxDrag(e) {
      bdrag.ghost.style.transform = `translate(${e.clientX - bdrag.dx}px,${e.clientY - bdrag.dy}px) scale(1.08)`;
      if (e.clientY < 90) scrollBy(0, -14);
      else if (e.clientY > innerHeight - 90) scrollBy(0, 14);
      bdrag.target = boxTarget(e);
      const hint = $("[data-box-hint]", bdrag.list);
      if (!hint) return;
      const tg = bdrag.target;
      hint.className = `pointer-events-none rounded-2xl border-2 border-dashed ${tg.action ? "border-brand-500/70 bg-brand-500/10" : "border-rose-400/70 bg-rose-400/10"}`;
      hint.style.gridColumn = `${tg.c + 1} / span ${bdrag.w}`;
      hint.style.gridRow = `${tg.r + 1} / span ${bdrag.h}`;
    }
    // 放下：区块被拉小过（图示被挤过）就把现在看到的位置全部记下来；不然只记还没记过的
    function boxDropSaves(d, a) {
      const skip = [d.id, a.type === "swap" ? a.key : null];
      if (d.B.L.reflow || (d.key === "home" && !homeIsV2())) return commitBox(d.key, d.B.L, skip);
      return d.B.model.filter((it) => it.c == null && !skip.includes(it.key)).map((it) => saveCell(d.key, it, d.B.L.pos.get(it.key).c, d.B.L.pos.get(it.key).r));
    }
    async function endBoxDrag(cancelled) {
      const d = bdrag;
      bdrag = null;
      d.ghost.remove();
      d.el.classList.remove("opacity-30");
      document.body.classList.remove("gw-dragging");
      lastDragEnd = Date.now();
      const a = !cancelled && d.target && d.target.action;
      if (!a) return draw();
      const me = d.B.model.find((x) => x.key === d.id);
      const saves = boxDropSaves(d, a);
      if (a.type === "place") {
        saves.push(saveCell(d.key, me, a.c, a.r));
        if (d.B.R && a.r + d.h > d.B.R) saves.push(saveLayout(d.key, { rows: a.r + d.h })); // 放到新的一行：区块跟着长高
      } else if (a.type === "swap") saves.push(saveCell(d.key, me, a.c, a.r), saveCell(d.key, d.B.model.find((x) => x.key === a.key), d.from.c, d.from.r));
      else if (a.type === "folder") {
        if (d.key !== "home") saves.push(placeInBox(d.key, d.id, 0, a.fid));
        else saves.push(me.kind === "link" ? moveLinkToFolder(me.id, a.fid) : moveIntoFolder(me.id, a.fid));
      }
      draw();
      settlePage(true);
      return Promise.all(saves);
    }
    root.addEventListener("pointerdown", (e) => {
      if (!sectionsOn || !editing || bdrag || e.button !== 0) return;
      const el = e.target.closest("[data-list] > .gw-item[data-key]");
      if (!el || e.target.closest(".no-drag")) return;
      bpress = { el, x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    root.addEventListener("pointermove", (e) => {
      if (bdrag) return moveBoxDrag(e);
      if (!bpress || e.pointerId !== bpress.id) return;
      if (Math.hypot(e.clientX - bpress.x, e.clientY - bpress.y) > 8) (startBoxDrag(e, bpress.el), moveBoxDrag(e), (bpress = null));
    });
    const boxUp = (e) => {
      bpress = null;
      if (bdrag) endBoxDrag(e.type === "pointercancel");
    };
    root.addEventListener("pointerup", boxUp);
    root.addEventListener("pointercancel", boxUp);
    addEventListener("pointerup", (e) => bdrag && boxUp(e));
    document.addEventListener("touchmove", (e) => bdrag && e.preventDefault(), { passive: false });

    // ------------------------------------------------------------ 区块右下角：拖拉调整大小（编辑时）
    /* 宽度按整数栏、高度按整数行吸附。最小 = 放得下全部东西的格数（只看数量）；
       比存的位置小时，里面的东西照顺序往上 / 往左挤（只是显示）；拉大回来就回到原位。
       放开后：区块盖到的页面小工具搬到区块下面（存起来）。 */
    function previewBox(key, wrap, list, n, R) {
      const B = boxGeo(key, { n, R });
      const g = B.g;
      wrap.style.width = B.fill ? "100%" : (2 * n + 1) * g.hw + "px";
      if (!list) return;
      list.dataset.cols = n;
      list.style.width = n * g.cw + "px";
      list.style.gridTemplateColumns = `repeat(${n},${g.cw}px)`;
      list.style.gridTemplateRows = `repeat(${R > 1 || modeOf(key) === "full" ? B.rows : 1},${g.rh}px)`;
      if (R > 1) ((list.style.height = ""), list.classList.remove("overflow-hidden"));
      $$("[data-key]", list).forEach((el) => {
        const p = B.L.pos.get(el.dataset.key);
        if (p) ((el.style.gridColumn = `${p.c + 1} / span ${p.w}`), (el.style.gridRow = `${p.r + 1} / span ${p.h}`));
      });
    }
    root.addEventListener("pointerdown", (e) => {
      const grab = e.target.closest("[data-sec-resize]");
      if (!grab || e.button !== 0 || !editing) return;
      e.preventDefault();
      const key = grab.dataset.secResize;
      const wrap = grab.closest("[data-sec-wrap]");
      const list = $("[data-list]", wrap);
      const B0 = boxGeo(key);
      const g = B0.g;
      const start = wrap.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      let n = B0.n;
      let R = modeOf(key) === "full" ? B0.rows : 1;
      document.body.classList.add("gw-dragging");
      const move = (ev) => {
        if (g.wide) n = Math.max(B0.minC, Math.min(g.fit, Math.round((start.width + ev.clientX - sx - g.hw) / g.cw)));
        R = Math.max(minRowsAt(B0.model, n), Math.round((start.height + ev.clientY - sy) / g.rh) - 1);
        previewBox(key, wrap, list, n, R);
      };
      const up = async () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        removeEventListener("pointercancel", up);
        document.body.classList.remove("gw-dragging");
        lastDragEnd = Date.now();
        // 手机上只改高度，不动电脑 / 平板存的栏数
        const patch = g.wide ? { cols: n >= g.fit ? null : n, rows: R, w: null, h: null } : { rows: R };
        if (key !== "home" && modeOf(key) !== "full" && R > 1) {
          patch.mode = "full";
          expanded.set(key, true);
          sb.from("gw_user_sections").upsert({ user_id: data.profile.id, group_id: key, expanded: true });
        }
        if (key !== "home" && modeOf(key) !== "full" && R <= 1) delete patch.rows;
        setLayout(key, patch);
        const saving = saveLayout(key, patch);
        draw();
        await Promise.all([saving, ...settlePage(true)]);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
    });

    // 区块（My Home 和各 Business）用握把拖着换位置（不用进编辑，按住握把马上可以拖）：上下左右都可以。
    // 放开前一直照鼠标位置找最近的区块：压在哪个区块上就排在它前面或后面（窄的区块看左右，整行宽的看上下），空白处找最近的。
    root.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest(".sec-grip");
      if (!grip || e.button !== 0 || readOnly || !sectionsOn) return;
      const stack = $("#gw-stack", root);
      const wrap = grip.closest("[data-sec-wrap]");
      if (!stack || !wrap) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      let ghost = null;
      let moved = false;
      const dist = (r, x, y) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const place = (x, y) => {
        const mine = wrap.getBoundingClientRect();
        if (x >= mine.left && x <= mine.right && y >= mine.top && y <= mine.bottom) return; // 还在自己的位置上
        const others = $$("[data-sec-wrap]", stack).filter((el) => el !== wrap);
        if (!others.length) return;
        let target = others[0];
        let best = Infinity;
        for (const el of others) {
          const d = dist(el.getBoundingClientRect(), x, y);
          if (d < best) ((best = d), (target = el));
        }
        const r = target.getBoundingClientRect();
        const narrow = r.width < stack.clientWidth * 0.8;
        const before = y < r.top ? true : y > r.bottom ? false : narrow ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
        if (before) {
          if (target.previousElementSibling !== wrap) stack.insertBefore(wrap, target);
        } else if (target.nextElementSibling !== wrap) stack.insertBefore(wrap, target.nextElementSibling);
      };
      if (lp) (clearTimeout(lp.timer), (lp = null));
      lastDragEnd = Date.now(); // 按握把放开的那一下不算点击（不会打开 App、不会离开编辑）
      // 手指拖握把时不要捲动页面
      const noScroll = (ev) => ev.cancelable && ev.preventDefault();
      document.addEventListener("touchmove", noScroll, { passive: false });
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        if (!moved) {
          moved = true;
          document.body.classList.add("gw-dragging");
          ghost = wrap.cloneNode(true);
          ghost.removeAttribute("data-sec-wrap");
          ghost.querySelectorAll("[data-fw-host], [data-list], [data-box]").forEach((el) => (el.removeAttribute("data-fw-host"), el.removeAttribute("data-list"), el.removeAttribute("data-box")));
          ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;z-index:80;pointer-events:none;opacity:.88;transform:scale(.98);filter:drop-shadow(0 18px 30px rgba(15,23,42,.25))`;
          document.body.appendChild(ghost);
          wrap.style.opacity = "0.3";
        }
        ghost.style.left = rect.left + ev.clientX - sx + "px";
        ghost.style.top = rect.top + ev.clientY - sy + "px";
        if (ev.clientY < 90) scrollBy(0, -16);
        else if (ev.clientY > innerHeight - 90) scrollBy(0, 16);
        place(ev.clientX, ev.clientY);
      };
      const up = async () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        removeEventListener("pointercancel", up);
        document.removeEventListener("touchmove", noScroll);
        document.body.classList.remove("gw-dragging");
        lastDragEnd = Date.now();
        if (!moved) return;
        ghost.remove();
        wrap.style.opacity = "";
        const order = $$("[data-sec-wrap]", stack).map((el) => el.dataset.secKey);
        if (order.join() === sectionOrder().join()) return;
        const w = board();
        if (!w) return;
        w.config = { ...(w.config || {}), order };
        const saving = saveBoardConfig();
        draw();
        await Promise.all([saving, ...settlePage(true)]);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
    });
    // 窗口宽度变了、格线跟着变时重画
    let lastGeo = "";
    const geoSig = () => (sectionsOn ? [pageGeo().halves, MET().cw].join(",") : "");
    addEventListener("resize", () => {
      if (!sectionsOn || geoSig() === lastGeo) return;
      lastGeo = geoSig();
      draw();
    });

    // ------------------------------------------------------------ 小工具：放在页面上（任何空位）或放进某个区块（占区块里的格子）
    /* 位置用格子算（config.pos.v = 2）：
       区块里：x / y = 第几栏 / 第几行，w / h = 几栏 / 几行；
       页面上：x = 第几个半格（才能贴着区块的边），y = 第几行（从区块最上面算），w / h = 几栏 / 几行。
       高度一定是整数行，同一排的小工具上缘、下缘对齐，彼此之间的空隙都一样。 */
    const isFloating = (w) => !!(w && w.config && w.config.pos);
    const pageWidgets = () => widgets.filter((w) => isFloating(w) && !w.config.pos.box);
    const CELLS = { small: [2, 2], medium: [4, 2], large: [4, 4] };
    const CELLS_BY_TYPE = { calendar: { small: [2, 2], medium: [3, 2] }, ai: { medium: [4, 4], large: [6, 6] } };
    const MIN_ROWS = { ai: 3 };
    const cellsFor = (type, size) => (CELLS_BY_TYPE[type] && CELLS_BY_TYPE[type][size]) || CELLS[size] || [4, 2];
    // 旧版的位置是 px（一格 104 × 100）：读的时候换成格子，不改数据库（下次移动时才存新的）
    const OLD_W = 104;
    const OLD_H = 100;
    let migrated = false;
    function migratePos(w) {
      const p = w.config.pos;
      if (p.v === 2) return;
      const cw = (v) => Math.max(1, Math.round(v / OLD_W));
      const ch = (v) => Math.max(1, Math.round(v / OLD_H));
      const down = (v) => Math.max(0, Math.ceil(v - 0.5)); // 刚好一半时往上靠
      let np;
      if (p.box) np = { box: p.box, x: down(p.x / OLD_W), y: down(p.y / OLD_H), w: cw(p.w), h: ch(p.h) };
      else {
        // 以前 y 从整个主画面最上面算（含 Notice Board），x 从格线左边算（g = 1）或从页面左边算
        const bw = board();
        const top = (bw && Number(bw.config && bw.config.height)) || (bw && bw.size === "large" ? 352 : 208);
        const oldOff = Math.max(0, Math.round(((root.clientWidth || 1000) - Math.floor(((root.clientWidth || 1000) - 48) / OLD_W) * OLD_W) / 2));
        np = { box: null, x: down((p.g ? p.x : p.x - oldOff) / (OLD_W / 2)), y: down((p.y - top - 16) / OLD_H), w: cw(p.w), h: ch(p.h) };
      }
      w.config = { ...w.config, pos: { ...np, v: 2 } };
      migrated = true;
    }
    function fwInner(w, p, inset) {
      const size = p.w <= 2 ? "small" : p.h >= 4 && p.w >= 4 ? "large" : "medium";
      const at = `top:${inset - 8}px;left:${inset - 8}px`;
      return `<div class="gw-fw-body h-full"><div class="${glass.replace("bg-white/45", "bg-white/80").replace("dark:bg-slate-900/45", "dark:bg-slate-900/80")} ${editing ? "cursor-grab" : ""} p-3!">${widgetBody({ ...w, size })}</div></div>
        ${editing ? `<button type="button" data-remove-fw="${w.id}" aria-label="${esc(t("widgets.remove"))}" title="${esc(t("widgets.remove"))}" class="no-drag absolute z-10 flex size-6 items-center justify-center rounded-full bg-slate-700/90 text-white shadow ring-2 ring-white dark:ring-slate-900" style="${at}">${icon("x", "size-3.5")}</button>
        <span data-fw-resize title="${esc(t("widgets.resize"))}" class="no-drag absolute z-10 flex size-6 cursor-nwse-resize touch-none items-end justify-end p-1 text-slate-400 hover:text-slate-600" style="right:${inset + 2}px;bottom:${inset + 2}px"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M11 1 1 11M11 6 6 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>` : ""}`;
    }
    // 区块里的小工具：占整数格，四边留跟图示一样的空隙
    function cellWidget(w, p, g) {
      const inset = (g.cw - g.lw) / 2;
      return `<div data-fw="${w.id}" data-key="fw:${w.id}" class="gw-fw relative ${editing ? "touch-none" : ""}" style="${cellCss(p)};padding:${inset}px">${fwInner(w, { w: p.w, h: p.h }, inset)}</div>`;
    }
    // 页面上的小工具（位置之后由 settlePage 摆好）
    function pageWidget(w, g) {
      const p = w.config.pos;
      return `<div data-fw="${w.id}" class="gw-fw absolute p-2 ${editing ? "touch-none" : ""}" style="left:${p.x * g.hw}px;top:${p.y * g.rh}px;width:${p.w * g.cw}px;height:${p.h * g.rh}px">${fwInner(w, p, 8)}</div>`;
    }

    // ---- 页面上的摆放（单位：横 = 半格，竖 = 行）
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const wRect = (p) => ({ x: p.x, y: p.y, w: p.w * 2, h: p.h });
    const shown = new Map(); // 页面小工具现在显示的位置（被区块盖到时会暂时挪开）
    const shownOf = (w) => shown.get(w.id) || w.config.pos;
    function boxRectsPage() {
      const page = $("#gw-page", root);
      if (!page) return [];
      const g = pageGeo();
      const pr = page.getBoundingClientRect();
      return $$("[data-sec-wrap]", page).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round((r.left - pr.left) / g.hw), y: Math.round((r.top - pr.top) / g.rh), w: Math.max(1, Math.round(r.width / g.hw)), h: Math.max(1, Math.ceil(r.height / g.rh - 0.05)) };
      });
    }
    // 第一个放得下的空位：从第 y0 行开始，由左到右、由上到下
    function pageFree(w, h, blocks, y0) {
      const g = pageGeo();
      const W = Math.max(1, Math.min(w, Math.floor(g.halves / 2)));
      for (let y = y0 || 0; y < 400; y++) for (let x = 0; x + 2 * W <= g.halves; x++) if (!blocks.some((b) => hit({ x, y, w: 2 * W, h }, b))) return { x, y, w: W, h };
      return { x: 0, y: 400, w: W, h };
    }
    // 离 (x, y) 最近的空位
    function pageNear(x, y, w, h, blocks) {
      const g = pageGeo();
      const ok = (cx, cy) => cx >= 0 && cy >= 0 && cx + 2 * w <= g.halves && !blocks.some((b) => hit({ x: cx, y: cy, w: 2 * w, h }, b));
      for (let k = 0; k <= 40; k++)
        for (let dy = -k; dy <= k; dy++)
          for (let dx = -2 * k; dx <= 2 * k; dx++) {
            if (Math.max(Math.abs(dx) / 2, Math.abs(dy)) < k - 0.5 && k) continue;
            if (ok(x + dx, y + dy)) return { x: x + dx, y: y + dy };
          }
      return pageFree(w, h, blocks, 0);
    }
    const blocksExcept = (id) => [...boxRectsPage(), ...pageWidgets().filter((o) => o.id !== id).map((o) => wRect(shownOf(o)))];
    // 同一排（上下范围有重叠）的小工具：能对齐就对齐成一样的上缘、下缘
    function alignTo(ids, top, bottom) {
      const changed = [];
      const boxes = boxRectsPage();
      ids.forEach((id) => {
        const w = widgets.find((x) => x.id === id);
        const cur = shownOf(w);
        const p = { ...cur, y: top, h: bottom - top };
        if (p.h < (MIN_ROWS[w.widget_type] || 1) || (p.y === cur.y && p.h === cur.h)) return;
        const others = pageWidgets().filter((o) => o.id !== id).map((o) => wRect(shownOf(o)));
        if ([...boxes, ...others].some((b) => hit(wRect(p), b))) return;
        shown.set(id, p);
        changed.push(id);
      });
      return changed;
    }
    const overlapsRows = (a, b) => a.y < b.y + b.h && a.y + a.h > b.y;
    // mode：drop = 放下的跟旁边的对齐；resize = 旁边的跟着改大小的对齐；all = 每一排各自对齐
    function alignBand(leadId, mode) {
      const list = pageWidgets();
      if (mode === "all") {
        const done = new Set();
        const changed = [];
        [...list].sort((a, b) => shownOf(a).y - shownOf(b).y).forEach((w) => {
          if (done.has(w.id)) return;
          const band = [w];
          for (let i = 0; i < band.length; i++) list.forEach((o) => !band.includes(o) && overlapsRows(shownOf(o), shownOf(band[i])) && band.push(o));
          band.forEach((o) => done.add(o.id));
          if (band.length < 2) return;
          const top = Math.min(...band.map((o) => shownOf(o).y));
          const bottom = Math.max(...band.map((o) => shownOf(o).y + shownOf(o).h));
          changed.push(...alignTo(band.map((o) => o.id), top, bottom));
        });
        return changed;
      }
      const lead = shownOf(widgets.find((w) => w.id === leadId));
      const band = list.filter((o) => o.id !== leadId && overlapsRows(shownOf(o), lead));
      if (!band.length) return [];
      if (mode === "resize") return alignTo(band.map((o) => o.id), lead.y, lead.y + lead.h);
      const top = Math.min(...band.map((o) => shownOf(o).y));
      const bottom = Math.max(...band.map((o) => shownOf(o).y + shownOf(o).h));
      return alignTo([leadId, ...band.map((o) => o.id)], top, bottom);
    }
    // 把显示的位置套到画面上
    function applyShown() {
      const page = $("#gw-page", root);
      if (!page) return;
      const g = pageGeo();
      let bottom = 0;
      pageWidgets().forEach((w) => {
        const p = shownOf(w);
        bottom = Math.max(bottom, p.y + p.h);
        const el = $(`#gw-float [data-fw="${w.id}"]`, root);
        if (el) Object.assign(el.style, { left: p.x * g.hw + "px", top: p.y * g.rh + "px", width: p.w * g.cw + "px", height: p.h * g.rh + "px" });
      });
      page.style.minHeight = bottom * g.rh + "px";
    }
    // 显示的位置存起来（只存有变的）
    function commitShown(ids) {
      return pageWidgets()
        .filter((w) => (!ids || ids.includes(w.id)) && shown.has(w.id))
        .filter((w) => ["x", "y", "w", "h"].some((k) => shown.get(w.id)[k] !== w.config.pos[k]) || w.config.pos.v !== 2)
        .map((w) => saveWidgetPos(w, { ...shown.get(w.id), box: null }));
    }
    /* 画完之后摆好页面上的小工具：被区块盖到的搬到那个区块下面第一个空位（由左到右，保持原来的先后）。
       save = true（区块被调整过）：搬过的存起来；false（只是打开页面）：只改显示。回传存档的 promise。 */
    function settlePage(save) {
      if (!$("#gw-page", root)) return [];
      const g = pageGeo();
      const boxes = boxRectsPage();
      const placed = [];
      shown.clear();
      [...pageWidgets()]
        .sort((a, b) => a.config.pos.y - b.config.pos.y || a.config.pos.x - b.config.pos.x)
        .forEach((w) => {
          let p = { ...w.config.pos };
          p.w = Math.max(1, Math.min(p.w, Math.floor(g.halves / 2)));
          p.x = Math.max(0, Math.min(p.x, g.halves - 2 * p.w));
          const under = boxes.filter((b) => hit(wRect(p), b));
          if (under.length || placed.some((b) => hit(wRect(p), b))) {
            const y0 = under.length ? Math.max(...under.map((b) => b.y + b.h)) : p.y;
            p = { ...p, ...pageFree(p.w, p.h, [...boxes, ...placed], y0) };
          }
          placed.push(wRect(p));
          shown.set(w.id, p);
        });
      // 旧版位置换过来后，同一排的先对齐（只改记忆中的资料，下次移动时才存）
      if (migrated) {
        migrated = false;
        alignBand(null, "all").forEach((id) => {
          const w = widgets.find((x) => x.id === id);
          w.config = { ...w.config, pos: { ...w.config.pos, y: shown.get(id).y, h: shown.get(id).h } };
        });
      }
      applyShown();
      return save ? commitShown() : [];
    }
    // 整理页面上的小工具：照原来的上下左右顺序重新排整齐，同一排对齐
    async function tidyWidgets() {
      const list = [...pageWidgets()].sort((a, b) => shownOf(a).y - shownOf(b).y || shownOf(a).x - shownOf(b).x);
      if (!list.length) return toast(t("home.nothingToTidy"));
      const boxes = boxRectsPage();
      const placed = [];
      list.forEach((w) => {
        const p = shownOf(w);
        const s = pageFree(p.w, p.h, [...boxes, ...placed], 0);
        shown.set(w.id, { ...p, ...s });
        placed.push(wRect(shown.get(w.id)));
      });
      alignBand(null, "all");
      applyShown();
      const results = await Promise.all(commitShown());
      if (results.some((r) => r && r.error)) toast(t("home.saveFailed"));
    }
    // 新增的小工具放在页面上第一个空位
    function newWidgetPos(type, size) {
      const [w, h] = cellsFor(type, size);
      const blocks = [...boxRectsPage(), ...pageWidgets().map((o) => wRect(shownOf(o)))];
      return { box: null, ...pageFree(w, h, blocks, 0), v: 2 };
    }

    // ---- 拖小工具（编辑时）：放在页面上 = 最近的空位、跟同一排对齐；放在区块上 = 那个区块里最近的空格
    async function dropOnPage(w, r) {
      const g = pageGeo();
      const pr = $("#gw-page", root).getBoundingClientRect();
      const pw = Math.max(1, Math.min(w.config.pos.w, Math.floor(g.halves / 2)));
      const ph = w.config.pos.h;
      w.config = { ...w.config, pos: { ...w.config.pos, box: null, w: pw, h: ph, x: 0, y: 9999 } }; // 先移出原来的地方
      draw();
      const x = Math.max(0, Math.min(g.halves - 2 * pw, Math.round((r.left - pr.left) / g.hw)));
      const y = Math.max(0, Math.round((r.top - pr.top) / g.rh));
      const spot = pageNear(x, y, pw, ph, blocksExcept(w.id));
      shown.set(w.id, { x: spot.x, y: spot.y, w: pw, h: ph });
      const changed = alignBand(w.id, "drop");
      applyShown();
      await Promise.all(commitShown([w.id, ...changed]));
    }
    async function dropInBox(w, key, r) {
      let list = $(`[data-list="${key}"]`, root);
      if (!list || modeOf(key) !== "full") {
        // 放进收起的区块：先展开，才看得到
        expanded.set(key, true);
        setLayout(key, { mode: "full" });
        sb.from("gw_user_sections").upsert({ user_id: data.profile.id, group_id: key, expanded: true });
        saveBoardConfig();
        draw();
        list = $(`[data-list="${key}"]`, root);
      }
      const B = boxGeo(key);
      const lr = list.getBoundingClientRect();
      const pw = Math.min(w.config.pos.w, B.n);
      const ph = w.config.pos.h;
      const me = "fw:" + w.id;
      const others = B.model.filter((it) => it.key !== me).map((it) => ({ ...it, ...B.L.pos.get(it.key) }));
      const c0 = Math.max(0, Math.min(B.n - pw, Math.round((r.left - lr.left) / B.g.cw)));
      const r0 = Math.max(0, Math.round((r.top - lr.top) / B.g.rh));
      // 从放下的地方往后（由左到右、由上到下）找第一个空格
      const taken = (c, rr) => others.some((o) => c < o.c + o.w && c + pw > o.c && rr < o.r + o.h && rr + ph > o.r);
      let spot = null;
      for (let rr = r0; !spot && rr < r0 + 60; rr++) for (let c = rr === r0 ? c0 : 0; !spot && c + pw <= B.n; c++) if (!taken(c, rr)) spot = { c, r: rr };
      // 区块被拉小过：现在看到的位置全部记下来；不然只记还没记过位置的 App（才不会被小工具挤走）
      const saves = B.L.reflow || (key === "home" && !homeIsV2()) ? commitBox(key, B.L, [me]) : others.filter((it) => B.model.find((m) => m.key === it.key).c == null).map((it) => saveCell(key, it, it.c, it.r));
      saves.push(saveWidgetPos(w, { box: key, x: spot.c, y: spot.r, w: pw, h: ph }));
      if (B.R && spot.r + ph > B.R) saves.push(saveLayout(key, { rows: spot.r + ph }));
      draw();
      saves.push(...settlePage(true));
      await Promise.all(saves);
    }
    // 拖拉调整小工具大小：放开时吸附到整数格；同一排的跟着对齐
    async function resizeWidgetEnd(w, el) {
      const g = pageGeo();
      const p = w.config.pos;
      const nw = Math.max(1, Math.round(el.getBoundingClientRect().width / g.cw));
      const nh = Math.max(MIN_ROWS[w.widget_type] || 1, Math.round(el.getBoundingClientRect().height / g.rh));
      if (p.box) {
        const B = boxGeo(p.box);
        const at = B.L.pos.get("fw:" + w.id) || { c: p.x, r: p.y };
        const cw = Math.min(nw, B.n);
        const clash = B.model.some((it) => it.key !== "fw:" + w.id && (() => { const o = B.L.pos.get(it.key); return at.c < o.c + o.w && at.c + cw > o.c && at.r < o.r + o.h && at.r + nh > o.r; })());
        const saves = B.L.reflow ? commitBox(p.box, B.L, ["fw:" + w.id]) : [];
        // 压到别的东西：放到区块里第一个放得下的空格
        const fixedPos = clash ? null : { c: at.c, r: at.r };
        if (!fixedPos) {
          const others = B.model.filter((it) => it.key !== "fw:" + w.id).map((it) => ({ ...it, ...B.L.pos.get(it.key) }));
          const L = packInto([...others, { key: "me", w: cw, h: nh, c: null, r: null }], B.n, null);
          Object.assign(at, L.pos.get("me"));
        }
        saves.push(saveWidgetPos(w, { box: p.box, x: at.c, y: at.r, w: cw, h: nh }));
        if (B.R && at.r + nh > B.R) saves.push(saveLayout(p.box, { rows: at.r + nh }));
        draw();
        saves.push(...settlePage(true));
        return Promise.all(saves);
      }
      const cur = shownOf(w);
      const W = Math.min(nw, Math.floor(g.halves / 2));
      const blocks = blocksExcept(w.id);
      let spot = { x: Math.min(cur.x, g.halves - 2 * W), y: cur.y };
      if (blocks.some((b) => hit({ x: spot.x, y: spot.y, w: 2 * W, h: nh }, b))) spot = pageNear(spot.x, spot.y, W, nh, blocks);
      shown.set(w.id, { x: spot.x, y: spot.y, w: W, h: nh });
      const changed = alignBand(w.id, "resize");
      const saves = commitShown([w.id, ...changed]); // 先存（会改记忆中的位置），再重画
      draw();
      await Promise.all(saves);
    }
    root.addEventListener("pointerdown", (e) => {
      const fw = e.target.closest("[data-fw]");
      if (!fw || e.button !== 0 || readOnly || !editing) return;
      const resizing = !!e.target.closest("[data-fw-resize]");
      if (!resizing && e.target.closest(".no-drag, button, input, textarea, select, a")) return;
      const w = widgets.find((x) => x.id === fw.dataset.fw);
      if (!w) return;
      e.preventDefault();
      const rect = fw.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      if (resizing) {
        document.body.classList.add("gw-dragging");
        fw.style.zIndex = "50";
        const move = (ev) => {
          fw.style.width = Math.max(pageGeo().cw, rect.width + ev.clientX - sx) + "px";
          fw.style.height = Math.max(pageGeo().rh, rect.height + ev.clientY - sy) + "px";
          if (fw.style.gridColumn) ((fw.style.gridColumn = ""), (fw.style.gridRow = ""), (fw.style.position = "absolute"), (fw.style.left = fw.offsetLeft + "px"));
        };
        const up = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
          removeEventListener("pointercancel", up);
          document.body.classList.remove("gw-dragging");
          lastDragEnd = Date.now();
          resizeWidgetEnd(w, fw);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
        addEventListener("pointercancel", up);
        return;
      }
      e.stopPropagation();
      if (lp) (clearTimeout(lp.timer), (lp = null));
      lastDragEnd = Date.now(); // 按握把放开的那一下不算点击（不会打开 App、不会离开编辑）
      // 手指拖握把时不要捲动页面
      const noScroll = (ev) => ev.cancelable && ev.preventDefault();
      document.addEventListener("touchmove", noScroll, { passive: false });
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        if (!moved) {
          moved = true;
          // 拖的时候搬到 body 底下（区块有毛玻璃，里面的 fixed 位置会跑掉）
          fw.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:70;padding:${getComputedStyle(fw).padding}`;
          document.body.appendChild(fw);
          document.body.classList.add("gw-dragging");
        }
        fw.style.left = rect.left + ev.clientX - sx + "px";
        fw.style.top = rect.top + ev.clientY - sy + "px";
        if (ev.clientY < 90) scrollBy(0, -14);
        else if (ev.clientY > innerHeight - 90) scrollBy(0, 14);
      };
      const up = (ev) => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        removeEventListener("pointercancel", up);
        document.body.classList.remove("gw-dragging");
        lastDragEnd = Date.now();
        if (!moved) return;
        const r = fw.getBoundingClientRect();
        fw.remove();
        // 放在哪个区块上面：那个区块；都不是 = 页面上
        const sec = $$("[data-box]", root).find((s) => {
          const b = s.getBoundingClientRect();
          return ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom;
        });
        if (sec) return dropInBox(w, sec.dataset.box, r);
        dropOnPage(w, r);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
    });
    const drawSections = () => draw();

    // ------------------------------------------------------------ AI 助手：聊天问资料、要报表，报表可以直接下载（Excel / CSV）
    /* 问题送到 Edge Function gw-ai-chat；它用这个人自己的权限查资料。
       聊天记录只在这台装置记文字（最近 30 则）；报表的资料只留在这次打开的页面，重新整理后要再问一次才能下载。 */
    const AI_KEY = "gw_ai_chat_" + profile.id;
    let aiMsgs = [];
    try {
      aiMsgs = JSON.parse(localStorage.getItem(AI_KEY) || "[]").filter((m) => m && typeof m.text === "string");
    } catch (e) {
      /* 忽略 */
    }
    let aiBusy = false;
    let aiDraft = "";
    const aiSave = () => {
      try {
        localStorage.setItem(AI_KEY, JSON.stringify(aiMsgs.slice(-30).map((m) => ({ role: m.role, text: m.text, reports: (m.reports || []).map((r) => ({ id: r.id, title: r.title, total: r.total })) }))));
      } catch (e) {
        /* 忽略 */
      }
    };
    // 简单的 markdown：表格、列表、粗体、行内代码
    function mdLite(text) {
      const inline = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, '<code class="rounded bg-slate-200/70 px-1 dark:bg-slate-700">$1</code>');
      const lines = String(text).split("\n");
      let out = "";
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*\|/.test(ln)) {
          const rows = [];
          while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
          i--;
          const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
          out += `<div class="my-1 overflow-x-auto"><table class="min-w-full text-xs">${body.map((r, k) => `<tr>${cells(r).map((c) => (k === 0 ? `<th class="border-b border-slate-300 px-2 py-1 text-left font-semibold">${inline(c)}</th>` : `<td class="border-b border-slate-200/70 px-2 py-1">${inline(c)}</td>`)).join("")}</tr>`).join("")}</table></div>`;
        } else if (/^\s*[-*]\s+/.test(ln)) {
          const items = [];
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
          i--;
          out += `<ul class="my-1 list-disc space-y-0.5 pl-4">${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
        } else if (!ln.trim()) out += '<div class="h-1.5"></div>';
        else out += `<p>${inline(ln)}</p>`;
      }
      return out;
    }
    function aiBody() {
      const ta = (k, v) => t("widgets.ai." + k, v);
      const bubble = (m, idx) =>
        m.role === "user"
          ? `<div class="flex justify-end"><div class="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3 py-1.5 text-sm text-white whitespace-pre-wrap break-words">${esc(m.text)}</div></div>`
          : `<div class="flex justify-start"><div class="max-w-[92%] min-w-0 rounded-2xl rounded-bl-md bg-white/70 px-3 py-2 text-sm break-words dark:bg-white/10">${mdLite(m.text)}${(m.reports || [])
              .map(
                (r) => `<div class="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 p-2 dark:border-slate-700 dark:bg-slate-900/60">
                  ${icon("file-spreadsheet", "size-4 shrink-0 text-emerald-600")}<span class="min-w-0 flex-1 truncate text-xs font-semibold" title="${esc(r.title)}">${esc(r.title)}</span><span class="text-[11px] text-slate-500">${esc(ta("rows", { count: r.total }))}</span>
                  ${r.rows ? `<button type="button" data-ai-dl="${idx}:${r.id}:xlsx" class="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">${esc(ta("excel"))}</button><button type="button" data-ai-dl="${idx}:${r.id}:csv" class="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-white dark:border-slate-600">${esc(ta("csv"))}</button>` : `<span class="text-[11px] text-slate-400">${esc(ta("expired"))}</span>`}
                </div>`,
              )
              .join("")}</div></div>`;
      const intro = `<div class="space-y-2 text-sm text-slate-600 dark:text-slate-300"><p>${esc(ta("intro"))}</p><div class="flex flex-wrap gap-1.5">${[1, 2, 3].map((n) => `<button type="button" data-ai-suggest="${esc(ta("s" + n))}" class="rounded-full border border-slate-300 bg-white/70 px-2.5 py-1 text-left text-xs hover:bg-white dark:border-slate-600 dark:bg-white/10">${esc(ta("s" + n))}</button>`).join("")}</div></div>`;
      return `<div class="flex h-full min-h-0 flex-col">
        <div class="mb-2 flex items-center justify-between gap-2"><div class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">${icon("bot", "size-3.5")}${esc(t("widgets.types.ai"))}</div>
          ${aiMsgs.length ? `<button type="button" data-ai-clear class="no-drag rounded-full px-2 py-0.5 text-[11px] text-slate-500 hover:bg-white/70 dark:hover:bg-white/10">${esc(ta("clear"))}</button>` : ""}</div>
        <div data-ai-log class="no-drag min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">${aiMsgs.length ? aiMsgs.map(bubble).join("") : intro}${aiBusy ? `<div class="flex justify-start"><div class="rounded-2xl rounded-bl-md bg-white/70 px-3 py-1.5 text-sm text-slate-500 dark:bg-white/10">${esc(ta("thinking"))}</div></div>` : ""}</div>
        <form data-ai-form class="no-drag mt-2 flex gap-1.5"><input data-ai-input autocomplete="off" maxlength="1000" value="${esc(aiDraft)}" placeholder="${esc(ta("placeholder"))}" ${aiBusy ? "disabled" : ""} class="${cls.input} h-9 min-w-0 flex-1 rounded-full bg-white/80 text-sm dark:bg-slate-800/80"><button type="submit" ${aiBusy ? "disabled" : ""} aria-label="${esc(ta("send"))}" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white disabled:opacity-50 dark:bg-white dark:text-slate-900">${icon("send", "size-4")}</button></form>
      </div>`;
    }
    function aiAfterDraw() {
      $$("[data-ai-log]", root).forEach((el) => (el.scrollTop = el.scrollHeight));
    }
    async function aiAsk(text) {
      text = String(text || "").trim();
      if (!text || aiBusy) return;
      aiMsgs.push({ role: "user", text });
      aiDraft = "";
      aiBusy = true;
      aiSave();
      draw();
      const r = await GW.invoke("gw-ai-chat", { messages: aiMsgs.slice(-12).map((m) => ({ role: m.role, content: m.text })) });
      aiBusy = false;
      if (r && r.ok) aiMsgs.push({ role: "assistant", text: r.reply, reports: r.reports || [] });
      else aiMsgs.push({ role: "assistant", text: t("widgets.ai.errors." + ((r && r.error) || "failed"), { limit: r && r.limit }) });
      aiSave();
      draw();
      const input = $("[data-ai-input]", root);
      if (input) input.focus();
    }
    async function aiDownload(spec) {
      const [idx, rid, fmt] = spec.split(":");
      const m = aiMsgs[Number(idx)];
      const rep = m && (m.reports || []).find((x) => x.id === rid);
      if (!rep || !rep.rows) return toast(t("widgets.ai.expired"));
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: GW_CONFIG.timeZone }).format(new Date());
      const base = (rep.title || "report").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "report";
      if (fmt === "xlsx")
        return GW.downloadXlsx(`${base}-${day}.xlsx`, (wb) => {
          const ws = wb.addWorksheet((rep.title || "Report").replace(/[\\/?*[\]:]/g, " ").slice(0, 30));
          ws.columns = rep.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, Math.min(34, c.label.length + 6)) }));
          rep.rows.forEach((row) => ws.addRow(rep.columns.map((c) => (c.type === "number" && row[c.key] !== null && row[c.key] !== "" ? Number(row[c.key]) : row[c.key] ?? ""))));
          ws.getRow(1).font = { bold: true };
          ws.views = [{ state: "frozen", ySplit: 1 }];
        });
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [rep.columns.map((c) => q(c.label)).join(","), ...rep.rows.map((row) => rep.columns.map((c) => (c.type === "number" && row[c.key] !== null ? row[c.key] : q(row[c.key]))).join(","))];
      GW.downloadBlob(`${base}-${day}.csv`, new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    }
    root.addEventListener("submit", (e) => {
      if (!e.target.matches("[data-ai-form]")) return;
      e.preventDefault();
      aiAsk($("[data-ai-input]", e.target).value);
    });
    root.addEventListener("input", (e) => {
      if (e.target.matches("[data-ai-input]")) aiDraft = e.target.value;
    });

    // ------------------------------------------------------------ 天气：用浏览器的位置，Open-Meteo（免费，不用 key）
    let weather = null; // { at, temp, code, hi, lo, rain, wind, place } 或 { error }
    let weatherBusy = false;
    const WCODE = (c) => (c === 0 ? ["sun", "clear"] : c <= 2 ? ["cloud-sun", "partly"] : c === 3 ? ["cloud", "cloudy"] : c <= 48 ? ["cloud-fog", "fog"] : c <= 57 ? ["cloud-drizzle", "drizzle"] : c <= 67 ? ["cloud-rain", "rain"] : c <= 77 ? ["snowflake", "snow"] : c <= 82 ? ["cloud-rain", "rain"] : c <= 86 ? ["snowflake", "snow"] : ["cloud-lightning", "storm"]);
    function weatherInner(size) {
      const tw = (k, v) => t("widgets.weather." + k, v);
      if (!weather) return `<div class="flex h-full items-center justify-center text-sm text-slate-500">${esc(tw("loading"))}</div>`;
      if (weather.error)
        return `<div class="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">${icon("map-pin-off", "size-6")}<span>${esc(tw(weather.error))}</span><button type="button" data-weather-retry class="no-drag rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-slate-900">${esc(tw("retry"))}</button></div>`;
      const [ic, key] = WCODE(weather.code);
      return `<div class="flex h-full flex-col justify-between">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="flex items-center gap-1 truncate text-xs font-semibold text-slate-500 uppercase">${icon("map-pin", "size-3.5 shrink-0")}<span class="truncate">${esc(weather.place || tw("yourLocation"))}</span></div>
            <div class="mt-1 text-4xl font-bold tabular-nums">${Math.round(weather.temp)}°</div></div>
          ${icon(ic, size === "small" ? "size-10 text-sky-500" : "size-14 text-sky-500")}
        </div>
        <div>
          <div class="text-sm font-medium">${esc(tw(key))}</div>
          <div class="mt-0.5 text-xs text-slate-500">${esc(tw("high"))} ${Math.round(weather.hi)}° · ${esc(tw("low"))} ${Math.round(weather.lo)}°${size === "small" ? "" : ` · ${esc(tw("rainChance"))} ${weather.rain ?? 0}%`}</div>
        </div>
      </div>`;
    }
    async function loadWeather(force) {
      if (weatherBusy || (weather && !weather.error && !force && Date.now() - weather.at < 30 * 60e3)) return;
      weatherBusy = true;
      try {
        let geo = null;
        try {
          const saved = JSON.parse(localStorage.getItem("gw_geo") || "null");
          if (saved && !force && Date.now() - saved.at < 6 * 3600e3) geo = saved;
        } catch (e) {
          /* 忽略 */
        }
        if (!geo) {
          geo = await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }), () => resolve(null), { timeout: 10000, maximumAge: 3600e3 });
          });
          if (geo)
            try {
              localStorage.setItem("gw_geo", JSON.stringify(geo));
            } catch (e) {
              /* 忽略 */
            }
        }
        if (!geo) weather = { error: "needLocation" };
        else {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
          const j = await (await fetch(url)).json();
          let place = "";
          try {
            const g = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${geo.lat}&longitude=${geo.lon}&localityLanguage=en`)).json();
            place = g.locality || g.city || g.principalSubdivision || "";
          } catch (e) {
            /* 名字取不到就算了 */
          }
          weather = { at: Date.now(), temp: j.current.temperature_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m, hi: j.daily.temperature_2m_max[0], lo: j.daily.temperature_2m_min[0], rain: j.daily.precipitation_probability_max[0], place };
        }
      } catch (e) {
        weather = { error: "failed" };
      }
      weatherBusy = false;
      $$("[data-weather]", root).forEach((el) => (el.innerHTML = weatherInner(el.dataset.weather)));
      refreshIcons();
    }

    // Notice Board 的高度不能小过里面的内容
    function boardMinHeight() {
      const el = $(".gw-pinned", root);
      const ul = el && $("ul", el);
      if (!ul) return 150;
      const kids = [...ul.children];
      const content = kids.reduce((a, k) => a + k.offsetHeight, 0) + Math.max(0, kids.length - 1) * 8;
      return Math.max(150, Math.ceil(content + 72));
    }
    function fitBoard() {
      const w = board();
      const el = $(".gw-pinned", root);
      if (!el || !(w && w.config && Number(w.config.height) > 0)) return;
      const min = boardMinHeight();
      if (el.getBoundingClientRect().height < min - 1) el.style.height = min + "px";
    }

    // 往大一级 / 小一级：只看标题 ⇄ 第一行 ⇄ 全部
    async function stepBox(key, dir) {
      const i = MODES.indexOf(modeOf(key)) + (dir === "more" ? 1 : -1);
      if (i < 0 || i > 2) return;
      const mode = MODES[i];
      expanded.set(key, mode === "full");
      setLayout(key, { mode });
      draw();
      await Promise.all([saveLayout(key, { mode }), sb.from("gw_user_sections").upsert({ user_id: data.profile.id, group_id: key, expanded: mode === "full" }), ...settlePage(true)]);
    }

    // 删除区块里的文件夹 / 便条（先问一下）；文件夹里的 App 回到区块里
    async function deleteBoxItem(item, before) {
      if (!item) return;
      const isNote = item.kind === "note";
      const ok = isNote
        ? await confirmDialog(t("home.deleteNoteTitle"), t("home.deleteNoteBody"), t("home.delete"), t("home.cancel"))
        : await confirmDialog(t("home.deleteFolderTitle"), t("home.deleteFolderBody", { name: item.name }), t("home.delete"), t("home.cancel"));
      if (!ok) return;
      if (before) before();
      if (!isNote) {
        sItems.filter((x) => x.parent_id === item.id).forEach((x) => (x.parent_id = null));
        await sb.from("gw_user_section_items").update({ parent_id: null }).eq("parent_id", item.id);
      }
      sItems = sItems.filter((x) => x.id !== item.id);
      drawSections();
      const { error } = await sb.from("gw_user_section_items").delete().eq("id", item.id);
      if (error) toast(t("home.saveFailed"));
    }
    // 从区块拿掉 / 放回一个 App（只改这个人的主页，权限不变）
    function hideModule(gid, mid, hide) {
      const bw = board();
      if (!bw) return toast(t("widgets.unavailable"));
      const hidden = { ...(boardCfg().hidden || {}) };
      const set = new Set(hidden[gid] || []);
      if (hide) set.add(mid);
      else set.delete(mid);
      if (set.size) hidden[gid] = [...set];
      else delete hidden[gid];
      bw.config = { ...bw.config, hidden };
      draw();
      if (!hide) toast(t("home.added"));
      return saveBoardConfig();
    }
    // Add Apps 面板：从区块拿掉过的 App，可以放回去
    function hiddenAppsHtml() {
      if (!sectionsOn) return "";
      const rows = [];
      Object.entries(boardCfg().hidden || {}).forEach(([gid, ids]) => {
        const grp = S.groups.find((x) => x.id === gid);
        ids.forEach((mid) => grp && modules.has(mid) && rows.push([grp, modules.get(mid)]));
      });
      if (!rows.length) return "";
      return `<p class="mb-2 ${cls.label}">${esc(t("fab.hiddenApps"))}</p>
        <div class="mb-4 space-y-1.5">${rows
          .map(([grp, m]) => `<div class="flex items-center gap-3 rounded-xl border border-slate-200 px-2.5 py-2 dark:border-slate-800">${appIcon(m, "size-9")}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(m.name)}</span><span class="block truncate text-xs text-slate-500">${esc(grp.name)}</span></span><button type="button" data-unhide="${grp.id}:${m.id}" class="${btn("secondary", "sm")}">${icon("plus", "size-3.5")} ${esc(t("fab.putBack"))}</button></div>`)
          .join("")}</div>`;
    }

    // 文件夹名称 / 便条内容
    function itemDialog(item, gid, kind, order) {
      const isNote = kind === "note";
      const dlg = modal(
        item ? t(isNote ? "home.editNote" : "home.editFolder") : t(isNote ? "home.newNote" : "home.newFolder"),
        `<form class="space-y-4">
          <input name="name" maxlength="40" ${isNote ? "" : "required"} value="${esc(item ? item.name || "" : "")}" placeholder="${esc(t(isNote ? "home.noteTitle" : "home.folderName"))}" class="${cls.input}">
          ${isNote ? `<textarea name="body" rows="6" maxlength="2000" placeholder="${esc(t("home.noteBody"))}" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900">${esc(item ? item.body || "" : "")}</textarea>` : ""}
          <div class="flex justify-between gap-2">
            ${item ? `<button type="button" data-del class="${btn("ghost")} text-red-600 dark:text-red-400">${icon("trash-2", "size-4")} ${esc(t("home.delete"))}</button>` : "<span></span>"}
            <div class="flex gap-2"><button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button><button type="submit" class="${btn("primary")}">${esc(t("home.save"))}</button></div>
          </div>
        </form>`,
      );
      refreshIcons();
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      $("[name=name]", dlg.el).focus();
      if (item) $("[data-del]", dlg.el).onclick = () => deleteBoxItem(item, dlg.close);
      $("form", dlg.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const fields = { name: f.name.value.trim() || null, body: isNote ? f.body.value : null };
        if (item) {
          const { error } = await sb.from("gw_user_section_items").update(fields).eq("id", item.id);
          if (error) return toast(t("home.saveFailed"));
          Object.assign(item, fields);
        } else {
          const { data: created, error } = await sb.from("gw_user_section_items").insert({ ...fields, user_id: data.profile.id, group_id: gid, kind, sort_order: order }).select().single();
          if (error) return toast(t("home.saveFailed"));
          sItems.push(created);
        }
        dlg.close();
        drawSections();
      });
    }

    // 文件夹：放大成浮动窗，名字在上面；可以加 App 进来、拿出去、改名、删除
    function openBoxFolder(fid) {
      const f = sItems.find((x) => x.id === fid);
      if (!f) return;
      const kids = folderKids(fid);
      const wrap = document.createElement("div");
      wrap.setAttribute("role", "dialog");
      wrap.className = "fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 p-6 backdrop-blur-md";
      wrap.innerHTML = `
        <h2 class="mb-5 max-w-full truncate px-4 text-3xl font-bold text-white drop-shadow sm:text-4xl">${esc(f.name || "")}</h2>
        <div data-win class="w-full max-w-md rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75">
          ${
            kids.length
              ? `<div class="grid grid-cols-3 gap-5 sm:grid-cols-4">${kids
                  .map(
                    (k) => `<div class="relative flex flex-col items-center gap-1.5">
                      <button type="button" data-open="${k.module_id}" class="flex flex-col items-center gap-1.5">${appIcon(modules.get(k.module_id), "size-14 sm:size-16")}<span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(modules.get(k.module_id).name)}</span></button>
                      <button type="button" data-out="${k.id}" title="${esc(t("fab.moveOut"))}" aria-label="${esc(t("fab.moveOut"))}" class="absolute -top-1 right-1 flex size-6 items-center justify-center rounded-full bg-slate-700/90 text-white shadow ring-2 ring-white dark:ring-slate-900">${icon("arrow-up-right", "size-3.5")}</button>
                    </div>`,
                  )
                  .join("")}</div>`
              : `<p class="py-6 text-center text-sm text-slate-500">${esc(t("fab.emptyFolder"))}</p>`
          }
        </div>
        <div class="mt-4 flex gap-2">
          <button type="button" data-fadd class="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow backdrop-blur dark:bg-slate-800/80 dark:text-slate-200">${icon("plus", "size-4")} ${esc(t("home.addApps"))}</button>
          <button type="button" data-frename class="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow backdrop-blur dark:bg-slate-800/80 dark:text-slate-200">${icon("pencil", "size-4")} ${esc(t("home.editFolder"))}</button>
        </div>`;
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
          const it = sItems.find((x) => x.id === b.dataset.out);
          it.parent_id = null;
          it.sort_order = Math.max(-1, ...sItems.filter((x) => x.group_id === f.group_id && !x.parent_id).map((x) => x.sort_order)) + 1;
          close();
          drawSections();
          await sb.from("gw_user_section_items").update({ parent_id: null, sort_order: it.sort_order }).eq("id", it.id);
          return openBoxFolder(fid);
        }
        if ("frename" in b.dataset) return close(), itemDialog(f, f.group_id, "folder");
        if ("fadd" in b.dataset) return close(), folderAddDialog(f);
      });
    }
    // 把区块里还没放进文件夹的 App 勾选放进来
    function folderAddDialog(f) {
      const loose = boxItems(f.group_id).filter((x) => x.kind === "module");
      const dlg = modal(
        t("home.addApps"),
        loose.length
          ? `<form class="space-y-4"><div class="space-y-1.5">${loose.map((x) => `<label class="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"><input type="checkbox" name="pick" value="${x.id}" class="size-4 accent-emerald-600">${appIcon(modules.get(x.module_id), "size-8")}<span class="truncate">${esc(modules.get(x.module_id).name)}</span></label>`).join("")}</div>
            <div class="flex justify-end gap-2"><button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button><button type="submit" class="${btn("primary")}">${esc(t("home.save"))}</button></div></form>`
          : `<p class="text-sm text-slate-500">${esc(t("home.noLooseApps"))}</p>`,
      );
      refreshIcons();
      const cancel = $("[data-cancel]", dlg.el);
      if (cancel) cancel.onclick = dlg.close;
      const form = $("form", dlg.el);
      if (form)
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const picked = $$("[name=pick]:checked", form).map((x) => x.value);
          dlg.close();
          let n = folderKids(f.id).length;
          const rows = [];
          for (const key of picked) {
            if (key.startsWith("new:")) rows.push({ user_id: data.profile.id, group_id: f.group_id, kind: "module", module_id: key.slice(4), parent_id: f.id, sort_order: n++ });
            else {
              const it = sItems.find((x) => x.id === key);
              it.parent_id = f.id;
              it.sort_order = n++;
              await sb.from("gw_user_section_items").update({ parent_id: f.id, sort_order: it.sort_order }).eq("id", it.id);
            }
          }
          if (rows.length) {
            const { data: created, error } = await sb.from("gw_user_section_items").insert(rows).select();
            if (error) toast(t("home.saveFailed"));
            else sItems.push(...created);
          }
          drawSections();
          openBoxFolder(f.id);
        });
    }

    // 区块版整页：Notice Board、区块（Business 和 My Home，顺序可以拖拉调整）、页面上的小工具，全部在同一个格线上
    function pageHtml(showHome) {
      const g = pageGeo();
      const parts = [];
      S.groups.forEach((grp) => {
        if (!(modsOfGroup(grp.id).length || sItems.some((x) => x.group_id === grp.id))) return;
        const B = boxGeo(grp.id);
        parts.push([grp.id, boxShell(grp.id, grp.name, B, modeOf(grp.id) === "title" ? "" : boxTiles(grp.id, B))]);
      });
      if (showHome) {
        const B = boxGeo("home");
        parts.push(["home", boxShell("home", t("home.myHome"), B, boxTiles("home", B))]);
      }
      const order = sectionOrder();
      const rank = (k) => (order.indexOf(k) === -1 ? 999 : order.indexOf(k));
      parts.sort((a, b) => rank(a[0]) - rank(b[0]));
      return `<div id="gw-frame" class="mx-auto max-w-full" style="width:${g.width}px">
        ${boardHtml()}
        ${editing ? `<p class="mx-2 mb-2 text-center text-xs text-slate-500">${esc(t("fab.editHint"))}</p>` : ""}
        <div id="gw-page" class="relative mb-6">
          <div id="gw-stack" class="flex flex-wrap items-start">${parts.map((x) => x[1]).join("")}</div>
          <div id="gw-float" class="pointer-events-none absolute inset-0 z-30 [&>*]:pointer-events-auto">${pageWidgets().map((w) => pageWidget(w, g)).join("")}</div>
        </div>
      </div>`;
    }

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
      // 区块版：Notice Board 下面是各 Business 区块和「My Home」（自由摆放：App、小工具、文件夹、连结），顺序可以拖拉调整
      const showGrid = !sectionsOn || items.length > 0 || editing || !!sheet;
      const gridHtml = showGrid
        ? `<div id="gw-grid" data-cols="${P.n}" class="${editing ? "gw-editing" : ""} relative grid gap-x-2 gap-y-4 [grid-auto-rows:5.25rem] sm:[grid-auto-rows:5.75rem]"
             style="grid-template-columns:repeat(${P.n},minmax(0,1fr));grid-template-rows:repeat(${Math.max(rows, 1)},var(--gw-row,5.25rem))">
          ${items.map(tile).join("")}
          <div data-drop-hint class="pointer-events-none hidden rounded-2xl border-2 border-dashed"></div>
        </div>`
        : "";
      const stackHtml = sectionsOn ? pageHtml(items.length > 0 || editing || !!sheet) : "";
      root.innerHTML = `
        ${uninitialized ? `<div class="mb-4 rounded-2xl bg-white/70 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">${esc(t("home.previewUninitialized"))}</div>` : ""}
        ${sectionsOn ? stackHtml : boardHtml()}
        ${editing && !sectionsOn ? `<p class="mb-3 text-center text-xs text-slate-500">${esc(t("fab.editHint"))}</p>` : ""}
        ${sectionsOn ? "" : gridHtml}
        ${items.length === 0 && !sectionsOn ? `<div class="${cls.empty} mt-2 bg-white/60 dark:bg-slate-900/40">${esc(data.modules.length ? t("fab.emptyHome") : t("home.noModules"))}</div>` : ""}
        ${
          sheet
            ? `<aside class="gw-sheet fixed inset-x-0 bottom-0 z-50 max-h-[62vh] overflow-y-auto rounded-t-3xl border border-white/60 bg-white/75 p-4 shadow-2xl backdrop-blur-2xl sm:inset-x-auto sm:top-20 sm:right-4 sm:bottom-4 sm:max-h-none sm:w-96 sm:rounded-3xl dark:border-white/10 dark:bg-slate-900/75">${sheet === "apps" ? appsSheet() : widgetsSheet()}</aside>`
            : ""
        }
        ${fabHtml()}`;
      refreshIcons();
      if (sectionsOn) {
        root.classList.toggle("gw-jiggle", editing);
        lastGeo = geoSig();
        fitBoard();
        settlePage(false);
      }
      if ($("[data-weather]", root)) loadWeather();
      aiAfterDraw();
      if ($("[data-clock]", root)) {
        clockTimer = setInterval(() => {
          const now = new Intl.DateTimeFormat(GW.LOCALE, { timeZone: GW_CONFIG.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
          $$("[data-clock]", root).forEach((el) => (el.textContent = now));
        }, 1000);
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
        if (kind === "folder" && (drag.kind === "app" || drag.kind === "lib" || drag.kind === "link")) action = { type: "folder", fid: id };
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
      if (a.type === "folder") return d.kind === "link" ? moveLinkToFolder(d.id, a.fid) : moveIntoFolder(d.id, a.fid);
      if (a.type === "swap") {
        const saving = Promise.all([saveSlot(d.kind, d.id, a.theirSlot), saveSlot(a.kind, a.id, a.mySlot)]);
        draw();
        return saving;
      }
      draw();
    }
    // Notice Board 下缘：按住往上 / 往下拖调高度，放开时记住
    root.addEventListener("pointerdown", (e) => {
      const grab = e.target.closest("[data-board-resize]");
      if (!grab || e.button !== 0) return;
      const el = grab.closest(".gw-pinned");
      const startY = e.clientY;
      const startH = el.getBoundingClientRect().height;
      let h = startH;
      e.preventDefault();
      document.body.classList.add("gw-dragging");
      const move = (ev) => {
        h = Math.max(boardMinHeight(), Math.min(Math.max(720, boardMinHeight()), startH + ev.clientY - startY));
        el.style.height = h + "px";
        el.classList.remove("h-[13rem]", "h-[22rem]");
      };
      const up = async () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        removeEventListener("pointercancel", up);
        document.body.classList.remove("gw-dragging");
        lastDragEnd = Date.now();
        const w = board();
        if (!w) return;
        w.config = { ...(w.config || {}), height: Math.round(h) };
        const { error } = await sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id);
        if (error) toast(t("home.saveFailed"));
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
    });
    // 长按（手机）或拖动（滑鼠）开始
    let press = null;
    root.addEventListener("pointerdown", (e) => {
      if (readOnly || sectionsOn || drag || e.button !== 0) return;
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
    // o.folderId：直接建在这个文件夹里；o.onSaved：存好之后叫
    function linkDialog(link, o) {
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
            .insert({ ...row, user_id: data.profile.id, sort_order: nextSlot(1, 1), ...(o && o.folderId ? { folder_id: o.folderId } : {}) })
            .select()
            .single();
          if (error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.saveFailed")));
          links.push(created);
        }
        dlg.close();
        draw();
        if (o && o.onSaved) o.onSaved();
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
              ${folders.filter((f) => !f.shared_by).map((f) => `<option value="${f.id}" ${current === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
            </select>
          </label>
          <button data-colors class="${btn("secondary")} w-full">${icon("palette")} ${esc(t("fab.iconColors"))}</button>
          <button data-remove class="${btn("ghost")} w-full text-red-600 dark:text-red-400">${icon("trash-2")} ${esc(t("home.removeFromHome"))}</button>
        </div>`,
      );
      $("[data-colors]", dlg.el).onclick = () => (dlg.close(), iconColorsDialog());
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

    // 文件夹：像 iPhone 一样放大成一个浮动窗，名字在上面（长按名字可以改名）
    /* mode = "grid"（图示格子）| "map"（心智图：视窗放大，右边一排工具；还是浮动窗，不换页）
       右上角小小的「两个人」= 分享给谁（分享用的文件夹、拥有者才有）；分享给我的文件夹右上角是淡蓝的「两个人」。
       分享给我的：不能移出里面的东西、不能改名。 */
    function openFolder(fid, mode) {
      const f = folders.find((x) => x.id === fid);
      if (!f) return;
      mode = mode || (f.canvas && f.canvas.map ? "map" : "grid"); // 画过心智图的文件夹一打开就是心智图
      const ids = folderApps(fid);
      const lks = folderLinks(fid);
      const mineF = !f.shared_by;
      const canOut = !readOnly && mineF;
      const canRename = mineF && !readOnly;
      const wrap = document.createElement("div");
      wrap.setAttribute("role", "dialog");
      wrap.className = "fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md sm:p-6";
      const tile = (btnAttr, iconHtml, label, title, outAttr) => `<div class="relative flex flex-col items-center gap-1.5">
          <button type="button" ${btnAttr} ${title ? `title="${esc(title)}"` : ""} class="flex flex-col items-center gap-1.5">${iconHtml}<span class="w-20 truncate text-center text-xs font-medium text-slate-700 dark:text-slate-200">${esc(label)}</span></button>
          ${canOut ? `<button type="button" ${outAttr} title="${esc(t("fab.moveOut"))}" aria-label="${esc(t("fab.moveOut"))}" class="absolute -top-1 right-1 flex size-6 items-center justify-center rounded-full bg-slate-700/90 text-white shadow ring-2 ring-white dark:ring-slate-900">${icon("arrow-up-right", "size-3.5")}</button>` : ""}
        </div>`;
      const grid =
        ids.length || lks.length
          ? `<div class="grid grid-cols-3 gap-5 sm:grid-cols-4">${ids.map((id) => tile(`data-open="${id}"`, appIcon(modules.get(id), "size-14 sm:size-16"), modules.get(id).name, "", `data-out="${id}"`)).join("")}${lks
              .map((l) => tile(`data-open-link="${l.id}"`, appIcon({ code: l.name, icon: l.icon, image_url: l.image_url }, "size-14 sm:size-16"), l.name, l.url, `data-out-link="${l.id}"`))
              .join("")}</div>`
          : `<p class="py-6 text-center text-sm text-slate-500">${esc(t("fab.emptyFolder"))}</p>`;
      const pill = (attr, ic, label) => `<button type="button" ${attr} class="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow backdrop-blur dark:bg-slate-800/80 dark:text-slate-200">${icon(ic, "size-4")} ${esc(label)}</button>`;
      wrap.innerHTML = `
        <div class="mb-4 flex max-w-full items-center gap-2 px-4">
          <h2 data-title class="min-w-0 truncate text-3xl font-bold text-white drop-shadow outline-none select-none sm:text-4xl ${canRename ? "cursor-pointer" : ""}" ${canRename ? `title="${esc(t("home.renameHint"))}"` : ""} style="touch-action:manipulation">${esc(f.name)}</h2>
        </div>
        <div data-win class="relative w-full ${mode === "map" ? "max-w-5xl" : "max-w-md"} rounded-[2rem] border border-white/60 bg-white/75 p-5 shadow-2xl backdrop-blur-xl sm:p-6 dark:border-white/10 dark:bg-slate-900/75">
          ${mineF && f.is_shared && !readOnly ? `<button type="button" data-share title="${esc(t("home.shareBtn"))}" aria-label="${esc(t("home.shareBtn"))}" class="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-sky-500 text-white shadow hover:bg-sky-600">${icon("users", "size-4")}</button>` : ""}
          ${!mineF ? `<span title="${esc(t("home.sharedBy"))}" class="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-sky-500/70 text-white shadow">${icon("users", "size-4")}</span>` : ""}
          ${mode === "map" ? `<div data-map-host class="h-[72vh] min-h-[420px]"></div>` : grid}
        </div>
        ${readOnly ? "" : `<div class="mt-4 flex flex-wrap justify-center gap-2">${mode === "map" ? pill("data-grid", "layout-grid", t("home.mapGrid")) : pill("data-map", "git-fork", t("home.mindMap"))}</div>`}`;
      document.body.appendChild(wrap);
      refreshIcons();
      let mapCtl = null;
      const close = () => {
        if (mapCtl) mapCtl.flush();
        wrap.remove();
        document.removeEventListener("keydown", onKey);
      };
      // Esc：上面还有弹窗（分享名单、加连结）就不动；心智图在画线就先取消画线
      const onKey = (e) => {
        if (e.key !== "Escape" || document.querySelector(".gw-modal")) return;
        if (mapCtl && mapCtl.onEscape()) return;
        close();
      };
      document.addEventListener("keydown", onKey);
      if (mode === "map") mapCtl = mountMindMap(f, $("[data-map-host]", wrap), { openApp: (id) => (close(), open(id)), reopen: () => (close(), openFolder(fid, "map")), canAddLink: canOut, canEditLinks: canOut, canEdit: !readOnly && (mineF || f.share_role === "edit") });
      // 长按名字 → 名字原地变成可以打字；按 ✓、Enter 或点别的地方就存，Esc 取消
      if (canRename) {
        const h = $("[data-title]", wrap);
        let timer = null, renaming = false;
        const stop = () => (clearTimeout(timer), (timer = null));
        const finish = async (commit) => {
          if (!renaming) return;
          renaming = false;
          h.contentEditable = "false";
          h.classList.remove("rounded-xl", "bg-white/20", "ring-2", "ring-white/80", "px-2");
          const ok = $("[data-rename-ok]", wrap);
          if (ok) ok.remove();
          const name = (h.innerText || "").trim().slice(0, 40);
          if (!commit || !name || name === f.name) return (h.textContent = f.name);
          h.textContent = name;
          const { error } = await sb.from("gw_user_folders").update({ name }).eq("id", f.id);
          if (error) return ((h.textContent = f.name), toast(t("home.saveFailed")));
          f.name = name;
          draw();
        };
        const start = () => {
          if (renaming) return;
          renaming = true;
          h.contentEditable = "true";
          h.classList.add("rounded-xl", "bg-white/20", "ring-2", "ring-white/80", "px-2");
          h.insertAdjacentHTML("afterend", `<button type="button" data-rename-ok aria-label="${esc(t("home.save"))}" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow">${icon("check", "size-5")}</button>`);
          refreshIcons();
          h.focus();
          const r = document.createRange();
          r.selectNodeContents(h);
          const s0 = getSelection();
          s0.removeAllRanges();
          s0.addRange(r);
        };
        h.addEventListener("pointerdown", () => {
          if (!renaming) timer = setTimeout(() => ((timer = null), start()), 600);
        });
        ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => h.addEventListener(ev, stop));
        h.addEventListener("contextmenu", (e) => e.preventDefault());
        h.addEventListener("keydown", (e) => {
          if (!renaming) return;
          e.stopPropagation();
          if (e.key === "Enter") (e.preventDefault(), finish(true));
          if (e.key === "Escape") (e.preventDefault(), finish(false));
        });
        h.addEventListener("blur", () => setTimeout(() => renaming && finish(true), 150));
        wrap.addEventListener("click", (e) => e.target.closest("[data-rename-ok]") && finish(true));
      }
      wrap.addEventListener("click", async (e) => {
        if (!e.target.isConnected) return; // 里面的工具刚重画过（图示换掉了）：不是点外面
        const b = e.target.closest("button");
        if (!b) {
          if (!e.target.closest("[data-win]") && !e.target.closest("[data-title]")) close();
          return;
        }
        if (!wrap.contains(b) || b.closest("[data-map-host]") || "renameOk" in b.dataset) return;
        if (b.dataset.open) return close(), open(b.dataset.open);
        if (b.dataset.openLink) {
          const l = links.find((x) => x.id === b.dataset.openLink);
          return l && window.open(l.url, "_blank", "noopener,noreferrer");
        }
        if (b.dataset.outLink) {
          close();
          await moveLinkToFolder(b.dataset.outLink, null);
          return openFolder(fid);
        }
        if (b.dataset.out) {
          const id = b.dataset.out;
          const slot = nextSlot(1, 1);
          layout.set(id, { folder_id: null, sort_order: slot });
          close();
          draw();
          await saveApps([{ module_id: id, folder_id: null, sort_order: slot }]);
          return openFolder(fid);
        }
        if ("share" in b.dataset) return sharePicker(f);
        if ("map" in b.dataset) return close(), openFolder(fid, "map");
        if ("grid" in b.dataset) return close(), openFolder(fid, "grid");
      });
    }

    // ------------------------------------------------------------ 文件夹心智图（在文件夹浮动窗里，右边一排工具）
    /* 文件夹里的 App / 连结自动变成节点；工具：加连结图示（拥有者）、方块 / 圆角 / 菱形（打字用）、
       画线（点两个节点就连一条有箭头的线；也可以从节点四边的蓝点拖到另一个节点）、全选、条列（把选到的 / 全部排成一直栏，前面一个点）、
       颜色（选到方块时）、删除。拖动节点改位置（选了好几个会一起动）；方块点两下改文字；App / 连结点两下打开。
       存在 gw_user_folders.canvas（gw_save_folder_canvas：拥有者和被分享的人都能改，改了会自动存）。 */
    const MAP_COLORS = ["slate", "sky", "emerald", "amber", "rose", "violet"];
    const MAP_FILL = {
      slate: "border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
      sky: "border-sky-300 bg-sky-100 text-sky-900",
      emerald: "border-emerald-300 bg-emerald-100 text-emerald-900",
      amber: "border-amber-300 bg-amber-100 text-amber-900",
      rose: "border-rose-300 bg-rose-100 text-rose-900",
      violet: "border-violet-300 bg-violet-100 text-violet-900",
    };
    const MAP_SWATCH = { slate: "#94a3b8", sky: "#38bdf8", emerald: "#34d399", amber: "#fbbf24", rose: "#fb7185", violet: "#a78bfa" };
    const NODE_W = 120, NODE_H = 108, ROW_W = 240, ROW_H = 48, GRID = 24;
    const snap = (v) => Math.round(v / GRID) * GRID; // 位置都对齐点点格子，排起来才整齐
    function mountMindMap(f, host, hooks) {
      const W = 1600, H = 1200;
      const uid = () => Math.random().toString(36).slice(2, 10);
      const cv = f.canvas && typeof f.canvas === "object" ? f.canvas : {};
      const nodes = (Array.isArray(cv.nodes) ? cv.nodes : []).map((n) => ({ ...n }));
      let edges = (Array.isArray(cv.edges) ? cv.edges : []).map((e) => ({ ...e }));
      // 文件夹里的 App / 连结：没有节点的补上，已经不在文件夹的拿掉
      const apps = folderApps(f.id), lks = folderLinks(f.id).map((l) => l.id);
      const kept = nodes.filter((n) => n.type === "shape" || (n.type === "app" ? apps.includes(n.ref) : lks.includes(n.ref)));
      nodes.splice(0, nodes.length, ...kept);
      let k = nodes.length;
      const place = (type, ref) => {
        if (nodes.some((n) => n.type === type && n.ref === ref)) return;
        nodes.push({ id: uid(), type, ref, x: snap(48 + (k % 6) * 168), y: snap(48 + Math.floor(k / 6) * 144), w: NODE_W, h: NODE_H });
        k++;
      };
      apps.forEach((id) => place("app", id));
      lks.forEach((id) => place("link", id));
      const have = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => e && e.from && e.to && have.has(e.from.n) && have.has(e.to.n));

      let selSet = new Set(), selEdge = null;
      let lineMode = false, lineFrom = null;
      let dirty = false, saveTimer = null, drag = null;
      let linkEdit = null, lp = null; // 长按连结图示：改名字 / 换图示（只有拥有者）
      const canEdit = !!hooks.canEdit;
      const tool = (attr, ic, label, extra) =>
        `<button type="button" ${attr} class="flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium text-slate-600 hover:bg-white aria-pressed:bg-slate-900 aria-pressed:text-white disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10 dark:aria-pressed:bg-white dark:aria-pressed:text-slate-900 ${extra || ""}">${icon(ic, "size-5")}<span class="leading-tight">${esc(label)}</span></button>`;
      host.innerHTML = `<div class="flex h-full gap-3">
          <div data-scroll class="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-2xl border border-white/70 bg-white/60 dark:border-white/10 dark:bg-slate-950/40">
            <div data-canvas class="relative" style="width:${W}px;height:${H}px;background-image:radial-gradient(circle, rgba(100,116,139,.28) 1px, transparent 1px);background-size:24px 24px">
              <svg data-edges class="absolute inset-0" width="${W}" height="${H}" style="pointer-events:none">
                <defs><marker id="gw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#475569"/></marker></defs>
                <g data-edge-layer></g>
                <path data-temp fill="none" stroke="#0ea5e9" stroke-width="2" stroke-dasharray="6 4" style="display:none"/>
              </svg>
              <div data-nodes class="absolute inset-0" style="pointer-events:none"></div>
              <div data-marquee class="pointer-events-none absolute hidden rounded border-2 border-dashed border-sky-500 bg-sky-500/10"></div>
            </div>
          </div>
          <div data-tools class="${canEdit ? "flex" : "hidden"} w-16 shrink-0 flex-col items-center gap-0.5 overflow-y-auto rounded-2xl border border-white/70 bg-white/70 p-1 dark:border-white/10 dark:bg-slate-800/70">
            ${hooks.canAddLink ? tool('data-tool="icon"', "link", t("home.mapIcon")) : ""}
            ${tool('data-add="rect"', "square", t("home.mapAddBox"))}
            ${tool('data-add="round"', "circle", t("home.mapAddRound"))}
            ${tool('data-add="diamond"', "diamond", t("home.mapAddDiamond"))}
            ${tool('data-tool="line"', "spline", t("home.mapLine"))}
            ${tool('data-tool="all"', "box-select", t("home.mapSelectAll"))}
            ${tool('data-tool="bullets"', "list", t("home.mapBullets"))}
            <span data-colors class="hidden w-full flex-wrap justify-center gap-1 px-1 py-1">${MAP_COLORS.map((c) => `<button type="button" data-color="${c}" aria-label="${c}" class="size-5 rounded-full ring-slate-400 ring-offset-1 hover:ring-2" style="background:${MAP_SWATCH[c]}"></button>`).join("")}</span>
            ${tool("data-del", "trash-2", t("home.mapDelete"), "text-red-600 dark:text-red-400")}
            <span data-status class="mt-auto px-1 pb-1 text-center text-[10px] leading-tight text-slate-400"></span>
          </div>
        </div>`;
      const canvasEl = $("[data-canvas]", host), nodesEl = $("[data-nodes]", host), edgeLayer = $("[data-edge-layer]", host), temp = $("[data-temp]", host), marquee = $("[data-marquee]", host);
      const status = $("[data-status]", host), colorsEl = $("[data-colors]", host), delBtn = $("[data-del]", host), scrollEl = $("[data-scroll]", host);
      const byId = (id) => nodes.find((n) => n.id === id);
      const port = (n, side) => (side === "t" ? [n.x + n.w / 2, n.y] : side === "b" ? [n.x + n.w / 2, n.y + n.h] : side === "l" ? [n.x, n.y + n.h / 2] : [n.x + n.w, n.y + n.h / 2]);
      const bendPt = (x, y, side, dx, dy) => (side === "l" ? [x - dx, y] : side === "r" ? [x + dx, y] : side === "t" ? [x, y - dy] : [x, y + dy]);
      const pathD = (a, sa, b, sb2) => {
        const [x1, y1] = port(a, sa), [x2, y2] = port(b, sb2);
        const dx = Math.max(40, Math.abs(x2 - x1) / 2), dy = Math.max(40, Math.abs(y2 - y1) / 2);
        const c1 = bendPt(x1, y1, sa, dx, dy), c2 = bendPt(x2, y2, sb2, dx, dy);
        return `M${x1} ${y1} C${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${x2} ${y2}`;
      };
      // 画线工具：照两个节点的相对位置决定从哪一边出、哪一边进
      const autoSides = (a, b) => {
        const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
        return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : dy > 0 ? ["b", "t"] : ["t", "b"];
      };
      const addEdge = (from, to) => {
        if (from.n === to.n || edges.some((ed) => ed.from.n === from.n && ed.to.n === to.n)) return false;
        edges.push({ id: uid(), from, to });
        return true;
      };
      function drawEdges() {
        edgeLayer.innerHTML = edges
          .map((e) => {
            const a = byId(e.from.n), b = byId(e.to.n);
            if (!a || !b) return "";
            const on = selEdge === e.id;
            const d = pathD(a, e.from.s, b, e.to.s);
            return `<path d="${d}" fill="none" stroke="transparent" stroke-width="16" style="pointer-events:stroke;cursor:pointer" data-edge="${e.id}"/><path d="${d}" fill="none" stroke="${on ? "#0ea5e9" : "#475569"}" stroke-width="${on ? 3 : 2}" marker-end="url(#gw-arrow)" style="pointer-events:none"/>`;
          })
          .join("");
      }
      const nodeHtml = (n) => {
        const on = selSet.has(n.id) || lineFrom === n.id;
        const editing = linkEdit === n.id;
        const ports = (canEdit && !editing ? ["t", "r", "b", "l"] : [])
          .map(
            (sd) => `<span data-port="${n.id}:${sd}" class="absolute z-10 size-4 rounded-full border-2 border-white bg-sky-500 shadow ${on ? "" : "opacity-0 group-hover:opacity-100"} ${
              sd === "t" ? "-top-2 left-1/2 -translate-x-1/2" : sd === "b" ? "-bottom-2 left-1/2 -translate-x-1/2" : sd === "l" ? "top-1/2 -left-2 -translate-y-1/2" : "top-1/2 -right-2 -translate-y-1/2"
            }" style="touch-action:none;cursor:crosshair"></span>`,
          )
          .join("");
        let body;
        if (n.type === "shape") {
          const fill = MAP_FILL[n.color] || MAP_FILL.slate;
          const shape = n.shape === "round" ? "rounded-full" : n.shape === "diamond" ? "border-0" : "rounded-xl";
          const clip = n.shape === "diamond" ? "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)" : "";
          body = `<div data-text class="flex h-full w-full items-center justify-center border-2 px-3 text-center text-sm font-medium break-words outline-none ${shape} ${fill}" style="${clip}">${esc(n.text || "")}</div>`;
        } else {
          const m = n.type === "app" ? modules.get(n.ref) : null;
          const l = n.type === "link" ? links.find((x) => x.id === n.ref) : null;
          const ic = appIcon(m || { code: l ? l.name : "?", icon: l ? l.icon : "link", image_url: l ? l.image_url : null }, n.bullet ? "size-8" : "size-12");
          const label = m ? m.name : l ? l.name : "";
          const nameAttr = editing ? `data-link-name contenteditable="true" class="min-w-0 max-w-full rounded bg-white px-1 text-xs font-medium outline-none ring-2 ring-sky-400 dark:bg-slate-900"` : "";
          const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800";
          // 抖动只抖图示和名字（换图示的小面板不抖）
          body = n.bullet
            ? `<div class="flex h-full w-full items-center gap-3 px-3 ${card} ${editing ? "gw-node-edit" : ""}">${ic}<span ${nameAttr || 'class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100"'}>${esc(label)}</span></div>`
            : `<div class="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 ${card} ${editing ? "gw-node-edit" : ""}">${ic}<span ${nameAttr || 'class="line-clamp-2 w-full text-center text-[11px] leading-tight font-medium text-slate-800 dark:text-slate-100"'}>${esc(label)}</span></div>`;
          // 换图示的小面板（挂在图示下面）
          if (editing)
            body += `<div data-link-pop class="absolute top-full left-0 z-20 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900" style="cursor:default">
                <div class="flex flex-wrap gap-1">${["link", ...Object.keys(GW.MODULE_ICONS)].filter((v, i, a) => a.indexOf(v) === i).map((key) => `<button type="button" data-pick-icon="${key}" class="flex size-8 items-center justify-center rounded-lg border ${(l ? l.icon : "link") === key ? "border-brand-500 bg-brand-50 text-brand-600" : "border-slate-200 text-slate-500 dark:border-slate-700"}">${key === "link" ? icon("link", "size-4") : moduleIcon(key, "size-4")}</button>`).join("")}</div>
                <div class="mt-2 flex justify-end"><button type="button" data-link-ok class="${btn("primary", "sm")}">${icon("check", "size-4")} ${esc(t("home.save"))}</button></div>
              </div>`;
        }
        const bullet = n.bullet ? `<span class="absolute top-1/2 -left-5 size-2.5 -translate-y-1/2 rounded-full bg-slate-500 dark:bg-slate-300"></span>` : "";
        return `<div data-node="${n.id}" class="group absolute rounded-2xl select-none ${editing ? "z-20" : ""} ${on ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900" : ""}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;pointer-events:auto;touch-action:none;cursor:${!canEdit ? "pointer" : lineMode ? "crosshair" : "grab"}">${bullet}${body}${ports}</div>`;
      };
      const selShapes = () => [...selSet].map(byId).filter((n) => n && n.type === "shape");
      const selLinks = () => (hooks.canEditLinks ? [...selSet].map(byId).filter((n) => n && n.type === "link") : []);
      function drawNodes() {
        nodesEl.innerHTML = nodes.map(nodeHtml).join("");
        refreshIcons();
        const hasShape = selShapes().length > 0;
        colorsEl.classList.toggle("hidden", !hasShape);
        colorsEl.classList.toggle("flex", hasShape);
        delBtn.disabled = !(selEdge || hasShape || selLinks().length);
        $$("[data-tool]", host).forEach((b) => b.setAttribute("aria-pressed", (b.dataset.tool === "line" && lineMode) || (b.dataset.tool === "all" && selSet.size && selSet.size === nodes.length) ? "true" : "false"));
        if (lineMode) status.textContent = lineFrom ? t("home.mapLinePick") : t("home.mapLineStart");
      }
      const paint = () => (drawNodes(), drawEdges());
      async function save() {
        if (!dirty) return;
        clearTimeout(saveTimer);
        const canvas = { nodes, edges, map: true }; // map: 这个文件夹有心智图 → 一打开就显示心智图
        const { error } = await sb.rpc("gw_save_folder_canvas", { p_folder: f.id, p_canvas: canvas });
        if (error) return ((status.textContent = t("home.saveFailed")), toast(t("home.saveFailed") + " (" + (error.message || "") + ")"));
        dirty = false;
        f.canvas = canvas;
        if (!lineMode) status.textContent = t("home.mapSaved");
      }
      const markDirty = () => {
        dirty = true;
        if (!lineMode) status.textContent = t("home.mapUnsaved");
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 800);
      };
      async function delSel() {
        if (selEdge) edges = edges.filter((e) => e.id !== selEdge);
        const dropNodes = selShapes();
        // 连结图示：整个连结删掉（拥有者）；先问一下
        const lk = selLinks();
        if (lk.length) {
          const ok = await confirmDialog(t("home.mapDeleteIconTitle"), t("home.mapDeleteIconBody", { count: lk.length }), t("home.delete"), t("home.cancel"));
          if (ok) {
            dropNodes.push(...lk);
            lk.forEach((n) => removeLink(n.ref));
          }
        }
        dropNodes.forEach((n) => {
          nodes.splice(nodes.indexOf(n), 1);
          edges = edges.filter((e) => e.from.n !== n.id && e.to.n !== n.id);
        });
        selEdge = null;
        selSet = new Set();
        markDirty();
        paint();
      }
      // 条列：选到的（没选就全部）排成一直栏，前面一个点；App / 连结变成一行一个（图示在左、名字在右）；再按一次就还原
      function bullets() {
        const targets = (selSet.size ? nodes.filter((n) => selSet.has(n.id)) : nodes.slice()).sort((a, b) => a.y - b.y || a.x - b.x);
        if (!targets.length) return;
        const undo = targets.every((n) => n.bullet);
        let y = 48;
        targets.forEach((n) => {
          n.bullet = !undo;
          if (n.type !== "shape") ((n.w = undo ? NODE_W : ROW_W), (n.h = undo ? NODE_H : ROW_H));
          if (!undo) ((n.x = 72), (n.y = y), (y = snap(y + n.h + 16)));
        });
        markDirty();
        paint();
      }
      function editText(id) {
        const el = $(`[data-node="${id}"] [data-text]`, nodesEl);
        if (!el) return;
        el.contentEditable = "true";
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s0 = getSelection();
        s0.removeAllRanges();
        s0.addRange(range);
        const done = () => {
          el.contentEditable = "false";
          const n = byId(id);
          const txt = (el.innerText || "").trim().slice(0, 200);
          if (n && txt !== (n.text || "")) ((n.text = txt), markDirty());
          paint();
        };
        el.addEventListener("blur", done, { once: true });
        el.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if ((ev.key === "Enter" && !ev.shiftKey) || ev.key === "Escape") (ev.preventDefault(), el.blur());
        });
      }
      nodesEl.addEventListener("keydown", (ev) => {
        if (!ev.target.matches("[data-link-name]")) return;
        ev.stopPropagation();
        if (ev.key === "Enter" || ev.key === "Escape") (ev.preventDefault(), finishLinkEdit());
      });
      // 长按连结图示：抖动 + 名字可以打字 + 换图示；按 ✓ 或点别的地方就存（App 的名字不能改）
      async function finishLinkEdit() {
        if (!linkEdit) return;
        const n = byId(linkEdit);
        const el = $(`[data-node="${linkEdit}"] [data-link-name]`, nodesEl);
        linkEdit = null;
        const l = n && links.find((x) => x.id === n.ref);
        const name = el ? (el.innerText || "").trim().slice(0, 40) : "";
        if (l && name && name !== l.name) {
          const { error } = await sb.from("gw_user_links").update({ name }).eq("id", l.id);
          if (error) toast(t("home.saveFailed"));
          else ((l.name = name), draw());
        }
        paint();
      }
      async function pickLinkIcon(key) {
        const n = linkEdit && byId(linkEdit);
        const l = n && links.find((x) => x.id === n.ref);
        if (!l || l.icon === key) return;
        const { error } = await sb.from("gw_user_links").update({ icon: key }).eq("id", l.id);
        if (error) return toast(t("home.saveFailed"));
        l.icon = key;
        draw();
        paint();
      }
      const onKey = (e) => {
        if (!document.body.contains(host) || (e.target && e.target.isContentEditable) || document.querySelector(".gw-modal")) return;
        if ((e.key === "Delete" || e.key === "Backspace") && (selEdge || selShapes().length || selLinks().length)) (e.preventDefault(), delSel());
      };
      document.addEventListener("keydown", onKey);
      host.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.pickIcon) return pickLinkIcon(b.dataset.pickIcon);
        if ("linkOk" in b.dataset) return finishLinkEdit();
        if (b.dataset.add) {
          const shape = b.dataset.add;
          const w = shape === "diamond" ? 144 : 168, h = shape === "diamond" ? 96 : 72;
          // 放在看得到的范围里第一个没被盖到的格子
          const free = (x, y) => !nodes.some((o) => x < o.x + o.w + GRID && x + w + GRID > o.x && y < o.y + o.h + GRID && y + h + GRID > o.y);
          let x = snap(scrollEl.scrollLeft + 48), y = snap(scrollEl.scrollTop + 48);
          const right = Math.min(W - w, scrollEl.scrollLeft + scrollEl.clientWidth - w - 24);
          for (let tries = 0; tries < 400 && !free(x, y); tries++) {
            x += GRID * 2;
            if (x > right) ((x = snap(scrollEl.scrollLeft + 48)), (y += GRID * 2));
          }
          const n = { id: uid(), type: "shape", shape, text: "", color: "slate", x, y: Math.min(y, H - h), w, h };
          nodes.push(n);
          selSet = new Set([n.id]);
          selEdge = null;
          markDirty();
          paint();
          return editText(n.id);
        }
        if (b.dataset.tool === "icon") return linkDialog(null, { folderId: f.id, onSaved: hooks.reopen });
        if (b.dataset.tool === "line") {
          lineMode = !lineMode;
          lineFrom = null;
          if (!lineMode) status.textContent = "";
          return paint();
        }
        if (b.dataset.tool === "all") {
          selSet = selSet.size === nodes.length ? new Set() : new Set(nodes.map((n) => n.id));
          selEdge = null;
          return paint();
        }
        if (b.dataset.tool === "bullets") return bullets();
        if (b.dataset.color) {
          const list = selShapes();
          if (list.length) (list.forEach((n) => (n.color = b.dataset.color)), markDirty(), paint());
          return;
        }
        if ("del" in b.dataset) return delSel();
      });
      const pt = (e) => {
        const r = canvasEl.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      canvasEl.addEventListener("pointerdown", (e) => {
        if (e.button || !canEdit) return;
        if (linkEdit) {
          // 正在改连结图示：点它自己里面不动；点别处 = 存
          if (e.target.closest(`[data-node="${linkEdit}"]`)) return;
          return finishLinkEdit();
        }
        const portEl = e.target.closest("[data-port]");
        if (portEl && !lineMode) {
          const [n, sd] = portEl.dataset.port.split(":");
          drag = { kind: "link", from: { n, s: sd } };
          canvasEl.setPointerCapture(e.pointerId);
          return e.preventDefault();
        }
        const nodeEl = e.target.closest("[data-node]");
        if (nodeEl) {
          if (e.target.isContentEditable) return;
          const n = byId(nodeEl.dataset.node);
          if (lineMode) {
            // 画线：点第一个，再点第二个
            if (!lineFrom) lineFrom = n.id;
            else {
              const a = byId(lineFrom);
              const [sa, sb2] = autoSides(a, n);
              if (addEdge({ n: a.id, s: sa }, { n: n.id, s: sb2 })) markDirty();
              lineFrom = null;
            }
            return paint();
          }
          const [x, y] = pt(e);
          if (!selSet.has(n.id)) ((selSet = new Set([n.id])), (selEdge = null), paint());
          drag = { kind: "move", id: n.id, x0: x, y0: y, start: new Map([...selSet].map((id) => [id, { x: byId(id).x, y: byId(id).y }])), moved: false };
          canvasEl.setPointerCapture(e.pointerId);
          if (hooks.canEditLinks && n.type === "link") {
            clearTimeout(lp);
            const pid = e.pointerId;
            lp = setTimeout(() => {
              lp = null;
              if (!drag || drag.moved) return;
              drag = null;
              try { canvasEl.releasePointerCapture(pid); } catch (_e) { /* 忽略 */ }
              linkEdit = n.id;
              selSet = new Set();
              paint();
              const el = $(`[data-node="${n.id}"] [data-link-name]`, nodesEl);
              if (el) el.focus();
            }, 600);
          }
          return e.preventDefault();
        }
        const edgeEl = e.target.closest("[data-edge]");
        if (edgeEl) return ((selEdge = edgeEl.dataset.edge), (selSet = new Set()), paint());
        if (selSet.size || selEdge || lineFrom) ((selSet = new Set()), (selEdge = null), (lineFrom = null), paint());
        if (lineMode) return;
        // 空白处按住拖：拉一个框选好几个
        const [x, y] = pt(e);
        drag = { kind: "box", x0: x, y0: y, moved: false };
        canvasEl.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      const boxRect = (x, y) => ({ x: Math.min(drag.x0, x), y: Math.min(drag.y0, y), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) });
      canvasEl.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const [x, y] = pt(e);
        if (drag.kind === "move") {
          const dx = x - drag.x0, dy = y - drag.y0;
          if (lp && Math.hypot(dx, dy) > 6) (clearTimeout(lp), (lp = null));
          drag.start.forEach((s0, id) => {
            const n = byId(id);
            if (!n) return;
            n.x = Math.max(0, Math.min(W - n.w, snap(s0.x + dx)));
            n.y = Math.max(0, Math.min(H - n.h, snap(s0.y + dy)));
            const el = $(`[data-node="${n.id}"]`, nodesEl);
            if (el) ((el.style.left = n.x + "px"), (el.style.top = n.y + "px"));
          });
          drag.moved = true;
          drawEdges();
        } else if (drag.kind === "box") {
          const r = boxRect(x, y);
          drag.moved = drag.moved || r.w > 4 || r.h > 4;
          marquee.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
          marquee.classList.toggle("hidden", !drag.moved);
        } else {
          const [x1, y1] = port(byId(drag.from.n), drag.from.s);
          temp.setAttribute("d", `M${x1} ${y1} L${x} ${y}`);
          temp.style.display = "";
        }
      });
      const endDrag = (e) => {
        clearTimeout(lp);
        lp = null;
        if (!drag) return;
        if (drag.kind === "move") {
          if (drag.moved) markDirty();
        } else if (drag.kind === "box") {
          marquee.classList.add("hidden");
          if (drag.moved) {
            const [x, y] = pt(e);
            const r = boxRect(x, y);
            selSet = new Set(nodes.filter((n) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y).map((n) => n.id));
            selEdge = null;
          }
        } else {
          temp.style.display = "none";
          const under = document.elementFromPoint(e.clientX, e.clientY);
          const target = under && (under.closest("[data-port]") || under.closest("[data-node]"));
          if (target) {
            let n, sd;
            if (target.dataset.port) [n, sd] = target.dataset.port.split(":");
            else {
              n = target.dataset.node;
              const b = byId(n);
              const [x, y] = pt(e);
              const dl = x - b.x, dr = b.x + b.w - x, dt = y - b.y, db = b.y + b.h - y;
              const m = Math.min(dl, dr, dt, db);
              sd = m === dl ? "l" : m === dr ? "r" : m === dt ? "t" : "b";
            }
            if (addEdge(drag.from, { n, s: sd })) markDirty();
          }
        }
        drag = null;
        paint();
      };
      canvasEl.addEventListener("pointerup", endDrag);
      canvasEl.addEventListener("pointercancel", () => ((drag = null), (temp.style.display = "none"), paint()));
      canvasEl.addEventListener("dblclick", (e) => {
        if (lineMode || linkEdit) return;
        const nodeEl = e.target.closest("[data-node]");
        if (!nodeEl) return;
        const n = byId(nodeEl.dataset.node);
        if (!n) return;
        if (n.type === "shape") return canEdit && editText(n.id);
        if (n.type === "app") return hooks.openApp(n.ref);
        const l = links.find((x) => x.id === n.ref);
        if (l) window.open(l.url, "_blank", "noopener,noreferrer");
      });
      paint();
      if (canEdit && !cv.map) markDirty(); // 第一次打开心智图：记下来，之后这个文件夹一打开就是心智图
      return {
        flush: () => {
          document.removeEventListener("keydown", onKey);
          clearTimeout(saveTimer);
          if (dirty) save();
        },
        onEscape: () => {
          if (linkEdit) return (finishLinkEdit(), true);
          if (!lineMode) return false;
          lineMode = false;
          lineFrom = null;
          status.textContent = "";
          paint();
          return true;
        },
      };
    }

    // 图示颜色：全部一起选（柔和 / 多彩 / 单一颜色），也可以一个一个 App 自己选
    async function saveIcons() {
      const w = board();
      if (!w) return;
      w.config = { ...(w.config || {}), icons: { style: ICON.style, apps: ICON.apps } };
      const { error } = await sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id);
      if (error) toast(t("home.saveFailed"));
    }
    function iconColorsDialog() {
      const swatch = (key, on, attr, label) =>
        `<button type="button" ${attr} aria-label="${esc(label)}" title="${esc(label)}" class="size-8 shrink-0 rounded-full border-2 ${on ? "border-slate-900 dark:border-white" : "border-white dark:border-slate-700"} shadow" style="background:${PALETTE[key][1]}"></button>`;
      const styleBtn = (key, label, on) => `<button type="button" data-ic-style="${key}" class="rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"}">${esc(label)}</button>`;
      const dlg = modal(t("fab.iconColors"), "", { wide: true });
      const draw2 = () => {
        dlg.el.innerHTML = `<div class="space-y-5">
          <div>
            <p class="mb-2 ${cls.label}">${esc(t("home.iconAll"))}</p>
            <div class="flex flex-wrap items-center gap-2">
              ${styleBtn("calm", t("home.iconCalm"), ICON.style === "calm")}${styleBtn("colorful", t("home.iconColorful"), ICON.style === "colorful")}
              <span class="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700"></span>
              ${Object.keys(PALETTE).map((k) => swatch(k, ICON.style === k, `data-ic-style="${k}"`, t("home.color." + k))).join("")}
            </div>
          </div>
          <div>
            <p class="mb-2 ${cls.label}">${esc(t("home.iconEach"))}</p>
            <div class="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              ${data.modules
                .map(
                  (m) => `<div class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                    ${appIcon(m, "size-10")}
                    <span class="min-w-0 flex-1 basis-28 truncate text-sm font-medium">${esc(m.name)}</span>
                    <span class="flex flex-wrap items-center gap-1.5">
                      <button type="button" data-ic-app="${m.id}" data-color="" class="rounded-full border px-2 py-1 text-xs ${ICON.apps[m.id] ? "border-slate-300 text-slate-500 dark:border-slate-700" : "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100"}">${esc(t("home.iconAuto"))}</button>
                      ${Object.keys(PALETTE).map((k) => swatch(k, ICON.apps[m.id] === k, `data-ic-app="${m.id}" data-color="${k}"`, t("home.color." + k))).join("")}
                    </span>
                  </div>`,
                )
                .join("")}
            </div>
          </div>
          <div class="flex justify-end"><button type="button" data-done class="${btn("primary")}">${esc(t("home.save"))}</button></div>
        </div>`;
        refreshIcons();
      };
      draw2();
      dlg.el.addEventListener("click", async (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if ("done" in b.dataset) return dlg.close();
        if (b.dataset.icStyle) {
          ICON.style = b.dataset.icStyle;
          ICON.apps = {}; // 选了整体风格，个别设定清掉，从头开始
        } else if (b.dataset.icApp) {
          if (b.dataset.color) ICON.apps[b.dataset.icApp] = b.dataset.color;
          else delete ICON.apps[b.dataset.icApp];
        } else return;
        draw2();
        draw();
        saveIcons();
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
      if (!folder) return newFolderDialog();
      const dlg = modal(
        t("home.editFolder"),
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

    // 新文件夹：先选 Own use（只有自己看）或 Shared（分享给同 Business 的同事），再取名；分享用的建好就选分享给谁
    function newFolderDialog() {
      const choice = (v, ic, title, hint, on) => `<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-checked:border-slate-900 has-checked:bg-slate-50 dark:border-slate-700 dark:has-checked:border-white dark:has-checked:bg-white/5">
          <input type="radio" name="kind" value="${v}" ${on ? "checked" : ""} class="mt-1 size-4 accent-slate-900">
          ${icon(ic, "mt-0.5 size-5 shrink-0 text-slate-500")}
          <span class="min-w-0"><span class="block text-sm font-medium">${esc(title)}</span><span class="block text-xs text-slate-500">${esc(hint)}</span></span>
        </label>`;
      const dlg = modal(
        t("fab.newFolder"),
        `<form class="space-y-4">
          <div data-err></div>
          <div class="grid gap-2 sm:grid-cols-2">
            ${choice("own", "folder", t("home.folderOwn"), t("home.folderOwnHint"), true)}
            ${choice("shared", "users", t("home.folderShared"), t("home.folderSharedHint"), false)}
          </div>
          <input name="name" maxlength="40" required placeholder="${esc(t("home.folderName"))}" class="${cls.input}">
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(t("home.save"))}</button>
          </div>
        </form>`,
      );
      refreshIcons();
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      const form = $("form", dlg.el);
      $("[name=name]", form).focus();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = form.name.value.trim();
        if (!name) return;
        const shared = form.kind.value === "shared";
        const submit = $("button[type=submit]", form);
        submit.disabled = true;
        const row = { user_id: data.profile.id, name, color: "slate", sort_order: nextSlot(1, 1), ...(shared ? { is_shared: true } : {}) };
        const { data: created, error } = await sb.from("gw_user_folders").insert(row).select("id, name, color, sort_order, collapsed").single();
        if (error) {
          submit.disabled = false;
          return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(shared && /is_shared/.test(error.message || "") ? t("home.sharedNeedsDb") : t("home.saveFailed")));
        }
        if (shared) created.is_shared = true;
        folders.push(created);
        dlg.close();
        draw();
        if (shared) sharePicker(created);
      });
    }

    // 分享给谁（像 Google Drive）：同 Business 的在职同事（gw_folder_share_candidates），勾选 + 每个人 Can view / Can edit → 存 gw_folder_shares
    async function sharePicker(f) {
      const cand = await sb.rpc("gw_folder_share_candidates");
      let cur = await sb.from("gw_folder_shares").select("user_id, role").eq("folder_id", f.id);
      const rolesOn = !(cur.error && /role/.test(cur.error.message || ""));
      if (!rolesOn) cur = await sb.from("gw_folder_shares").select("user_id").eq("folder_id", f.id);
      if (cand.error || cur.error) return toast(t("home.sharedNeedsDb"));
      const on = new Map((cur.data || []).map((x) => [x.user_id, x.role || "edit"]));
      // 已经分享的排前面
      const list = (cand.data || []).slice().sort((x, y) => (on.has(y.id) ? 1 : 0) - (on.has(x.id) ? 1 : 0) || (x.full_name || "").localeCompare(y.full_name || ""));
      const roleSel = (id, role, show) => `<select data-role="${id}" aria-label="${esc(t("home.shareRole"))}" class="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 ${show ? "" : "invisible"}">
          <option value="view" ${role === "view" ? "selected" : ""}>${esc(t("home.shareRoleView"))}</option>
          <option value="edit" ${role === "edit" ? "selected" : ""}>${esc(t("home.shareRoleEdit"))}</option>
        </select>`;
      const dlg = modal(
        t("home.shareTitle", { name: f.name }),
        `<div class="space-y-3">
          ${list.length ? `<div class="relative"><span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">${icon("search")}</span><input data-q type="search" placeholder="${esc(t("home.shareSearch"))}" class="${cls.input} pl-9"></div>` : ""}
          <div class="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${
            list.length
              ? list
                  .map(
                    (u) => `<div data-row="${esc(((u.full_name || "") + " " + (u.email || "")).toLowerCase())}" class="flex items-center gap-3 px-3 py-2 text-sm">
                      <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input type="checkbox" data-pick="${u.id}" ${on.has(u.id) ? "checked" : ""} class="size-4 accent-emerald-600">
                        <span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(u.full_name || "")}</span><span class="block truncate text-xs text-slate-500">${esc(u.email || "")}</span></span>
                      </label>
                      ${rolesOn ? roleSel(u.id, on.get(u.id) || "view", on.has(u.id)) : ""}
                    </div>`,
                  )
                  .join("")
              : `<p class="px-3 py-6 text-center text-sm text-slate-400">${esc(t("home.shareNone"))}</p>`
          }</div>
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button>
            <button type="button" data-save class="${btn("primary")}">${esc(t("home.save"))}</button>
          </div>
        </div>`,
        { wide: true },
      );
      refreshIcons();
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      const q = $("[data-q]", dlg.el);
      if (q) q.addEventListener("input", () => { const v = q.value.trim().toLowerCase(); $$("[data-row]", dlg.el).forEach((r) => r.classList.toggle("hidden", !!v && !r.dataset.row.includes(v))); });
      dlg.el.addEventListener("change", (e) => {
        if (!e.target.dataset.pick) return;
        const sel = $(`[data-role="${e.target.dataset.pick}"]`, dlg.el);
        if (sel) sel.classList.toggle("invisible", !e.target.checked);
      });
      $("[data-save]", dlg.el).onclick = async () => {
        const picked = new Map($$("[data-pick]:checked", dlg.el).map((x) => [x.dataset.pick, rolesOn ? $(`[data-role="${x.dataset.pick}"]`, dlg.el).value : "edit"]));
        const add = [...picked.keys()].filter((id) => !on.has(id));
        const drop = [...on.keys()].filter((id) => !picked.has(id));
        const changed = [...picked].filter(([id, role]) => on.has(id) && on.get(id) !== role);
        const fail = (error) => (($("[data-save]", dlg.el).disabled = false), toast(t("home.saveFailed") + (error && error.message ? " (" + error.message + ")" : "")));
        $("[data-save]", dlg.el).disabled = true;
        if (add.length) {
          const { error } = await sb.from("gw_folder_shares").insert(add.map((user_id) => ({ folder_id: f.id, user_id, ...(rolesOn ? { role: picked.get(user_id) } : {}) })));
          if (error) return fail(error);
        }
        for (const [id, role] of changed) {
          const { error } = await sb.from("gw_folder_shares").update({ role }).eq("folder_id", f.id).eq("user_id", id);
          if (error) return fail(error);
        }
        if (drop.length) {
          const { error } = await sb.from("gw_folder_shares").delete().eq("folder_id", f.id).in("user_id", drop);
          if (error) return fail(error);
        }
        dlg.close();
        toast(t("home.shareSaved", { count: picked.size }));
      };
    }

    async function deleteFolder(fid) {
      const f = folders.find((x) => x.id === fid);
      if (f.shared_by) {
        // 分享给我的：只是从我的主页拿掉（退出分享），文件夹本身是对方的
        const ok = await confirmDialog(t("home.leaveSharedTitle"), t("home.leaveSharedBody", { name: f.name }), t("home.leaveShared"), t("home.cancel"));
        if (!ok) return;
        folders = folders.filter((x) => x.id !== fid);
        links = links.filter((l) => l.folder_id !== fid);
        sharedApps.delete(fid);
        draw();
        const { error } = await sb.from("gw_folder_shares").delete().eq("folder_id", fid).eq("user_id", data.profile.id);
        if (error) toast(t("home.saveFailed"));
        return;
      }
      const ok = await confirmDialog(t("home.deleteFolderTitle"), t("home.deleteFolderBody", { name: f.name }), t("home.delete"), t("home.cancel"));
      if (!ok) return;
      // 文件夹里的 App 回到主画面的空格
      const ids = folderApps(fid);
      const lks = folderLinks(fid);
      folders = folders.filter((x) => x.id !== fid);
      lks.forEach((l) => {
        l.folder_id = null;
        l.sort_order = nextSlot(1, 1);
      });
      const moved = ids.map((id) => {
        const slot = nextSlot(1, 1);
        layout.set(id, { folder_id: null, sort_order: slot });
        return { module_id: id, folder_id: null, sort_order: slot };
      });
      draw();
      await Promise.all(lks.map((l) => sb.from("gw_user_links").update({ folder_id: null, sort_order: l.sort_order }).eq("id", l.id)));
      const { error } = await sb.from("gw_user_folders").delete().eq("id", fid);
      if (error) return toast(t("home.saveFailed"));
      await saveApps(moved);
    }

    // 从 Business 区块点开的模块：带上区块里选的 Company（或这个 Business 唯一的 Company），
    // 以及这家 Company 在那个系统里的代码（Connector 设定的），让系统开起来就是这家公司
    function companyContext(gid, moduleId) {
      if (!sectionsOn) return null;
      // 不是从区块点开的（Dock、最近用过、搜寻、文件夹）：找这个模块属于哪个 Business，用那个区块选的 Company
      if (!gid) {
        const gids = S.groupModules.filter((x) => x.module_id === moduleId).map((x) => x.group_id);
        gid = gids.find((g) => companyContext(g, moduleId)) || null;
        if (!gid) return null;
      }
      const list = companiesOf(gid);
      const sel = selectedCompany(gid);
      const c = sel === "all" ? (list.length === 1 ? list[0] : null) : list.find((x) => x.id === sel);
      if (!c) return null;
      // Connector 里设的代码：先找这个模块的；没有就找同一个系统（网址同一个主机）别的模块的
      const origin = (id) => { try { return new URL(modules.get(id).url).origin; } catch (e) { return ""; } };
      const maps = (S.companyMappings || []).filter((x) => x.company_id === c.id);
      const map = maps.find((x) => x.module_id === moduleId) || maps.find((x) => modules.has(x.module_id) && origin(x.module_id) && origin(x.module_id) === origin(moduleId));
      return { company: (map && map.external_id) || c.name, company_name: c.name, company_short: c.short_name || c.code || "" };
    }

    async function open(id, gid) {
      if (readOnly || editing || Date.now() - lastDragEnd < 300) return;
      const m = modules.get(id);
      data.recent = [id, ...data.recent.filter((x) => x !== id)].slice(0, 5);
      if (m.is_new) {
        m.is_new = false;
        if (sectionsOn) sb.rpc("gw_mark_seen", { p_modules: [id] });
      }
      const ok = await openModule(m, companyContext(gid, id));
      if (!ok) toast(t("home.openFailed"));
    }

    // ------------------------------------------------------------ 事件（委派）
    let noteTimer;
    root.addEventListener("click", (e) => {
      if (Date.now() - lastDragEnd < 400) return; // 刚拖完，不算点击
      // 编辑中点空白处（不是图示、小工具、按钮）：离开编辑
      if (sectionsOn && editing && downOnEmpty && !e.target.closest(EDIT_KEEP)) return setEditing(false);
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) {
        if (sectionsOn && companyMenuGid) return ((companyMenuGid = null), draw());
        if (fabOpen && !e.target.closest("[data-fab-toggle]")) ((fabOpen = false), draw());
        return;
      }
      const d = b.dataset;
      if (sectionsOn) {
        if (companyMenuGid && !("companyMenu" in d) && !("companyPick" in d)) companyMenuGid = null;
        if ("companyMenu" in d) return ((companyMenuGid = companyMenuGid === d.companyMenu ? null : d.companyMenu), draw());
        if ("companyPick" in d) {
          companyMenuGid = null;
          companySel.set(d.gid, d.companyPick);
          draw();
          const w = board();
          if (!w) return;
          w.config = { ...(w.config || {}), companies: Object.fromEntries(companySel) };
          return sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id).then(({ error }) => error && toast(t("home.saveFailed")));
        }
        if (d.mode) return stepBox(d.gid || b.closest("[data-sec-key]").dataset.secKey, d.mode);
        if (d.openFolder) return openBoxFolder(d.openFolder);
        if (d.openNote) return itemDialog(sItems.find((x) => x.id === d.openNote), null, "note");
        if (d.removeFw) return removeWidget(d.removeFw);
        if (d.hideMod) return hideModule(d.gid, d.hideMod, true);
        if (d.unhide) return hideModule(...d.unhide.split(":"), false);
        if (d.delItem) return deleteBoxItem(sItems.find((x) => x.id === d.delItem));
        if ("weatherRetry" in d) return ((weather = null), $$("[data-weather]", root).forEach((el) => (el.innerHTML = weatherInner(el.dataset.weather))), loadWeather(true));
      }
      if (d.open) return open(d.open, d.gid);
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
      if (d.aiSuggest) return aiAsk(d.aiSuggest);
      if (d.aiDl) return aiDownload(d.aiDl);
      if ("aiClear" in d) return ((aiMsgs = []), aiSave(), draw());
      if (d.react) return toggleReaction(...d.react.split(":"));
      if (d.who) return whoReacted(...d.who.split(":"));
      if (d.editNotice) return postNotice(data.announcements.find((a) => a.id === d.editNotice));
      if (d.delNotice) return deleteNotice(d.delNotice);
      if ("fabToggle" in d) return ((fabOpen = !fabOpen), draw());
      if (d.fab) {
        fabOpen = false;
        if (d.fab === "icons") return draw(), iconColorsDialog();
        if (d.fab === "tidy") return draw(), tidyWidgets();
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
        const match = (m) => [m.name, m.code, m.description].some((v) => v && v.toLowerCase().includes(q));
        // 区块版：同一个模块在好几个 Business 都有，所以每个结果都写上它属于哪个 Business（和 Company），才不会进错
        let hits;
        if (sectionsOn && q) {
          hits = [];
          S.groups.forEach((g) => modsOfGroup(g.id).forEach((m) => {
            if (!match(m)) return;
            const cs = companiesOf(g.id);
            const tagged = cs.filter((c) => S.moduleCompanies.some((x) => x.module_id === m.id && x.company_id === c.id));
            const names = (tagged.length ? tagged : cs.length === 1 ? cs : []).map((c) => c.short_name || c.code || c.name);
            hits.push({ m, label: g.name + (names.length ? " · " + names.join(", ") : "") });
          }));
          hits = hits.slice(0, 8);
        } else hits = q ? data.modules.filter(match).slice(0, 6).map((m) => ({ m, label: "" })) : [];
        box.innerHTML = q && !hits.length
          ? `<p class="text-sm text-slate-400">${esc(t("home.noResults"))}</p>`
          : hits.map(({ m, label }) => `<button type="button" data-open="${m.id}" class="no-drag flex w-24 shrink-0 flex-col items-center gap-1">${appIcon(m, "size-11")}<span class="w-full truncate text-center text-[11px] font-medium">${esc(m.name)}</span>${label ? `<span class="w-full truncate text-center text-[10px] text-slate-500" title="${esc(label)}">${esc(label)}</span>` : ""}</button>`).join("");
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

    if (sectionsOn) widgets.filter(isFloating).forEach(migratePos); // 旧版 px 位置换成格子（只在记忆中）
    draw();
    loadShared();
  }

  return { render, WIDGETS };
})();
