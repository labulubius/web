export type UploadApi = (path: string, init?: RequestInit) => Promise<Response>;
const CHUNK_BYTES = 8 * 1024 ** 2;

type Session = { id: string; offset: number; size: number };

// Persistent session IDs let a user select the same file after a refresh to resume.
export async function uploadInChunks(api: UploadApi, endpoint: string, file: File, context: string, onProgress: (sent: number) => void, folderId?: string | null) {
  if (file.size === 0) throw new Error("Empty files are not supported.");
  const key = `upload-v1:${endpoint}:${context}:${file.name}:${file.size}:${file.lastModified}`;
  const saved = window.localStorage.getItem(key);
  let session: Session | null = null;
  if (saved) {
    let previous: { id: string };
    try { previous = JSON.parse(saved) as { id: string }; }
    catch { window.localStorage.removeItem(key); previous = { id: "" }; }
    if (previous.id) {
      try {
        const response = await api(`${endpoint}?id=${encodeURIComponent(previous.id)}`);
        session = { id: previous.id, ...await response.json() as { offset: number; size: number } };
        if (session.size !== file.size || session.offset > file.size) throw new Error("Invalid upload session.");
      } catch (error) {
        if (!(error instanceof Error) || !/Upload session expired|Invalid upload session/.test(error.message)) throw error;
        window.localStorage.removeItem(key);
      }
    }
  }
  if (!session) {
    const response = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", name: file.name, size: file.size, ...(endpoint.includes("share") ? { folderId: folderId ?? null } : { path: context }) }) });
    session = await response.json() as Session;
    window.localStorage.setItem(key, JSON.stringify({ id: session.id }));
  }
  let sent = session.offset;
  onProgress(sent);
  while (sent < file.size) {
    let attempts = 0;
    while (true) {
      try {
        const response = await api(`${endpoint}?id=${encodeURIComponent(session.id)}&offset=${sent}`, {
          method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(sent, Math.min(sent + CHUNK_BYTES, file.size)),
        });
        const data = await response.json() as { offset: number };
        if (!Number.isSafeInteger(data.offset) || data.offset <= sent || data.offset > file.size) throw new Error("Invalid upload progress.");
        sent = data.offset;
        onProgress(sent);
        break;
      } catch (error) {
        if (++attempts > 3) throw error;
        const response = await api(`${endpoint}?id=${encodeURIComponent(session.id)}`);
        const data = await response.json() as { offset: number };
        if (!Number.isSafeInteger(data.offset) || data.offset < sent || data.offset > file.size) throw new Error("Invalid upload progress.");
        sent = data.offset;
        onProgress(sent);
        if (sent === file.size) break;
      }
    }
  }
  await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finish", id: session.id }) });
  window.localStorage.removeItem(key);
}
