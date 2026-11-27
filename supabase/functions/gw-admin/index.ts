// 后台管理动作（需要 service_role 的部分）：建立用户、批量导入、停用/启用、重设密码、产生模块 API Key
// 只有 super_admin 可以用；写入 gw_profiles / gw_group_members 时用调用者身份，RLS 再检查一次
import { corsHeaders, generatePassword, getCaller, json, logEvent, serviceClient, sha256Hex, withCors } from "../_shared/gw.ts";

type Role = "super_admin" | "user";
type Caller = NonNullable<Awaited<ReturnType<typeof getCaller>>>;
// role_id = 自订角色（只在 role = user 时有意义）
type CreateInput = { email: string; full_name: string; role?: Role; role_id?: string | null; group_ids?: string[] };
type CreateResult = { ok: true; email: string; password?: string; linked?: boolean } | { ok: false; email: string; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: Role[] = ["super_admin", "user"];

async function createUser(caller: Caller, input: CreateInput): Promise<CreateResult> {
  const email = String(input.email ?? "").trim().toLowerCase();
  const fullName = String(input.full_name ?? "").trim();
  const role: Role = ROLES.includes(input.role as Role) ? (input.role as Role) : "user";
  const roleId = role === "user" && input.role_id ? String(input.role_id) : null;
  const groupIds = Array.isArray(input.group_ids) ? input.group_ids : [];
  if (!EMAIL.test(email) || !fullName || fullName.length > 100) return { ok: false, email, error: "invalid_input" };
  const me = caller.profile;

  const admin = serviceClient();
  const { data: existing } = await admin.from("gw_profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { ok: false, email, error: "exists" };

  let userId: string;
  let password: string | undefined;
  let linked = false;
  const { data: authId } = await admin.rpc("gw_auth_user_id", { p_email: email });
  if (authId) {
    userId = authId;
    linked = true;
  } else {
    password = generatePassword();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) return { ok: false, email, error: "auth_failed" };
    userId = data.user.id;
  }

  const { error: profileError } = await caller.supabase.from("gw_profiles").insert({
    id: userId,
    email,
    full_name: fullName,
    role,
    role_id: roleId,
    must_change_password: !linked,
  });
  if (profileError) {
    if (!linked) await admin.auth.admin.deleteUser(userId);
    return { ok: false, email, error: "forbidden" };
  }
  if (groupIds.length) {
    await caller.supabase.from("gw_group_members").insert(groupIds.map((group_id) => ({ group_id, user_id: userId })));
  }
  await logEvent(me.id, linked ? "user.link" : "user.create", "profiles", userId, email);
  return { ok: true, email, password, linked };
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = await getCaller(req);
  const me = caller?.profile;
  if (!caller || !me || me.status !== "active" || me.role !== "super_admin") {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  const body = await req.json().catch(() => ({}));
  const admin = serviceClient();

  switch (body.action) {
    case "create_user":
      return json(await createUser(caller, body.user ?? {}));

    // 批量导入：rows = [{ email, full_name, groups: [Business 名称], role: 角色名称 | "Super Admin" | 空白 }]
    case "import_users": {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length > 500) return json({ results: [], error: "too_many" });
      const [{ data: roles }, { data: groups }] = await Promise.all([
        caller.supabase.from("gw_roles").select("id, name"),
        caller.supabase.from("gw_groups").select("id, name"),
      ]);
      const roleByName = new Map((roles ?? []).map((r) => [String(r.name).trim().toLowerCase(), r.id]));
      const groupByName = new Map((groups ?? []).map((g) => [String(g.name).trim(), g.id]));
      const results: CreateResult[] = [];
      for (const row of rows) {
        const email = String(row.email ?? "").trim();
        if (!email) continue;
        const roleText = String(row.role ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
        const isSuper = roleText === "super admin";
        const roleId = roleText && !isSuper && roleText !== "user" ? roleByName.get(String(row.role).trim().toLowerCase()) : null;
        if (roleText && !isSuper && roleText !== "user" && !roleId) {
          results.push({ ok: false, email, error: "unknown_role" });
          continue;
        }
        const names: string[] = Array.isArray(row.groups) ? row.groups : [];
        const groupIds = names.map((n) => groupByName.get(String(n).trim()));
        if (groupIds.some((g) => !g)) {
          results.push({ ok: false, email, error: "unknown_group" });
          continue;
        }
        results.push(
          await createUser(caller, {
            email,
            full_name: String(row.full_name ?? "").trim() || email,
            role: isSuper ? "super_admin" : "user",
            role_id: roleId ?? null,
            group_ids: groupIds as string[],
          }),
        );
      }
      return json({ results });
    }

    case "set_status": {
      const status = body.status === "disabled" ? "disabled" : "active";
      const { data: updated, error } = await caller.supabase
        .from("gw_profiles")
        .update({ status })
        .eq("id", body.id)
        .select("id, email");
      if (error || !updated?.length) return json({ ok: false, error: "forbidden" });
      // 同时封锁 / 解封 Supabase 登录，现有 session 也无法再刷新
      await admin.auth.admin.updateUserById(body.id, { ban_duration: status === "disabled" ? "876000h" : "none" });
      // 启用 = 批准（OPIS PRO 第一次登入自动开的帐号）；栏位还没加时忽略
      if (status === "active") await admin.from("gw_profiles").update({ pending_approval: false }).eq("id", body.id).eq("pending_approval", true);
      await logEvent(me.id, status === "disabled" ? "user.disable" : "user.enable", "profiles", body.id, updated[0].email);
      return json({ ok: true });
    }

    case "reset_password": {
      const { data: allowed } = await caller.supabase.rpc("gw_can_manage_user", { p_user: body.id });
      if (!allowed) return json({ ok: false, error: "forbidden" });
      const password = generatePassword();
      const { error } = await admin.auth.admin.updateUserById(body.id, { password });
      if (error) return json({ ok: false, error: "auth_failed" });
      const { data: profile } = await admin
        .from("gw_profiles")
        .update({ must_change_password: true })
        .eq("id", body.id)
        .select("email")
        .single();
      // 重设密码同时解除登录锁定
      if (profile) await admin.rpc("gw_login_succeeded", { p_email: profile.email });
      await logEvent(me.id, "user.reset_password", "profiles", body.id, profile?.email ?? null);
      return json({ ok: true, password });
    }

    // 产生目标系统调用 gw-check-access 用的 API Key；只显示一次，资料库只存 SHA-256
    case "generate_api_key": {
      if (me.role !== "super_admin") return json({ ok: false, error: "forbidden" });
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const key = "gwk_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const { error } = await admin.from("gw_module_api_keys").upsert({
        module_id: body.module_id,
        key_hash: await sha256Hex(key),
        key_prefix: key.slice(0, 10),
        created_at: new Date().toISOString(),
      });
      if (error) return json({ ok: false, error: "forbidden" });
      await logEvent(me.id, "module.api_key", "modules", body.module_id, key.slice(0, 10));
      return json({ ok: true, key });
    }

    // 模块 API Key 前缀（列表显示用）
    case "list_api_keys": {
      if (me.role !== "super_admin") return json({ ok: false, error: "forbidden" });
      const { data } = await admin.from("gw_module_api_keys").select("module_id, key_prefix");
      return json({ ok: true, keys: data ?? [] });
    }
  }
  return json({ ok: false, error: "unknown_action" }, 400);
}));
