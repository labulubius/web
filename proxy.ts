import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRetiredDriveRequest, retiredDriveResponse } from "./app/lib/retired-drive";

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const isWwwHost = hostname === "www.labulubius.com";

  // Retire every Drive method, including public links and stale upload clients.
  if (isRetiredDriveRequest(hostname, request.nextUrl.pathname)) {
    return retiredDriveResponse(request.method);
  }

  if (isWwwHost) {
    const url = new URL(request.nextUrl.pathname, "https://labulubius.com");
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
    { source: "/:path*", has: [{ type: "host", value: "drive.labulubius.com" }] },
    { source: "/:path*", has: [{ type: "host", value: "drive.localhost" }] },
  ],
};
