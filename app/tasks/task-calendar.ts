const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function fromLocalDate(value: string) {
  if (!DATE.test(value)) throw new Error("Invalid local date.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error("Invalid local date.");
  return date;
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(fromLocalDate(value));
}
