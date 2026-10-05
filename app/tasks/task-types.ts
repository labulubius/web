export type TaskProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalTask = {
  id: string;
  title: string;
  notes: string;
  projectId: string | null;
  date: string | null;
  startMinute: number | null;
  durationMinutes: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskData = {
  version: 1;
  tasks: PersonalTask[];
  projects: TaskProject[];
};

export type TaskDraft = Pick<PersonalTask, "title" | "notes" | "projectId" | "date" | "startMinute" | "durationMinutes">;
