"use client";

import { CSS } from "@dnd-kit/utilities";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Check, Clock3, GripVertical, Inbox } from "lucide-react";
import { CSSProperties, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { addDays, DAY_MINUTES, fromLocalDate, localDate, longDate, positionOverlaps, shortDate, SLOT_HEIGHT, timeLabel } from "./task-calendar";
import type { PersonalTask } from "./task-types";
import type { TaskDialogValue } from "./task-dialogs";

function DraggableTask({ task, children, className, style, title, onOpen, onComplete, after }: {
  task: PersonalTask;
  children: React.ReactNode;
  className: string;
  style?: CSSProperties;
  title: string;
  onOpen: () => void;
  onComplete: () => void;
  after?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: `task:${task.id}` });
  return <div ref={setNodeRef} className={`${className}${isDragging ? " is-dragging" : ""}`} style={{ ...style, transform: CSS.Translate.toString(transform) }}>
    <button ref={setActivatorNodeRef} className="task-card-drag" type="button" onClick={onOpen} title={title} {...listeners} {...attributes}><GripVertical size={12} aria-hidden="true" />{children}</button>
    {after}
    <button className="task-card-complete" type="button" aria-label={`Complete ${task.title}`} title="Complete task" onClick={(event) => { event.stopPropagation(); onComplete(); }}><Check size={12} /></button>
  </div>;
}

function DropSlot({ date, minute, onCreate }: { date: string; minute: number; onCreate: () => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `slot:${date}:${minute}` });
  return <button ref={setNodeRef} className={`task-time-slot${isOver ? " is-over" : ""}`} type="button" aria-label={`Create task ${longDate(date)} at ${timeLabel(minute)}`} onClick={onCreate} />;
}

function AllDayCell({ date, tasks, onOpen, onCreate, onComplete }: {
  date: string;
  tasks: PersonalTask[];
  onOpen: (value: TaskDialogValue) => void;
  onCreate: () => void;
  onComplete: (task: PersonalTask) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `slot:${date}:all` });
  return <div ref={setNodeRef} className={`task-all-day-cell${isOver ? " is-over" : ""}`}>
    <button className="task-all-day-add" type="button" onClick={onCreate} aria-label={`Create task on ${longDate(date)}`}>＋</button>
    {tasks.map((task) => <DraggableTask key={task.id} task={task} className="task-all-day-card" title={`${task.title}, ${longDate(date)}`} onOpen={() => onOpen({ task })} onComplete={() => onComplete(task)}><span>{task.title}</span></DraggableTask>)}
  </div>;
}

