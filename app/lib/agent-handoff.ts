export type PdfInputSource = "drive" | "share";

export function pdfToEpubHandoff(
  source: PdfInputSource,
  remote: string,
  originalName: string,
  size: number,
): string {
  if (!remote || !originalName || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Invalid PDF handoff");
  }
  const reference = { version: 1, source, remote, originalName, size };
  return `/skill:pdf-to-epub\n<pi-file-reference>${JSON.stringify(reference)}</pi-file-reference>`;
}

export function agentHandoffPath(prompt: string): string {
  return `/agent?handoff=${encodeURIComponent(prompt)}`;
}
