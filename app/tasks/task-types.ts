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
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskData = {
  version: 2;
  tasks: PersonalTask[];
  projects: TaskProject[];
};

export type TaskDraft = Pick<PersonalTask, "title" | "notes" | "projectId" | "startDate" | "endDate">;
