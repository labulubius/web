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
  createdAt: string;
  updatedAt: string;
};

export type TaskData = {
  version: 4;
  tasks: PersonalTask[];
  projects: TaskProject[];
};

export type TaskDraft = Pick<PersonalTask, "title" | "description" | "projectId" | "startDate" | "endDate">;
