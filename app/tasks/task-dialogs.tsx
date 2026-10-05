"use client";

import { Trash2, X } from "lucide-react";
import { FormEvent, useMemo } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import { timeLabel } from "./task-calendar";
import type { PersonalTask, TaskDraft, TaskProject } from "./task-types";

export type TaskDialogValue = {
  task?: PersonalTask;
  defaults?: Partial<TaskDraft>;
};

export function TaskDialog({ value, projects, busy, onClose, onSave, onComplete, onDelete }: {
  value: TaskDialogValue;
  projects: TaskProject[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TaskDraft) => Promise<void>;
  onComplete: (task: PersonalTask, completed: boolean) => Promise<void>;
  onDelete: (task: PersonalTask) => Promise<void>;
}) {
  const task = value.task;
  const initial = useMemo<TaskDraft>(() => ({
    title: task?.title ?? value.defaults?.title ?? "",
    notes: task?.notes ?? value.defaults?.notes ?? "",
    projectId: task?.projectId ?? value.defaults?.projectId ?? null,
    date: task?.date ?? value.defaults?.date ?? null,
    startMinute: task?.startMinute ?? value.defaults?.startMinute ?? null,
    durationMinutes: task?.durationMinutes ?? value.defaults?.durationMinutes ?? 30,
  }), [task, value.defaults]);
  const times = Array.from({ length: 48 }, (_, index) => index * 30);
  const durations = Array.from({ length: 48 }, (_, index) => (index + 1) * 30);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "") || null;
    const time = String(form.get("startMinute") ?? "");
    const startMinute = date && time ? Number(time) : null;
    const requestedDuration = Number(form.get("durationMinutes") ?? 30);
    await onSave({
      title: String(form.get("title") ?? ""),
      notes: String(form.get("notes") ?? ""),
      projectId: String(form.get("projectId") ?? "") || null,
      date,
      startMinute,
      durationMinutes: startMinute === null ? requestedDuration : Math.min(requestedDuration, 1440 - startMinute),
    });
  }

  return <AccessibleDialog labelledBy="task-dialog-title" busy={busy} onClose={onClose} className="task-dialog">
    <header><h2 id="task-dialog-title">{task ? "Task details" : "New task"}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <form onSubmit={(event) => void submit(event)}>
      <label>Title<input name="title" defaultValue={initial.title} maxLength={200} required autoFocus /></label>
      <label>Notes<textarea name="notes" defaultValue={initial.notes} maxLength={5000} rows={4} /></label>
      <div className="task-form-row">
        <label>Project<select name="projectId" defaultValue={initial.projectId ?? ""}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label>Date<input name="date" type="date" defaultValue={initial.date ?? ""} /></label>
      </div>
      <div className="task-form-row">
        <label>Start time<select name="startMinute" defaultValue={initial.startMinute ?? ""}><option value="">No specific time</option>{times.map((minute) => <option key={minute} value={minute}>{timeLabel(minute)}</option>)}</select></label>
        <label>Duration<select name="durationMinutes" defaultValue={initial.durationMinutes}>{durations.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)}${minutes % 60 ? ":30" : ""} hours`}</option>)}</select></label>
      </div>
      <footer className="task-dialog-footer">
        {task && <div className="task-dialog-secondary"><button className="task-danger" type="button" disabled={busy} onClick={() => void onDelete(task)}><Trash2 size={14} /> Delete</button><button type="button" disabled={busy} onClick={() => void onComplete(task, !task.completedAt)}>{task.completedAt ? "Restore" : "Complete"}</button></div>}
        <span className="task-dialog-spacer" />
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </footer>
    </form>
  </AccessibleDialog>;
}

export function ProjectDialog({ project, busy, onClose, onSave, onDelete }: {
  project?: TaskProject;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  onDelete: (project: TaskProject) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(String(new FormData(event.currentTarget).get("name") ?? ""));
  }
  return <AccessibleDialog labelledBy="project-dialog-title" busy={busy} onClose={onClose}>
    <header><h2 id="project-dialog-title">{project ? "Edit project" : "New project"}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <form onSubmit={(event) => void submit(event)}>
      <label>Project name<input name="name" defaultValue={project?.name ?? ""} maxLength={80} required autoFocus /></label>
      <footer>{project && <button className="task-danger" type="button" disabled={busy} onClick={() => void onDelete(project)}><Trash2 size={14} /> Delete</button>}<span className="task-dialog-spacer" /><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></footer>
    </form>
  </AccessibleDialog>;
}
