import { createProject, reorderProjects, requireTasksAdmin, taskPrivateHeaders, taskRequestBody, tasksError } from "../../../lib/tasks-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!await requireTasksAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: taskPrivateHeaders });
    return Response.json({ data: await createProject(await taskRequestBody(request)) }, { status: 201, headers: taskPrivateHeaders });
  } catch (error) { return tasksError(error); }
}

export async function PATCH(request: Request) {
  try {
    if (!await requireTasksAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: taskPrivateHeaders });
    return Response.json({ data: await reorderProjects(await taskRequestBody(request)) }, { headers: taskPrivateHeaders });
  } catch (error) { return tasksError(error); }
}