function CalendarTask({ task, lane, lanes, onOpen, onComplete, onResize }: {
  task: PersonalTask;
  lane: number;
  lanes: number;
  onOpen: () => void;
  onComplete: () => void;
  onResize: (minutes: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const duration = preview ?? task.durationMinutes;
  const start = task.startMinute ?? 0;
  const style: CSSProperties = {
    top: `${start / 30 * SLOT_HEIGHT + 1}px`,
    height: `${Math.max(25, duration / 30 * SLOT_HEIGHT - 2)}px`,
    left: `calc(${lane / lanes * 100}% + 2px)`,
    width: `calc(${100 / lanes}% - 4px)`,
  };

  function resizeStart(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const origin = event.clientY;
    const initial = task.durationMinutes;
    target.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => {
      const slots = Math.round((next.clientY - origin) / SLOT_HEIGHT);
      const maximum = DAY_MINUTES - start;
      setPreview(Math.max(30, Math.min(maximum, initial + slots * 30)));
    };
    const finish = (next: globalThis.PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      const slots = Math.round((next.clientY - origin) / SLOT_HEIGHT);
      const result = Math.max(30, Math.min(DAY_MINUTES - start, initial + slots * 30));
      setPreview(null);
      if (result !== initial) onResize(result);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }

  return <DraggableTask task={task} className="task-calendar-card" style={style} title={`${task.title}, ${timeLabel(start)} for ${duration} minutes`} onOpen={onOpen} onComplete={onComplete}
    after={<button className="task-resize-handle" type="button" aria-label={`Resize ${task.title}`} title="Drag to change duration" onPointerDown={resizeStart} />}>
    <strong>{task.title}</strong><small>{timeLabel(start)}–{timeLabel(start + duration)}</small>
  </DraggableTask>;
}

function InboxTray({ tasks, onOpen, onComplete }: { tasks: PersonalTask[]; onOpen: (value: TaskDialogValue) => void; onComplete: (task: PersonalTask) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: "inbox" });
  return <section className={`task-inbox-tray${isOver ? " is-over" : ""}`} aria-labelledby="week-inbox-title">
    <div className="task-inbox-tray-title"><Inbox size={15} /><strong id="week-inbox-title">Inbox</strong><span>{tasks.length} unscheduled</span></div>
    <div ref={setNodeRef} className="task-inbox-tray-list">
      {tasks.length === 0 ? <span className="task-inbox-tray-empty">No unscheduled tasks.</span> : tasks.map((task) => <DraggableTask key={task.id} task={task} className="task-inbox-chip" title={`${task.title}, unscheduled`} onOpen={() => onOpen({ task })} onComplete={() => onComplete(task)}><span>{task.title}</span></DraggableTask>)}
    </div>
  </section>;
}

export function WeekView({ weekStart, tasks, onOpen, onComplete, onResize }: {
  weekStart: string;
  tasks: PersonalTask[];
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
  onResize: (task: PersonalTask, durationMinutes: number) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const inbox = tasks.filter((task) => !task.completedAt && !task.date);
  const scroll = useRef<HTMLDivElement>(null);
  const today = localDate();
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const thisWeek = today >= weekStart && today <= days[6];

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const target = thisWeek ? nowMinute / 30 * SLOT_HEIGHT - element.clientHeight / 3 : 8 * 2 * SLOT_HEIGHT;
    element.scrollTop = Math.max(0, target);
  }, [weekStart, thisWeek, nowMinute]);

  return <div className="task-week-view">
    <InboxTray tasks={inbox} onOpen={onOpen} onComplete={onComplete} />
    <div ref={scroll} className="task-week-scroll" tabIndex={0} aria-label={`Week of ${longDate(weekStart)}`}>
      <div className="task-week-grid">
        <div className="task-week-corner" />
        {days.map((date) => <div key={date} className={`task-day-heading${date === today ? " is-today" : ""}`}><span>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(fromLocalDate(date))}</span><strong>{shortDate(date)}</strong></div>)}
        <div className="task-all-day-label">All day</div>
        {days.map((date) => <AllDayCell key={date} date={date} tasks={tasks.filter((task) => !task.completedAt && task.date === date && task.startMinute === null)} onOpen={onOpen} onComplete={onComplete} onCreate={() => onOpen({ defaults: { date } })} />)}
        <div className="task-time-axis">{Array.from({ length: 48 }, (_, index) => <span key={index} style={{ top: index * SLOT_HEIGHT }}>{timeLabel(index * 30)}</span>)}</div>
        {days.map((date) => {
          const timed = tasks.filter((task) => !task.completedAt && task.date === date && task.startMinute !== null);
          return <div key={date} className={`task-day-column${date === today ? " is-today" : ""}`}>
            {Array.from({ length: 48 }, (_, index) => <DropSlot key={index} date={date} minute={index * 30} onCreate={() => onOpen({ defaults: { date, startMinute: index * 30, durationMinutes: 30 } })} />)}
            {positionOverlaps(timed).map(({ task, lane, lanes }) => <CalendarTask key={task.id} task={task} lane={lane} lanes={lanes} onOpen={() => onOpen({ task })} onComplete={() => onComplete(task)} onResize={(duration) => onResize(task, duration)} />)}
            {date === today && thisWeek && <span className="task-now-line" style={{ top: nowMinute / 30 * SLOT_HEIGHT }} aria-hidden="true" />}
          </div>;
        })}
      </div>
    </div>
    <p className="task-week-hint"><Clock3 size={13} /> Drag Inbox tasks into the week. Drag the bottom edge of a scheduled task to change its duration.</p>
  </div>;
}
