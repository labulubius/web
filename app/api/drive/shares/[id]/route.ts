import { revokeDriveShare } from "../../../../lib/drive-shares";
import { driveError, drivePreflight, privateHeaders, requireDriveAdmin, withDriveCors } from "../../../../lib/drive-server";

export const runtime = "nodejs";
export function OPTIONS(request: Request) { return drivePreflight(request); }

export async function DELETE(request: Request, context: RouteContext<"/api/drive/shares/[id]">) {
  return withDriveCors(request, async () => {
    try {
      if (!await requireDriveAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
      const { id } = await context.params;
      return Response.json({ ok: await revokeDriveShare(id) }, { headers: privateHeaders });
    } catch (error) { return driveError(error); }
  });
}
