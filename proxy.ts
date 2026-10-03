import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const isWwwHost = hostname === "www.labulubius.com";
  const isDriveHost = hostname === "drive.labulubius.com" || hostname === "drive.localhost";

  if (isWwwHost) {
    const url = new URL(request.nextUrl.pathname, "https://labulubius.com");
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 308);
  }

  if (isDriveHost && (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/drive")) {
    const url = new URL("https://labulubius.com/drive", request.url);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
