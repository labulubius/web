"use client";

import { CSS } from "@dnd-kit/utilities";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Check, GripVertical, Inbox } from "lucide-react";
import { CSSProperties, PointerEvent, useMemo, useState } from "react";
import { addDays, daysBetween, fromLocalDate, localDate, longDate, monthDates, shortDate } from "./task-calendar";
import type { PersonalTask, TaskProject } from "./task-types";
import type { TaskDialogValue } from "./task-dialogs";

function DraggableInboxTask({ task, onOpen, onComplete }: { task: PersonalTask; onOpen: () => void; onComplete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: `task:${task.id}` });
  return <div ref={setNodeRef} className={`task-inbox-chip${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Translate.toString(transform) }}>
    <button ref={setActivatorNodeRef} className="task-card-drag" type="button" onClick={onOpen} title={`${task.title}, unscheduled`} {...listeners} {...attributes}><GripVertical size={12} aria-hidden="true" /><span>{task.title}</span></button>
    <button className="task-card-complete" type="button" aria-label={`Complete ${task.title}`} title="Complete and remove task" onClick={onComplete}><Check size={12} /></button>
  </div>;
}

function InboxTray({ tasks, onOpen, onComplete }: { tasks: PersonalTask[]; onOpen: (value: TaskDialogValue) => void; onComplete: (task: PersonalTask) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: "inbox" });
  return <section className={`task-inbox-tray${isOver ? " is-over" : ""}`} aria-labelledby="gantt-inbox-title">
    <div className="task-inbox-tray-title"><Inbox size={15} /><strong id="gantt-inbox-title">Inbox</strong><span>{tasks.length} unscheduled</span></div>
    <div ref={setNodeRef} className="task-inbox-tray-list">
      {tasks.length === 0 ? <span className="task-inbox-tray-empty">No unscheduled tasks.</span> : tasks.map((task) => <DraggableInboxTask key={task.id} task={task} onOpen={() => onOpen({ task })} onComplete={() => onComplete(task)} />)}
    </div>
  </section>;
}

function DayCell({ rowId, date, today, onCreate }: { rowId: string; date: string; today: string; onCreate: () => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `gantt:${rowId}:${date}` });
  const weekend = [0, 6].includes(fromLocalDate(date).getDay());
  return <button ref={setNodeRef} type="button" className={`gantt-day-cell${date === today ? " is-today" : ""}${weekend ? " is-weekend" : ""}${isOver ? " is-over" : ""}`} aria-label={`Create task on ${longDate(date)}`} onClick={onCreate} />;
}

function GanttBar({ task, dates, projects, onOpen, onComplete, onResize }: {
  task: PersonalTask;
  dates: string[];
  projects: TaskProject[];
  onOpen: () => void;
  onComplete: () => void;
  onResize: (startDate: string, endDate: string) => void;
}) {
  const [preview, setPreview] = useState<{ startDate: string; endDate: string } | null>(null);
  const range = preview ?? { startDate: task.startDate!, endDate: task.endDate! };
  const visibleStart = range.startDate < dates[0] ? dates[0] : range.startDate;
  const visibleEnd = range.endDate > dates.at(-1)! ? dates.at(-1)! : range.endDate;
  const startIndex = daysBetween(dates[0], visibleStart);
  const span = Math.max(1, daysBetween(visibleStart, visibleEnd) + 1);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: `task:${task.id}` });
  const project = projects.find((item) => item.id === task.projectId)?.name;

  function resizeStart(event: PointerEvent<HTMLButtonElement>, edge: "start" | "end") {
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget;
    const row = handle.closest<HTMLElement>(".gantt-row");
    const label = row?.querySelector<HTMLElement>(".gantt-task-label");
    if (!row || !label) return;
    const dayWidth = (row.getBoundingClientRect().width - label.getBoundingClientRect().width) / dates.length;
    const origin = event.clientX;
    const originalStart = task.startDate!;
    const originalEnd = task.endDate!;
    handle.setPointerCapture(event.pointerId);
    const value = (clientX: number) => {
      const delta = Math.round((clientX - origin) / dayWidth);
      if (edge === "start") {
        const startDate = addDays(originalStart, delta);
        return { startDate: startDate > originalEnd ? originalEnd : startDate, endDate: originalEnd };
      }
      const endDate = addDays(originalEnd, delta);
      return { startDate: originalStart, endDate: endDate < originalStart ? originalStart : endDate };
    };
    const move = (next: globalThis.PointerEvent) => setPreview(value(next.clientX));
    const finish = (next: globalThis.PointerEvent) => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", finish); handle.removeEventListener("pointercancel", finish);
      const result = value(next.clientX); setPreview(null);
      if (result.startDate !== originalStart || result.endDate !== originalEnd) onResize(result.startDate, result.endDate);
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", finish); handle.addEventListener("pointercancel", finish);
  }

  return <div ref={setNodeRef} className={`gantt-bar${isDragging ? " is-dragging" : ""}`} style={{ gridColumn: `${startIndex + 2} / span ${span}`, transform: CSS.Translate.toString(transform) }}>
    {range.startDate >= dates[0] && <button className="gantt-resize gantt-resize-start" type="button" aria-label={`Change start date for ${task.title}`} title="Drag to change start date" onPointerDown={(event) => resizeStart(event, "start")} />}
    <button ref={setActivatorNodeRef} className="gantt-bar-main" type="button" onClick={onOpen} title={`${task.title}, ${shortDate(range.startDate)} to ${shortDate(range.endDate)}`} {...listeners} {...attributes}><GripVertical size={12} aria-hidden="true" /><span>{task.title}{project ? <small>{project}</small> : null}</span></button>
    <button className="task-card-complete" type="button" aria-label={`Complete ${task.title}`} title="Complete and remove task" onClick={(event) => { event.stopPropagation(); onComplete(); }}><Check size={12} /></button>
    {range.endDate <= dates.at(-1)! && <button className="gantt-resize gantt-resize-end" type="button" aria-label={`Change end date for ${task.title}`} title="Drag to change end date" onPointerDown={(event) => resizeStart(event, "end")} />}
  </div>;
}

export function GanttView({ timelineStart, tasks, projects, onOpen, onComplete, onResize }: {
  timelineStart: string;
  tasks: PersonalTask[];
  projects: TaskProject[];
  onOpen: (value: TaskDialogValue) => void;
  onComplete: (task: PersonalTask) => void;
  onResize: (task: PersonalTask, startDate: string, endDate: string) => void;
}) {
  const dates = useMemo(() => monthDates(timelineStart), [timelineStart]);
  const today = localDate();
  const inbox = tasks.filter((task) => !task.startDate);
  const scheduled = tasks.filter((task) => task.startDate && task.endDate && task.startDate <= dates.at(-1)! && task.endDate >= dates[0]).sort((a, b) => a.startDate!.localeCompare(b.startDate!) || a.title.localeCompare(b.title));
  const minWidth = 190 + dates.length * 34;
  const gridStyle = { "--gantt-days": dates.length, minWidth: `${minWidth}px` } as CSSProperties;

  return <div className="task-gantt-view">
    <InboxTray tasks={inbox} onOpen={onOpen} onComplete={onComplete} />
    <div className="gantt-scroll" tabIndex={0} aria-label={`Gantt chart for ${timelineStart.slice(0, 7)}`}>
      <div className="gantt-grid" style={gridStyle}>
        <div className="gantt-header-row">
          <div className="gantt-task-heading">Task</div>
          {dates.map((date) => <div key={date} className={`gantt-day-heading${date === today ? " is-today" : ""}${[0, 6].includes(fromLocalDate(date).getDay()) ? " is-weekend" : ""}`}><span>{new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(fromLocalDate(date))}</span><strong>{fromLocalDate(date).getDate()}</strong></div>)}
        </div>
        {scheduled.length === 0 ? <div className="gantt-row gantt-empty-row"><div className="gantt-task-label"><span>No tasks this month</span></div>{dates.map((date) => <DayCell key={date} rowId="empty" date={date} today={today} onCreate={() => onOpen({ defaults: { startDate: date, endDate: date } })} />)}</div> : scheduled.map((task) => <div className="gantt-row" key={task.id}>
          <button type="button" className="gantt-task-label" onClick={() => onOpen({ task })}><strong title={task.title}>{task.title}</strong><span>{shortDate(task.startDate!)} – {shortDate(task.endDate!)}</span></button>
          {dates.map((date) => <DayCell key={date} rowId={task.id} date={date} today={today} onCreate={() => onOpen({ defaults: { startDate: date, endDate: date } })} />)}
          <GanttBar task={task} dates={dates} projects={projects} onOpen={() => onOpen({ task })} onComplete={() => onComplete(task)} onResize={(startDate, endDate) => onResize(task, startDate, endDate)} />
        </div>)}
      </div>
    </div>
    <p className="task-gantt-hint">Drag Inbox tasks onto a date. Drag a bar to move it, or drag either edge to change its date range.</p>
  </div>;
}
