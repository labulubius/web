export function reorderByExactIds<T extends { id: string }>(items: T[], value: unknown): T[] | null {
  if (!Array.isArray(value) || value.length !== items.length || value.some((item) => typeof item !== "string")) return null;
  const order = value as string[];
  if (new Set(order).size !== order.length) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  if (order.some((item) => !byId.has(item))) return null;
  return order.map((item) => byId.get(item)!);
}
