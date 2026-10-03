export type TaskStatus = "open" | "completed";

export type PlannerTask = {
  id: string;
  owner_id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  scheduled_date: string | null;
  start_minute: number | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskDraft = {
  title: string;
  notes: string;
  scheduled_date: string | null;
  start_minute: number | null;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localDate(now = new Date()) {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(value: string, amount: number) {
  const { year, month, day } = dateParts(value);
  const date = new Date(year, month - 1, day + amount, 12);
  return isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  const { year, month, day } = dateParts(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...options,
  }).format(new Date(year, month - 1, day, 12));
}

export function minutesToTime(minutes: number | null) {
  if (minutes === null) return "";
  const bounded = Math.max(0, Math.min(1439, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

export function timeToMinutes(value: string) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return Math.min(1425, hour * 60 + Math.round(minute / 15) * 15);
}

export function compareTasks(a: PlannerTask, b: PlannerTask) {
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  const aTime = a.start_minute ?? -1;
  const bTime = b.start_minute ?? -1;
  if (aTime !== bTime) return aTime - bTime;
  if (a.position !== b.position) return a.position - b.position;
  return a.created_at.localeCompare(b.created_at);
}
