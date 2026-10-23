export const TASK_ARCHIVE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const TASK_ARCHIVE_PROJECT_NAME = "Archive";

export type TaskProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalTask = {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  startDate: string | null;
  endDate: string | null;
  isImportant: boolean;
  importantSortOrder: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskData = {
  version: 6;
  tasks: PersonalTask[];
  projects: TaskProject[];
};

export type TaskDraft = Pick<PersonalTask, "title" | "description" | "projectId" | "startDate" | "endDate">;

export function isArchiveProject(project: TaskProject) {
  return project.id === TASK_ARCHIVE_PROJECT_ID;
}

export function isArchivedTask(task: PersonalTask) {
  return task.projectId === TASK_ARCHIVE_PROJECT_ID;
}
