const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromLocalDate(value: string) {
  if (!DATE.test(value)) throw new Error("Invalid local date.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error("Invalid local date.");
  return date;
}

export function validLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { fromLocalDate(value); return true; } catch { return false; }
}

export function addDays(value: string, amount: number) {
  const date = fromLocalDate(value);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

export function daysBetween(start: string, end: string) {
  const first = fromLocalDate(start);
  const last = fromLocalDate(end);
  return Math.round((Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86_400_000);
}

export function monthStart(value = localDate()) {
  return `${value.slice(0, 7)}-01`;
}

export function shiftMonth(value: string, amount: number) {
  const source = fromLocalDate(value);
  const target = new Date(source.getFullYear(), source.getMonth() + amount, 1);
  const finalDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(source.getDate(), finalDay));
  return localDate(target);
}

export function monthEnd(value = localDate()) {
  return addDays(shiftMonth(monthStart(value), 1), -1);
}

export function dateRange(start: string, end: string) {
  const count = daysBetween(start, end);
  if (count < 0) throw new Error("Invalid date range.");
  return Array.from({ length: count + 1 }, (_, index) => addDays(start, index));
}

export function maximumRangeEnd(start: string) {
  return addDays(shiftMonth(start, 2), -1);
}

export function validTimelineRange(start: unknown, end: unknown): start is string {
  return validLocalDate(start) && validLocalDate(end) && start <= end && end <= maximumRangeEnd(start);
}

export function shiftRange(start: string, end: string, direction: -1 | 1) {
  const amount = (daysBetween(start, end) + 1) * direction;
  return { startDate: addDays(start, amount), endDate: addDays(end, amount) };
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(fromLocalDate(value));
}

export function longDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(fromLocalDate(value));
}

export function rangeLabel(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${formatter.format(fromLocalDate(start))} – ${formatter.format(fromLocalDate(end))}`;
}
