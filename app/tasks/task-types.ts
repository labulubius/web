export type TaskProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalTask = {
  id: string;
  title: string;
  projectId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskData = {
  version: 3;
  tasks: PersonalTask[];
  projects: TaskProject[];
};

export type TaskDraft = Pick<PersonalTask, "title" | "projectId" | "startDate" | "endDate">;
