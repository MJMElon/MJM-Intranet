// AI 查询工具共用的参数说明（聊天小工具 gw-ai-chat 和 AI Connector gw-mcp 共用）
export const filterSchema = {
  type: "array",
  description: "Row filters, all must match. Dates are YYYY-MM-DD strings, so gte/lte work on dates.",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      op: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"] },
      value: { description: "A string or number; an array of strings for op=in" },
    },
    required: ["column", "op", "value"],
  },
};
export const specProps = {
  dataset: { type: "string", description: "Dataset name from list_datasets" },
  filters: filterSchema,
  group_by: { type: "array", items: { type: "string" }, description: "Columns to group by (turns the result into a summary)" },
  metrics: {
    type: "array",
    description: "Summary numbers per group. count needs no column; sum/avg need a number column.",
    items: {
      type: "object",
      properties: { fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] }, column: { type: "string" }, as: { type: "string", description: "Optional name for the result column" } },
      required: ["fn"],
    },
  },
  columns: { type: "array", items: { type: "string" }, description: "Columns to return for a plain list (default: all)" },
  order_by: { type: "string", description: "A result column to sort by" },
  descending: { type: "boolean" },
};
