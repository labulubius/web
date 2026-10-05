import type { PersonalTask } from "./task-types";

export const SLOT_MINUTES = 30;
export const SLOT_HEIGHT = 28;
export const DAY_MINUTES = 24 * 60;

export function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(value: string, days: number) {
  const date = fromLocalDate(value);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function mondayOf(value = new Date()) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return localDate(date);
}

export function timeLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function shortDate(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(fromLocalDate(value));
}

export function longDate(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(fromLocalDate(value));
}

export type PositionedTask = { task: PersonalTask; lane: number; lanes: number };

export function positionOverlaps(tasks: PersonalTask[]): PositionedTask[] {
  const sorted = [...tasks].sort((a, b) => (a.startMinute ?? 0) - (b.startMinute ?? 0) || b.durationMinutes - a.durationMinutes);
  const laneEnds: number[] = [];
  const positioned = sorted.map((task) => {
    const start = task.startMinute ?? 0;
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = start + task.durationMinutes;
    return { task, lane, lanes: 1 };
  });
  const lanes = Math.max(1, laneEnds.length);
  return positioned.map((item) => ({ ...item, lanes }));
}
