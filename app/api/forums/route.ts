import { InvalidForumInput, loadForumDirectory, manageForums } from "../../lib/forums-directory";
import { newsAdmin, privateNewsHeaders } from "../../lib/news-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function relay(request: Request) {
  const response = await fetch("https://drive.labulubius.com/api/forums", {
    method: request.method,
    headers: {
      ...(request.headers.get("authorization") ? { Authorization: request.headers.get("authorization")! } : {}),
      ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(request.method === "POST" ? { body: await request.text() } : {}),
    cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  return new Response(response.body, { status: response.status, headers: { ...privateNewsHeaders, "Content-Type": "application/json" } });
}

export async function GET(request: Request) {
  try {
    return process.env.VERCEL ? await relay(request) : Response.json(await loadForumDirectory(), { headers: privateNewsHeaders });
  } catch {
    return Response.json({ error: "Forum sources unavailable." }, { status: 503, headers: privateNewsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    if (process.env.VERCEL) return await relay(request);
    if (!await newsAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: privateNewsHeaders });
    const raw = await request.text();
    if (raw.length > 5000) return Response.json({ error: "Request too large." }, { status: 413, headers: privateNewsHeaders });
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: privateNewsHeaders }); }
    return Response.json(await manageForums(data), { headers: privateNewsHeaders });
  } catch (error) {
    if (error instanceof InvalidForumInput) return Response.json({ error: error.message }, { status: 400, headers: privateNewsHeaders });
    console.error("Forum management failed (details withheld).", error);
    return Response.json({ error: "Could not update forums." }, { status: 503, headers: privateNewsHeaders });
  }
}
