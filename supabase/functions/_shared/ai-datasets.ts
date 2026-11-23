// AI 助手可以查询的资料集（白名单）。
// 每个资料集 = 一个 Gateway 自己的表 + 要带出来的栏位；查询一律用「调用者自己的身份」，
// 所以数据库的权限（RLS）照常生效：看不到的资料，AI 也看不到。
// 不开放原本就在用的其他系统表（workrecords_*、machinery_*）和用户名单。
// Diesel 已搬到 CMMS 2（Machinery Portal）自己的资料库，这里不再查旧的 diesel_* 表。

export type Col = { name: string; type: "text" | "number" | "date"; desc: string };
export type Dataset = {
  name: string;
  description: string;
  table: string;
  select: string;
  order: string;
  columns: Col[];
  flatten: (row: any) => Record<string, unknown>;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? {};

export const DATASETS: Dataset[] = [
  {
    name: "businesses",
    description: "Business lines (groups) in the company.",
    table: "gw_groups",
    select: "name, code, description",
    order: "name",
    columns: [
      { name: "code", type: "text", desc: "Business code" },
      { name: "name", type: "text", desc: "Business name" },
      { name: "description", type: "text", desc: "Description" },
    ],
    flatten: (r) => ({ code: r.code ?? null, name: r.name, description: r.description ?? null }),
  },
  {
    name: "companies",
    description: "Companies (legal entities) with code and registration number.",
    table: "gw_companies",
    select: "code, name, short_name, registration_no, description",
    order: "name",
    columns: [
      { name: "code", type: "text", desc: "Company code" },
      { name: "name", type: "text", desc: "Company name" },
      { name: "short_name", type: "text", desc: "Short name" },
      { name: "registration_no", type: "text", desc: "Registration number" },
    ],
    flatten: (r) => ({ code: r.code ?? null, name: r.name, short_name: r.short_name ?? null, registration_no: r.registration_no ?? null }),
  },
  {
    name: "modules",
    description: "Systems (modules) available in MJM Intranet.",
    table: "gw_modules",
    select: "code, name, kind, description, is_active",
    order: "name",
    columns: [
      { name: "code", type: "text", desc: "Module code" },
      { name: "name", type: "text", desc: "Module name" },
      { name: "kind", type: "text", desc: "system or link" },
      { name: "description", type: "text", desc: "Description" },
      { name: "active", type: "text", desc: "true or false" },
    ],
    flatten: (r) => ({ code: r.code, name: r.name, kind: r.kind, description: r.description ?? null, active: String(!!r.is_active) }),
  },
];

export const byName = (name: string) => DATASETS.find((d) => d.name === name);
