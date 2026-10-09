"use client";

import { X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import type { PersonalTask, TaskDraft, TaskProject } from "./task-types";

export type TaskDialogValue = { task?: PersonalTask; defaults?: Partial<TaskDraft> };

export function TaskDialog({ value, projects, busy, error, onClose, onSave }: {
  value: TaskDialogValue;
  error?: string;
  projects: TaskProject[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TaskDraft) => Promise<void>;
}) {
  const titleInput = useRef<HTMLInputElement>(null);
  // Let AccessibleDialog capture the trigger before moving focus into the form.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => titleInput.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const task = value.task;
  const initial = useMemo<TaskDraft>(() => ({
    title: task?.title ?? value.defaults?.title ?? "",
    description: task?.description ?? value.defaults?.description ?? "",
    projectId: task?.projectId ?? value.defaults?.projectId ?? null,
    startDate: task?.startDate ?? value.defaults?.startDate ?? null,
    endDate: task?.endDate ?? value.defaults?.endDate ?? null,
  }), [task, value.defaults]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const projectId = String(form.get("projectId") ?? "") || null;
    const enteredStart = String(form.get("startDate") ?? "") || null;
    const enteredEnd = String(form.get("endDate") ?? "") || null;
    const startDate = enteredStart ?? enteredEnd;
    const endDate = enteredEnd ?? enteredStart;
    await onSave({ title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""), projectId, startDate, endDate });
  }

  return <AccessibleDialog labelledBy="task-dialog-title" busy={busy} onClose={onClose} className="task-dialog">
    <header><h2 id="task-dialog-title">{task ? "Task details" : "New task"}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="task-form-primary">
        <label>Title<input ref={titleInput} name="title" defaultValue={initial.title} maxLength={200} required /></label>
        <label>Project<select name="projectId" defaultValue={initial.projectId ?? ""}><option value="">Uncategorized</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      </div>
      <label>Description<textarea name="description" maxLength={300} rows={3} defaultValue={initial.description} /></label>
      <div className="task-form-row">
        <label>Start date<input name="startDate" type="date" defaultValue={initial.startDate ?? ""} /></label>
        <label>End date<input name="endDate" type="date" defaultValue={initial.endDate ?? ""} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="task-dialog-footer">
        <span className="task-dialog-spacer" />
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </footer>
    </form>
  </AccessibleDialog>;
}

export function ProjectDialog({ project, busy, onClose, onSave }: {
  project?: TaskProject;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(String(new FormData(event.currentTarget).get("name") ?? ""));
  }
  return <AccessibleDialog labelledBy="project-dialog-title" busy={busy} onClose={onClose}>
    <header><h2 id="project-dialog-title">{project ? "Edit project" : "New project"}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <form onSubmit={(event) => void submit(event)}>
      <label>Project name<input name="name" defaultValue={project?.name ?? ""} maxLength={80} required autoFocus /></label>
      <footer><span className="task-dialog-spacer" /><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></footer>
    </form>
  </AccessibleDialog>;
}
