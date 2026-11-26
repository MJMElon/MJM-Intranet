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
       style：glass（预设，白色毛玻璃，像 iPhone 锁定画面的按钮）/ calm（柔和低调）/ colorful（原本的多彩）/ 或固定一个颜色（全部图示同一个颜色）
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
  let ICON = { style: "glass", apps: {} };
  const hashOf = (code) => [...String(code)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  // 渐层色的 class；白色（glass）风格而且没有自己选颜色时回 null
  const tileColor = (code, id, color) => {
    if (color && PALETTE[color]) return PALETTE[color][0]; // 连结自己选的颜色
    const own = id && ICON.apps[id];
    if (own && PALETTE[own]) return PALETTE[own][0];
    if (PALETTE[ICON.style]) return PALETTE[ICON.style][0];
    if (ICON.style === "glass") return null;
    const list = ICON.style === "colorful" ? COLORFUL : CALM;
    return list[hashOf(code) % list.length];
  };
  // 文件夹里的小方块一定要有颜色
  const miniColor = (code, id, color) => tileColor(code, id, color) || "from-slate-300 to-slate-500";
  // 白色毛玻璃图示（预设）：白底、细边、深色符号
  const GLASS = "gw-icon-glass border border-white/80 bg-white/75 text-slate-700 backdrop-blur-md dark:border-white/15 dark:bg-white/15 dark:text-white";

  // 小工具种类与可选大小
  const WIDGETS = {
    // 问候、搜寻：已停用（不再提供，主页上旧的也不显示）
    greeting: { sizes: ["medium"], icon: "sun", hidden: true, retired: true },
    clock: { sizes: ["small", "medium"], icon: "clock" },
    search: { sizes: ["medium"], icon: "search", hidden: true, retired: true },
    // 最近打开：已停用（不再提供，主页上旧的也不显示）
    recent: { sizes: ["small", "medium"], icon: "history", hidden: true, retired: true },
    // Notice Board：固定在最上面，只能调大小，不能移动、不能删除，也不能再加第二个
    announcements: { sizes: ["medium", "large"], icon: "megaphone", hidden: true, pinned: true },
    calendar: { sizes: ["small", "medium"], icon: "calendar" },
    weather: { sizes: ["small", "medium"], icon: "cloud-sun" },
    ai: { sizes: ["medium", "large"], icon: "bot", soon: true }, // 还没开放：列在最后、灰掉
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
    // 公告是哪个 Business 的：Business 名称；没有 Business = 给每个人
    const groupNames = (opts && opts.groupNames) || {};
    const noticeBiz = (a) => (a.group_id ? groupNames[a.group_id] || t("widgets.business") : t("widgets.postEveryone"));
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
      // 新设计（白色 glass）之前存的图示设定（任何风格、每个 App 的颜色）都换成 glass 一次；之后存的都带 v: 2，照用户选的
      const fresh = saved && saved.v === 2;
      ICON = fresh ? { style: saved.style || "glass", apps: { ...(saved.apps || {}) } } : { style: "glass", apps: {} };
    }
    let folders = data.folders.map((f) => ({ ...f }));
    let widgets = widgetsEnabled ? opts.widgets.map((w) => ({ ...w })).filter((w) => !(WIDGETS[w.widget_type] || {}).retired) : [];
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
      links.filter((l) => !l.folder_id).forEach((l) => items.push({ kind: "link", id: l.id, slot: l.sort_order, w: 1, h: 1 }));
      folders.filter((f) => !boxesOf(f).length || homeCopyOf(f.id) != null).forEach((f) => items.push({ kind: "folder", id: f.id, slot: boxesOf(f).length ? homeCopyOf(f.id) : f.sort_order, w: 1, h: 1 }));
      widgets.filter((w) => !isPinned(w) && !isFloating(w)).forEach((w) => items.push({ kind: "widget", id: w.id, slot: w.sort_order, w: SIZES[w.size][0], h: SIZES[w.size][1] }));
      return items.sort((a, b) => a.slot - b.slot || a.kind.localeCompare(b.kind));
    }
    const folderLinks = (fid) => links.filter((l) => l.folder_id === fid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    /* 分享给我的文件夹（folder.shared_by = 拥有者）：文件夹、连结、App 都是对方的，我只能看、打开，位置记在 gw_folder_shares；
       里面的 App 只显示我自己也有权限的。自己的文件夹 is_shared = 分享用（可以选分享给谁）。 */
    const sharedApps = new Map(); // 分享给我的文件夹 → 里面的 App（module id）
    const folderBiz = new Map(); // 文件夹 → 分享给哪些 Business [{ group_id, company_id, role }]
    let bizTableOn = false; // 资料库有 gw_folder_business_shares（新 SQL 跑过）
    const myGroups = new Set((opts && opts.memberOf) || []);
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
      const TAGS = "tag_group_id, tag_company_id, tag_role";
      let mineRes = await sb.from("gw_user_folders").select("id, is_shared, canvas, " + TAGS).eq("user_id", me);
      let tagCols = TAGS;
      if (mineRes.error && /tag_role/.test(mineRes.error.message || "")) ((tagCols = "tag_group_id, tag_company_id"), (mineRes = await sb.from("gw_user_folders").select("id, is_shared, canvas, " + tagCols).eq("user_id", me)));
      const tagsOn = !(mineRes.error && /tag_/.test(mineRes.error.message || ""));
      if (!tagsOn) mineRes = await sb.from("gw_user_folders").select("id, is_shared, canvas").eq("user_id", me); // 资料库还没加 Business 标签：照旧
      let shareRes = await sb.from("gw_folder_shares").select("folder_id, sort_order, role").eq("user_id", me);
      if (shareRes.error && /role/.test(shareRes.error.message || "")) shareRes = await sb.from("gw_folder_shares").select("folder_id, sort_order").eq("user_id", me); // 还没套用 role 的资料库：当作可以改
      if (mineRes.error || shareRes.error) return; // 资料库还没更新：没有分享功能，其他照常
      (mineRes.data || []).forEach((r) => Object.assign(folders.find((f) => f.id === r.id) || {}, { is_shared: !!r.is_shared, canvas: r.canvas, tag_group_id: r.tag_group_id || null, tag_company_id: r.tag_company_id || null, tag_role: r.tag_role || "view" }));
      const shares = shareRes.data || [];
      // 文件夹分享给哪些 Business（一个文件夹可以好几个）：RLS 只给我看得到的
      const bizAll = await sb.from("gw_folder_business_shares").select("folder_id, group_id, company_id, role");
      bizTableOn = !bizAll.error;
      if (bizTableOn) {
        folderBiz.clear();
        (bizAll.data || []).forEach((b) => folderBiz.set(b.folder_id, [...(folderBiz.get(b.folder_id) || []), b]));
      }
      // 还没跑新 SQL：用以前的单一 Business 设定
      const legacyBiz = (f) => (f.tag_group_id ? [{ folder_id: f.id, group_id: f.tag_group_id, company_id: f.tag_company_id || null, role: f.tag_role || "view" }] : []);
      folders.forEach((f) => !bizTableOn && folderBiz.set(f.id, legacyBiz(f)));
      const bizRes = bizTableOn ? { data: [...folderBiz.keys()].filter((id) => !folders.some((f) => f.id === id)).map((id) => ({ id })) } : tagsOn ? await sb.from("gw_user_folders").select("id").neq("user_id", me).not("tag_group_id", "is", null) : { data: [] };
      const ids = [...new Set([...shares.map((x) => x.folder_id), ...((bizRes.data || []).map((x) => x.id))])];
      if (ids.length) {
        const [fs, ls, ly] = await Promise.all([
          sb.from("gw_user_folders").select("id, user_id, name, color, collapsed, is_shared, canvas" + (tagsOn ? ", " + tagCols : "")).in("id", ids),
          sb.from("gw_user_links").select("*").in("folder_id", ids),
          sb.from("gw_user_layout").select("module_id, folder_id").in("folder_id", ids),
        ]).then((r) => r.map((x) => x.data || []));
        fs.forEach((f) => {
          if (folders.some((x) => x.id === f.id)) return;
          const sh = shares.find((x) => x.folder_id === f.id);
          // 权限：个人分享和 Business 分享取比较大的（有一个是 Editor 就是 Editor）
          if (!bizTableOn) folderBiz.set(f.id, legacyBiz(f));
          const mine = (folderBiz.get(f.id) || []).filter((b) => isSuper || myGroups.has(b.group_id));
          const viaBiz = mine.length ? (mine.some((b) => b.role === "edit") ? "edit" : "view") : null;
          const viaMe = sh ? sh.role || "edit" : null;
          folders.push({ ...f, shared_by: f.user_id, sort_order: sh ? sh.sort_order : 0, share_role: viaMe === "edit" || viaBiz === "edit" ? "edit" : "view" });
        });
        ls.forEach((l) => !links.some((x) => x.id === l.id) && links.push({ ...l }));
        ly.forEach((l) => sharedApps.set(l.folder_id, [...(sharedApps.get(l.folder_id) || []), l.module_id]));
      }
      draw();
      askTransfers();
    }
    // 有人要把文件夹转给我：问我接不接受（按「之后再说」下次打开首页会再问）
    async function askTransfers() {
      const { data: reqs, error } = await sb.rpc("gw_my_folder_transfers");
      if (error || !reqs || !reqs.length) return;
      for (const r of reqs) {
        const answer = await new Promise((resolve) => {
          const dlg = modal(
            t("home.transferInTitle"),
            `<div class="space-y-4">
              <p class="text-sm">${esc(t("home.transferInBody", { name: r.from_name || "", folder: r.folder_name || "" }))}</p>
              <div class="flex flex-wrap justify-end gap-2">
                <button type="button" data-a="later" class="${btn("ghost")}">${esc(t("home.transferLater"))}</button>
                <button type="button" data-a="no" class="${btn("secondary")}">${esc(t("home.transferDecline"))}</button>
                <button type="button" data-a="yes" class="${btn("primary")}">${esc(t("home.transferAccept"))}</button>
              </div>
            </div>`,
          );
          dlg.el.addEventListener("click", (e) => {
            const b = e.target.closest("[data-a]");
            if (b) (dlg.close(), resolve(b.dataset.a));
          });
        });
        if (answer === "later") continue;
        const { error: e2 } = await sb.rpc("gw_answer_folder_transfer", { p_folder: r.folder_id, p_accept: answer === "yes" });
        if (e2) toast(t("home.saveFailed") + " (" + (e2.message || "") + ")");
        else if (answer === "yes") {
          toast(t("home.transferDone"));
          return setTimeout(() => location.reload(), 600); // 文件夹换了主人：整页重新载入最单纯
        }
      }
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
        // 从 Business 区块复制到 My Home 的文件夹：位置记在自己的 Notice Board 设定里
        if (f && boxesOf(f).length && homeCopyOf(id) != null) return setHomeCopy(id, slot);
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

    // 只显示传到 Intranet 自己的图片（别的网站的图片会知道谁打开了）
    const ownPhoto = (u) => String(u).startsWith(GW_CONFIG.supabaseUrl + "/storage/v1/object/public/");
    function appIcon(m, size) {
      if (m.image_url && ownPhoto(m.image_url))
        return `<span class="gw-icon relative flex ${size || "size-14 sm:size-16"} overflow-hidden rounded-[26%] bg-white"><img src="${esc(m.image_url)}" alt="" class="size-full object-cover">${newDot(m)}</span>`;
      const grad = tileColor(m.code, m.id, m.color);
      const skin = grad ? `bg-gradient-to-br ${grad} text-white` : GLASS;
      const sym = size ? "size-[46%]" : "size-6 sm:size-7";
      return `<span class="gw-icon relative flex ${size || "size-14 sm:size-16"} items-center justify-center rounded-[26%] ${skin}">
        ${m.icon === "link" ? icon("link", sym) : moduleIcon(m.icon, sym)}${newDot(m)}
      </span>`;
    }

    // 个人连结图示
    function linkTile(l) {
      return `<div data-kind="link" data-id="${l.id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-open-link="${l.id}" class="flex flex-col items-center gap-1.5" title="${esc(l.url)}">
          ${appIcon({ code: l.name, icon: l.icon, image_url: l.image_url, color: l.color })}
          <span class="w-20 text-center text-xs leading-tight font-medium break-words text-slate-700 dark:text-slate-200">${esc(l.name)}</span>
        </button>
        ${editing ? badge(`data-remove-link="${l.id}"`, "minus", t("home.removeFromHome"), "top-0 left-1/2 -translate-x-[2.4rem]") + badge(`data-edit-link="${l.id}"`, "pencil", t("home.editLink"), "top-0 left-1/2 translate-x-[1rem]") : ""}
      </div>`;
    }

    function appTile(id) {
      const m = modules.get(id);
      return `<div data-kind="app" data-id="${id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-open="${id}" class="flex flex-col items-center gap-1.5" title="${esc(m.description || m.name)}">
          ${appIcon(m)}
          <span class="w-20 text-center text-xs leading-tight font-medium break-words text-slate-700 dark:text-slate-200">${esc(m.name)}</span>
        </button>
        ${editing ? badge(`data-remove-app="${id}"`, "minus", t("home.removeFromHome"), "top-0 left-1/2 -translate-x-[2.4rem]") + badge(`data-app-menu="${id}"`, "ellipsis", t("home.cardMenu"), "top-0 left-1/2 translate-x-[1rem]") : ""}
      </div>`;
    }

    function folderTile(f) {
      const ids = folderApps(f.id);
      const minis = [
        ...ids.map((id) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${miniColor(modules.get(id).code, id)}"></span>`),
        ...folderLinks(f.id).map((l) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${miniColor(l.name)}"></span>`),
      ].slice(0, 9).join("");
      return `<div data-kind="folder" data-id="${f.id}" class="gw-item relative flex flex-col items-center gap-1.5 pt-1">
        <button type="button" data-folder="${f.id}" class="flex flex-col items-center gap-1.5">
          <span class="grid size-14 grid-cols-3 grid-rows-3 content-start gap-1 gw-icon rounded-[26%] border border-white/60 bg-white/50 p-2 backdrop-blur-xl sm:size-16 dark:border-white/10 dark:bg-white/10">${minis}</span>
          <span class="w-20 text-center text-xs leading-tight font-medium break-words text-slate-700 dark:text-slate-200">${esc(f.name)}</span>
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
          const until = (d) => (d ? t("widgets.postUntil", { time: new Intl.DateTimeFormat(GW.LOCALE, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d)) }) : "");
          // 排好时间、还没到的公告：只有能发公告的人看得到（虚线框、写「Scheduled · 时间」），放在最后面
          const schedIds = new Set((data.scheduled || []).map((a) => a.id));
          const when2 = (d) => new Intl.DateTimeFormat(GW.LOCALE, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d));
          const meta = (a) => (schedIds.has(a.id) ? [t("widgets.postScheduledBadge", { time: when2(a.starts_at) }), until(a.ends_at)] : [when(a.starts_at), a.author, until(a.ends_at)]).filter(Boolean).join(" · ");
          return `<div class="${allNotices().length ? "mb-2" : ""} flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-100">${icon("megaphone", "size-4 text-brand-600 dark:text-brand-400")}${esc(t("widgets.types.announcements"))}</div>
              ${canPost && !readOnly && !editing ? `<button type="button" data-post class="no-drag flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">${icon("plus", "size-3.5")}${esc(t("widgets.post"))}</button>` : ""}
            </div>
            ${
              allNotices().length
                ? `<ul class="no-drag -mr-2 space-y-2 overflow-y-auto pr-2 h-[calc(100%-2.25rem)]">${allNotices()
                    .map(
                      (a) => `<li class="flex gap-2.5 rounded-xl px-3 py-2 text-sm ${schedIds.has(a.id) ? "border border-dashed border-slate-300 opacity-80 dark:border-slate-600" : ""} ${a.level === "warning" ? "bg-amber-100/60 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "bg-white/50 dark:bg-white/5"}">${icon(a.level === "warning" ? "triangle-alert" : "info", `mt-0.5 size-4 shrink-0 ${a.level === "warning" ? "text-amber-500" : "text-sky-500"}`)}<div class="min-w-0 flex-1"><p class="whitespace-pre-line break-words"><span class="font-bold text-slate-900 dark:text-white">${esc(noticeBiz(a))} :</span> ${esc(a.message)}</p><p class="mt-0.5 text-[11px] text-slate-400">${schedIds.has(a.id) ? icon("calendar-clock", "mr-1 inline size-3 -translate-y-px") : ""}${esc(meta(a))}</p>${schedIds.has(a.id) ? "" : reactionBar(a)}</div>${
                        !editing && (canEditNotice(a) || canDeleteNotice(a))
                          ? `<span class="flex shrink-0 items-start gap-0.5">${canEditNotice(a) ? `<button type="button" data-edit-notice="${a.id}" aria-label="${esc(t("widgets.editNotice"))}" title="${esc(t("widgets.editNotice"))}" class="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-white/10">${icon("pencil", "size-3.5")}</button>` : ""}${canDeleteNotice(a) ? `<button type="button" data-del-notice="${a.id}" aria-label="${esc(t("widgets.deleteNotice"))}" title="${esc(t("widgets.deleteNotice"))}" class="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-white/10">${icon("trash-2", "size-3.5")}</button>` : ""}</span>`
                          : ""
                      }</li>`,
                    )
                    .join("")}</ul>`
                : "" // 没有公告：下面不留空白（看得到的只有能发公告的人：只剩标题列和「+ Post」）
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
        case "notes": {
          // 便条：上面是待办清单（圆圈打勾，像 Apple 备忘录），下面是自由文字
          const todos = w.config && Array.isArray(w.config.todos) ? w.config.todos : [];
          const item = (td) => `<li class="flex items-center gap-2">
              <button type="button" data-todo-toggle="${w.id}:${td.id}" ${readOnly ? "disabled" : ""} aria-label="${esc(t("widgets.todoDone"))}" class="no-drag flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${td.done ? "border-amber-500 bg-amber-500 text-white" : "border-slate-400 hover:border-amber-500 dark:border-slate-500"}">${td.done ? icon("check", "size-3") : ""}</button>
              <input data-todo-text="${w.id}:${td.id}" value="${esc(td.text || "")}" maxlength="200" ${readOnly ? "disabled" : ""} placeholder="${esc(t("widgets.todoPlaceholder"))}" class="no-drag min-w-0 flex-1 bg-transparent text-sm outline-none ${td.done ? "text-slate-400 line-through" : ""}">
            </li>`;
          return `${wTitle("sticky-note", t("widgets.types.notes"))}
            <div class="flex h-[calc(100%-1.75rem)] flex-col gap-1.5">
              ${todos.length ? `<ul data-todos="${w.id}" class="no-drag max-h-[70%] shrink-0 space-y-1 overflow-y-auto pr-1">${todos.map(item).join("")}</ul>` : ""}
              ${readOnly ? "" : `<button type="button" data-todo-add="${w.id}" class="no-drag flex items-center gap-1.5 self-start rounded-full px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-slate-200">${icon("list-checks", "size-3.5")}${esc(t("widgets.todoAdd"))}</button>`}
              <textarea data-note="${w.id}" ${readOnly ? "disabled" : ""} placeholder="${esc(t("widgets.notesPlaceholder"))}" class="no-drag min-h-0 w-full flex-1 resize-none bg-transparent text-sm outline-none">${esc((w.config && w.config.text) || "")}</textarea>
            </div>`;
        }
        case "admin":
          return `${wTitle("shield-check", t("home.adminSection"))}
            <div class="grid content-start gap-2 ${isSuper ? "grid-cols-2" : "grid-cols-1"}">
              ${isAdmin ? `<a href="admin#users" class="no-drag flex items-center gap-2 rounded-2xl bg-sky-50 px-3 py-4 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-200">${icon("user-cog", "size-6 shrink-0")}<span class="text-sm font-semibold">${esc(t("home.userAccess"))}</span></a>` : `<p class="text-sm text-slate-400">${esc(t("widgets.adminOnly"))}</p>`}
              ${isSuper ? `<a href="admin#modules" class="no-drag flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-4 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200">${icon("crown", "size-6 shrink-0")}<span class="text-sm font-semibold">${esc(t("home.superAdmin"))}</span></a>` : ""}
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
    // 公告栏上的全部公告：现在看得到的 + 排好时间还没到的（只有能发公告的人有）
    const allNotices = () => [...data.announcements, ...(data.scheduled || [])];
    // 没有公告：一般人不显示整个 Notice Board；能发公告的人只显示标题列 +「+ Post」（不占高度）
    function boardHtml() {
      const w = board();
      if (!w) return "";
      const empty = !allNotices().length;
      if (empty && !(canPost && !readOnly)) return "";
      const h = Number(w.config && w.config.height);
      const sized = sectionsOn && h > 0 && !empty;
      return `<div data-kind="widget" data-id="${w.id}" class="gw-pinned relative ${sectionsOn ? "mx-2 mb-2" : "mb-4"} ${sized || empty ? "" : w.size === "large" ? "h-[22rem]" : "h-[13rem]"}" ${sized ? `style="height:${Math.round(h)}px"` : ""}>
        <div class="${glass}">${widgetBody(w)}</div>
        ${editing && !sectionsOn && !empty ? badge(`data-resize="${w.id}"`, "scaling", t("widgets.resize"), "-right-2 -bottom-2") : ""}
        ${sectionsOn && editing && !empty ? `<div data-board-resize title="${esc(t("widgets.resize"))}" aria-label="${esc(t("widgets.resize"))}" class="absolute inset-x-0 -bottom-3 z-10 flex h-6 cursor-ns-resize touch-none items-center justify-center"><span class="h-1.5 w-14 rounded-full bg-slate-400/60 shadow backdrop-blur"></span></div>` : ""}
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
      // 只列名称；还没开放的（soon）排最后、灰掉、写「coming soon」
      const types = Object.entries(WIDGETS)
        .filter(([, d]) => !d.hidden)
        .sort(([, a], [, b]) => (a.soon ? 1 : 0) - (b.soon ? 1 : 0));
      // 不是小工具、但一样从这里加：My Home 方块、连结、文件夹
      const extra = (attr, ic, label, done) => `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-md dark:border-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-800/60">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">${icon(ic, "size-5")}</span>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">${esc(label)}</span>
          ${done ? `<span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">${esc(t("home.added"))}</span>` : `<button type="button" ${attr} class="${btn("secondary", "sm")} px-2.5">${icon("plus", "size-4")} ${esc(t("home.addThis"))}</button>`}
        </div>`;
      const extras = sectionsOn
        ? extra("data-sheet-home", "house", t("home.myHome"), homeOn()) + extra("data-sheet-link", "link", t("fab.addLink")) + extra("data-sheet-folder", "folder-plus", t("fab.newFolder"))
        : "";
      return `<div class="mb-3 flex items-center justify-between"><h3 class="font-semibold">${esc(t("fab.addWidget"))}</h3>${iconBtn("data-close-sheet", t("home.close"), "x")}</div>
        <div class="space-y-2">${extras}${types
          .map(
            ([type, d]) => `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 transition duration-150 dark:border-slate-800 ${d.soon ? "opacity-50" : "hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-md dark:hover:border-slate-600 dark:hover:bg-slate-800/60"}">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">${icon(d.icon, "size-5")}</span>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">${esc(t("widgets.types." + type))}</span>
              ${
                d.soon
                  ? `<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">${esc(t("settings.comingSoon"))}</span>`
                  : `<span class="flex gap-1">${d.sizes.map((s) => `<button type="button" data-add-widget="${type}" data-size="${s}" class="${btn("secondary", "sm")} px-2">${esc(t("widgets.sizes." + s))}</button>`).join("")}</span>`
              }
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
        return `<button type="button" data-done class="fixed right-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex h-12 cursor-pointer items-center gap-2 rounded-full bg-slate-900 px-5 font-semibold text-white shadow-xl transition duration-150 hover:scale-105 hover:bg-slate-700 hover:shadow-2xl active:scale-95 sm:bottom-8 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">${icon("check")} ${esc(t("fab.done"))}</button>`;
      }
      // 只放两样：连结、文件夹、My Home 都在「Add Widget」里；图示颜色在编辑模式（长按图示）的「…」选单里
      const items = [
        ["add-widget", "layout-dashboard", t("fab.addWidget")],
        ["edit", "move", t("fab.edit")],
      ];
      return `<div class="fixed right-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2 sm:bottom-8">
        ${
          fabOpen
            ? items
                .map(
                  ([k, ic, label]) => `<button type="button" data-fab="${k}" class="flex cursor-pointer items-center gap-2 rounded-full border border-white/70 bg-white/90 py-2 pr-4 pl-3 text-sm font-medium shadow-lg backdrop-blur transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-xl active:translate-y-0 active:scale-95 dark:border-white/10 dark:bg-slate-800/90 dark:hover:border-white/30 dark:hover:bg-slate-700">${icon(ic)} ${esc(label)}</button>`,
                )
                .join("")
            : ""
        }
        <button type="button" data-fab-toggle aria-label="${esc(t("fab.menu"))}" aria-expanded="${fabOpen}" class="flex size-14 cursor-pointer items-center justify-center rounded-full bg-slate-900 text-white shadow-xl ring-slate-900/20 transition duration-150 hover:scale-110 hover:bg-slate-700 hover:shadow-2xl hover:ring-4 active:scale-95 dark:bg-white dark:text-slate-900 dark:ring-white/30 dark:hover:bg-slate-200 ${fabOpen ? "rotate-45" : ""}">${icon("plus", "size-6")}</button>
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
    let estateMenuGid = null; // 打开着 Location 选单的区块
    // 每个区块选的 Location：记在 Notice Board 小工具的 config.locations
    const estateSel = new Map(Object.entries(((opts && opts.widgets) || []).find((w) => w.widget_type === "announcements")?.config?.locations || {}));
    const estatesOf = (cid, gid) => (S && S.locations ? S.locations : []).filter((x) => x.company_id === cid && (!x.group_id || x.group_id === gid));
    // 每个区块选的 Company（"all" = 全部）：记在 Notice Board 小工具的 config.companies；没选过就用自己在那个 Business 的 Company
    const companySel = new Map(Object.entries(((opts && opts.widgets) || []).find((w) => w.widget_type === "announcements")?.config?.companies || {}));
    // 用户自己排的 Company 顺序：记在 Notice Board 小工具的 config.companyOrder（每个 Business 一份）
    const companyOrder = new Map(Object.entries(((opts && opts.widgets) || []).find((w) => w.widget_type === "announcements")?.config?.companyOrder || {}));
    // 这个 Business 底下我可以选的 Company：super_admin 全部；其他人只有 HR 分给我的
    const bizHasCompanies = (gid) => S.bizCompanies.some((x) => x.group_id === gid);
    const companiesOf = (gid) => {
      const mine = new Set((S.memberCompanies || []).filter((x) => x.group_id === gid).map((x) => x.company_id));
      const ids = new Set(S.bizCompanies.filter((x) => x.group_id === gid && (isSuper || mine.has(x.company_id))).map((x) => x.company_id));
      const list = S.companies.filter((c) => ids.has(c.id));
      const ord = companyOrder.get(gid) || [];
      const at = (id) => { const i = ord.indexOf(id); return i < 0 ? 1e6 : i; };
      return list.map((c, i) => [c, i]).sort((a, b) => at(a[0].id) - at(b[0].id) || a[1] - b[1]).map((x) => x[0]);
    };
    // HQ 类型的 Business（Master Manage 勾「HQ」）：不用切换 Company，我所有的 Company 一起看
    const isHq = (gid) => !!(S.groups.find((g) => g.id === gid) || {}).all_companies;
    const selectedCompany = (gid) => {
      const list = companiesOf(gid);
      if (isHq(gid)) return list.length || isSuper || !bizHasCompanies(gid) ? "hq" : "none";
      // Business 有 Company、但还没分给我任何一家：不算任何 Company（标了 Company 的 App / 文件夹不显示）
      if (!list.length) return bizHasCompanies(gid) && !isSuper ? "none" : "all";
      if (list.length === 1) return list[0].id; // 只有一家：就是那一家（标给别家 Company 的 App 不显示）
      // 一定选一个 Company：自己选过的 → 自己的 Company → 第一个
      const v = companySel.get(gid) || S.myCompany[gid];
      return list.some((c) => c.id === v) ? v : list[0].id;
    };
    // 区块里现在的 Company 物件（选「全部」而这个 Business 只有一家时就是那一家）
    const currentCompany = (gid) => {
      const list = companiesOf(gid);
      const sel = selectedCompany(gid);
      return sel === "all" ? (list.length === 1 ? list[0] : null) : list.find((x) => x.id === sel) || null;
    };
    // 区块里选的 Location：公司只有一个（或没有）Location 就是那一个；多于一个时用选过的，没选过用第一个
    const selectedEstate = (gid) => {
      const c = currentCompany(gid);
      if (!c) return null;
      const list = estatesOf(c.id, gid);
      if (list.length < 2) return list[0] || null;
      const v = estateSel.get(gid);
      return list.find((x) => x.id === v) || list[0];
    };
    // 从别的系统（CMMS 2）回来时网址带 gw_company：每个有这家 Company 的 Business 区块都切到它，
    // 这样 Intranet 的 Company 跟模块里最后用的一样。记下来后把参数从网址拿掉。
    (function companyFromUrl() {
      let u;
      try { u = new URL(location.href); } catch (e) { return; }
      const asks = ["gw_company", "gw_company_name", "gw_company_short"].map((k) => (u.searchParams.get(k) || "").trim().toLowerCase()).filter(Boolean);
      if (!asks.length) return;
      ["gw_company", "gw_company_name", "gw_company_short"].forEach((k) => u.searchParams.delete(k));
      try { history.replaceState(null, "", u.toString()); } catch (e) { /* 忽略 */ }
      const hit = S.companies.find((c) => [c.code, c.name, c.short_name, c.id].some((v) => v && asks.includes(String(v).trim().toLowerCase())));
      if (!hit) return;
      let changed = false;
      S.bizCompanies.filter((x) => x.company_id === hit.id).forEach((x) => {
        if (companySel.get(x.group_id) !== hit.id) { companySel.set(x.group_id, hit.id); changed = true; }
      });
      const w = board();
      if (!changed || !w) return;
      w.config = { ...(w.config || {}), companies: Object.fromEntries(companySel) };
      sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id).then(({ error }) => error && toast(t("home.saveFailed")));
    })();
    // 模块有标 Company 的，只在选了那个 Company（或选全部）时显示；没标 Company 的模块一律显示
    // 我在这个 Business 现在选的 Company 有没有这个模块的权限（super_admin 全部都有）
    const accessHere = (gid, moduleId, sel) => {
      if (isSuper || !S.myAccess) return true;
      const rows = S.myAccess.filter((r) => r.group_id === gid && r.module_id === moduleId);
      if (!rows.length) return false;
      if (sel === "all") return true;
      if (sel === "none") return rows.some((r) => !r.company_id);
      if (sel === "hq") return rows.some((r) => !r.company_id || companiesOf(gid).some((c) => c.id === r.company_id));
      return rows.some((r) => !r.company_id || r.company_id === sel);
    };
    const shownFor = (gid, moduleId) => {
      const sel = selectedCompany(gid);
      if (!accessHere(gid, moduleId, sel)) return false;
      if (sel === "all") return true;
      const tags = S.moduleCompanies.filter((x) => x.module_id === moduleId);
      if (sel === "none") return !tags.length;
      if (sel === "hq") return !tags.length || tags.some((x) => companiesOf(gid).some((c) => c.id === x.company_id));
      return !tags.length || tags.some((x) => x.company_id === sel);
    };
    const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
    const modsOfGroup = (gid) => {
      const ids = new Set(S.groupModules.filter((x) => x.group_id === gid).map((x) => x.module_id));
      // 只算在这个 Business 被开了的模块（在别的 Business 有权限不算）
      return data.modules.filter((m) => ids.has(m.id) && (isSuper || !S.myAccess || S.myAccess.some((r) => r.group_id === gid && r.module_id === m.id)));
    };
    // 从区块拿掉的 App：只是这个区块不显示（权限不变），记在 Notice Board 小工具的 config.hidden = { Business id: [模块 id] }；Add Apps 可以放回去
    const boardCfg = () => (board() && board().config) || {};
    // Business 区块里的 App 一律显示（以前拿掉过的也回来）：区块的内容由 Business 决定，只有 My Home 可以自己加减
    const hiddenIn = () => new Set();
    // My Home 里从 Business 区块复制来的文件夹
    // My Home 方块：从「Add widget」加进来（config.homeBox.on），空的也一直在；名字可以自己改（config.homeBox.name）
    const homeOn = () => !!(boardCfg().homeBox && boardCfg().homeBox.on);
    const homeName = () => ((boardCfg().homeBox && boardCfg().homeBox.name) || "").trim() || t("home.myHome");
    function setHomeBox(patch) {
      const bw = board();
      if (!bw) return Promise.resolve();
      bw.config = { ...(bw.config || {}), homeBox: { ...((bw.config || {}).homeBox || {}), ...patch } };
      return saveBoardConfig();
    }
    const homeCopyOf = (fid) => {
      const v = (boardCfg().homeFolders || {})[fid];
      return v == null ? null : v;
    };
    function setHomeCopy(fid, slot) {
      const bw = board();
      if (!bw) return Promise.resolve();
      const hf = { ...(boardCfg().homeFolders || {}) };
      if (slot == null) delete hf[fid];
      else hf[fid] = slot;
      bw.config = { ...(bw.config || {}), homeFolders: hf };
      return saveBoardConfig();
    }
    // 标了 Business（和 Company）的文件夹：放在那个 Business 区块里（固定在最后面，不能拖走）；我看不到那个区块就照旧在 My Home
    // 文件夹在哪几个 Business 区块（分享给那些 Business、而且我看得到那个区块）
    function boxesOf(f) {
      if (!f || !sectionsOn) return [];
      return (folderBiz.get(f.id) || []).map((b) => b.group_id).filter((gid) => S.groups.some((g) => g.id === gid));
    }
    // 这个区块现在要显示的文件夹（标了 Company 的，只在区块选那家 Company 时出现）
    const boxFolders = (gid) =>
      folders.filter((f) => {
        if (!boxesOf(f).includes(gid)) return false;
        const e = (folderBiz.get(f.id) || []).find((b) => b.group_id === gid);
        const sel = selectedCompany(gid);
        return !e.company_id || ["all", e.company_id].includes(sel) || (sel === "hq" && companiesOf(gid).some((c) => c.id === e.company_id));
      });
    // 区块最上层的东西：有记录的按记录排；还没记录的 App 按默认顺序补在后面
    function boxItems(gid) {
      const mods = new Map(modsOfGroup(gid).map((m) => [m.id, m]));
      const hid = hiddenIn(gid);
      const visible = (mid) => mods.has(mid) && shownFor(gid, mid) && !hid.has(mid);
      const own = sItems.filter((x) => x.group_id === gid && !x.parent_id && (x.kind !== "module" || visible(x.module_id))).sort(bySort);
      const have = new Set(sItems.filter((x) => x.group_id === gid && x.kind === "module").map((x) => x.module_id));
      let n = own.length ? own[own.length - 1].sort_order : 0;
      const extra = [...mods.values()].filter((m) => !have.has(m.id) && visible(m.id)).map((m) => ({ id: "new:" + m.id, virtual: true, group_id: gid, kind: "module", module_id: m.id, parent_id: null, sort_order: ++n }));
      const sf = boxFolders(gid).map((f) => ({ id: "sf:" + f.id, virtual: true, group_id: gid, kind: "sfolder", folder_id: f.id, parent_id: null, sort_order: ++n }));
      return [...own, ...extra, ...sf];
    }
    const folderKids = (fid) => sItems.filter((x) => x.parent_id === fid && modules.has(x.module_id) && shownFor(x.group_id, x.module_id)).sort(bySort);

    // ---- 格子：一格 = 一个图示加名字，横竖间距一样（像 iPad 文件夹）
    /* cw / rh：一格的宽和高；lw：名字的宽；icon：图示大小；
       px / pt / pb：区块左右 / 上 / 下的内距，th / tg：标题高度和标题下面的空隙。
       数字是算好的：区块外框（含外面 8px 的空隙）刚好 = 整数格高、宽 = 整数格 + 半格，
       所以区块和页面上的小工具都在同一个格线上，彼此之间的空隙一样（16px）。 */
    const MET = () =>
      matchMedia("(min-width: 640px)").matches
        ? { cw: 104, rh: 124, lw: 80, icon: 64, px: 17, pt: 20, th: 24, tg: 24, pb: 24 }
        : { cw: 88, rh: 108, lw: 72, icon: 56, px: 13, pt: 14, th: 24, tg: 18, pb: 20 };
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
    const LABEL = "w-[72px] text-center text-xs leading-tight font-medium break-words text-slate-700 sm:w-20 dark:text-slate-200"; // 名字太长就换行，整个名字都要看得到
    // 编辑时图示左上角 / 右上角的小圆钮（对准图示的角）
    const BADGE_L = "top-0 left-[calc(50%-36px)] sm:top-1 sm:left-[calc(50%-40px)]";
    const BADGE_R = "top-0 right-[calc(50%-36px)] sm:top-1 sm:right-[calc(50%-40px)]";
    const cellCss = (p) => `grid-column:${p.c + 1} / span ${p.w};grid-row:${p.r + 1} / span ${p.h}`;
    // 分享的文件夹：蓝色文件夹图示，右下角小小的「人」（一眼看得出是大家一起用的）
    const sharedFolderIcon = (f) =>
      `<span title="${esc(t(f.shared_by ? "home.sharedBy" : "home.sharedBadge"))}" class="gw-icon relative flex size-14 items-center justify-center rounded-[26%] bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-sm sm:size-16">${icon("folder-open", "size-[46%]")}<span class="absolute right-1 bottom-1 flex size-[1.15rem] items-center justify-center rounded-full bg-white text-sky-600 shadow-sm">${icon("users", "size-3")}</span></span>`;
    const folderIcon = (minis) => `<span class="grid size-14 grid-cols-3 grid-rows-3 content-start gap-1 gw-icon rounded-[26%] border border-white/60 bg-white/50 p-2 backdrop-blur-xl sm:size-16 dark:border-white/10 dark:bg-white/10">${minis}</span>`;
    function cellTile({ key, kind, p, btnAttr, iconHtml, label, title, badges }) {
      return `<div data-key="${key}" data-kind="${kind}" style="${cellCss(p)}" class="gw-item relative flex flex-col items-center justify-start pt-2.5 sm:pt-3 ${editing ? "touch-none" : ""}">
        <button type="button" ${btnAttr} class="flex flex-col items-center gap-1.5" ${title ? `title="${esc(title)}"` : ""}>${iconHtml}<span class="${LABEL}">${esc(label)}</span></button>${editing ? badges || "" : ""}</div>`;
    }
    // Business 区块里的一个东西
    function sTile(gid, it, p) {
      if (it.kind === "sfolder") {
        const f = folders.find((x) => x.id === it.folder_id);
        return cellTile({ key: it.id, kind: "sfolder", p, btnAttr: `data-folder="${f.id}"`, iconHtml: sharedFolderIcon(f), label: f.name, title: f.name });
      }
      if (it.kind === "module") {
        const m = modules.get(it.module_id);
        // Business 区块里的 App 固定在那里（不能拿掉）；要整理就拖一份到 My Home
        return cellTile({ key: it.id, kind: "module", p, btnAttr: `data-open="${m.id}" data-gid="${gid}"`, iconHtml: appIcon(m), label: m.name, title: m.description || m.name });
      }
      const del = badge(`data-del-item="${it.id}"`, "minus", t("home.delete"), BADGE_L);
      if (it.kind === "folder") {
        const minis = folderKids(it.id).slice(0, 9).map((k) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${miniColor(modules.get(k.module_id).code, k.module_id)}"></span>`).join("");
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
        return cellTile({ key: it.key, kind: "link", p, btnAttr: `data-open-link="${l.id}"`, iconHtml: appIcon({ code: l.name, icon: l.icon, image_url: l.image_url, color: l.color }), label: l.name, title: l.url, badges: badge(`data-remove-link="${l.id}"`, "minus", t("home.removeFromHome"), BADGE_L) + badge(`data-edit-link="${l.id}"`, "pencil", t("home.editLink"), BADGE_R) });
      }
      if (it.kind === "folder") {
        const f = folders.find((x) => x.id === it.id);
        const minis = [...folderApps(f.id).map((id) => miniColor(modules.get(id).code, id)), ...folderLinks(f.id).map((l) => miniColor(l.name, null, l.color))].slice(0, 9).map((c) => `<span class="aspect-square rounded-[28%] bg-gradient-to-br ${c}"></span>`).join("");
        const shared = f.is_shared || f.shared_by;
        const iconHtml = shared ? sharedFolderIcon(f) : folderIcon(minis);
        const copy = boxesOf(f).length > 0 && homeCopyOf(f.id) != null;
        return cellTile({ key: it.key, kind: "folder", p, btnAttr: `data-folder="${f.id}"`, iconHtml, label: f.name, badges: badge(`data-remove-folder="${f.id}"`, "minus", t(copy ? "home.removeFromHome" : f.shared_by ? "home.leaveShared" : "home.deleteFolder"), BADGE_L) });
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
        <h2 class="min-w-0 truncate text-[15px] leading-6 font-semibold tracking-tight text-slate-800 dark:text-slate-100">${esc(title)}</h2>${
          key === "home"
            ? editing && sectionsOn
              ? `<button type="button" data-home-rename class="no-drag flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/60 dark:hover:bg-white/10" title="${esc(t("home.renameHome"))}" aria-label="${esc(t("home.renameHome"))}">${icon("pencil", "size-4")}</button>${homeOn() ? `<button type="button" data-home-remove class="no-drag flex size-7 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" title="${esc(t("home.removeHome"))}" aria-label="${esc(t("home.removeHome"))}">${icon("minus-circle", "size-4")}</button>` : ""}`
              : ""
            : companyPicker(key) // 只选 Company；Location 在模块里面自己选
        }
        <div class="ml-auto flex shrink-0 items-center">${sectionsOn ? secGrip() : ""}${steps}</div></div>`;
    }
    // 一个区块（My Home 也一样）：外框宽 = 整数格 + 半格，高 = 整数格
    function boxShell(key, title, B, tiles) {
      const { g, n } = B;
      const mode = modeOf(key);
      const shownRows = mode === "full" ? B.rows : 1;
      const pad = mode === "title" ? `${g.pt + g.tg / 2}px ${g.px}px ${g.pb + g.tg / 2}px` : `${g.pt}px ${g.px}px ${g.pb}px`;
      const emptyBiz = key !== "home" && !modsOfGroup(key).length && !sItems.some((x) => x.group_id === key);
      const body = tiles || `<p class="col-span-full row-start-1 self-center px-3 text-sm text-slate-500">${esc(t(key === "home" ? "home.homeEmpty" : emptyBiz ? "home.noModulesInBusiness" : "home.noAppsForCompany"))}</p>`;
      const grid =
        mode === "title"
          ? ""
          : `<div data-list="${key}" data-fw-host="${key}" data-cols="${n}" class="relative mx-auto grid ${mode === "row" ? "overflow-hidden" : ""}" style="width:${n * g.cw}px;grid-template-columns:repeat(${n},${g.cw}px);grid-template-rows:repeat(${shownRows},${g.rh}px);grid-auto-rows:${g.rh}px;${mode === "row" ? `height:${g.rh}px;` : ""}">${body}<div data-box-hint class="pointer-events-none hidden rounded-2xl border-2 border-dashed"></div></div>`;
      return `<div data-sec-wrap data-sec-key="${key}" class="p-2" style="width:${B.fill ? "100%" : (2 * n + 1) * g.hw + "px"};max-width:100%">
        <section data-box="${key}" data-pad="${pad}" class="relative ${glassSkin} ${companyMenuGid === key || estateMenuGid === key ? "z-20" : ""}" style="padding:${pad}">${boxHead(key, title, B, mode)}${grid}${editing && mode !== "title" ? resizeGrip(key) : ""}</section></div>`;
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
      // HQ（全部 Company）：不用选，显示「All companies」；点一下展开看包括哪几家（只看，不能选）
      if (isHq(gid)) {
        if (list.length === 1) return `<span class="inline-flex max-w-[14rem] min-w-0 items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-3.5 shrink-0")}<span class="truncate">${esc(list[0].name)}</span></span>`;
        const open = companyMenuGid === gid;
        return `<div data-pick-wrap class="relative min-w-0">
        <button type="button" data-company-menu="${gid}" aria-expanded="${open ? "true" : "false"}" title="${esc(t("home.hqShowCompanies"))}" class="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-3.5 shrink-0")}<span class="truncate">${esc(t("home.hqAllCompanies", { count: list.length }))}</span>${icon(open ? "chevron-up" : "chevron-down", "size-3.5 shrink-0")}</button>
        ${
          open
            ? `<div data-hq-list class="absolute top-full left-0 z-30 mt-1 max-h-80 w-max max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-white/60 bg-white/90 p-1.5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90">
            <p class="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">${esc(t("home.hqCompaniesIncluded", { count: list.length }))}</p>
            <div class="grid grid-cols-1 gap-x-3 sm:grid-cols-[auto_auto]">${list.map((c) => `<div class="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 dark:text-slate-200">${icon("building-2", "size-3.5 shrink-0 text-slate-400")}<span class="min-w-0 flex-1 break-words">${esc(c.name)}</span>${c.short_name || c.code ? `<span class="shrink-0 font-mono text-[11px] text-slate-400">${esc(c.short_name || c.code)}</span>` : ""}</div>`).join("")}</div>
          </div>`
            : ""
        }
      </div>`;
      }
      // 只有一个 Company：只显示它的名字，不用下拉选单
      if (list.length === 1) return `<span class="inline-flex max-w-[14rem] min-w-0 items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-3.5 shrink-0")}<span class="truncate">${esc(list[0].name)}</span></span>`;
      const sel = selectedCompany(gid);
      const cur = list.find((c) => c.id === sel);
      const label = cur ? cur.short_name || cur.code || cur.name : list[0].name;
      const row = (id, text) => `<div data-co-row="${id}" class="flex items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <span data-co-grip class="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center text-slate-400 hover:text-slate-600 active:cursor-grabbing" title="${esc(t("home.dragToSort"))}">${icon("grip-vertical", "size-4")}</span>
          <button type="button" data-company-pick="${id}" data-gid="${gid}" class="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pr-2.5 text-left text-sm"><span class="truncate">${esc(text)}</span>${sel === id ? icon("check", "size-4 shrink-0 text-emerald-600") : ""}</button>
        </div>`;
      return `<div data-pick-wrap class="relative min-w-0">
        <button type="button" data-company-menu="${gid}" class="inline-flex max-w-[11rem] items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("building-2", "size-3.5 shrink-0")}<span class="truncate">${esc(label)}</span>${icon("chevron-down", "size-3.5 shrink-0")}</button>
        ${companyMenuGid === gid ? `<div data-co-list="${gid}" class="absolute top-full left-0 z-30 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-white/60 bg-white/90 p-1.5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90">${list.map((c) => row(c.id, c.name)).join("")}</div>` : ""}
      </div>`;
    };

    // 区块标题旁边的 Location 选择（不再显示：Location 改在模块里面选；保留以后要用）
    const estatePicker = (gid) => {
      const c = currentCompany(gid);
      const list = c ? estatesOf(c.id, gid) : [];
      if (list.length < 2) return "";
      const cur = selectedEstate(gid);
      const label = cur ? cur.name : list[0].name;
      const row = (x) => `<button type="button" data-estate-pick="${x.id}" data-gid="${gid}" class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><span class="truncate">${esc(x.name)}</span>${cur && cur.id === x.id ? icon("check", "size-4 text-emerald-600") : ""}</button>`;
      return `<div data-pick-wrap class="relative min-w-0">
        <button type="button" data-estate-menu="${gid}" title="${esc(t("home.location"))}" class="inline-flex max-w-[11rem] items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-medium text-slate-600 backdrop-blur hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">${icon("map-pin", "size-3.5 shrink-0")}<span class="truncate">${esc(label)}</span>${icon("chevron-down", "size-3.5 shrink-0")}</button>
        ${estateMenuGid === gid ? `<div class="absolute top-full left-0 z-30 mt-1 max-h-64 w-60 overflow-y-auto rounded-xl border border-white/60 bg-white/90 p-1.5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90">${list.map(row).join("")}</div>` : ""}
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
      if (it.kind === "sfolder") return Promise.resolve(); // 标了 Business 的文件夹固定在区块最后，不存位置
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
      const el = e.target.closest(".gw-item, .gw-pinned, [data-fw], [data-box]");
      if (!el || e.target.closest("input, textarea, select, a, [data-company-menu], [data-estate-menu], [data-pick-wrap], [data-mode], .gw-sheet, .sec-grip")) return; // 握把直接拖区块，不算长按
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
        else if (other.kind !== "fw" && other.kind !== "sfolder" && w === 1 && h === 1 && p.w === 1 && p.h === 1) action = { type: "swap", key: hits[0], c: p.c, r: p.r };
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
    // 从 Business 区块拖到 My Home：复制一份过去（Business 区块里的不动）
    const HOME_HL = ["ring-4", "ring-brand-500/60"];
    function homeDropAt(e) {
      if (bdrag.key === "home" || !["module", "sfolder"].includes(bdrag.kind)) return null;
      const box = $('[data-box="home"]', root);
      const list = $('[data-list="home"]', root);
      if (!box || !list) return null;
      const br = box.getBoundingClientRect();
      if (e.clientX < br.left || e.clientX > br.right || e.clientY < br.top || e.clientY > br.bottom) return null;
      const B = boxGeo("home");
      const lr = list.getBoundingClientRect();
      const c = Math.max(0, Math.min(B.n - 1, Math.floor((e.clientX - lr.left) / B.g.cw)));
      const r = Math.max(0, Math.floor((e.clientY - lr.top) / B.g.rh));
      let free = true;
      B.L.pos.forEach((p) => c >= p.c && c < p.c + p.w && r >= p.r && r < p.r + p.h && (free = false));
      return { c: free ? c : null, r: free ? r : null };
    }
    function moveBoxDrag(e) {
      bdrag.ghost.style.transform = `translate(${e.clientX - bdrag.dx}px,${e.clientY - bdrag.dy}px) scale(1.08)`;
      if (e.clientY < 90) scrollBy(0, -14);
      else if (e.clientY > innerHeight - 90) scrollBy(0, 14);
      bdrag.toHome = homeDropAt(e);
      const hb = $('[data-box="home"]', root);
      if (hb) hb.classList.toggle(HOME_HL[0], !!bdrag.toHome), hb.classList.toggle(HOME_HL[1], !!bdrag.toHome);
      if (bdrag.toHome) {
        bdrag.target = null;
        const h = $("[data-box-hint]", bdrag.list);
        if (h) h.className = "pointer-events-none hidden";
        return;
      }
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
    async function copyToHome(me, at) {
      if (!homeIsV2()) homeFreeSlot(); // 第一次：先把 My Home 换成新的位置编码
      const slot = at.c != null ? at.r * 100 + at.c : homeFreeSlot();
      const it = me && me.item;
      if (it && it.kind === "module") {
        const l = layout.get(it.module_id);
        if (l) return (draw(), toast(t("home.alreadyInHome")));
        layout.set(it.module_id, { folder_id: null, sort_order: slot });
        draw();
        toast(t("home.copiedToHome"));
        return saveApps([{ module_id: it.module_id, folder_id: null, sort_order: slot }]);
      }
      if (it && it.kind === "sfolder") {
        if (homeCopyOf(it.folder_id) != null) return (draw(), toast(t("home.alreadyInHome")));
        const p = setHomeCopy(it.folder_id, slot);
        draw();
        toast(t("home.copiedToHome"));
        return p;
      }
      draw();
    }
    async function endBoxDrag(cancelled) {
      const d = bdrag;
      bdrag = null;
      d.ghost.remove();
      d.el.classList.remove("opacity-30");
      document.body.classList.remove("gw-dragging");
      lastDragEnd = Date.now();
      if (!cancelled && d.toHome) return copyToHome(d.B.model.find((x) => x.key === d.id), d.toHome);
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
    function pageWidget(w, g, T) {
      const p = w.config.pos;
      return `<div data-fw="${w.id}" class="gw-fw absolute p-2 ${editing ? "touch-none" : ""}" style="left:${p.x * g.hw}px;top:${(p.y + (T || 0)) * g.rh}px;width:${p.w * g.cw}px;height:${p.h * g.rh}px">${fwInner(w, p, 8)}</div>`;
    }

    // ---- 页面上的摆放（单位：横 = 半格，竖 = 行）
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const wRect = (p) => ({ x: p.x, y: p.y, w: p.w * 2, h: p.h });
    const shown = new Map(); // 页面小工具现在显示的位置（被区块盖到时会暂时挪开）
    const shownOf = (w) => shown.get(w.id) || w.config.pos;
    // 放在所有区块上面的小工具：y 是负数（区块从第 0 行开始）；区块整排往下推这么多行
    const topRowsOf = (list) => Math.max(0, ...list.map((p) => -p.y));
    const topRows = () => topRowsOf(pageWidgets().map(shownOf));
    // 上面那排小工具跟区块之间不要留空行
    function compactTop() {
      const negs = pageWidgets().filter((w) => shownOf(w).y < 0);
      if (!negs.length) return [];
      const gap = -Math.max(...negs.map((w) => shownOf(w).y + shownOf(w).h));
      if (gap <= 0) return [];
      negs.forEach((w) => shown.set(w.id, { ...shownOf(w), y: shownOf(w).y + gap }));
      return negs.map((w) => w.id);
    }
    // 每个区块的高度补到「整数行」（页面格子 rh 的倍数）：区块底边才会和旁边的小工具底边对齐、下一个区块也从格线开始
    function alignBoxes() {
      const page = $("#gw-page", root);
      if (!page) return;
      const g = pageGeo();
      $$("[data-sec-wrap]", page).forEach((el) => {
        const box = $("[data-box]", el);
        if (!box) return;
        box.style.padding = box.dataset.pad || "";
        const h = el.getBoundingClientRect().height;
        const target = Math.ceil(h / g.rh - 0.02) * g.rh;
        const extra = Math.max(0, target - h);
        if (extra) box.style.paddingBottom = Math.round(parseFloat(getComputedStyle(box).paddingBottom) + extra) + "px";
      });
    }
    function boxRectsPage() {
      const page = $("#gw-page", root);
      if (!page) return [];
      alignBoxes();
      const g = pageGeo();
      const pr = ($("#gw-stack", page) || page).getBoundingClientRect();
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
      const minY = -(topRows() + h); // 最多比现在最上面再高一个小工具
      const ok = (cx, cy) => cx >= 0 && cy >= minY && cx + 2 * w <= g.halves && !blocks.some((b) => hit({ x: cx, y: cy, w: 2 * w, h }, b));
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
      const T = topRows();
      const stack = $("#gw-stack", page);
      if (stack) stack.style.marginTop = T * g.rh + "px";
      let bottom = 0;
      pageWidgets().forEach((w) => {
        const p = shownOf(w);
        bottom = Math.max(bottom, p.y + p.h);
        const el = $(`#gw-float [data-fw="${w.id}"]`, root);
        if (el) Object.assign(el.style, { left: p.x * g.hw + "px", top: (p.y + T) * g.rh + "px", width: p.w * g.cw + "px", height: p.h * g.rh + "px" });
      });
      page.style.minHeight = (bottom + T) * g.rh + "px";
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
      const T = topRows();
      list.forEach((w) => {
        const p = shownOf(w);
        const s = pageFree(p.w, p.h, [...boxes, ...placed], p.y < 0 ? -T : 0);
        shown.set(w.id, { ...p, ...s });
        placed.push(wRect(shown.get(w.id)));
      });
      alignBand(null, "all");
      compactTop();
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
      const pw = Math.max(1, Math.min(w.config.pos.w, Math.floor(g.halves / 2)));
      const ph = w.config.pos.h;
      w.config = { ...w.config, pos: { ...w.config.pos, box: null, w: pw, h: ph, x: 0, y: 9999 } }; // 先移出原来的地方
      draw();
      // 从第一个区块的上缘算第几行；放在区块上面（Notice Board 那边）= 负数，区块会往下推
      const pr = $("#gw-stack", root).getBoundingClientRect();
      const x = Math.max(0, Math.min(g.halves - 2 * pw, Math.round((r.left - pr.left) / g.hw)));
      const y = Math.max(-(topRows() + ph), Math.round((r.top - pr.top) / g.rh));
      const spot = pageNear(x, y, pw, ph, blocksExcept(w.id));
      shown.set(w.id, { x: spot.x, y: spot.y, w: pw, h: ph });
      const changed = [...alignBand(w.id, "drop"), ...compactTop()];
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
      const changed = [...alignBand(w.id, "resize"), ...compactTop()];
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
                      <button type="button" data-open="${k.module_id}" class="flex flex-col items-center gap-1.5">${appIcon(modules.get(k.module_id), "size-14 sm:size-16")}<span class="w-20 text-center text-xs leading-tight font-medium break-words text-slate-700 dark:text-slate-200">${esc(modules.get(k.module_id).name)}</span></button>
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
      const T0 = topRowsOf(pageWidgets().map((w) => w.config.pos));
      const parts = [];
      S.groups.forEach((grp) => {
        // 一般人：Business 里有 App 才出现；super admin：新开的 Business 还没有模块也显示（空的区块）
        if (!(isSuper || modsOfGroup(grp.id).length || sItems.some((x) => x.group_id === grp.id) || folders.some((f) => boxesOf(f).includes(grp.id)))) return;
        const B = boxGeo(grp.id);
        parts.push([grp.id, boxShell(grp.id, grp.name, B, modeOf(grp.id) === "title" ? "" : boxTiles(grp.id, B))]);
      });
      if (showHome) {
        const B = boxGeo("home");
        parts.push(["home", boxShell("home", homeName(), B, boxTiles("home", B))]);
      }
      const order = sectionOrder();
      const rank = (k) => (order.indexOf(k) === -1 ? 999 : order.indexOf(k));
      parts.sort((a, b) => rank(a[0]) - rank(b[0]));
      return `<div id="gw-frame" class="mx-auto max-w-full" style="width:${g.width}px">
        ${boardHtml()}
        ${editing ? `<p class="mx-2 mb-2 text-center text-xs text-slate-500">${esc(t("fab.editHint"))}</p>` : ""}
        <div id="gw-page" class="relative mb-6">
          <div id="gw-stack" class="flex flex-wrap items-start" style="margin-top:${T0 * g.rh}px">${parts.map((x) => x[1]).join("")}</div>
          <div id="gw-float" class="pointer-events-none absolute inset-0 z-10 [&>*]:pointer-events-auto">${pageWidgets().map((w) => pageWidget(w, g, T0)).join("")}</div>
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
      // My Home 只在有东西、或从「Add widget」加了才出现（编辑时不再突然冒出来，把区块挤开）
      const stackHtml = sectionsOn ? pageHtml(items.length > 0 || homeOn() || widgets.some((w) => isFloating(w) && w.config.pos.box === "home")) : "";
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
      // 「All companies」清单：宽到看得见完整的公司名；右边超出画面就往左移
      const hqList = $("[data-hq-list]", root);
      if (hqList) {
        const over = hqList.getBoundingClientRect().right - (document.documentElement.clientWidth - 12);
        if (over > 0) hqList.style.left = -Math.min(over, Math.max(0, hqList.getBoundingClientRect().left - 12)) + "px";
      }
      const coList = $("[data-co-list]", root);
      if (coList && window.Sortable) {
        Sortable.create(coList, {
          handle: "[data-co-grip]",
          draggable: "[data-co-row]",
          animation: 150,
          ghostClass: "opacity-40",
          onEnd: () => {
            const gid = coList.dataset.coList;
            companyOrder.set(gid, $$("[data-co-row]", coList).map((x) => x.dataset.coRow));
            lastDragEnd = Date.now();
            draw();
            const w = board();
            if (!w) return;
            w.config = { ...(w.config || {}), companyOrder: Object.fromEntries(companyOrder) };
            sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id).then(({ error }) => error && toast(t("home.saveFailed")));
          },
        });
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
      let color = link ? link.color || "" : "";
      let photo = link ? link.image_url || null : null;
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
          <div>
            <p class="mb-1.5 ${cls.label}">${esc(t("home.linkColor"))}</p>
            <div class="flex flex-wrap gap-1.5">${["", ...Object.keys(PALETTE)].map((c) => `<button type="button" data-pick-color="${c}" title="${esc(c || t("home.iconAuto"))}" class="size-7 rounded-full border-2 shadow ${c ? "" : "bg-gradient-to-br from-slate-300 to-slate-500"}" style="${c ? `background:${PALETTE[c][1]}` : ""}"></button>`).join("")}</div>
          </div>
          <div class="flex items-center gap-2">
            <span data-photo-preview></span>
            <label class="${btn("secondary", "sm")} cursor-pointer">${icon("upload", "size-4")} ${esc(t("home.linkPhoto"))}<input type="file" data-photo accept="image/*" class="hidden"></label>
            <button type="button" data-nophoto class="${btn("ghost", "sm")} hidden text-red-600 dark:text-red-400">${icon("image-off", "size-4")} ${esc(t("home.linkRemovePhoto"))}</button>
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
      const paintExtra = () => {
        $$("[data-pick-color]", dlg.el).forEach((b) => {
          b.classList.toggle("border-slate-900", b.dataset.pickColor === color);
          b.classList.toggle("dark:border-white", b.dataset.pickColor === color);
          b.classList.toggle("border-white", b.dataset.pickColor !== color);
        });
        $("[data-photo-preview]", dlg.el).innerHTML = photo ? `<img src="${esc(photo)}" alt="" class="size-9 rounded-lg object-cover ring-1 ring-slate-200">` : "";
        $("[data-nophoto]", dlg.el).classList.toggle("hidden", !photo);
      };
      paint();
      paintExtra();
      refreshIcons();
      $$("[data-pick-icon]", dlg.el).forEach((b) => b.addEventListener("click", () => ((chosen = b.dataset.pickIcon), paint(), refreshIcons())));
      $$("[data-pick-color]", dlg.el).forEach((b) => b.addEventListener("click", () => ((color = b.dataset.pickColor), paintExtra())));
      $("[data-nophoto]", dlg.el).addEventListener("click", () => ((photo = null), paintExtra()));
      // 自己的照片当图示：先传到 link-icons，按 Save 才记到连结上
      $("[data-photo]", dlg.el).addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) return toast(t("home.linkPhotoTooBig"));
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
        const path = `${data.profile.id}/${crypto.randomUUID()}.${ext}`; // 随机档名：猜不到别人的图片网址
        const up = await sb.storage.from("link-icons").upload(path, file, { contentType: file.type, upsert: true });
        if (up.error) return toast(t("home.saveFailed") + " (" + (up.error.message || "") + ")");
        photo = sb.storage.from("link-icons").getPublicUrl(path).data.publicUrl;
        paintExtra();
      });
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      $("form", dlg.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const row = { name: f.name.value.trim(), url: f.url.value.trim(), icon: chosen, color: color || null, image_url: photo };
        if (!/^https?:\/\//i.test(row.url)) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.badUrl")));
        let created = null;
        if (link) {
          const { error } = await sb.from("gw_user_links").update(row).eq("id", link.id);
          if (error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.saveFailed")));
          Object.assign(link, row);
        } else {
          const ins = await sb
            .from("gw_user_links")
            .insert({ ...row, user_id: (o && o.ownerId) || data.profile.id, sort_order: nextSlot(1, 1), ...(o && o.folderId ? { folder_id: o.folderId } : {}) })
            .select()
            .single();
          if (ins.error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("home.saveFailed")));
          created = ins.data;
          links.push(created);
        }
        dlg.close();
        draw();
        if (o && o.onSaved) o.onSaved(link || created);
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
    // 文件夹分享给哪些 Business（名字列在文件夹名称下面；拥有者点了可以改）
    const bizNames = (f) => (folderBiz.get(f.id) || []).map((b) => (S.groups.find((g) => g.id === b.group_id) || {}).name).filter(Boolean);
    function folderTagChip(f, canChange) {
      if (!sectionsOn) return "";
      const names = bizNames(f);
      if (!names.length && !canChange) return "";
      const label = names.length ? names.join(", ") : t("home.folderTagAdd");
      const cls_ = "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-sm backdrop-blur " + (names.length ? "bg-white/85 text-slate-700 dark:bg-slate-800/85 dark:text-slate-200" : "border border-dashed border-white/70 bg-white/20 text-white");
      return canChange
        ? `<button type="button" data-folder-tag class="${cls_} hover:bg-white">${icon(names.length ? "briefcase-business" : "tag", "size-3.5 shrink-0")}<span class="truncate">${esc(label)}</span>${names.length ? icon("pencil", "size-3 shrink-0 opacity-60") : ""}</button>`
        : `<span class="${cls_}">${icon("briefcase-business", "size-3.5 shrink-0")}<span class="truncate">${esc(label)}</span></span>`;
    }
    // 分享给 Business：一排 Business，勾 = 分享给那个 Business（勾了旁边选 Viewer / Editor），按 Save 存
    function folderTagDialog(f, done) {
      const cur = new Map((folderBiz.get(f.id) || []).map((b) => [b.group_id, b.role || "view"]));
      const st = new Map(cur);
      const dirty = () => cur.size !== st.size || [...st].some(([g, r]) => cur.get(g) !== r);
      const roleSel = (gid) => `<select data-biz-role="${gid}" aria-label="${esc(t("home.shareRole"))}" class="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 ${st.has(gid) ? "" : "invisible"}">
          <option value="view" ${st.get(gid) !== "edit" ? "selected" : ""}>${esc(t("home.shareRoleView"))}</option>
          <option value="edit" ${st.get(gid) === "edit" ? "selected" : ""}>${esc(t("home.shareRoleEdit"))}</option>
        </select>`;
      const dlg = modal(
        t("home.folderTagTitle"),
        `<div class="space-y-4">
          <div class="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${
            S.groups.length
              ? S.groups
                  .map(
                    (g) => `<div class="flex items-center gap-3 px-3 py-2">
                      <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input type="checkbox" data-biz-tick="${g.id}" ${st.has(g.id) ? "checked" : ""} class="size-4 accent-emerald-600">
                        <span class="min-w-0 truncate text-sm font-medium">${esc(g.name)}</span>
                      </label>
                      ${roleSel(g.id)}
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
        { guard: dirty },
      );
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      dlg.el.addEventListener("change", (e) => {
        const el = e.target;
        if (el.dataset.bizTick) {
          if (el.checked) st.set(el.dataset.bizTick, $(`[data-biz-role="${el.dataset.bizTick}"]`, dlg.el).value || "view");
          else st.delete(el.dataset.bizTick);
          $(`[data-biz-role="${el.dataset.bizTick}"]`, dlg.el).classList.toggle("invisible", !el.checked);
        } else if (el.dataset.bizRole && st.has(el.dataset.bizRole)) st.set(el.dataset.bizRole, el.value);
      });
      $("[data-save]", dlg.el).onclick = async () => {
        if (!bizTableOn) return toast(t("home.folderTagNeedsDb"));
        const save = $("[data-save]", dlg.el);
        save.disabled = true;
        const add = [...st].filter(([g]) => !cur.has(g));
        const drop = [...cur.keys()].filter((g) => !st.has(g));
        const changed = [...st].filter(([g, r]) => cur.has(g) && cur.get(g) !== r);
        const fail = (error) => ((save.disabled = false), toast(t("home.saveFailed") + (error && error.message ? " (" + error.message + ")" : "")));
        if (add.length) {
          const { error } = await sb.from("gw_folder_business_shares").insert(add.map(([g, r]) => ({ folder_id: f.id, group_id: g, role: r })));
          if (error) return fail(error);
        }
        for (const [g, r] of changed) {
          const { error } = await sb.from("gw_folder_business_shares").update({ role: r }).eq("folder_id", f.id).eq("group_id", g);
          if (error) return fail(error);
        }
        if (drop.length) {
          const { error } = await sb.from("gw_folder_business_shares").delete().eq("folder_id", f.id).in("group_id", drop);
          if (error) return fail(error);
        }
        // 分享给 Business 的文件夹就是分享用的文件夹（拥有者才有「分享」钮）
        if (st.size && !f.is_shared) {
          const { error } = await sb.from("gw_user_folders").update({ is_shared: true }).eq("id", f.id);
          if (!error) f.is_shared = true;
        }
        const old = new Map((folderBiz.get(f.id) || []).map((b) => [b.group_id, b]));
        folderBiz.set(f.id, [...st].map(([g, r]) => ({ folder_id: f.id, group_id: g, company_id: (old.get(g) || {}).company_id || null, role: r })));
        dlg.close();
        draw();
        if (done) done();
      };
    }

    function openFolder(fid, pageId) {
      const f = folders.find((x) => x.id === fid);
      if (!f) return;
      const mineF = !f.shared_by;
      const canOut = !readOnly && mineF;
      const canRename = mineF && !readOnly;
      const wrap = document.createElement("div");
      wrap.setAttribute("role", "dialog");
      wrap.className = "fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md sm:p-6";
      const pill = (attr, ic, label) => `<button type="button" ${attr} class="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow backdrop-blur dark:bg-slate-800/80 dark:text-slate-200">${icon(ic, "size-4")} ${esc(label)}</button>`;
      wrap.innerHTML = `
        <div class="mb-4 flex max-w-full items-center gap-2 px-4">
          <h2 data-title class="min-w-0 truncate text-3xl font-bold text-white drop-shadow outline-none select-none sm:text-4xl ${canRename ? "cursor-pointer" : ""}" ${canRename ? `title="${esc(t("home.renameHint"))}"` : ""} style="touch-action:manipulation">${esc(f.name)}</h2>
        </div>
        <div data-tag-row class="-mt-2 mb-4 flex justify-center">${folderTagChip(f, canRename)}</div>
        <div data-win class="relative w-full max-w-5xl rounded-[2rem] border border-white/60 bg-white/75 p-5 shadow-2xl backdrop-blur-xl sm:p-6 dark:border-white/10 dark:bg-slate-900/75">
          ${mineF && f.is_shared && !readOnly ? `<button type="button" data-share title="${esc(t("home.shareBtn"))}" aria-label="${esc(t("home.shareBtn"))}" class="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-sky-500 text-white shadow hover:bg-sky-600">${icon("users", "size-4")}</button>` : ""}
          ${!mineF ? `<span title="${esc(t("home.sharedBy"))}" class="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-sky-500/70 text-white shadow">${icon("users", "size-4")}</span>` : ""}
          <div data-pages></div>
          <div data-shelf-host></div>
        </div>`;
      document.body.appendChild(wrap);
      refreshIcons();
      const close = () => {
        wrap.remove();
        document.removeEventListener("keydown", onKey);
      };
      // Esc：上面还有弹窗（分享名单、加连结）就不动
      const onKey = (e) => {
        if (e.key !== "Escape" || document.querySelector(".gw-modal")) return;
        // 正在表格格子 / 分页名字里打字：Esc 只是离开那一格
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-sheet], [data-pages]")) return document.activeElement.blur();
        close();
      };
      document.addEventListener("keydown", onKey);
      const canEditF = !readOnly && (mineF || f.share_role === "edit");
      mountPages(f, wrap, { canEdit: canEditF, isOwner: canOut, page: pageId, reopen: (pg) => (close(), openFolder(fid, pg)) });
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
        if (!wrap.contains(b) || "renameOk" in b.dataset) return;
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
        if ("share" in b.dataset) return sharePicker(f, () => (($("[data-tag-row]", wrap).innerHTML = folderTagChip(f, canRename)), refreshIcons()));
        if ("folderTag" in b.dataset) return folderTagDialog(f, () => ($("[data-tag-row]", wrap).innerHTML = folderTagChip(f, canRename), refreshIcons()));
      });
    }

    // ------------------------------------------------------------ 文件夹分页（Page）
    /* 一个文件夹可以有好几页（上面一排标签）：「Links」柜子（连结 / App 分标题）或「Sheet」表格（像 Google Sheets：打字、拉宽格子）。
       存在 gw_user_folders.canvas.pages = [{ id, title, type: "links" | "sheet", … }]（跟柜子同一个栏位，一起存，不用新的 SQL）。
       第一页（id "main"）= 原本的柜子，资料照旧在 canvas.shelves / canvas.loose；之后加的柜子页自己记 shelves / loose
       （东西只在一页：其他页拿走的，第一页就不显示）；表格页记 cells { "列:栏": 文字 }、rows / cols、w（栏宽）/ h（列高）。
       能改的人（拥有者、Can edit）：加页、再按一次现在这页的标签改名字 / 删页（第一页不能删）。 */
    const PAGE_ID = /^[A-Za-z0-9_-]{1,40}$/;
    const canvasOf = (f) => (f.canvas && typeof f.canvas === "object" ? f.canvas : {});
    const rawPages = (f) => (Array.isArray(canvasOf(f).pages) ? canvasOf(f).pages : []).filter((p) => p && typeof p === "object" && PAGE_ID.test(String(p.id || "")) && (p.type === "links" || p.type === "sheet"));
    function folderPages(f) {
      const list = rawPages(f).map((p) => ({ id: String(p.id), type: p.type, title: String(p.title || "").slice(0, 40) }));
      if (!list.some((p) => p.id === "main")) list.unshift({ id: "main", type: "links", title: "" });
      return list;
    }
    // 整个 canvas 一次存（patch 盖掉最外层的 key）；失败回传 false
    async function saveFolderCanvas(f, patch) {
      const canvas = { ...canvasOf(f), ...patch };
      delete canvas.nodes;
      delete canvas.edges;
      delete canvas.map;
      const { error } = await sb.rpc("gw_save_folder_canvas", { p_folder: f.id, p_canvas: canvas });
      if (error) {
        toast(/too large/i.test(error.message || "") ? t("home.sheetTooBig") : t("home.saveFailed") + (error.message ? " (" + error.message + ")" : ""));
        return false;
      }
      f.canvas = canvas;
      return true;
    }
    // 存分页清单（保留每一页自己的内容；第一页的内容在外层）
    const pagesWith = (f, list) => {
      const old = new Map(rawPages(f).map((p) => [p.id, p]));
      return list.map((p) => (p.id === "main" ? { id: "main", type: "links", title: p.title } : { ...(old.get(p.id) || {}), ...p }));
    };
    const pageName = (p) => p.title || (p.id === "main" ? t("home.pageLinks") : t("home.pageUntitled"));

    function mountPages(f, wrap, hooks) {
      const bar = $("[data-pages]", wrap);
      const host = $("[data-shelf-host]", wrap);
      const canEdit = !!hooks.canEdit;
      let pages = folderPages(f);
      let cur = pages.some((p) => p.id === hooks.page) ? hooks.page : pages[0].id;
      let renaming = false;
      const sharedIcon = f.is_shared || f.shared_by;
      function paintBar() {
        if (!canEdit && pages.length < 2) return (bar.innerHTML = "");
        const tab = (p) => {
          const on = p.id === cur;
          if (on && renaming)
            return `<span class="inline-flex items-center gap-1 rounded-xl bg-white px-1.5 py-1 shadow-sm ring-2 ring-slate-900 dark:bg-slate-800 dark:ring-white">
              <input data-page-name value="${esc(p.title || pageName(p))}" maxlength="40" aria-label="${esc(t("home.pageName"))}" class="h-7 w-40 rounded-lg bg-transparent px-1.5 text-sm font-semibold outline-none">
              <button type="button" data-page-ok aria-label="${esc(t("home.save"))}" title="${esc(t("home.save"))}" class="flex size-7 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">${icon("check", "size-4")}</button>
              ${p.id !== "main" ? `<button type="button" data-page-del aria-label="${esc(t("home.pageDelete"))}" title="${esc(t("home.pageDelete"))}" class="flex size-7 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">${icon("trash-2", "size-4")}</button>` : ""}
            </span>`;
          return `<button type="button" data-page="${esc(p.id)}" ${on && canEdit ? `title="${esc(t("home.pageRenameHint"))}"` : ""} class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
            on ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900" : "bg-white/70 text-slate-600 ring-1 ring-slate-200 hover:bg-white dark:bg-white/5 dark:text-slate-300 dark:ring-white/10"
          }">${icon(p.type === "sheet" ? "table-2" : "layout-list", "size-4 shrink-0")}<span class="whitespace-nowrap">${esc(pageName(p))}</span></button>`;
        };
        bar.innerHTML = `<div class="mb-3 flex flex-wrap items-center gap-1.5 border-b border-slate-200/70 pb-3 dark:border-white/10 ${sharedIcon ? "pr-10" : ""}">
          ${pages.map(tab).join("")}
          ${canEdit ? `<button type="button" data-page-add aria-label="${esc(t("home.pageAdd"))}" title="${esc(t("home.pageAdd"))}" class="inline-flex items-center gap-1 rounded-xl border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:hover:border-white dark:hover:text-white">${icon("plus", "size-4")}${esc(t("home.pageAdd"))}</button>` : ""}
        </div>`;
        refreshIcons();
        if (renaming) {
          const inp = $("[data-page-name]", bar);
          inp.focus();
          inp.select();
        }
      }
      function mountCurrent() {
        const p = pages.find((x) => x.id === cur) || pages[0];
        cur = p.id;
        // 每次换页都给一个新的方块：上一页挂的事件跟着旧方块一起丢掉，不会两页抢着处理
        host.innerHTML = "<div></div>";
        const box = host.firstElementChild;
        if (p.type === "sheet") return mountSheet(f, p.id, box, { canEdit, toolsPad: false });
        mountShelves(f, box, {
          ...hooks,
          page: p.id === "main" ? null : p.id,
          otherPages: pages.filter((x) => x.type === "links" && x.id !== p.id),
          toolsPad: !bar.innerHTML && sharedIcon,
          reopen: () => hooks.reopen(cur),
        });
      }
      async function rename(commit) {
        const inp = $("[data-page-name]", bar);
        const title = inp ? inp.value.trim().slice(0, 40) : "";
        renaming = false;
        const p = pages.find((x) => x.id === cur);
        if (commit && p && title && title !== pageName(p)) {
          const next = pages.map((x) => (x.id === cur ? { ...x, title } : x));
          if (await saveFolderCanvas(f, { pages: pagesWith(f, next) })) pages = next;
        }
        paintBar();
      }
      function addPage() {
        const dlg = modal(
          t("home.pageAdd"),
          `<form class="space-y-4">
            <label class="block space-y-1.5"><span class="${cls.label}">${esc(t("home.pageName"))}</span>
              <input name="title" required maxlength="40" placeholder="${esc(t("home.pageNameEg"))}" class="${cls.input}"></label>
            <div class="grid gap-2 sm:grid-cols-2">
              ${[
                ["sheet", "table-2", t("home.pageTypeSheet"), t("home.pageTypeSheetHint")],
                ["links", "layout-list", t("home.pageTypeLinks"), t("home.pageTypeLinksHint")],
              ]
                .map(
                  ([v, ic, label, hint], i) => `<label class="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-slate-900 has-[:checked]:ring-1 has-[:checked]:ring-slate-900 dark:border-slate-700 dark:has-[:checked]:border-white dark:has-[:checked]:ring-white">
                    <input type="radio" name="type" value="${v}" ${i === 0 ? "checked" : ""} class="mt-1 size-4 accent-slate-900">
                    <span class="min-w-0"><span class="flex items-center gap-1.5 text-sm font-semibold">${icon(ic, "size-4")}${esc(label)}</span><span class="mt-0.5 block text-xs text-slate-500">${esc(hint)}</span></span>
                  </label>`,
                )
                .join("")}
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button>
              <button type="submit" class="${btn("primary")}">${icon("plus")} ${esc(t("home.pageAdd"))}</button>
            </div>
          </form>`,
        );
        refreshIcons();
        $("[data-cancel]", dlg.el).onclick = dlg.close;
        $("form", dlg.el).addEventListener("submit", async (e) => {
          e.preventDefault();
          const fm = e.target;
          const type = fm.type.value === "links" ? "links" : "sheet";
          const id = "p" + Math.random().toString(36).slice(2, 10);
          const page = { id, type, title: fm.title.value.trim().slice(0, 40), ...(type === "sheet" ? { rows: 20, cols: 6, cells: {} } : { shelves: [], loose: [] }) };
          const list = [...pagesWith(f, pages), page];
          if (!(await saveFolderCanvas(f, { pages: list }))) return;
          dlg.close();
          pages = folderPages(f);
          cur = id;
          paintBar();
          mountCurrent();
        });
      }
      async function deletePage() {
        const p = pages.find((x) => x.id === cur);
        if (!p || p.id === "main") return;
        const ok = await confirmDialog(t("home.pageDeleteTitle"), t(p.type === "sheet" ? "home.pageDeleteSheet" : "home.pageDeleteLinks", { name: pageName(p) }), t("home.delete"), t("home.cancel"));
        if (!ok) return;
        const list = pagesWith(f, pages.filter((x) => x.id !== p.id));
        if (!(await saveFolderCanvas(f, { pages: list }))) return;
        pages = folderPages(f);
        cur = "main";
        renaming = false;
        paintBar();
        mountCurrent();
      }
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if ("pageAdd" in b.dataset) return addPage();
        if ("pageOk" in b.dataset) return rename(true);
        if ("pageDel" in b.dataset) return deletePage();
        if (b.dataset.page) {
          if (b.dataset.page === cur) {
            // 再按一次现在这页 → 改名字
            if (!canEdit) return;
            renaming = true;
            return paintBar();
          }
          cur = b.dataset.page;
          renaming = false;
          paintBar();
          mountCurrent();
        }
      });
      bar.addEventListener("keydown", (e) => {
        if (!e.target.matches("[data-page-name]")) return;
        if (e.key === "Enter") (e.preventDefault(), rename(true));
        if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), rename(false));
      });
      paintBar();
      mountCurrent();
    }

    // ------------------------------------------------------------ 表格页（像 Google Sheets）
    /* 格子直接打字（Enter 往下一格、Tab 往右）；从 Excel / Google Sheets 复制一块贴上会自动摊开；
       拉栏位标题右边 / 列号下面的线改宽度、高度；第一列当标题（粗体）。
       右边「+」加一栏、下面「+」加一列。点栏位字母 / 列号选那一栏 / 列（Shift 再点 = 选一整段），
       按右键（或再点一次选好的）出现选单：插入几栏 / 几列（左右 / 上下）、设宽度 / 高度、删除——选几栏就一起改；
       拉线改大小时，选好的几栏 / 几列也一起变。
       上面一排格式工具：字变大 / 变小、靠左 / 置中 / 靠右、靠上 / 置中 / 靠下——用在拉选的一块格子（按住拖，或 Shift 再点），
       或选好的整栏 / 整列，不然就是现在这一格。
       点一下 = 选这一格（不进去打字）；按两下、Enter、F2 = 进去改字；选好直接打字 = 换掉内容。方向键换格子；
       Delete / Backspace 清掉选好的格子（一格、一块、或整栏 / 整列）。格子上按右键：在选好的栏 / 列里 → 栏 / 列选单；不然 → 宽度 / 高度 / 清除。
       框线（像 Google Sheets）：全部、内框、横线、直线、外框、左 / 上 / 右 / 下、清除；可选颜色、粗细 / 虚线 / 点线。
       框线记在格子上：下面那条 bb、右边那条 br（第一列的上面 bt、第一栏的左边 bl），两格中间只记一次。
       另有粗体（b）、底色（bg）。
       复原 / 重做：Ctrl+Z（Mac：⌘Z）复原，Ctrl+Y 或 Ctrl+Shift+Z 重做；工具列也有两个钮。打字、贴上、格式、大小、加 / 删栏列都可以复原（留言不算）。存在 fmt { "列:栏": { s: 字大小, a: "l"|"c"|"r", v: "t"|"m"|"b" } }。
       放大 / 缩小：缩小时画面能放更多格，空的格子自动补满（不用自己加）。
       留言：看得到这个文件夹的人都可以对一格留言（谁、内容、日期时间），存在 gw_folder_cell_comments（要先跑 20261206 SQL）。
       看的人：Email、网址可以直接点。打字停一下就自动存（整个 canvas 一起存，单页最多约 300KB）。 */
    const SHEET_ZOOMS = [50, 67, 80, 90, 100, 110, 125, 150];
    function mountSheet(f, pageId, host, hooks) {
      const canEdit = !!hooks.canEdit;
      const rec = () => rawPages(f).find((p) => p.id === pageId) || {};
      const r0 = rec();
      const num = (v, lo, hi, d) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
      };
      const MAXR = 500, MAXC = 52;
      let rows = num(r0.rows, 1, MAXR, 20);
      let cols = num(r0.cols, 1, MAXC, 6);
      let cells = new Map();
      if (r0.cells && typeof r0.cells === "object")
        for (const [k, v] of Object.entries(r0.cells)) if (/^\d{1,3}:\d{1,2}$/.test(k) && typeof v === "string" && v) cells.set(k, v.slice(0, 1000));
      // 格式：字大小（s）、左右（a）、上下（v）
      const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]; // − / + 一格一格跳
      const FS_MIN = 6, FS_MAX = 72; // 自己打的可以是 6–72 任何整数
      const DEF_FS = 14;
      let fmt = new Map();
      if (r0.fmt && typeof r0.fmt === "object")
        for (const [k, v] of Object.entries(r0.fmt)) {
          if (!/^\d{1,3}:\d{1,2}$/.test(k) || !v || typeof v !== "object") continue;
          const x = {};
          if (Number.isInteger(Number(v.s)) && Number(v.s) >= FS_MIN && Number(v.s) <= FS_MAX) x.s = Number(v.s);
          if (["l", "c", "r"].includes(v.a)) x.a = v.a;
          if (["t", "m", "b"].includes(v.v)) x.v = v.v;
          if (v.b === 0 || v.b === 1) x.b = v.b;
          if (typeof v.bg === "string" && /^#[0-9a-f]{6}$/i.test(v.bg)) x.bg = v.bg;
          for (const e of ["bt", "bb", "bl", "br"]) if (typeof v[e] === "string" && /^[123do]\|#[0-9a-f]{6}$/i.test(v[e])) x[e] = v[e];
          if (Object.keys(x).length) fmt.set(k, x);
        }
      const fmtOf = (k) => fmt.get(k) || {};
      let w = {}, h = {};
      if (r0.w && typeof r0.w === "object") for (const [k, v] of Object.entries(r0.w)) if (/^\d{1,2}$/.test(k)) w[k] = num(v, 40, 600, 140);
      if (r0.h && typeof r0.h === "object") for (const [k, v] of Object.entries(r0.h)) if (/^\d{1,3}$/.test(k)) h[k] = num(v, 24, 240, 32);
      const DEF_W = 140, DEF_H = 32; // 预设栏宽 / 列高
      let q = "", qi = 0; // 搜寻：打的字、现在第几个
      let grid = r0.grid !== false; // 格线：显示 / 不显示（整页，存在这一页）
      const colW = (c) => w[c] || DEF_W;
      const rowH = (r) => h[r] || DEF_H;
      const colName = (c) => {
        let s = "";
        for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
      };
      const cellName = (k) => {
        const [r, c] = k.split(":").map(Number);
        return colName(c) + (r + 1);
      };
      // 放大 / 缩小：每个人自己记（这台电脑）
      let zoom = 100;
      try { zoom = SHEET_ZOOMS.includes(Number(localStorage.getItem("gw-sheet-zoom"))) ? Number(localStorage.getItem("gw-sheet-zoom")) : 100; } catch (e) {}
      const z = () => zoom / 100;
      // 画面上显示几栏 / 几列：存的数目，不够填满看得到的范围就自动补空格子
      let showC = cols, showR = rows;
      // 补满：只补到刚好放得进视窗的格子数（最后一格不会被切掉，不用卷到右边 / 下面）
      const SIDE = canEdit ? 40 : 0; // 右边「+ 栏」那一条（含间距）
      const BOTTOM = canEdit ? 40 : 0; // 下面「+ 列」那一条
      const maxH = () => Math.round(innerHeight * 0.6);
      function measure() {
        const availW = (Math.max(300, host.clientWidth || 900) - SIDE - 2) / z() - 44;
        let c = 0, sum = 0;
        while (c < MAXC && (c < cols || sum + colW(c) <= availW)) sum += colW(c++);
        showC = Math.max(cols, c, 1);
        const availH = (maxH() - 6) / z() - 27; // 边框 + 栏位标题那一行（留一点空，不会出现卷轴）
        let r = 0, hs = 0;
        while (r < MAXR && (r < rows || hs + rowH(r) <= availH)) hs += rowH(r++);
        showR = Math.max(rows, r, 1);
      }
      // 打到补出来的格子里：那一格就算进正式的范围
      const grow = (r, c) => ((rows = Math.max(rows, r + 1)), (cols = Math.max(cols, c + 1)));

      let focus = null; // [列, 栏]：最后点的格子
      let sel = null; // 选好的栏 / 列：{ kind: "col" | "row", a, b, anchor }
      let range = null; // 拉选的一块格子：{ r1, c1, r2, c2 }（已排好大小）
      const RANGE_CLS = ["gw-rng", "shadow-[inset_0_0_0_9999px_rgba(14,165,233,0.18)]"]; // 一层淡蓝盖在格子上（有底色也看得到）
      const inRange = (r, c) => !!range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
      const inSel = (kind, i) => !!sel && sel.kind === kind && i >= sel.a && i <= sel.b;
      let timer = null;
      const status = (txt) => {
        const el = $("[data-sheet-status]", host);
        if (el) el.textContent = txt;
      };
      const toObj = (m) => Object.fromEntries([...m].filter(([, v]) => v));
      async function save() {
        clearTimeout(timer);
        timer = null;
        const list = rawPages(f).map((p) => (p.id === pageId ? { ...p, rows, cols, cells: toObj(cells), fmt: Object.fromEntries(fmt), w, h, grid } : p));
        status(t("home.mapUnsaved"));
        const ok = await saveFolderCanvas(f, { pages: list });
        status(ok ? t("home.mapSaved") : "");
      }
      let ver = 0; // 每改一次就加一（复原纪录用来分辨「有没有改过」）
      const later = () => {
        ver++;
        status(t("home.mapUnsaved"));
        clearTimeout(timer);
        timer = setTimeout(save, 700);
      };
      // ---- 复原 / 重做：每次要改之前先记一份（同一格连续打字只记一次）
      const hist = [], fut = [];
      let typingKey = null;
      const snap = () => ({ ver, rows, cols, cells: new Map(cells), fmt: new Map([...fmt].map(([k, v]) => [k, { ...v }])), w: { ...w }, h: { ...h }, grid });
      function remember() {
        if (hist.length && hist[hist.length - 1].ver === ver) return; // 上一份之后还没改过：不用再记
        hist.push(snap());
        if (hist.length > 100) hist.shift();
        fut.length = 0;
        paintUndo();
      }
      function restore(x) {
        rows = x.rows;
        cols = x.cols;
        cells = new Map(x.cells);
        fmt = new Map([...x.fmt].map(([k, v]) => [k, { ...v }]));
        w = { ...x.w };
        h = { ...x.h };
        grid = x.grid !== false;
        typingKey = null;
        const keep = focus && !range ? focus.slice() : null;
        render();
        later();
        if (keep) {
          const el = cellEl(keep[0], keep[1]);
          if (el) el.focus({ preventScroll: true });
        }
      }
      function undo() {
        if (!hist.length) return;
        fut.push(snap());
        restore(hist.pop());
      }
      function redo() {
        if (!fut.length) return;
        hist.push(snap());
        restore(fut.pop());
      }
      function paintUndo() {
        const u = $("[data-undo]", host), rd = $("[data-redo]", host);
        if (u) u.disabled = !hist.length;
        if (rd) rd.disabled = !fut.length;
      }

      // ---- 留言
      let notes = []; // { id, cell, user_id, author_name, body, created_at }
      let notesOn = true;
      const notesOf = (k) => notes.filter((n) => n.cell === k).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      async function loadNotes() {
        const { data: rows0, error } = await sb.from("gw_folder_cell_comments").select("id, cell, user_id, author_name, body, created_at").eq("folder_id", f.id).eq("page_id", pageId);
        if (error) return void (notesOn = false);
        notes = rows0 || [];
        paintMarks();
      }
      // 有留言的格子：右上角一个橘色小角
      function paintMarks() {
        $$("[data-mark]", host).forEach((x) => x.remove());
        const have = new Set(notes.map((n) => n.cell));
        have.forEach((k) => {
          const td = $(`[data-td="${k}"]`, host);
          if (td) td.insertAdjacentHTML("beforeend", `<button type="button" data-mark data-cmt="${k}" title="${esc(t("home.sheetComments"))}" aria-label="${esc(t("home.sheetComments"))}" class="absolute top-0 right-0 z-[1] size-0 border-t-[9px] border-l-[9px] border-t-orange-500 border-l-transparent"></button>`);
        });
      }

      // ---- 小浮窗（加几栏 / 几列、删栏 / 列、留言）：点外面或 Esc 关掉
      let popEl = null;
      function closePop() {
        if (!popEl) return;
        popEl.remove();
        popEl = null;
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", popKey, true);
      }
      const outside = (e) => popEl && !popEl.contains(e.target) && !e.target.closest("[data-pop-anchor]") && closePop();
      const popKey = (e) => {
        if (e.key !== "Escape" || !popEl) return;
        e.stopPropagation();
        closePop();
      };
      function pop(anchor, html, width = 260) {
        closePop();
        popEl = document.createElement("div");
        popEl.className = "fixed z-[60] rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-2xl dark:border-slate-700 dark:bg-slate-900";
        popEl.style.width = width + "px";
        popEl.innerHTML = html;
        document.body.appendChild(popEl);
        const a = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor; // 元素，或滑鼠位置 { left, top, bottom }
        const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
        let left = Math.min(innerWidth - pw - 8, Math.max(8, a.left));
        let top = a.bottom + 6;
        if (top + ph > innerHeight - 8) top = Math.max(8, a.top - ph - 6);
        popEl.style.left = left + "px";
        popEl.style.top = top + "px";
        refreshIcons();
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", popKey, true);
        return popEl;
      }
      const when = (d) => new Intl.DateTimeFormat(GW.LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
      function openNotes(k, anchor) {
        if (!notesOn) return toast(t("home.sheetCommentsNeedDb"));
        const isOwner = !f.shared_by;
        const list = () => {
          const items = notesOf(k);
          return items.length
            ? items
                .map(
                  (n) => `<div class="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
                    <div class="flex items-center gap-2"><span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold dark:bg-slate-700">${esc((n.author_name || "?").slice(0, 1))}</span>
                      <span class="min-w-0 flex-1"><span class="block truncate text-xs font-semibold">${esc(n.author_name || "—")}</span><span class="block text-[11px] text-slate-400">${esc(when(n.created_at))}</span></span>
                      ${n.user_id === data.profile.id || isOwner ? `<button type="button" data-note-del="${n.id}" aria-label="${esc(t("home.delete"))}" title="${esc(t("home.delete"))}" class="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-white/10">${icon("trash-2", "size-3.5")}</button>` : ""}
                    </div>
                    <p class="mt-1.5 text-sm break-words whitespace-pre-line">${esc(n.body)}</p>
                  </div>`,
                )
                .join("")
            : `<p class="py-2 text-center text-xs text-slate-400">${esc(t("home.sheetNoComments"))}</p>`;
        };
        const el = pop(
          anchor,
          `<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">${icon("message-square", "size-4")}${esc(t("home.sheetCommentsOn", { cell: cellName(k) }))}</div>
          <div data-note-list class="max-h-64 space-y-2 overflow-y-auto">${list()}</div>
          <form data-note-form class="mt-2 space-y-2">
            <textarea name="body" rows="2" maxlength="1000" required placeholder="${esc(t("home.sheetCommentPh"))}" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-white"></textarea>
            <div class="flex justify-end"><button type="submit" class="${btn("primary", "sm")}">${esc(t("home.sheetComment"))}</button></div>
          </form>`,
          300,
        );
        const repaint = () => {
          $("[data-note-list]", el).innerHTML = list();
          refreshIcons();
          paintMarks();
        };
        $("textarea", el).focus();
        $("[data-note-form]", el).addEventListener("submit", async (e) => {
          e.preventDefault();
          const body = e.target.body.value.trim();
          if (!body) return;
          const sub = $("button[type=submit]", el);
          sub.disabled = true;
          const { data: row, error } = await sb.from("gw_folder_cell_comments").insert({ folder_id: f.id, page_id: pageId, cell: k, body }).select("id, cell, user_id, author_name, body, created_at").single();
          sub.disabled = false;
          if (error) return toast(/gw_folder_cell_comments|PGRST205|42P01/.test(`${error.code} ${error.message}`) ? t("home.sheetCommentsNeedDb") : t("home.saveFailed"));
          notes.push(row);
          e.target.body.value = "";
          repaint();
        });
        el.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-note-del]");
          if (!b) return;
          const { error } = await sb.from("gw_folder_cell_comments").delete().eq("id", b.dataset.noteDel);
          if (error) return toast(t("home.saveFailed"));
          notes = notes.filter((n) => n.id !== b.dataset.noteDel);
          repaint();
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.name === "body") (e.preventDefault(), $("[data-note-form]", el).requestSubmit());
        });
      }

      // 看的人：Email → mailto、网址 → 新分页
      const show = (v) => {
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `<a href="mailto:${esc(v)}" class="text-sky-700 hover:underline dark:text-sky-300">${esc(v)}</a>`;
        if (/^https?:\/\/\S+$/i.test(v)) return `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer" class="text-sky-700 hover:underline dark:text-sky-300">${esc(v)}</a>`;
        return esc(v);
      };
      // 格式工具列：字变小 / 大小 / 字变大 | 靠左 置中 靠右 | 靠上 置中 靠下
      function toolsHtml() {
        const tb = (attr, ic, label) => `<button type="button" ${attr} title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="false" class="flex size-7 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent aria-pressed:bg-slate-900 aria-pressed:text-white dark:text-slate-300 dark:hover:bg-white/10 dark:aria-pressed:bg-white dark:aria-pressed:text-slate-900">${icon(ic, "size-4")}</button>`;
        const sep = `<span class="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-700"></span>`;
        return `<div data-fmt-bar class="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1 py-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          ${tb("data-undo", "undo-2", t("home.sheetUndo"))}
          ${tb("data-redo", "redo-2", t("home.sheetRedo"))}
          ${sep}
          <button type="button" data-fmt="smaller" title="${esc(t("home.sheetFontSmaller"))}" aria-label="${esc(t("home.sheetFontSmaller"))}" class="flex size-7 items-center justify-center rounded-lg text-base font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">−</button>
          <input data-fmt-size type="number" min="${FS_MIN}" max="${FS_MAX}" step="1" value="${DEF_FS}" title="${esc(t("home.sheetFontSize"))}" aria-label="${esc(t("home.sheetFontSize"))}" class="h-7 w-11 rounded-md border border-slate-200 bg-white text-center text-xs font-semibold tabular-nums text-slate-700 outline-none [appearance:textfield] focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-white [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none">
          <button type="button" data-fmt="bigger" title="${esc(t("home.sheetFontBigger"))}" aria-label="${esc(t("home.sheetFontBigger"))}" class="flex size-7 items-center justify-center rounded-lg text-base font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">+</button>
          ${sep}
          ${tb('data-fmt="b"', "bold", t("home.sheetBold"))}
          ${tb('data-fill data-pop-anchor', "paint-bucket", t("home.sheetFill"))}
          ${tb('data-borders data-pop-anchor', "grid-2x2", t("home.sheetBorders"))}
          ${tb("data-gridlines", "grid-3x3", t("home.sheetGridlines"))}
          ${sep}
          ${tb('data-fmt="a:l"', "align-left", t("home.sheetAlignLeft"))}
          ${tb('data-fmt="a:c"', "align-center", t("home.sheetAlignCenter"))}
          ${tb('data-fmt="a:r"', "align-right", t("home.sheetAlignRight"))}
          ${sep}
          ${tb('data-fmt="v:t"', "align-vertical-justify-start", t("home.sheetAlignTop"))}
          ${tb('data-fmt="v:m"', "align-vertical-justify-center", t("home.sheetAlignMiddle"))}
          ${tb('data-fmt="v:b"', "align-vertical-justify-end", t("home.sheetAlignBottom"))}
        </div>`;
      }
      // 格式要用在哪些格子：拉选的一块 → 选好的整栏 / 整列 → 现在这一格
      function targets() {
        const out = [];
        if (range) {
          for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) out.push(r + ":" + c);
        } else if (sel) {
          for (let i = sel.a; i <= sel.b; i++)
            if (sel.kind === "col") for (let r = 0; r < showR; r++) out.push(r + ":" + i);
            else for (let c = 0; c < showC; c++) out.push(i + ":" + c);
        } else if (focus) out.push(focus.join(":"));
        return out;
      }
      // 工具列亮起来的按钮 = 第一格现在的格式
      function paintTools() {
        const bar = $("[data-fmt-bar]", host);
        if (!bar) return;
        paintUndo();
        const gb = $("[data-gridlines]", bar);
        if (gb) gb.setAttribute("aria-pressed", String(grid));
        const k = targets()[0];
        const fm = k ? fmtOf(k) : {};
        const fsBox = $("[data-fmt-size]", bar);
        if (document.activeElement !== fsBox) fsBox.value = fm.s || DEF_FS; // 正在打的时候不要盖掉
        const bb = $('[data-fmt="b"]', bar);
        if (bb) bb.setAttribute("aria-pressed", String(fm.b != null ? fm.b === 1 : !!k && k.startsWith("0:")));
        $$("[data-fmt]", bar).forEach((b) => {
          const [key, val] = b.dataset.fmt.split(":");
          if (!val) return;
          b.setAttribute("aria-pressed", String((fm[key] || (key === "a" ? "l" : "m")) === val));
        });
      }
      function applyFmt(what) {
        const list = targets();
        if (!list.length) return toast(t("home.sheetPickCells"));
        remember();
        const [key, val] = what.split(":");
        list.forEach((k) => {
          const x = { ...fmtOf(k) };
          if (what === "bigger" || what === "smaller") {
            // 下一个常用大小（自己打过奇怪的大小也可以接着跳）
            const cur = x.s || DEF_FS;
            const next = what === "bigger" ? FONT_SIZES.find((n) => n > cur) : [...FONT_SIZES].reverse().find((n) => n < cur);
            x.s = next || cur;
            if (x.s === DEF_FS) delete x.s;
          } else if (what === "b") {
            // 粗体：跟第一格相反（第一列预设是粗体）
            const k0 = list[0];
            const f0 = fmtOf(k0);
            const now = f0.b != null ? f0.b === 1 : k0.startsWith("0:");
            const r = Number(k.split(":")[0]);
            x.b = now ? 0 : 1;
            if ((x.b === 1) === (r === 0)) delete x.b; // 跟预设一样就不用记
          } else if (key === "bg") {
            if (val) x.bg = val;
            else delete x.bg;
          } else if (key === "s") {
            x.s = Number(val);
            if (x.s === DEF_FS) delete x.s;
          } else {
            x[key] = val;
            if ((key === "a" && val === "l") || (key === "v" && val === "m")) delete x[key]; // 预设就不用记
          }
          Object.keys(x).length ? fmt.set(k, x) : fmt.delete(k);
        });
        const keep = focus && !range && !sel ? focus.slice() : null;
        render();
        later();
        if (keep) {
          const el = cellEl(keep[0], keep[1]);
          if (el) el.focus({ preventScroll: true });
        }
      }
      // ---- 框线
      const BSTYLE = { 1: "1px solid", 2: "2px solid", 3: "3px solid", d: "1px dashed", o: "1px dotted" };
      const BCOLORS = ["#0f172a", "#64748b", "#cbd5e1", "#dc2626", "#ea580c", "#16a34a", "#2563eb", "#7c3aed"];
      const FILLS = ["#f1f5f9", "#e2e8f0", "#fef9c3", "#ffedd5", "#fee2e2", "#dcfce7", "#cffafe", "#dbeafe", "#f3e8ff", "#fce7f3"];
      let bStyle = "1", bColor = "#0f172a";
      // 要画框线的那一块（长方形）：拉选的一块 → 选好的整栏 / 整列 → 现在这一格
      function rect() {
        if (range) return { ...range };
        if (sel) return sel.kind === "col" ? { r1: 0, r2: showR - 1, c1: sel.a, c2: sel.b } : { r1: sel.a, r2: sel.b, c1: 0, c2: showC - 1 };
        if (focus) return { r1: focus[0], r2: focus[0], c1: focus[1], c2: focus[1] };
        return null;
      }
      const setEdge = (k, e, v) => {
        const x = { ...fmtOf(k) };
        v ? (x[e] = v) : delete x[e];
        Object.keys(x).length ? fmt.set(k, x) : fmt.delete(k);
      };
      // 横线：(r, c) 下面那条（r = -1 = 第一列上面）；直线：(r, c) 右边那条（c = -1 = 第一栏左边）
      const hEdge = (r, c, v) => (r < 0 ? setEdge("0:" + c, "bt", v) : setEdge(r + ":" + c, "bb", v));
      const vEdge = (r, c, v) => (c < 0 ? setEdge(r + ":0", "bl", v) : setEdge(r + ":" + c, "br", v));
      function applyBorder(kind) {
        const R = rect();
        if (!R) return toast(t("home.sheetPickCells"));
        const { r1, r2, c1, c2 } = R;
        const v = kind === "clear" ? null : bStyle + "|" + bColor;
        const H = (r) => { for (let c = c1; c <= c2; c++) hEdge(r, c, v); };
        const V = (c) => { for (let r = r1; r <= r2; r++) vEdge(r, c, v); };
        remember();
        if (kind === "all" || kind === "clear") {
          for (let r = r1 - 1; r <= r2; r++) H(r);
          for (let c = c1 - 1; c <= c2; c++) V(c);
        } else if (kind === "inner") {
          for (let r = r1; r < r2; r++) H(r);
          for (let c = c1; c < c2; c++) V(c);
        } else if (kind === "horizontal") for (let r = r1; r < r2; r++) H(r);
        else if (kind === "vertical") for (let c = c1; c < c2; c++) V(c);
        else if (kind === "outer") (H(r1 - 1), H(r2), V(c1 - 1), V(c2));
        else if (kind === "top") H(r1 - 1);
        else if (kind === "bottom") H(r2);
        else if (kind === "left") V(c1 - 1);
        else if (kind === "right") V(c2);
        grow(r2, c2);
        const keep = focus && !range && !sel ? focus.slice() : null;
        render();
        later();
        if (keep) {
          const el = cellEl(keep[0], keep[1]);
          if (el) el.focus({ preventScroll: true });
        }
      }
      // 选项的小图（像 Google Sheets）：淡色格子，深色 = 会画的线
      const BORDER_KINDS = ["all", "inner", "horizontal", "vertical", "outer", "left", "top", "right", "bottom", "clear"];
      const borderIcon = (kind) => {
        const L = { top: "M2 2H16", bottom: "M2 16H16", left: "M2 2V16", right: "M16 2V16", h: "M2 9H16", v: "M9 2V16" };
        const on = { all: ["top", "bottom", "left", "right", "h", "v"], inner: ["h", "v"], horizontal: ["h"], vertical: ["v"], outer: ["top", "bottom", "left", "right"], left: ["left"], top: ["top"], right: ["right"], bottom: ["bottom"], clear: [] }[kind];
        const faint = Object.values(L).map((d) => `<path d="${d}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="1.5 1.5"/>`).join("");
        const dark = on.map((x) => `<path d="${L[x]}" stroke="currentColor" stroke-width="2"/>`).join("");
        return `<svg viewBox="0 0 18 18" class="size-[18px]" fill="none">${faint}${dark}${kind === "clear" ? `<path d="M3 15L15 3" stroke="#dc2626" stroke-width="1.6"/>` : ""}</svg>`;
      };
      function borderMenu(anchor) {
        const swatch = (c) => `<button type="button" data-bcolor="${c}" title="${c}" class="size-6 rounded-full ring-offset-2 ${c === bColor ? "ring-2 ring-slate-900 dark:ring-white" : "ring-1 ring-slate-200 dark:ring-slate-700"}" style="background:${c}"></button>`;
        const styleBtn = (st) => `<button type="button" data-bstyle="${st}" class="flex h-8 flex-1 items-center justify-center rounded-lg ${st === bStyle ? "bg-slate-900 dark:bg-white" : "hover:bg-slate-100 dark:hover:bg-white/10"}"><span class="block w-8" style="border-top:${BSTYLE[st]} ${st === bStyle ? "var(--sw,#fff)" : "#334155"}"></span></button>`;
        const paint = (el) => {
          el.innerHTML = `<p class="mb-2 text-xs font-bold text-slate-500">${esc(t("home.sheetBorders"))}</p>
            <div class="grid grid-cols-5 gap-1">${BORDER_KINDS.map((k) => `<button type="button" data-border="${k}" title="${esc(t("home.sheetBorder_" + k))}" aria-label="${esc(t("home.sheetBorder_" + k))}" class="flex h-9 items-center justify-center rounded-lg text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10">${borderIcon(k)}</button>`).join("")}</div>
            <p class="mt-3 mb-1.5 text-xs text-slate-500">${esc(t("home.sheetBorderColor"))}</p>
            <div class="flex flex-wrap gap-1.5 px-0.5">${BCOLORS.map(swatch).join("")}</div>
            <p class="mt-3 mb-1.5 text-xs text-slate-500">${esc(t("home.sheetBorderStyle"))}</p>
            <div class="flex gap-1 [--sw:#fff] dark:[--sw:#0f172a]">${["1", "2", "3", "d", "o"].map(styleBtn).join("")}</div>`;
        };
        const el = pop(anchor, "", 260);
        paint(el);
        el.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          if (b.dataset.bcolor) return ((bColor = b.dataset.bcolor), paint(el));
          if (b.dataset.bstyle) return ((bStyle = b.dataset.bstyle), paint(el));
          if (b.dataset.border) applyBorder(b.dataset.border); // 选单留着，可以接着按
        });
      }
      function fillMenu(anchor) {
        const el = pop(
          anchor,
          `<p class="mb-2 text-xs font-bold text-slate-500">${esc(t("home.sheetFill"))}</p>
          <div class="grid grid-cols-5 gap-2 px-0.5">${FILLS.map((c) => `<button type="button" data-fillc="${c}" title="${c}" class="size-8 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700" style="background:${c}"></button>`).join("")}</div>
          <button type="button" data-fillc="" class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-white/5">${icon("eraser", "size-3.5")}${esc(t("home.sheetFillNone"))}</button>`,
          220,
        );
        el.addEventListener("click", (e) => {
          const b = e.target.closest("[data-fillc]");
          if (!b) return;
          closePop();
          applyFmt("bg:" + b.dataset.fillc);
        });
      }
      // 拉选的那一块：格子底色
      function paintRange() {
        $$("td.gw-rng", host).forEach((x) => x.classList.remove(...RANGE_CLS));
        if (range)
          for (let r = range.r1; r <= range.r2; r++)
            for (let c = range.c1; c <= range.c2; c++) {
              const td = $(`[data-td="${r}:${c}"]`, host);
              if (td) td.classList.add(...RANGE_CLS);
            }
        paintTools();
      }
      // 看的人：点一格 → 框起来，出现「复制」（和留言）按钮
      function viewPick(td) {
        $$("[data-vtools]", host).forEach((x) => x.remove());
        $$("td.gw-vsel", host).forEach((x) => x.classList.remove("gw-vsel", "ring-2", "ring-sky-500", "ring-inset"));
        const k = td.dataset.vcell;
        td.classList.add("gw-vsel", "ring-2", "ring-sky-500", "ring-inset");
        const ib = "flex size-6 items-center justify-center rounded-md bg-white text-slate-500 shadow ring-1 ring-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:text-white";
        td.insertAdjacentHTML(
          "beforeend",
          `<span data-vtools class="absolute top-1/2 right-1 z-[2] flex -translate-y-1/2 gap-1">${
            cells.get(k) ? `<button type="button" data-vcopy="${k}" title="${esc(t("home.sheetCopy"))}" aria-label="${esc(t("home.sheetCopy"))}" class="${ib}">${icon("copy", "size-3.5")}</button>` : ""
          }${notesOn ? `<button type="button" data-cmt="${k}" data-pop-anchor title="${esc(t("home.sheetComment"))}" aria-label="${esc(t("home.sheetComment"))}" class="${ib}">${icon("message-square-plus", "size-3.5")}</button>` : ""}</span>`,
        );
        refreshIcons();
      }
      async function viewCopy(k) {
        const v = cells.get(k) || "";
        try {
          await navigator.clipboard.writeText(v);
        } catch (e) {
          const ta = document.createElement("textarea");
          ta.value = v;
          ta.style.cssText = "position:fixed;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        toast(t("home.sheetCopied"));
      }
      function render() {
        measure();
        const hs = (on) => (on ? "bg-sky-200 text-sky-800 dark:bg-sky-800 dark:text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800");
        const head = `<tr><th class="sticky top-0 left-0 z-30 w-11 min-w-11 border-r border-b border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"></th>${Array.from(
          { length: showC },
          (_, c) => `<th class="sticky top-0 z-20 border-r border-b border-slate-200 p-0 text-center text-[11px] font-semibold select-none dark:border-slate-700 ${hs(inSel("col", c))}">
            <div class="relative h-6 leading-6">${canEdit ? `<button type="button" data-col-menu="${c}" data-pop-anchor class="h-full w-full hover:bg-slate-200/70 dark:hover:bg-slate-700">${colName(c)}</button><span data-col-resize="${c}" title="${esc(t("home.sheetDragSize"))}" class="absolute top-0 ${c === showC - 1 ? "right-0" : "-right-1"} z-10 h-full w-2 cursor-col-resize hover:bg-sky-400/60"></span>` : colName(c)}</div></th>`,
        ).join("")}</tr>`;
        const gl = grid ? "border-slate-200 dark:border-slate-700" : "border-transparent"; // 格线关掉：只剩自己设的框线
        const body = Array.from({ length: showR }, (_, r) => {
          const tds = Array.from({ length: showC }, (_, c) => {
            const k = r + ":" + c;
            const v = cells.get(k) || "";
            const fm = fmtOf(k);
            const ta = fm.a === "c" ? "center" : fm.a === "r" ? "right" : "left";
            const va = fm.v === "t" ? "top" : fm.v === "b" ? "bottom" : "middle";
            const fsz = fm.s || DEF_FS;
            const rangeCls = inRange(r, c) ? " " + RANGE_CLS.join(" ") : "";
            const isBold = fm.b != null ? fm.b === 1 : r === 0;
            // 框线：自己的下面 / 右边（第一列另外有上面、第一栏有左边）；没设就是淡淡的格线
            const edge = (v) => (v ? BSTYLE[v.split("|")[0]] + " " + v.split("|")[1] : "");
            const bs = [
              fm.bb ? `border-bottom:${edge(fm.bb)}` : "",
              fm.br ? `border-right:${edge(fm.br)}` : "",
              r === 0 && fm.bt ? `border-top:${edge(fm.bt)}` : "",
              c === 0 && fm.bl ? `border-left:${edge(fm.bl)}` : "",
              fm.bg ? `background-color:${fm.bg};color:#0f172a` : "",
            ].filter(Boolean).join(";");
            const bold = inSel("col", c) || inSel("row", r) ? "bg-sky-50 dark:bg-sky-900/20" + (r === 0 ? " font-semibold" : "") : r === 0 ? "font-semibold bg-slate-50 dark:bg-white/5" : "";
            const cmt = notesOn ? `<button type="button" data-cmt="${k}" data-pop-anchor title="${esc(t("home.sheetComment"))}" aria-label="${esc(t("home.sheetComment"))}" class="absolute top-1/2 right-1 z-[2] hidden size-6 -translate-y-1/2 items-center justify-center rounded-md bg-white text-slate-500 shadow ring-1 ring-slate-200 group-focus-within:flex hover:text-slate-900 dark:bg-slate-800 dark:ring-slate-700">${icon("message-square-plus", "size-3.5")}</button>` : "";
            return canEdit
              ? `<td data-td="${k}" style="vertical-align:${va};${bs}" class="group relative border-r border-b ${gl} p-0 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-inset dark:focus-within:bg-slate-900 ${bold}${rangeCls}"><input data-cell="${k}" value="${esc(v)}" readonly maxlength="1000" spellcheck="false" style="font-size:${fsz}px;text-align:${ta};${fm.bg ? "color:#0f172a;" : ""}font-weight:${isBold ? 600 : 400}" class="block w-full min-w-0 bg-transparent px-2 py-1 leading-tight text-slate-800 outline-none focus:pr-8 read-only:cursor-default read-only:caret-transparent read-only:select-none dark:text-slate-100">${cmt}<span data-col-resize="${c}" class="absolute top-0 ${c === showC - 1 ? "right-0" : "-right-[3px]"} z-[3] h-full w-[6px] cursor-col-resize hover:bg-sky-400/50"></span><span data-row-resize="${r}" class="absolute ${r === showR - 1 ? "bottom-0" : "-bottom-[3px]"} left-0 z-[3] h-[6px] w-full cursor-row-resize hover:bg-sky-400/50"></span></td>`
              : `<td data-td="${k}" data-vcell="${k}" style="vertical-align:${va};text-align:${ta};font-size:${fsz}px;font-weight:${isBold ? 600 : 400};${bs}" class="relative overflow-hidden border-r border-b ${gl} px-2 py-1 leading-tight text-ellipsis whitespace-nowrap text-slate-800 dark:text-slate-100 cursor-pointer hover:bg-sky-50/60 dark:hover:bg-white/5 ${bold}" title="${esc(v)}">${show(v)}</td>`;
          }).join("");
          return `<tr style="height:${rowH(r)}px"><th class="sticky left-0 z-10 border-r border-b border-slate-200 p-0 text-center text-[11px] font-medium select-none dark:border-slate-700 ${hs(inSel("row", r))}">
            <div class="relative flex h-full items-center justify-center">${canEdit ? `<button type="button" data-row-menu="${r}" data-pop-anchor class="h-full w-full hover:bg-slate-200/70 dark:hover:bg-slate-700">${r + 1}</button><span data-row-resize="${r}" title="${esc(t("home.sheetDragSize"))}" class="absolute ${r === showR - 1 ? "bottom-0" : "-bottom-1"} left-0 z-10 h-2 w-full cursor-row-resize hover:bg-sky-400/60"></span>` : r + 1}</div></th>${tds}</tr>`;
        }).join("");
        const tableW = 44 + Array.from({ length: showC }, (_, c) => colW(c)).reduce((a, b) => a + b, 0);
        // 重画前记住卷到哪里（表格本身 + 外面会卷的框），画完放回去：加框线 / 底色等不会跳回第一列
        const oldSh = $("[data-sheet]", host);
        const keepSh = oldSh ? [oldSh.scrollTop, oldSh.scrollLeft] : null;
        const outer = [];
        for (let el = host.parentElement; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) outer.push([el, el.scrollTop, el.scrollLeft]);
        const keepWin = [scrollX, scrollY];
        const zb = (attr, ic, label, dis) => `<button type="button" ${attr} ${dis ? "disabled" : ""} title="${esc(label)}" aria-label="${esc(label)}" class="flex size-7 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10">${icon(ic, "size-4")}</button>`;
        host.innerHTML = `
          <div class="mb-2 flex flex-wrap items-center gap-2">
            ${canEdit ? toolsHtml() : ""}
            <span data-sheet-status class="text-xs text-slate-400"></span>
            <div class="ml-auto flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white pr-1 pl-2 shadow-sm focus-within:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:focus-within:border-white">
              ${icon("search", "size-3.5 shrink-0 text-slate-400")}
              <input data-sheet-search type="search" value="${esc(q)}" placeholder="${esc(t("home.sheetSearch"))}" aria-label="${esc(t("home.sheetSearch"))}" autocomplete="off" spellcheck="false" class="h-7 w-28 min-w-0 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 sm:w-36 dark:text-slate-200 [&::-webkit-search-cancel-button]:hidden">
              <span data-search-count class="text-[11px] tabular-nums text-slate-400"></span>
              <button type="button" data-search-prev title="${esc(t("home.sheetSearchPrev"))}" aria-label="${esc(t("home.sheetSearchPrev"))}" class="hidden size-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">${icon("chevron-up", "size-3.5")}</button>
              <button type="button" data-search-next title="${esc(t("home.sheetSearchNext"))}" aria-label="${esc(t("home.sheetSearchNext"))}" class="hidden size-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">${icon("chevron-down", "size-3.5")}</button>
            </div>
            <div class="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1 py-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              ${zb("data-zoom-out", "zoom-out", t("home.sheetZoomOut"), zoom <= SHEET_ZOOMS[0])}
              <button type="button" data-zoom-reset title="${esc(t("home.sheetZoomReset"))}" class="w-12 text-center text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">${zoom}%</button>
              ${zb("data-zoom-in", "zoom-in", t("home.sheetZoomIn"), zoom >= SHEET_ZOOMS[SHEET_ZOOMS.length - 1])}
            </div>
          </div>
          <div class="inline-flex max-w-full flex-col align-top">
          <div class="flex items-stretch gap-2">
            <div data-sheet class="gw-noscroll min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" style="max-height:${maxH()}px">
              <table class="border-separate border-spacing-0 text-left" style="table-layout:fixed;width:${tableW}px;zoom:${z()}">
                <colgroup><col style="width:44px">${Array.from({ length: showC }, (_, c) => `<col data-col="${c}" style="width:${colW(c)}px">`).join("")}</colgroup>
                <thead>${head}</thead><tbody>${body}</tbody>
              </table>
            </div>
            ${canEdit ? `<button type="button" data-add-cols title="${esc(t("home.sheetAddCols"))}" aria-label="${esc(t("home.sheetAddCols"))}" class="flex w-8 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:border-slate-900 hover:bg-white hover:text-slate-900 dark:border-slate-600 dark:hover:border-white dark:hover:bg-white/5 dark:hover:text-white">${icon("plus", "size-4")}</button>` : ""}
          </div>
          ${canEdit ? `<button type="button" data-add-rows title="${esc(t("home.sheetAddRows"))}" aria-label="${esc(t("home.sheetAddRows"))}" class="mt-2 flex h-8 w-[calc(100%-2.5rem)] items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:border-slate-900 hover:bg-white hover:text-slate-900 dark:border-slate-600 dark:hover:border-white dark:hover:bg-white/5 dark:hover:text-white">${icon("plus", "size-4")}</button>` : ""}
          </div>`;
        if (keepSh) {
          const sh = $("[data-sheet]", host);
          if (sh) ((sh.scrollTop = keepSh[0]), (sh.scrollLeft = keepSh[1]));
        }
        outer.forEach(([el, t0, l0]) => ((el.scrollTop = t0), (el.scrollLeft = l0)));
        if (scrollX !== keepWin[0] || scrollY !== keepWin[1]) scrollTo(keepWin[0], keepWin[1]);
        refreshIcons();
        paintMarks();
        paintTools();
        paintSearch(false);
      }
      // ---- 搜寻：找到的格子淡黄，现在这个深黄 + 卷到看得到
      const HIT = ["gw-hit", "shadow-[inset_0_0_0_9999px_rgba(250,204,21,0.28)]"];
      const HIT_ON = ["gw-hit-on", "shadow-[inset_0_0_0_9999px_rgba(245,158,11,0.55)]"];
      function hits() {
        const s0 = q.trim().toLowerCase();
        if (!s0) return [];
        return [...cells]
          .filter(([, v]) => v.toLowerCase().includes(s0))
          .map(([k]) => k.split(":").map(Number))
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])
          .map((x) => x.join(":"));
      }
      function paintSearch(jump) {
        $$("td.gw-hit, td.gw-hit-on", host).forEach((x) => x.classList.remove(...HIT, ...HIT_ON));
        const list = hits();
        if (qi >= list.length) qi = 0;
        list.forEach((k, i) => {
          const td = $(`[data-td="${k}"]`, host);
          if (td) td.classList.add(...(i === qi ? HIT_ON : HIT));
        });
        const cnt = $("[data-search-count]", host);
        if (cnt) cnt.textContent = q.trim() ? (list.length ? `${qi + 1}/${list.length}` : "0") : "";
        $$("[data-search-prev], [data-search-next]", host).forEach((b) => (b.classList.toggle("hidden", list.length < 2), b.classList.toggle("flex", list.length >= 2)));
        if (jump && list.length) {
          const td = $(`[data-td="${list[qi]}"]`, host);
          const sh = $("[data-sheet]", host);
          if (td && sh) {
            // 只卷表格本身，外面不动
            const tr = td.getBoundingClientRect(), sr = sh.getBoundingClientRect();
            if (tr.top < sr.top + 28 || tr.bottom > sr.bottom) sh.scrollTop += tr.top - sr.top - sr.height / 2 + tr.height / 2;
            if (tr.left < sr.left + 44 || tr.right > sr.right) sh.scrollLeft += tr.left - sr.left - sr.width / 2 + tr.width / 2;
          }
        }
      }
      const searchStep = (d) => {
        const n = hits().length;
        if (!n) return;
        qi = (qi + d + n) % n;
        paintSearch(true);
      };
      host.addEventListener("input", (e) => {
        if (!e.target.matches || !e.target.matches("[data-sheet-search]")) return;
        q = e.target.value.slice(0, 100);
        qi = 0;
        paintSearch(true);
      });
      host.addEventListener("keydown", (e) => {
        if (!e.target.matches || !e.target.matches("[data-sheet-search]")) return;
        if (e.key === "Enter") return e.preventDefault(), searchStep(e.shiftKey ? -1 : 1);
        if (e.key === "Escape" && q) return e.preventDefault(), e.stopPropagation(), (e.target.value = ""), (q = ""), paintSearch(false);
      });
      const cellEl = (r, c) => $(`[data-cell="${r}:${c}"]`, host);
      const go = (r, c) => {
        const el = cellEl(r, c);
        if (el) el.focus(); // 只选这一格（不进去改字）
      };
      // 进去改字：replace = 直接打字换掉内容；不然游标放最后面
      let editOrig = null;
      function startEdit(el, replace) {
        if (!el || !el.readOnly) return;
        el.readOnly = false;
        editOrig = el.value;
        if (replace) el.value = "";
        else {
          const n = el.value.length;
          el.setSelectionRange(n, n);
        }
      }
      // 不改了：回到「只选」
      function stopEdit(el, cancel) {
        if (!el || el.readOnly) return;
        if (cancel && editOrig != null && el.value !== editOrig) {
          el.value = editOrig;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        el.readOnly = true;
        editOrig = null;
      }
      // 清掉选好的格子的字（一格 / 一块 / 整栏整列）
      function clearCells() {
        const list = targets().filter((k) => cells.has(k));
        if (!list.length) return;
        remember();
        typingKey = null;
        list.forEach((k) => {
          cells.delete(k);
          const el = $(`[data-cell="${k}"]`, host);
          if (el) el.value = "";
        });
        later();
      }
      function setZoom(nz) {
        zoom = nz;
        try { localStorage.setItem("gw-sheet-zoom", String(zoom)); } catch (e) {}
        render();
      }
      // 「+」：直接加一栏 / 一列（加在最后面，卷到看得到）
      function addOne(kind) {
        if (kind === "rows" ? showR >= MAXR : showC >= MAXC) return toast(t("home.sheetMax"));
        remember();
        if (kind === "rows") rows = showR + 1;
        else cols = showC + 1;
        render();
        later();
        const sh = $("[data-sheet]", host);
        if (kind === "rows") sh.scrollTop = sh.scrollHeight;
        else sh.scrollLeft = sh.scrollWidth;
      }
      const shift = (m, fn) => {
        const out = new Map();
        for (const [k, v] of m) {
          const nk = fn(k);
          if (nk != null) out.set(nk, v);
        }
        return out;
      };
      // 栏 / 列编号往后（count > 0，插入）或往前（count < 0，删掉 at 开始的 -count 个）移：格子、宽度 / 高度、留言一起
      function moveLines(kind, at, count) {
        const pos = kind === "row" ? 0 : 1;
        const lim = kind === "row" ? MAXR : MAXC;
        const end = count < 0 ? at - count : at; // 删掉的范围 [at, end)
        const idx = (i) => (count < 0 ? (i < at ? i : i < end ? null : i + count) : i < at ? i : i + count < lim ? i + count : null);
        cells = shift(cells, (k) => {
          const p2 = k.split(":").map(Number);
          const ni = idx(p2[pos]);
          if (ni == null) return null;
          p2[pos] = ni;
          return p2.join(":");
        });
        fmt = shift(fmt, (k) => {
          const p2 = k.split(":").map(Number);
          const ni = idx(p2[pos]);
          if (ni == null) return null;
          p2[pos] = ni;
          return p2.join(":");
        });
        const sizes = kind === "row" ? h : w;
        const ns = {};
        for (const [k, v] of Object.entries(sizes)) {
          const ni = idx(+k);
          if (ni != null) ns[ni] = v;
        }
        if (kind === "row") h = ns;
        else w = ns;
        if (notesOn && notes.length) {
          notes = notes
            .map((n) => {
              const p2 = n.cell.split(":").map(Number);
              const ni = idx(p2[pos]);
              if (ni == null) return null;
              p2[pos] = ni;
              return { ...n, cell: p2.join(":") };
            })
            .filter(Boolean);
          // 资料库：新的 gw_move_cell_comments（20261207）；还没跑的话，删一个时用旧的
          sb.rpc("gw_move_cell_comments", { p_folder: f.id, p_page: pageId, p_kind: kind, p_at: at, p_count: count }).then(({ error }) => {
            if (error && count === -1) sb.rpc("gw_shift_cell_comments", { p_folder: f.id, p_page: pageId, p_kind: kind, p_index: at }).then(() => {}, () => {});
          }, () => {});
        }
      }
      // 右键（或再点一次选好的）选单：插入 / 宽度或高度 / 删除——对选好的全部栏 / 列
      function lineMenu(kind, anchor) {
        const isRow = kind === "row";
        const a = sel.a, b = sel.b, n = b - a + 1;
        const nm = (i) => (isRow ? String(i + 1) : colName(i));
        const label = n === 1 ? t(isRow ? "home.sheetRowLabel" : "home.sheetColLabel", { a: nm(a) }) : t(isRow ? "home.sheetRowsLabel" : "home.sheetColsLabel", { a: nm(a), b: nm(b) });
        const size0 = isRow ? rowH(a) : colW(a);
        const inp = "h-8 w-16 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-white";
        const sbtn = "flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-white/5";
        const el = pop(
          anchor,
          `<p class="mb-2 text-xs font-bold text-slate-500">${esc(label)}</p>
          <div class="space-y-1.5 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div class="flex items-center gap-2"><span class="w-14 text-xs text-slate-500">${esc(t("home.sheetInsert"))}</span><input data-ins-n type="number" min="1" max="${isRow ? MAXR : MAXC}" value="${n}" class="${inp}"><span class="text-xs text-slate-500">${esc(t(isRow ? "home.sheetRowsWord" : "home.sheetColsWord"))}</span></div>
            <div class="flex gap-1.5 pl-16">
              <button type="button" data-ins-at="before" class="${sbtn}">${icon(isRow ? "arrow-up" : "arrow-left", "inline size-3.5")} ${esc(t(isRow ? "home.sheetAbove" : "home.sheetLeft"))}</button>
              <button type="button" data-ins-at="after" class="${sbtn}">${esc(t(isRow ? "home.sheetBelow" : "home.sheetRight"))} ${icon(isRow ? "arrow-down" : "arrow-right", "inline size-3.5")}</button>
            </div>
          </div>
          <form data-size-form class="border-b border-slate-100 py-3 dark:border-slate-800">
            <div class="flex items-center gap-2"><span class="w-14 text-xs text-slate-500">${esc(t(isRow ? "home.sheetHeight" : "home.sheetWidth"))}</span>
              <input data-size-px type="number" min="${isRow ? 24 : 40}" max="${isRow ? 240 : 600}" value="${size0}" class="${inp}"><span class="text-xs text-slate-500">px</span>
              <button type="submit" class="${btn("secondary", "sm")} ml-auto">${esc(t("home.sheetApply"))}</button></div>
            <div class="mt-1.5 flex items-center gap-2 pl-16"><span class="text-[11px] text-slate-400">${esc(t("home.sheetDefaultIs", { px: isRow ? DEF_H : DEF_W }))}</span>
              <button type="button" data-size-default class="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-slate-100 dark:text-brand-100 dark:hover:bg-white/10">${esc(t("home.sheetUseDefault"))}</button></div>
          </form>
          <button type="button" data-do-del class="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30">${icon("trash-2", "size-4")}${esc(n === 1 ? t(isRow ? "home.sheetDelRowN" : "home.sheetDelColN", isRow ? { n: a + 1 } : { c: nm(a) }) : t(isRow ? "home.sheetDelRows" : "home.sheetDelCols", { a: nm(a), b: nm(b) }))}</button>`,
          290,
        );
        el.addEventListener("click", (e) => {
          const bt = e.target.closest("button");
          if (!bt) return;
          if (bt.dataset.insAt) {
            const want = num($("[data-ins-n]", el).value, 1, isRow ? MAXR : MAXC, 1);
            const at = bt.dataset.insAt === "before" ? a : b + 1;
            const total = isRow ? Math.max(rows, at) : Math.max(cols, at);
            const k = Math.min(want, (isRow ? MAXR : MAXC) - total);
            if (k <= 0) return toast(t("home.sheetMax"));
            remember();
            moveLines(kind, at, k);
            if (isRow) rows = total + k;
            else cols = total + k;
            sel = { kind, a: at, b: at + k - 1, anchor: at };
            closePop();
            render();
            return later();
          }
          if ("doDel" in bt.dataset) {
            remember();
            const total = isRow ? rows : cols;
            if (a < total) {
              const gone = Math.min(b, total - 1) - a + 1;
              if (isRow) rows = Math.max(1, rows - gone);
              else cols = Math.max(1, cols - gone);
            }
            moveLines(kind, a, -n);
            sel = null;
            focus = null;
            closePop();
            render();
            return later();
          }
        });
        $("[data-size-form]", el).addEventListener("submit", (e) => {
          e.preventDefault();
          const px = isRow ? num($("[data-size-px]", el).value, 24, 240, 32) : num($("[data-size-px]", el).value, 40, 600, 140);
          remember();
          for (let i = a; i <= b; i++) (isRow ? h : w)[i] = px;
          closePop();
          render();
          later();
        });
        // 回到预设大小：拿掉自订的宽度 / 高度
        $("[data-size-default]", el).onclick = () => {
          remember();
          for (let i = a; i <= b; i++) delete (isRow ? h : w)[i];
          closePop();
          render();
          later();
        };
        const ni = $("[data-ins-n]", el);
        ni.focus();
        ni.select();
      }
      // 右键按下去时不要把游标移进那一格（不然选好的栏 / 列、一块格子会被取消）
      host.addEventListener("mousedown", (e) => {
        if (e.button !== 2 || !canEdit) return;
        const td = e.target.closest("[data-td]");
        if (!td) return;
        const [r, c] = td.dataset.td.split(":").map(Number);
        if (inSel("col", c) || inSel("row", r) || inRange(r, c)) e.preventDefault();
      });
      // 格子的右键选单：这一块格子的栏宽、列高（含预设）、清除字
      function cellMenu(anchor) {
        const { r1, c1, r2, c2 } = range;
        const inp = "h-8 w-16 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-white";
        const label = r1 === r2 && c1 === c2 ? colName(c1) + (r1 + 1) : colName(c1) + (r1 + 1) + ":" + colName(c2) + (r2 + 1);
        const row = (kind, val, min, max, def) => `<form data-cell-size="${kind}" class="border-b border-slate-100 py-2.5 dark:border-slate-800">
            <div class="flex items-center gap-2"><span class="w-14 text-xs text-slate-500">${esc(t(kind === "w" ? "home.sheetWidth" : "home.sheetHeight"))}</span>
              <input type="number" min="${min}" max="${max}" value="${val}" class="${inp}"><span class="text-xs text-slate-500">px</span>
              <button type="submit" class="${btn("secondary", "sm")} ml-auto">${esc(t("home.sheetApply"))}</button></div>
            <div class="mt-1.5 flex items-center gap-2 pl-16"><span class="text-[11px] text-slate-400">${esc(t("home.sheetDefaultIs", { px: def }))}</span>
              <button type="button" data-cell-default="${kind}" class="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-slate-100 dark:text-brand-100 dark:hover:bg-white/10">${esc(t("home.sheetUseDefault"))}</button></div>
          </form>`;
        const el = pop(
          anchor,
          `<p class="mb-1 text-xs font-bold text-slate-500">${esc(label)}</p>
          ${row("w", colW(c1), 40, 600, DEF_W)}
          ${row("h", rowH(r1), 24, 240, DEF_H)}
          <button type="button" data-cell-clear class="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30">${icon("eraser", "size-4")}${esc(t("home.sheetClearText"))}</button>`,
          290,
        );
        const setSizes = (kind, px) => {
          remember();
          if (kind === "w") for (let c = c1; c <= c2; c++) px == null ? delete w[c] : (w[c] = px);
          else for (let r = r1; r <= r2; r++) px == null ? delete h[r] : (h[r] = px);
          closePop();
          render();
          later();
        };
        $$("[data-cell-size]", el).forEach((fm) =>
          fm.addEventListener("submit", (e) => {
            e.preventDefault();
            const kind = fm.dataset.cellSize;
            const v = $("input", fm).value;
            setSizes(kind, kind === "w" ? num(v, 40, 600, DEF_W) : num(v, 24, 240, DEF_H));
          }),
        );
        el.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          if (b.dataset.cellDefault) return setSizes(b.dataset.cellDefault, null);
          if ("cellClear" in b.dataset) {
            closePop();
            clearCells();
          }
        });
      }
      // 按住栏位字母 / 列号往旁边拖 = 选好几栏 / 列
      let skipClick = false;
      host.addEventListener("pointerdown", (e) => {
        if (!canEdit || e.button !== 0 || e.shiftKey) return;
        const hb = e.target.closest("[data-col-menu], [data-row-menu]");
        if (!hb) return;
        const kind = hb.dataset.colMenu != null ? "col" : "row";
        const start = Number(kind === "col" ? hb.dataset.colMenu : hb.dataset.rowMenu);
        let moved = false;
        const move = (ev) => {
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const over = el && el.closest && el.closest(kind === "col" ? "[data-col-menu]" : "[data-row-menu]");
          if (!over || !host.contains(over)) return;
          const i = Number(kind === "col" ? over.dataset.colMenu : over.dataset.rowMenu);
          if (!moved && i === start) return;
          moved = true;
          const ns = { kind, a: Math.min(start, i), b: Math.max(start, i), anchor: start };
          if (sel && sel.kind === kind && sel.a === ns.a && sel.b === ns.b) return;
          sel = ns;
          range = null;
          render();
        };
        const up = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
          if (moved) skipClick = true; // 放开时的 click 不要再当成「点一下」
          setTimeout(() => (skipClick = false), 0);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      });
      // 点栏位字母 / 列号：选那一栏 / 列；Shift 再点 = 选一整段；再点一次选好的那一个 = 开选单（手机没有右键）
      function pick(kind, i, e, anchor) {
        if (e.shiftKey && sel && sel.kind === kind) sel = { kind, a: Math.min(sel.anchor, i), b: Math.max(sel.anchor, i), anchor: sel.anchor };
        else if (sel && sel.kind === kind && sel.a === i && sel.b === i) return lineMenu(kind, anchor);
        else sel = { kind, a: i, b: i, anchor: i };
        range = null;
        render();
      }
      // 在边线上按两下：那一栏 / 列（或选好的全部）回到预设大小
      host.addEventListener("dblclick", (e) => {
        // 格子按两下 = 进去改字
        if (canEdit && e.target.matches && e.target.matches("[data-cell]")) return startEdit(e.target, false);
        const cr = canEdit && e.target.closest("[data-col-resize]");
        const rr = canEdit && e.target.closest("[data-row-resize]");
        if (!cr && !rr) return;
        e.preventDefault();
        const kind = cr ? "col" : "row";
        const i = Number(cr ? cr.dataset.colResize : rr.dataset.rowResize);
        const list = inSel(kind, i) ? Array.from({ length: sel.b - sel.a + 1 }, (_, x) => sel.a + x) : [i];
        remember();
        list.forEach((x) => delete (kind === "col" ? w : h)[x]);
        render();
        later();
      });
      host.addEventListener("contextmenu", (e) => {
        const td = canEdit && e.target.closest("[data-td]");
        if (td) {
          e.preventDefault();
          const [r, c] = td.dataset.td.split(":").map(Number);
          const at = { left: e.clientX, top: e.clientY, bottom: e.clientY };
          if (inSel("col", c) || inSel("row", r)) return lineMenu(sel.kind, at);
          if (!inRange(r, c)) {
            range = { r1: r, c1: c, r2: r, c2: c };
            sel = null;
            focus = [r, c];
            paintRange();
          }
          return cellMenu(at);
        }
        const hb = canEdit && e.target.closest("[data-col-menu], [data-row-menu]");
        if (!hb) return;
        e.preventDefault();
        const kind = hb.dataset.colMenu != null ? "col" : "row";
        const i = Number(kind === "col" ? hb.dataset.colMenu : hb.dataset.rowMenu);
        if (!inSel(kind, i)) {
          sel = { kind, a: i, b: i, anchor: i };
          render();
        }
        lineMenu(kind, { left: e.clientX, top: e.clientY, bottom: e.clientY });
      });
      // 字大小的框：打数字，按 Enter（或点别的地方）就套用
      const applyTypedSize = (el) => {
        const n = Math.round(Number(el.value));
        if (!Number.isFinite(n) || n < FS_MIN || n > FS_MAX) {
          // 不合理就变回原来的大小
          const k0 = targets()[0];
          el.value = (k0 && fmtOf(k0).s) || DEF_FS;
          return toast(t("home.sheetFontRange", { min: FS_MIN, max: FS_MAX }));
        }
        const k0 = targets()[0];
        if (k0 && (fmtOf(k0).s || DEF_FS) === n && targets().every((k) => (fmtOf(k).s || DEF_FS) === n)) return;
        applyFmt("s:" + n);
      };
      host.addEventListener("keydown", (e) => {
        if (!e.target.matches || !e.target.matches("[data-fmt-size]")) return;
        if (e.key === "Enter") (e.preventDefault(), applyTypedSize(e.target));
        if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), paintTools(), e.target.blur());
      });
      host.addEventListener("change", (e) => e.target.matches && e.target.matches("[data-fmt-size]") && applyTypedSize(e.target));
      host.addEventListener("click", (e) => {
        if (skipClick) return void (skipClick = false); // 刚刚是拖选栏位 / 列号，不是点一下
        if (e.target.closest("a")) return; // 看的人点 Email / 网址：照常打开
        const vc = !canEdit && !e.target.closest("button") && e.target.closest("[data-vcell]");
        if (vc && host.contains(vc)) return viewPick(vc);
        const b = e.target.closest("button, [data-cmt]");
        if (!b || b.disabled || !host.contains(b)) return;
        if (b.dataset.vcopy) return viewCopy(b.dataset.vcopy);
        const d = b.dataset;
        if ("zoomIn" in d) return setZoom(SHEET_ZOOMS[Math.min(SHEET_ZOOMS.length - 1, SHEET_ZOOMS.indexOf(zoom) + 1)]);
        if ("zoomOut" in d) return setZoom(SHEET_ZOOMS[Math.max(0, SHEET_ZOOMS.indexOf(zoom) - 1)]);
        if ("zoomReset" in d) return setZoom(100);
        if ("searchNext" in d) return searchStep(1);
        if ("searchPrev" in d) return searchStep(-1);
        if (d.fmt) return canEdit && applyFmt(d.fmt);
        if (d.gridlines != null && canEdit) {
          remember();
          grid = !grid;
          render();
          later();
          return;
        }
        if ("fill" in d) return canEdit && fillMenu(b);
        if ("borders" in d) return canEdit && borderMenu(b);
        if ("undo" in d) return canEdit && undo();
        if ("redo" in d) return canEdit && redo();
        if (d.cmt) return openNotes(d.cmt, b.closest("td") || b);
        if (!canEdit) return;
        if ("addRows" in d) return addOne("rows");
        if ("addCols" in d) return addOne("cols");
        if (d.colMenu) return pick("col", Number(d.colMenu), e, b);
        if (d.rowMenu) return pick("row", Number(d.rowMenu), e, b);
      });
      if (canEdit) {
        host.addEventListener("input", (e) => {
          const k = e.target.dataset && e.target.dataset.cell;
          if (!k) return;
          const v = e.target.value.slice(0, 1000);
          if (typingKey !== k) ((typingKey = null), remember(), (typingKey = k)); // 同一格连续打字 = 一步
          v ? cells.set(k, v) : cells.delete(k);
          const [r, c] = k.split(":").map(Number);
          if (v) grow(r, c);
          later();
        });
        host.addEventListener("focusout", (e) => {
          if (e.target.matches && e.target.matches("[data-cell]")) stopEdit(e.target);
        });
        host.addEventListener("focusin", (e) => {
          const k = e.target.dataset && e.target.dataset.cell;
          if (!k) return;
          if (typingKey !== k) typingKey = null;
          focus = k.split(":").map(Number);
          if (range && !dragging && !inRange(focus[0], focus[1])) ((range = null), paintRange());
          paintTools();
          if (sel) {
            sel = null;
            $$("[data-col-menu], [data-row-menu]", host).forEach((x) => x.closest("th").classList.remove("bg-sky-200", "text-sky-800", "dark:bg-sky-800", "dark:text-white"));
            $$("td.bg-sky-50", host).forEach((x) => x.classList.remove("bg-sky-50", "dark:bg-sky-900/20"));
          }
        });
        host.addEventListener("keydown", (e) => {
          const k = e.target.dataset && e.target.dataset.cell;
          if (!k) return;
          const [r, c] = k.split(":").map(Number);
          const el = e.target;
          const down = () => go(Math.min(showR - 1, r + 1), c);
          if (e.ctrlKey || e.metaKey || e.altKey) return; // 复原、复制、贴上等交给别的地方
          if (el.readOnly) {
            // 只选着这一格
            if (e.key === "Enter" || e.key === "F2") return e.preventDefault(), startEdit(el, false);
            if (e.key === "Delete" || e.key === "Backspace") return e.preventDefault(), clearCells();
            if (e.key === "ArrowDown") return e.preventDefault(), down();
            if (e.key === "ArrowUp") return e.preventDefault(), go(Math.max(0, r - 1), c);
            if (e.key === "ArrowRight") return e.preventDefault(), go(r, Math.min(showC - 1, c + 1));
            if (e.key === "ArrowLeft") return e.preventDefault(), go(r, Math.max(0, c - 1));
            if (e.key === "Tab") return e.preventDefault(), go(r, e.shiftKey ? Math.max(0, c - 1) : Math.min(showC - 1, c + 1));
            if (e.key.length === 1 && !e.isComposing) {
              // 直接打字：换掉这一格的内容（这个字照常打进去）
              if (range && (range.r1 !== range.r2 || range.c1 !== range.c2)) ((range = null), paintRange());
              return startEdit(el, true);
            }
            return;
          }
          // 正在改字
          if (e.key === "Escape") return e.preventDefault(), e.stopPropagation(), stopEdit(el, true);
          if (e.key === "Enter") return e.preventDefault(), stopEdit(el), go(e.shiftKey ? Math.max(0, r - 1) : Math.min(showR - 1, r + 1), c);
          if (e.key === "Tab") return e.preventDefault(), stopEdit(el), go(r, e.shiftKey ? Math.max(0, c - 1) : Math.min(showC - 1, c + 1));
          if (e.key === "ArrowDown") return e.preventDefault(), stopEdit(el), down();
          if (e.key === "ArrowUp") return e.preventDefault(), stopEdit(el), go(Math.max(0, r - 1), c);
        });
        // 贴上一块（有 Tab / 换行）：从这一格开始摊开，不够就加列 / 栏
        host.addEventListener("paste", (e) => {
          const k = e.target.dataset && e.target.dataset.cell;
          if (!k) return;
          const text = (e.clipboardData || window.clipboardData).getData("text");
          if (!/[\t\n]/.test(text)) {
            if (!e.target.readOnly) return; // 正在改字：照常贴进去
            e.preventDefault();
            remember();
            typingKey = null;
            const v = text.trim().slice(0, 1000);
            v ? cells.set(k, v) : cells.delete(k);
            e.target.value = v;
            if (v) grow(...k.split(":").map(Number));
            return later();
          }
          e.preventDefault();
          remember();
          typingKey = null;
          const [r0c, c0c] = k.split(":").map(Number);
          const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").slice(0, MAXR - r0c);
          lines.forEach((line, i) =>
            line
              .split("\t")
              .slice(0, MAXC - c0c)
              .forEach((v, j) => {
                const key = r0c + i + ":" + (c0c + j);
                v = v.trim().slice(0, 1000);
                v ? cells.set(key, v) : cells.delete(key);
                if (v) grow(r0c + i, c0c + j);
              }),
          );
          render();
          later();
          go(r0c, c0c);
        });
        // 拉线改栏宽 / 列高（放开才存；有放大缩小时换算回 100%）
        // 按住一格往别格拖 = 选一块；Shift 再点一格 = 从现在这格选到那一格
        let dragging = false;
        host.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || e.target.closest("[data-col-resize], [data-row-resize], [data-cmt]")) return;
          const td = e.target.closest("[data-td]");
          if (!td) return;
          const [r0d, c0d] = td.dataset.td.split(":").map(Number);
          if (e.shiftKey && focus) {
            e.preventDefault();
            range = { r1: Math.min(focus[0], r0d), c1: Math.min(focus[1], c0d), r2: Math.max(focus[0], r0d), c2: Math.max(focus[1], c0d) };
            sel = null;
            return paintRange();
          }
          // 点到格子空白的地方（字的上 / 下面）：一样进这一格打字
          if (!e.target.matches("[data-cell]")) {
            e.preventDefault();
            const inp = $("[data-cell]", td);
            if (inp) inp.focus();
          }
          const table = $("table", host);
          const move = (ev) => {
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const over = el && el.closest && el.closest("[data-td]");
            if (!over || !host.contains(over)) return;
            const [r, c] = over.dataset.td.split(":").map(Number);
            if (!dragging && r === r0d && c === c0d) return;
            if (!dragging) {
              dragging = true;
              table.classList.add("select-none");
              const ae = document.activeElement;
              if (ae && ae.matches && ae.matches("[data-cell]")) stopEdit(ae);
              const startEl = cellEl(r0d, c0d);
              if (startEl && document.activeElement !== startEl) startEl.focus({ preventScroll: true });
              focus = [r0d, c0d];
              sel = null;
            }
            const nr = { r1: Math.min(r0d, r), c1: Math.min(c0d, c), r2: Math.max(r0d, r), c2: Math.max(c0d, c) };
            if (!range || nr.r1 !== range.r1 || nr.r2 !== range.r2 || nr.c1 !== range.c1 || nr.c2 !== range.c2) ((range = nr), paintRange());
          };
          const up = () => {
            removeEventListener("pointermove", move);
            removeEventListener("pointerup", up);
            table.classList.remove("select-none");
            setTimeout(() => (dragging = false), 0);
          };
          addEventListener("pointermove", move);
          addEventListener("pointerup", up);
        });
        host.addEventListener("pointerdown", (e) => {
          const cr = e.target.closest("[data-col-resize]");
          const rr = e.target.closest("[data-row-resize]");
          if (!cr && !rr) return;
          e.preventDefault();
          remember();
          const startX = e.clientX, startY = e.clientY;
          const table = $("table", host);
          if (cr) {
            const c = Number(cr.dataset.colResize);
            const w0 = colW(c);
            const targets = inSel("col", c) ? Array.from({ length: sel.b - sel.a + 1 }, (_, i) => sel.a + i) : [c];
            const move = (ev) => {
              const nw = Math.min(600, Math.max(40, Math.round(w0 + (ev.clientX - startX) / z())));
              targets.forEach((x) => {
                w[x] = nw;
                const colEl = $(`col[data-col="${x}"]`, host);
                if (colEl) colEl.style.width = nw + "px";
              });
              table.style.width = 44 + Array.from({ length: showC }, (_, x) => colW(x)).reduce((p, q) => p + q, 0) + "px";
            };
            const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up), grow(0, c), later());
            addEventListener("pointermove", move);
            addEventListener("pointerup", up);
          } else {
            const r = Number(rr.dataset.rowResize);
            const h0 = rowH(r);
            const targets = inSel("row", r) ? Array.from({ length: sel.b - sel.a + 1 }, (_, i) => sel.a + i) : [r];
            const trs = $$("tbody tr", host);
            const move = (ev) => {
              const nh = Math.min(240, Math.max(24, Math.round(h0 + (ev.clientY - startY) / z())));
              targets.forEach((x) => {
                h[x] = nh;
                if (trs[x]) trs[x].style.height = nh + "px";
              });
            };
            const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up), grow(r, 0), later());
            addEventListener("pointermove", move);
            addEventListener("pointerup", up);
          }
        });
      }
      // 视窗大小变了：重新补满格子（打字中不重画）
      let rz = null;
      const onResize = () => {
        if (!document.body.contains(host)) return removeEventListener("resize", onResize);
        clearTimeout(rz);
        rz = setTimeout(() => {
          if (host.contains(document.activeElement)) return;
          const before = [showR, showC];
          measure();
          if (before[0] !== showR || before[1] !== showC) render();
        }, 200);
      };
      addEventListener("resize", onResize);
      const onUndoKey = (e) => {
        if (!document.body.contains(host)) return document.removeEventListener("keydown", onUndoKey, true);
        if (canEdit && (e.key === "Delete" || e.key === "Backspace") && sel && !popEl && !document.querySelector(".gw-modal")) {
          const ae = document.activeElement;
          if (!ae || ae === document.body || (host.contains(ae) && !ae.matches("input:not([readonly]), textarea"))) {
            e.preventDefault();
            return clearCells();
          }
        }
        if (!canEdit || !(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key !== "z" && key !== "y") return;
        if (popEl || document.querySelector(".gw-modal")) return;
        const ae = document.activeElement;
        if (ae && ae.matches && ae.matches("[data-sheet-search]")) return; // 搜寻框：照常复原打的字
        const inSheet = ae && host.contains(ae);
        const idle = !ae || ae === document.body || (!ae.matches("input, textarea, select, [contenteditable=true]") && ae.closest("[data-win]"));
        if (!inSheet && !idle) return;
        e.preventDefault();
        e.stopPropagation();
        if (key === "y" || e.shiftKey) redo();
        else undo();
      };
      document.addEventListener("keydown", onUndoKey, true);
      render();
      loadNotes();
    }

    // ------------------------------------------------------------ 文件夹「柜子」看法
    /* 一个文件夹 = 一个柜子，里面好几个标题（Section），每个标题下面一条条连结 / App（↳ 1.1、1.2…，像总表）。
       电脑上标题排成两栏。能改的人（拥有者、被分享成 Can edit 的人）：
         - 把连结拖到某个标题上（标题会亮起来）→ 放到那个标题下面
         - 也可以拖到列表里任何位置排顺序；拖标题左边的握把排标题
         - 按 Edit 改标题名字 / 删标题
       拥有者另外可以加连结、改连结（名字、网址、图示、颜色、照片）、把东西移出文件夹。
       存在 gw_user_folders.canvas.shelves = [{ id, name, items: ["a:模块id" | "l:连结id"] }]；
       还没放到标题下的在最下面「Not in a section」，顺序记在 canvas.loose。 */
    function mountShelves(f, host, hooks) {
      const canEdit = !!hooks.canEdit, isOwner = !!hooks.isOwner;
      const uid = () => Math.random().toString(36).slice(2, 10);
      let editMode = false;
      // pageId：null = 第一页（资料在 canvas 最外层）；不然是之后加的柜子页
      const pageId = hooks.page || null;
      const otherPages = hooks.otherPages || [];
      const cv0 = pageId ? rawPages(f).find((p) => p.id === pageId) || {} : canvasOf(f);
      let shelves = (Array.isArray(cv0.shelves) ? cv0.shelves : []).filter((x) => x && typeof x === "object").map((x) => ({ id: /^[A-Za-z0-9_-]{1,40}$/.test(String(x.id || "")) ? String(x.id) : uid(), name: String(x.name || "").slice(0, 40), items: Array.isArray(x.items) ? x.items.map(String) : [] })); // id 只收字母数字（文件夹内容别人也能改：不能让奇怪的字进到画面）
      let looseOrder = Array.isArray(cv0.loose) ? cv0.loose.map(String) : [];
      const folderKeys = () => [...folderApps(f.id).map((id) => "a:" + id), ...folderLinks(f.id).map((l) => "l:" + l.id)];
      // 别的柜子页拿走的东西（第一页不显示）
      const claimed = () => {
        const set = new Set();
        rawPages(f).forEach((p) => {
          if (p.type !== "links" || p.id === "main" || p.id === pageId) return;
          (Array.isArray(p.shelves) ? p.shelves : []).forEach((x) => (Array.isArray(x && x.items) ? x.items : []).forEach((k) => set.add(String(k))));
          (Array.isArray(p.loose) ? p.loose : []).forEach((k) => set.add(String(k)));
        });
        return set;
      };
      const allKeys = () => {
        if (!pageId) {
          const taken = claimed();
          return folderKeys().filter((k) => !taken.has(k));
        }
        const own = new Set([...shelves.flatMap((x) => x.items), ...looseOrder]);
        return folderKeys().filter((k) => own.has(k));
      };
      // 已经不在文件夹的拿掉；同一个东西只放一个标题；剩下的 = 还没分
      function loose() {
        const have = new Set(allKeys());
        const seen = new Set();
        shelves.forEach((x) => (x.items = x.items.filter((k) => have.has(k) && !seen.has(k) && seen.add(k))));
        const rest = allKeys().filter((k) => !seen.has(k));
        const at = (k) => { const i = looseOrder.indexOf(k); return i < 0 ? 1e6 : i; };
        return rest.map((k, i) => [k, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map((x) => x[0]);
      }
      const info = (k) => {
        const id = k.slice(2);
        if (k[0] === "a") {
          const m = modules.get(id);
          return { attr: `data-open="${id}"`, iconHtml: appIcon(m, "size-7"), name: m.name, title: m.description || m.name, sub: t("home.shelfApp") };
        }
        const l = links.find((x) => x.id === id);
        let site = "";
        try { site = new URL(l.url).host.replace(/^www\./, ""); } catch (e) { site = l.url; }
        return { attr: `data-open-link="${l.id}"`, iconHtml: appIcon({ code: l.name, icon: l.icon, image_url: l.image_url, color: l.color }, "size-7"), name: l.name, title: l.url, sub: site };
      };
      const mini = (attr, ic, label, extra) => `<button type="button" data-badge ${attr} title="${esc(label)}" aria-label="${esc(label)}" class="flex size-7 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 ${extra}">${icon(ic, "size-3.5")}</button>`;
      // 编辑中每一条右边的小钮：连结 → 改、删（拥有者和 Editor）；移出文件夹 → 只有拥有者
      const badges = (k) => {
        const id = k.slice(2);
        const link = k[0] === "l";
        return (
          (link ? mini(`data-shelf-edit-link="${id}"`, "pencil", t("home.editLink"), "bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200") : "") +
          (otherPages.length ? mini(`data-shelf-move="${k}"`, "arrow-right-left", t("home.pageMove"), "bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200") : "") +
          (isOwner ? mini(link ? `data-out-link="${id}"` : `data-out="${id}"`, "arrow-up-right", t("fab.moveOut"), "bg-slate-700 text-white") : "") +
          (link ? mini(`data-shelf-del-link="${id}"`, "trash-2", t("home.deleteLink"), "bg-white text-red-600 dark:bg-slate-800 dark:text-red-400") : "")
        );
      };
      // 一条：↳ 编号 图示 名字（下面小字是网站）
      const row = (k, num) => {
        const x = info(k);
        return `<div data-item="${k}" class="flex items-center gap-2 py-1.5 pr-2 pl-3 ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}">
          <span class="flex shrink-0 items-center gap-1 text-slate-300 dark:text-slate-600">${icon("corner-down-right", "size-4")}<span class="w-7 text-[11px] text-slate-400 tabular-nums">${num}</span></span>
          <button type="button" ${x.attr} title="${esc(x.title)}" class="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 text-left">${x.iconHtml}<span class="min-w-0"><span class="block truncate text-sm font-medium text-slate-800 group-hover:text-sky-700 group-hover:underline dark:text-slate-100 dark:group-hover:text-sky-300">${esc(x.name)}</span><span class="block truncate text-[11px] text-slate-400">${esc(x.sub)}</span></span></button>
          ${editMode && canEdit ? `<span class="flex shrink-0 gap-1">${badges(k)}</span>` : ""}
        </div>`;
      };
      const emptyHint = (txt) => `<p data-empty class="px-3 py-3 text-center text-xs text-slate-400">${esc(txt)}</p>`;
      const card = (sh, i) => {
        const n = sh.items.length;
        return `<section data-shelf="${esc(sh.id)}" class="overflow-hidden rounded-2xl border border-white/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-slate-800/70">
          <header data-shelf-head="${esc(sh.id)}" class="flex items-center gap-2 border-b border-slate-200/80 bg-slate-50/90 px-3 py-2 transition dark:border-white/10 dark:bg-slate-800">
            ${canEdit ? `<span data-shelf-grip title="${esc(t("home.dragToSort"))}" class="-ml-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-white/10">${icon("grip-vertical", "size-4")}</span>` : ""}
            <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white dark:bg-white dark:text-slate-900">${i + 1}</span>
            ${
              editMode
                ? `<input data-shelf-name="${esc(sh.id)}" value="${esc(sh.name)}" maxlength="40" placeholder="${esc(t("home.shelfName"))}" class="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-white">`
                : `<h3 class="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">${esc(sh.name || t("home.shelfNew"))}</h3>`
            }
            <span class="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10">${n}</span>
            ${editMode ? `<button type="button" data-shelf-del="${esc(sh.id)}" title="${esc(t("home.shelfDelete"))}" aria-label="${esc(t("home.shelfDelete"))}" class="flex size-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">${icon("trash-2", "size-4")}</button>` : ""}
          </header>
          <div data-shelf-items="${esc(sh.id)}" class="min-h-[2.75rem] py-1">${sh.items.map((k, j) => row(k, `${i + 1}.${j + 1}`)).join("")}${n ? "" : emptyHint(canEdit ? t("home.shelfDropHere") : t("home.shelfEmpty"))}</div>
        </section>`;
      };
      function render() {
        const rest = loose();
        const tb = (attr, ic, label, primary) => `<button type="button" ${attr} class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-sm ${primary ? "bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}">${icon(ic, "size-4")}${esc(label)}</button>`;
        const showLoose = rest.length || !shelves.length || editMode;
        const empty = !allKeys().length;
        const tools = [canEdit ? tb("data-shelf-link", "link", t("home.shelfAddLink")) : "", canEdit ? tb("data-shelf-add", "plus", t("home.shelfAdd")) : "", canEdit && (shelves.length || !empty) ? tb("data-shelf-edit", editMode ? "check" : "pencil", editMode ? t("home.shelfDone") : t("home.shelfEdit"), editMode) : ""].join("");
        host.innerHTML = `
          ${tools ? `<div class="mb-3 flex flex-wrap items-center justify-end gap-2 ${hooks.toolsPad ? "pr-10" : ""}">${tools}</div>` : `<div class="${hooks.toolsPad ? "h-6" : "h-0"}"></div>`}
          <div class="gw-noscroll -mx-1 max-h-[68vh] space-y-3 overflow-y-auto px-1 pb-1">
            ${!shelves.length && canEdit && !empty ? `<p class="mb-3 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">${icon("lightbulb", "size-4 shrink-0")}${esc(t("home.shelfHint"))}</p>` : ""}
            ${shelves.length ? shelvesHtml() : ""}
            ${
              showLoose
                ? `<section class="overflow-hidden rounded-2xl border border-dashed border-slate-300/80 bg-white/50 dark:border-white/15 dark:bg-white/5">
                    ${shelves.length ? `<header class="px-3 pt-2 text-xs font-semibold text-slate-500">${esc(t("home.shelfUnsorted"))}</header>` : ""}
                    <div data-shelf-items="_" class="min-h-[2.75rem] py-1">${rest.map((k, j) => row(k, shelves.length ? "" : String(j + 1))).join("")}${rest.length ? "" : emptyHint(empty ? t("home.shelfFolderEmpty") : t("home.shelfDropHere"))}</div>
                  </section>`
                : ""
            }
          </div>`;
        refreshIcons();
        if (!canEdit || !window.Sortable) return;
        const group = "shelf-" + f.id;
        $$("[data-shelf-items]", host).forEach((el) =>
          Sortable.create(el, { group, draggable: "[data-item]", filter: "[data-badge], input", preventOnFilter: false, animation: 150, delay: 180, delayOnTouchOnly: true, ghostClass: "opacity-40", onStart: dragStart, onEnd: dragEnd }),
        );
        $$("[data-shelf-col]", host).forEach((col) =>
          Sortable.create(col, { group: "shelfcol-" + f.id, handle: "[data-shelf-grip]", draggable: "[data-shelf]", animation: 150, ghostClass: "opacity-40", onEnd: () => collect() }),
        );
      }
      // 电脑 / 平板：两栏固定（1 | 2、3 | 4…，拖的时候不会乱跳）；手机：一栏
      const wide = () => matchMedia("(min-width: 768px)").matches;
      let wasWide = wide();
      const onResize = () => {
        if (!document.body.contains(host)) return removeEventListener("resize", onResize);
        if (wide() !== wasWide) ((wasWide = wide()), render());
      };
      addEventListener("resize", onResize);
      function shelvesHtml() {
        const col = (list) => `<div data-shelf-col class="space-y-3">${list.map(([sh, i]) => card(sh, i)).join("")}</div>`;
        const all = shelves.map((sh, i) => [sh, i]);
        if (!wide() || shelves.length < 2) return col(all);
        return `<div class="grid grid-cols-2 items-start gap-3">${col(all.filter((x) => x[1] % 2 === 0))}${col(all.filter((x) => x[1] % 2 === 1))}</div>`;
      }
      // 拖着连结经过标题：标题亮起来；放开就放到那个标题下面（最后一条）
      const HL = ["bg-sky-100", "ring-2", "ring-sky-400", "ring-inset", "dark:bg-sky-900/40"];
      let overHead = null;
      const track = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const h = el && el.closest("[data-shelf-head]");
        if (h === overHead) return;
        if (overHead) overHead.classList.remove(...HL);
        overHead = h && host.contains(h) ? h : null;
        if (overHead) overHead.classList.add(...HL);
      };
      const onDragOver = (e) => track(e.clientX, e.clientY);
      const onPtr = (e) => {
        const p = e.touches ? e.touches[0] : e;
        if (p) track(p.clientX, p.clientY);
      };
      function dragStart() {
        overHead = null;
        document.addEventListener("dragover", onDragOver, true);
        document.addEventListener("pointermove", onPtr, true);
        document.addEventListener("touchmove", onPtr, { capture: true, passive: true });
      }
      function dragEnd(evt) {
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("pointermove", onPtr, true);
        document.removeEventListener("touchmove", onPtr, { capture: true });
        // 放开那一下的位置再看一次（有的浏览器最后一下 dragover 来得慢）
        const oe = evt.originalEvent;
        const pt = oe && (oe.changedTouches ? oe.changedTouches[0] : oe);
        if (pt && (pt.clientX || pt.clientY)) track(pt.clientX, pt.clientY);
        const target = overHead ? overHead.dataset.shelfHead : null;
        if (overHead) overHead.classList.remove(...HL);
        overHead = null;
        collect(target ? { key: evt.item.dataset.item, to: target } : null);
      }
      // 照画面上的样子记下来（放在标题上的再搬到那个标题下面）
      function collect(drop) {
        const byId = new Map(shelves.map((x) => [x.id, x]));
        // 两栏：左右交错读回来（左 1、右 1、左 2、右 2…）
        const cols = $$("[data-shelf-col]", host).map((c) => $$("[data-shelf]", c));
        const secs = [];
        for (let i = 0; i < Math.max(0, ...cols.map((c) => c.length)); i++) cols.forEach((c) => c[i] && secs.push(c[i]));
        shelves = secs.map((sec) => {
          const sh = byId.get(sec.dataset.shelf);
          sh.items = $$("[data-item]", $("[data-shelf-items]", sec)).map((x) => x.dataset.item);
          return sh;
        });
        const lz = $('[data-shelf-items="_"]', host);
        if (lz) looseOrder = $$("[data-item]", lz).map((x) => x.dataset.item);
        if (drop) {
          shelves.forEach((x) => (x.items = x.items.filter((k) => k !== drop.key)));
          const to = shelves.find((x) => x.id === drop.to);
          if (to) to.items.push(drop.key);
        }
        save();
        render();
      }
      // 存：第一页存在 canvas 最外层；其他柜子页存在自己那一页（move = 把一个东西搬到别的柜子页）
      function save(move) {
        let pages = rawPages(f).map((p) => (p.id === pageId ? { ...p, shelves, loose: looseOrder } : p));
        if (move && move.to !== "main") pages = pages.map((p) => (p.id === move.to ? { ...p, loose: [...(Array.isArray(p.loose) ? p.loose.map(String) : []).filter((x) => x !== move.key), move.key] } : p));
        if (!pageId) return saveFolderCanvas(f, rawPages(f).length || move ? { shelves, loose: looseOrder, pages } : { shelves, loose: looseOrder });
        return saveFolderCanvas(f, { pages });
      }
      // 搬到别的柜子页：先问哪一页
      function moveDialog(key) {
        const dlg = modal(
          t("home.pageMoveTitle"),
          `<div class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${otherPages
            .map((p) => `<button type="button" data-move-to="${esc(p.id)}" class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5">${icon("layout-list", "size-4 text-slate-400")}${esc(pageName(p))}</button>`)
            .join("")}</div>`,
        );
        refreshIcons();
        dlg.el.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-move-to]");
          if (!b) return;
          dlg.close();
          shelves.forEach((x) => (x.items = x.items.filter((k) => k !== key)));
          looseOrder = looseOrder.filter((k) => k !== key);
          await save({ key, to: b.dataset.moveTo });
          render();
        });
      }
      host.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || !host.contains(b)) return;
        const d = b.dataset;
        // 新连结记在文件夹拥有者名下（Editor 加的也一样），大家都看得到
        if ("shelfLink" in d)
          return linkDialog(null, {
            folderId: f.id,
            ownerId: f.shared_by || null,
            // 在别的柜子页加的连结：记在这一页
            onSaved: async (l) => {
              if (pageId && l) {
                looseOrder = [...looseOrder, "l:" + l.id];
                await save();
              }
              hooks.reopen();
            },
          });
        if (d.shelfMove) return moveDialog(d.shelfMove);
        if (d.shelfDelLink) {
          const l = links.find((x) => x.id === d.shelfDelLink);
          if (!l) return;
          return confirmDialog(t("home.deleteLinkTitle", { name: l.name }), t("home.deleteLinkBody"), t("home.delete"), t("home.cancel")).then(async (ok) => {
            if (!ok) return;
            const { error } = await sb.from("gw_user_links").delete().eq("id", l.id);
            if (error) return toast(t("home.saveFailed") + " (" + (error.message || "") + ")");
            links = links.filter((x) => x.id !== l.id);
            draw();
            save();
            render();
          });
        }
        if (d.shelfEditLink) return linkDialog(links.find((x) => x.id === d.shelfEditLink), { onSaved: hooks.reopen });
        if ("shelfEdit" in d) return ((editMode = !editMode), render());
        if ("shelfAdd" in d) {
          const nid = uid();
          shelves.push({ id: nid, name: t("home.shelfNew") + " " + (shelves.length + 1), items: [] });
          editMode = true;
          save();
          render();
          const inp = $(`[data-shelf-name="${nid}"]`, host);
          if (inp) (inp.focus(), inp.select(), inp.scrollIntoView({ block: "nearest" }));
          return;
        }
        if (d.shelfDel) {
          const sh = shelves.find((x) => x.id === d.shelfDel);
          return confirmDialog(t("home.shelfDeleteTitle", { name: sh.name || t("home.shelfNew") }), t("home.shelfDeleteBody"), t("home.shelfDelete"), t("home.cancel")).then((ok) => {
            if (!ok) return;
            shelves = shelves.filter((x) => x.id !== d.shelfDel);
            if (!shelves.length) editMode = false;
            save();
            render();
          });
        }
      });
      // 改标题名字：离开输入框或按 Enter 就存
      host.addEventListener("change", (e) => {
        const inp = e.target.closest("[data-shelf-name]");
        if (!inp) return;
        const sh = shelves.find((x) => x.id === inp.dataset.shelfName);
        if (!sh) return;
        sh.name = inp.value.trim().slice(0, 40);
        save();
      });
      host.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.closest("[data-shelf-name]")) (e.preventDefault(), e.target.blur());
      });
      render();
    }

    // 图示颜色：全部一起选（柔和 / 多彩 / 单一颜色），也可以一个一个 App 自己选
    async function saveIcons() {
      const w = board();
      if (!w) return;
      w.config = { ...(w.config || {}), icons: { v: 2, style: ICON.style, apps: ICON.apps } };
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
              ${styleBtn("glass", t("home.iconGlass"), ICON.style === "glass")}${styleBtn("calm", t("home.iconCalm"), ICON.style === "calm")}${styleBtn("colorful", t("home.iconColorful"), ICON.style === "colorful")}
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
      const cur = notice || { message: "", group_id: "", level: "info", ends_at: null, starts_at: null };
      // datetime-local 要本地时间 YYYY-MM-DDTHH:MM；时间一律 5 分钟一格
      const localInput = (d) => {
        const x = new Date(d);
        const z = (n) => String(n).padStart(2, "0");
        return `${x.getFullYear()}-${z(x.getMonth() + 1)}-${z(x.getDate())}T${z(x.getHours())}:${z(x.getMinutes())}`;
      };
      const FIVE = 5 * 60000;
      const floor5 = (ms) => Math.floor(ms / FIVE) * FIVE;
      const ceil5 = (ms) => Math.ceil(ms / FIVE) * FIVE;
      const startsInit = localInput(floor5(cur.starts_at ? new Date(cur.starts_at).getTime() : Date.now()));
      const endsInit = cur.ends_at ? localInput(ceil5(new Date(cur.ends_at).getTime())) : "";
      const dt = `h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900`;
      const dlg = modal(
        notice ? t("widgets.editNotice") : t("widgets.postTitle"),
        `<form class="space-y-3">
          <div data-err></div>
          <textarea name="message" required maxlength="500" rows="4" placeholder="${esc(t("widgets.postPlaceholder"))}" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900">${esc(cur.message)}</textarea>
          <label class="block space-y-1"><span class="${cls.label}">${esc(t("widgets.postAudience"))}</span>
            <select name="group_id" class="${cls.input}">${targets.map(([v, l]) => `<option value="${esc(v)}" ${v === (cur.group_id || "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          </label>
          <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">${icon("calendar-clock", "size-4 text-brand-600 dark:text-brand-400")}${esc(t("widgets.postSchedule"))}</p>
            <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <label for="gw-post-on" class="text-xs font-medium text-slate-500">${esc(t("widgets.postOn"))}</label>
              <span class="flex items-center gap-1"><input id="gw-post-on" type="datetime-local" name="starts_at" step="300" ${notice ? "" : `min="${localInput(floor5(Date.now()))}"`} value="${startsInit}" required class="${dt} min-w-0 flex-1"><span class="size-9 shrink-0"></span></span>
              <label for="gw-post-ends" class="text-xs font-medium text-slate-500">${esc(t("widgets.postEnds"))}</label>
              <span class="flex items-center gap-1"><input id="gw-post-ends" type="datetime-local" name="ends_at" step="300" min="${localInput(ceil5(Date.now()))}" value="${endsInit}" class="${dt} min-w-0 flex-1">
                <button type="button" data-clear-ends title="${esc(t("widgets.postEndsClear"))}" aria-label="${esc(t("widgets.postEndsClear"))}" class="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10">${icon("x", "size-4")}</button></span>
            </div>
            <p class="mt-2 text-xs text-slate-500">${esc(t("widgets.postScheduleHint"))}</p>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("settings.cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(notice ? t("widgets.save") : t("widgets.post"))}</button>
          </div>
        </form>`,
      );
      // 「重要」放在标题旁边
      if (dlg.head) dlg.head.innerHTML = `<label class="flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"><input type="checkbox" name="important" ${cur.level === "warning" ? "checked" : ""} class="size-3.5 accent-amber-500">${esc(t("widgets.postImportant"))}</label>`;
      refreshIcons();
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      $("[data-clear-ends]", dlg.el).onclick = () => ($("[name=ends_at]", dlg.el).value = "");
      $("form", dlg.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const groupId = f.group_id.value || null;
        const now = Date.now();
        const imp = dlg.head ? $("[name=important]", dlg.head) : null;
        // 什么时候贴出来：没改就照旧（新的 = 现在）；改到以后 = 排程
        const startsChanged = f.starts_at.value !== startsInit;
        const starts = f.starts_at.value ? new Date(f.starts_at.value).getTime() : now;
        // 下架时间：空白 = 一直显示；没改就照旧；要比贴出来的时间晚
        const endsChanged = f.ends_at.value !== endsInit;
        const ends = f.ends_at.value ? new Date(f.ends_at.value).getTime() : null;
        if (endsChanged && ends != null && (isNaN(ends) || ends <= Math.max(now, starts))) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("widgets.postEndsPast")));
        const fields = { message: f.message.value.trim(), level: imp && imp.checked ? "warning" : "info", group_id: groupId };
        if (endsChanged) fields.ends_at = ends != null ? new Date(ends).toISOString() : null;
        else if (!notice) fields.ends_at = null;
        if (!notice ? starts > now + 60000 : startsChanged) fields.starts_at = new Date(Math.max(starts, now)).toISOString();
        const cols = "id, message, level, starts_at, ends_at, group_id, created_by";
        const { data: row, error } = notice
          ? await sb.from("gw_announcements").update(fields).eq("id", notice.id).select(cols).single()
          : await sb.from("gw_announcements").insert({ ...fields, created_by: profile.id }).select(cols).single();
        if (error) return ($("[data-err]", dlg.el).innerHTML = GW.alertBox(t("widgets.postFailed")));
        dlg.close();
        row.author = notice ? notice.author : profile.full_name;
        const sched = new Date(row.starts_at).getTime() > Date.now();
        const at = data.announcements.findIndex((a) => a.id === row.id);
        data.announcements = data.announcements.filter((a) => a.id !== row.id);
        data.scheduled = (data.scheduled || []).filter((a) => a.id !== row.id);
        if (sched) data.scheduled = [...data.scheduled, row].sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at));
        // 发给自己不在的 Business 时，自己的公告栏不会显示，只提示已发布
        else if (!groupId || (opts && opts.memberOf && opts.memberOf.includes(groupId))) {
          if (at >= 0) data.announcements.splice(at, 0, row);
          else data.announcements = [row, ...data.announcements];
        }
        draw();
        const fmtT = new Intl.DateTimeFormat(GW.LOCALE, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(row.starts_at));
        toast(sched ? t("widgets.postScheduledFor", { time: fmtT }) : notice ? t("widgets.saved") : t("widgets.posted"));
      });
    }

    async function deleteNotice(id) {
      if (!(await confirmDialog(t("widgets.deleteNotice"), t("widgets.deleteNoticeBody"), t("widgets.delete"), t("settings.cancel")))) return;
      const { error } = await sb.from("gw_announcements").delete().eq("id", id);
      if (error) return toast(t("widgets.postFailed"));
      data.announcements = data.announcements.filter((a) => a.id !== id);
      data.scheduled = (data.scheduled || []).filter((a) => a.id !== id);
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
    // 分享给 Business 的说明（分享名单最上面那一行）
    function bizShareLabel(f) {
      const list = (folderBiz.get(f.id) || []).map((b) => {
        const g = S && S.groups.find((x) => x.id === b.group_id);
        return g ? g.name + " (" + t(b.role === "edit" ? "home.shareRoleEdit" : "home.shareRoleView") + ")" : "";
      }).filter(Boolean);
      return list.length ? list.join(", ") : t("home.shareBizNone");
    }
    async function sharePicker(f, onTag) {
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
          <option value="owner">${esc(t("home.shareRoleOwner"))}</option>
        </select>`;
      const dlg = modal(
        t("home.shareTitle", { name: f.name }),
        `<div class="space-y-3">
          ${sectionsOn ? `<div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-white/5">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300">${icon("briefcase-business", "size-4")}</span>
            <span class="min-w-0 flex-1"><span class="block font-medium">${esc(t("home.shareBizTitle"))}</span><span data-biz-label class="block truncate text-xs text-slate-500">${esc(bizShareLabel(f))}</span></span>
            <button type="button" data-biz-share class="${btn("secondary", "sm")}">${esc(t("home.shareBizChange"))}</button>
          </div>
          <p class="px-1 text-xs font-semibold text-slate-500">${esc(t("home.sharePeople"))}</p>` : ""}
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
      // 已经送出、还没被接受的转移
      const pend = await sb.from("gw_folder_transfers").select("to_user").eq("folder_id", f.id).maybeSingle();
      if (pend.data) {
        const who = list.find((u) => u.id === pend.data.to_user);
        $(".space-y-3", dlg.el).insertAdjacentHTML("afterbegin", `<div data-pending class="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">${icon("hourglass", "size-4 shrink-0")}<span class="min-w-0 flex-1">${esc(t("home.transferPending", { name: (who && who.full_name) || "" }))}</span><button type="button" data-cancel-transfer class="${btn("secondary", "sm")}">${esc(t("home.cancel"))}</button></div>`);
        refreshIcons();
        $("[data-cancel-transfer]", dlg.el).onclick = async () => {
          const { error } = await sb.rpc("gw_cancel_folder_transfer", { p_folder: f.id });
          if (error) return toast(t("home.saveFailed"));
          $("[data-pending]", dlg.el).remove();
        };
      }
      const bz = $("[data-biz-share]", dlg.el);
      if (bz) bz.onclick = () => folderTagDialog(f, () => (($("[data-biz-label]", dlg.el).textContent = bizShareLabel(f)), onTag && onTag()));
      const q = $("[data-q]", dlg.el);
      if (q) q.addEventListener("input", () => { const v = q.value.trim().toLowerCase(); $$("[data-row]", dlg.el).forEach((r) => r.classList.toggle("hidden", !!v && !r.dataset.row.includes(v))); });
      dlg.el.addEventListener("change", (e) => {
        // 只能选一个新拥有者：选了另一个人，前一个改回 Editor
        if (e.target.dataset.role && e.target.value === "owner") $$("[data-role]", dlg.el).forEach((x) => x !== e.target && x.value === "owner" && (x.value = "edit"));
        if (!e.target.dataset.pick) return;
        const sel = $(`[data-role="${e.target.dataset.pick}"]`, dlg.el);
        if (sel) sel.classList.toggle("invisible", !e.target.checked);
      });
      $("[data-save]", dlg.el).onclick = async () => {
        const picked = new Map($$("[data-pick]:checked", dlg.el).map((x) => [x.dataset.pick, rolesOn ? $(`[data-role="${x.dataset.pick}"]`, dlg.el).value : "edit"]));
        // 转移拥有者：先问清楚；分享名单先照常存（新拥有者暂时当 Editor），最后才转
        const newOwner = [...picked].find(([, role]) => role === "owner");
        if (newOwner) {
          picked.set(newOwner[0], "edit");
          const who = list.find((u) => u.id === newOwner[0]);
          const ok = await confirmDialog(t("home.transferTitle", { name: (who && who.full_name) || "" }), t("home.transferBody", { name: (who && who.full_name) || "", folder: f.name }), t("home.transferOk"), t("home.cancel"));
          if (!ok) return;
        }
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
        if (newOwner) {
          // 送出请求：对方在首页按「接受」才会真的转过去
          const { error } = await sb.rpc("gw_request_folder_transfer", { p_folder: f.id, p_to: newOwner[0] });
          if (error) return fail(/gw_request_folder_transfer/.test(error.message || "") ? { message: t("home.folderTagNeedsDb") } : error);
          dlg.close();
          const who = list.find((u) => u.id === newOwner[0]);
          return toast(t("home.transferAsked", { name: (who && who.full_name) || "" }));
        }
        dlg.close();
        toast(t("home.shareSaved", { count: picked.size }));
      };
    }

    async function deleteFolder(fid) {
      const f = folders.find((x) => x.id === fid);
      if (boxesOf(f).length && homeCopyOf(fid) != null) {
        // My Home 里的复制：只拿掉这一份，Business 区块里的还在
        await setHomeCopy(fid, null);
        return draw();
      }
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
      // 只带 Company 进模块；要看哪个 Location 的资料在模块里面设定
      return { company: (map && map.external_id) || c.name, company_name: c.name, company_short: c.short_name || c.code || "", opispro: c.opispro_id || "" };
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
    // 面板开着时点到主页区块以外（例如页面底下的空白）也要收起来
    document.addEventListener("click", (e) => {
      if (!sheet || root.contains(e.target) || e.target.closest(".gw-modal, [data-fab], [data-fab-toggle]")) return;
      sheet = null;
      draw();
    });
    // Company / Location 下拉开着时，点它以外任何地方（包括顶栏、空白处）都收起来
    document.addEventListener("click", (e) => {
      if (!(companyMenuGid || estateMenuGid) || (e.target.isConnected && e.target.closest("[data-pick-wrap]"))) return;
      companyMenuGid = null;
      estateMenuGid = null;
      draw();
    }, true);
    root.addEventListener("click", (e) => {
      if (!e.target.isConnected) return; // 上面刚收起下拉、画面重画过：这一下只算收起
      if (Date.now() - lastDragEnd < 400) return; // 刚拖完，不算点击
      // 「新增小工具 / App」面板开着时，点面板外面就收起来
      if (sheet && !e.target.closest(".gw-sheet") && !e.target.closest("[data-fab], [data-fab-toggle]")) return ((sheet = null), draw());
      // 编辑中点空白处（不是图示、小工具、按钮）：离开编辑
      if (sectionsOn && editing && downOnEmpty && !e.target.closest(EDIT_KEEP)) return setEditing(false);
      const b = e.target.closest("button");
      if (b && b.dataset.todoAdd) {
        const w = widgets.find((x) => x.id === b.dataset.todoAdd);
        if (w) ((w.config = w.config || {}), addTodo(w));
        return;
      }
      if (b && b.dataset.todoToggle) {
        const [wid, tid] = b.dataset.todoToggle.split(":");
        const w = widgets.find((x) => x.id === wid);
        const td = w && (w.config.todos || []).find((x) => x.id === tid);
        if (td) ((td.done = !td.done), saveNote(w), draw());
        return;
      }
      if (!b || !root.contains(b)) {
        if (sectionsOn && (companyMenuGid || estateMenuGid)) return ((companyMenuGid = null), (estateMenuGid = null), draw());
        if (fabOpen && !e.target.closest("[data-fab-toggle]")) ((fabOpen = false), draw());
        return;
      }
      const d = b.dataset;
      if (sectionsOn) {
        if (companyMenuGid && !("companyMenu" in d) && !("companyPick" in d)) companyMenuGid = null;
        if (estateMenuGid && !("estateMenu" in d) && !("estatePick" in d)) estateMenuGid = null;
        if ("companyMenu" in d) return ((estateMenuGid = null), (companyMenuGid = companyMenuGid === d.companyMenu ? null : d.companyMenu), draw());
        if ("estateMenu" in d) return ((companyMenuGid = null), (estateMenuGid = estateMenuGid === d.estateMenu ? null : d.estateMenu), draw());
        if ("estatePick" in d) {
          estateMenuGid = null;
          estateSel.set(d.gid, d.estatePick);
          draw();
          const w = board();
          if (!w) return;
          w.config = { ...(w.config || {}), locations: Object.fromEntries(estateSel) };
          return sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id).then(({ error }) => error && toast(t("home.saveFailed")));
        }
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
      if (d.aiSuggest) return aiAsk(d.aiSuggest);
      if (d.aiDl) return aiDownload(d.aiDl);
      if ("aiClear" in d) return ((aiMsgs = []), aiSave(), draw());
      if (d.react) return toggleReaction(...d.react.split(":"));
      if (d.who) return whoReacted(...d.who.split(":"));
      if (d.editNotice) return postNotice(allNotices().find((a) => a.id === d.editNotice));
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
      if ("sheetHome" in d) return ((sheet = null), setHomeBox({ on: true }), draw());
      if ("sheetLink" in d) return ((sheet = null), draw(), linkDialog(null));
      if ("sheetFolder" in d) return ((sheet = null), draw(), folderDialog(null));
      if ("homeRename" in d) return renameHome();
      if ("homeRemove" in d) {
        if (rootItems().length) return toast(t("home.removeHomeNotEmpty"));
        setHomeBox({ on: false });
        return draw();
      }
    });
    // 改 My Home 的名字（空白 = 回到「My Home」）
    function renameHome() {
      const dlg = modal(
        t("home.renameHome"),
        `<form class="space-y-4">
          <input name="n" maxlength="40" value="${esc(homeName())}" class="${cls.input}">
          <div class="flex justify-end gap-2">
            <button type="button" data-cancel class="${btn("secondary")}">${esc(t("home.cancel"))}</button>
            <button type="submit" class="${btn("primary")}">${esc(t("home.save"))}</button>
          </div>
        </form>`,
      );
      const f = $("form", dlg.el);
      f.n.focus();
      f.n.select();
      $("[data-cancel]", dlg.el).onclick = dlg.close;
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        setHomeBox({ name: f.n.value.trim().slice(0, 40), on: true });
        dlg.close();
        draw();
      });
    }
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
        saveNote(w);
      } else if (el.matches("[data-todo-text]")) {
        const [wid, tid] = el.dataset.todoText.split(":");
        const w = widgets.find((x) => x.id === wid);
        const td = w && (w.config.todos || []).find((x) => x.id === tid);
        if (td) ((td.text = el.value.slice(0, 200)), saveNote(w));
      }
    });
    function saveNote(w) {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => sb.from("gw_user_widgets").update({ config: w.config }).eq("id", w.id).then(({ error }) => error && toast(t("home.saveFailed"))), 1000);
    }
    // 待办：新增一行 / 打勾 / Enter 再加一行 / 空行按 Backspace 删掉
    const focusTodo = (wid, tid) => {
      const el = $(`[data-todo-text="${wid}:${tid}"]`, root);
      if (el) el.focus();
    };
    function addTodo(w, afterId) {
      const todos = (w.config.todos = Array.isArray(w.config.todos) ? w.config.todos : []);
      const td = { id: Math.random().toString(36).slice(2, 10), text: "", done: false };
      const i = afterId ? todos.findIndex((x) => x.id === afterId) : -1;
      todos.splice(i < 0 ? todos.length : i + 1, 0, td);
      saveNote(w);
      draw();
      focusTodo(w.id, td.id);
    }
    root.addEventListener("keydown", (e) => {
      const el = e.target.closest("[data-todo-text]");
      if (!el) return;
      const [wid, tid] = el.dataset.todoText.split(":");
      const w = widgets.find((x) => x.id === wid);
      if (!w) return;
      if (e.key === "Enter") return (e.preventDefault(), addTodo(w, tid));
      if (e.key === "Backspace" && !el.value) {
        e.preventDefault();
        const todos = w.config.todos || [];
        const i = todos.findIndex((x) => x.id === tid);
        if (i < 0) return;
        todos.splice(i, 1);
        saveNote(w);
        draw();
        if (todos[i - 1]) focusTodo(wid, todos[i - 1].id);
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

    // 公告的下架时间：首页资料没有带，另外拿；时间到了就从公告栏拿掉（不用重新整理页面）
    const expireNotices = () => {
      const now = Date.now();
      let changed = false;
      // 排好时间的：时间到了就贴出来（自己是那个 Business 的人才会在自己的公告栏看到）
      const due = (data.scheduled || []).filter((a) => new Date(a.starts_at).getTime() <= now);
      if (due.length) {
        data.scheduled = data.scheduled.filter((a) => !due.includes(a));
        const mine = due.filter((a) => !a.group_id || (opts && opts.memberOf && opts.memberOf.includes(a.group_id)));
        data.announcements = [...mine.reverse(), ...data.announcements];
        changed = true;
      }
      const left = data.announcements.filter((a) => !a.ends_at || new Date(a.ends_at).getTime() > now);
      if (left.length !== data.announcements.length) ((data.announcements = left), (changed = true));
      if (changed) draw();
    };
    if (!readOnly && canPost) {
      sb.from("gw_announcements")
        .select("id, message, level, starts_at, ends_at, group_id, created_by")
        .eq("is_active", true)
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
        .then(({ data: rows, error }) => {
          if (error || !rows || !rows.length) return;
          data.scheduled = rows.map((r) => ({ ...r, author: r.created_by === profile.id ? profile.full_name : "" }));
          draw();
        });
    }
    if (!readOnly && data.announcements && data.announcements.length) {
      sb.from("gw_announcements")
        .select("id, ends_at")
        .in("id", data.announcements.map((a) => a.id))
        .then(({ data: rows }) => {
          const byId = new Map((rows || []).map((r) => [r.id, r.ends_at]));
          let any = false;
          data.announcements.forEach((a) => {
            if (byId.get(a.id)) ((a.ends_at = byId.get(a.id)), (any = true));
          });
          if (any) draw();
        });
    }
    setInterval(expireNotices, 30000);
  }

  return { render, WIDGETS };
})();
