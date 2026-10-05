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
  return new Date(year, month - 1, day);
}

export function addDays(value: string, amount: number) {
  const date = fromLocalDate(value);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

export function daysBetween(start: string, end: string) {
  return Math.round((fromLocalDate(end).getTime() - fromLocalDate(start).getTime()) / 86_400_000);
}

export function monthStart(value = localDate()) {
  return `${value.slice(0, 7)}-01`;
}

export function shiftMonth(value: string, amount: number) {
  const date = fromLocalDate(monthStart(value));
  date.setMonth(date.getMonth() + amount);
  return localDate(date);
}

export function monthDates(value: string) {
  const start = monthStart(value);
  const next = shiftMonth(start, 1);
  return Array.from({ length: daysBetween(start, next) }, (_, index) => addDays(start, index));
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(fromLocalDate(value));
}

export function longDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(fromLocalDate(value));
}

export function monthLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(fromLocalDate(value));
}
