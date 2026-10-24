import { requireNavigationAdmin } from "./auth";
import { InvalidNavigationOrder, loadNavigationOrder, navigationPrivateHeaders, saveNavigationOrder } from "./storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const unavailable = () => Response.json({ error: "Task navigation preferences are temporarily unavailable." }, { status: 503, headers: navigationPrivateHeaders });

async function requestBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new InvalidNavigationOrder("Request too large.");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new InvalidNavigationOrder("Request too large.");
  try { return JSON.parse(raw) as unknown; }
  catch { throw new InvalidNavigationOrder("Invalid JSON."); }
}

export async function GET(request: Request) {
  try {
    const auth = await requireNavigationAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: navigationPrivateHeaders });
    return Response.json({ order: await loadNavigationOrder(auth.user.id) }, { headers: navigationPrivateHeaders });
  } catch {
    console.error("Task navigation preference read failed (details withheld).");
    return unavailable();
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireNavigationAdmin(request);
    if (!auth) return Response.json({ error: "Unauthorized." }, { status: 401, headers: navigationPrivateHeaders });
    const body = await requestBody(request);
    const order = body && typeof body === "object" && !Array.isArray(body) ? (body as { order?: unknown }).order : undefined;
    return Response.json({ order: await saveNavigationOrder(auth.user.id, order) }, { headers: navigationPrivateHeaders });
  } catch (error) {
    if (error instanceof InvalidNavigationOrder) {
      return Response.json({ error: error.message }, { status: error.message === "Request too large." ? 413 : 400, headers: navigationPrivateHeaders });
    }
    console.error("Task navigation preference update failed (details withheld).");
    return unavailable();
  }
}
