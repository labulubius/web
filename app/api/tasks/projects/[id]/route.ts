import { deleteProject, requireTasksAdmin, taskPrivateHeaders, taskRequestBody, tasksError, updateProject } from "../../../../lib/tasks-server";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    if (!await requireTasksAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: taskPrivateHeaders });
    const { id } = await context.params;
    return Response.json({ data: await updateProject(id, await taskRequestBody(request)) }, { headers: taskPrivateHeaders });
  } catch (error) { return tasksError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    if (!await requireTasksAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: taskPrivateHeaders });
    const { id } = await context.params;
    return Response.json({ data: await deleteProject(id) }, { headers: taskPrivateHeaders });
  } catch (error) { return tasksError(error); }
}
