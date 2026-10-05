import type { TaskProject } from "./task-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function reorderTaskProjects(projects: TaskProject[], value: unknown) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(value).size !== value.length) {
    throw new Error("Invalid project order.");
  }
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  if (value.length !== projects.length || value.some((id) => !projectsById.has(id))) throw new Error("Invalid project order.");
  return value.map((id) => projectsById.get(id)!);
}
