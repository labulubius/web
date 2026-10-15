// Keep old page, API and capability URLs retired without touching any storage.
export function isRetiredDriveRequest(hostname: string, pathname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "drive.labulubius.com" || host === "drive.localhost" ||
    ["/drive", "/api/drive"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function retiredDriveResponse(method: string): Response {
  return new Response(method === "HEAD" ? null : "Drive has been retired.\n", {
    status: 410,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
