"use client";

import { X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import type { PersonalTask, TaskDraft, TaskProject } from "./task-types";

export type TaskDialogValue = { task?: PersonalTask; defaults?: Partial<TaskDraft> };

export function TaskDialog({ value, projects, busy, onClose, onSave }: {
  value: TaskDialogValue;
  projects: TaskProject[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TaskDraft) => Promise<void>;
}) {
  const task = value.task;
  const initial = useMemo<TaskDraft>(() => ({
    title: task?.title ?? value.defaults?.title ?? "",
    projectId: task?.projectId ?? value.defaults?.projectId ?? null,
    startDate: task?.startDate ?? value.defaults?.startDate ?? null,
    endDate: task?.endDate ?? value.defaults?.endDate ?? null,
  }), [task, value.defaults]);
  const [selectedProject, setSelectedProject] = useState(initial.projectId ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const projectId = String(form.get("projectId") ?? "") || null;
    const enteredStart = projectId ? String(form.get("startDate") ?? "") || null : null;
    const enteredEnd = projectId ? String(form.get("endDate") ?? "") || null : null;
    const startDate = enteredStart ?? enteredEnd;
    const endDate = enteredEnd ?? enteredStart;
    await onSave({ title: String(form.get("title") ?? ""), projectId, startDate, endDate });
  }

  return <AccessibleDialog labelledBy="task-dialog-title" busy={busy} onClose={onClose} className="task-dialog">
    <header><h2 id="task-dialog-title">{task ? "Task details" : "New task"}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="task-form-primary">
        <label>Title<input name="title" defaultValue={initial.title} maxLength={200} required autoFocus /></label>
        <label>Project<select name="projectId" value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}><option value="">Uncategorized</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      </div>
      {selectedProject && <div className="task-form-row">
        <label>Start date<input name="startDate" type="date" defaultValue={initial.startDate ?? ""} /></label>
        <label>End date<input name="endDate" type="date" defaultValue={initial.endDate ?? ""} /></label>
      </div>}
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
