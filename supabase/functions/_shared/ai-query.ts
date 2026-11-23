// 在已取得的资料列上做筛选、分组汇总、排序（全部在 Edge Function 里算，不把整张表送给 AI）
import type { Dataset } from "./ai-datasets.ts";

export type Filter = { column: string; op: string; value?: unknown };
export type Metric = { fn: string; column?: string; as?: string };
export type Spec = {
  filters?: Filter[];
  columns?: string[];
  group_by?: string[];
  metrics?: Metric[];
  order_by?: string;
  descending?: boolean;
  limit?: number;
};
export type OutCol = { key: string; label: string; type: "text" | "number" | "date" };
export type Result = { columns: OutCol[]; rows: Record<string, unknown>[]; total: number };

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"];
const FNS = ["count", "sum", "avg", "min", "max"];

const label = (k: string) => k.replace(/_/g, " ").replace(/\brm\b/gi, "(RM)").replace(/\bkm\b/gi, "(km)").replace(/^\w/, (c) => c.toUpperCase());

function matches(row: Record<string, unknown>, f: Filter, type: string): boolean {
  const v = row[f.column];
  if (f.op === "in") return Array.isArray(f.value) && f.value.map(String).map((x) => x.toLowerCase()).includes(String(v ?? "").toLowerCase());
  if (v === null || v === undefined) return false;
  if (f.op === "contains") return String(v).toLowerCase().includes(String(f.value ?? "").toLowerCase());
  const a = type === "number" ? Number(v) : String(v).toLowerCase();
  const b = type === "number" ? Number(f.value) : String(f.value ?? "").toLowerCase();
  if (type === "number" && Number.isNaN(b as number)) return false;
  switch (f.op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
  }
  return false;
}

export function runQuery(ds: Dataset, all: Record<string, unknown>[], spec: Spec): Result {
  const colType = new Map(ds.columns.map((c) => [c.name, c.type]));
  const need = (name: string) => {
    if (!colType.has(name)) throw new Error(`Unknown column "${name}" in dataset ${ds.name}. Columns: ${ds.columns.map((c) => c.name).join(", ")}`);
    return colType.get(name)!;
  };

  let rows = all;
  for (const f of spec.filters ?? []) {
    if (!OPS.includes(f.op)) throw new Error(`Unknown filter operator "${f.op}". Use: ${OPS.join(", ")}`);
    const type = need(f.column);
    rows = rows.filter((r) => matches(r, f, type));
  }

  let columns: OutCol[];
  let out: Record<string, unknown>[];
  const groupBy = spec.group_by ?? [];
  const metrics = spec.metrics ?? [];

  if (groupBy.length || metrics.length) {
    groupBy.forEach(need);
    const defs = metrics.map((m) => {
      if (!FNS.includes(m.fn)) throw new Error(`Unknown metric "${m.fn}". Use: ${FNS.join(", ")}`);
      if (m.fn !== "count") {
        if (!m.column) throw new Error(`Metric ${m.fn} needs a column`);
        const type = need(m.column);
        if ((m.fn === "sum" || m.fn === "avg") && type !== "number") throw new Error(`${m.fn} needs a number column, "${m.column}" is ${type}`);
      }
      const key = m.as || (m.fn === "count" ? "count" : `${m.fn}_${m.column}`);
      return { ...m, key };
    });
    if (!defs.length) defs.push({ fn: "count", key: "count" } as never);
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const k = JSON.stringify(groupBy.map((g) => r[g] ?? null));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    out = [...groups.values()].map((g) => {
      const row: Record<string, unknown> = {};
      groupBy.forEach((c) => (row[c] = g[0][c] ?? null));
      for (const d of defs) {
        const vals = d.column ? g.map((r) => r[d.column!]).filter((v) => v !== null && v !== undefined) : [];
        const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
        let v: unknown;
        if (d.fn === "count") v = d.column ? vals.length : g.length;
        else if (d.fn === "sum") v = nums.reduce((a, b) => a + b, 0);
        else if (d.fn === "avg") v = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        else if (d.fn === "min") v = vals.length ? vals.reduce((a, b) => (a! <= b! ? a : b)) : null;
        else v = vals.length ? vals.reduce((a, b) => (a! >= b! ? a : b)) : null;
        row[d.key] = typeof v === "number" ? Math.round(v * 100) / 100 : v;
      }
      return row;
    });
    columns = [
      ...groupBy.map((c) => ({ key: c, label: label(c), type: colType.get(c)! })),
      ...defs.map((d) => ({ key: d.key, label: label(d.key), type: (d.fn === "min" || d.fn === "max") && d.column ? colType.get(d.column)! : ("number" as const) })),
    ];
  } else {
    const picked = spec.columns?.length ? spec.columns : ds.columns.map((c) => c.name);
    picked.forEach(need);
    columns = picked.map((c) => ({ key: c, label: label(c), type: colType.get(c)! }));
    out = rows.map((r) => Object.fromEntries(picked.map((c) => [c, r[c] ?? null])));
  }

  if (spec.order_by) {
    const col = columns.find((c) => c.key === spec.order_by);
    if (!col) throw new Error(`order_by "${spec.order_by}" is not in the result columns: ${columns.map((c) => c.key).join(", ")}`);
    const dir = spec.descending ? -1 : 1;
    out.sort((a, b) => {
      const x = a[col.key], y = b[col.key];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (col.type === "number" ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * dir;
    });
  }
  const total = out.length;
  return { columns, rows: out.slice(0, Math.max(1, Math.min(spec.limit ?? 100, 5000))), total };
}
