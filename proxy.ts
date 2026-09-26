import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const isNavHost = hostname === "nav.labulubius.com" || hostname === "nav.localhost";
  const isDriveHost = hostname === "drive.labulubius.com" || hostname === "drive.localhost";

  if (isDriveHost && (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/drive")) {
    const url = new URL("https://labulubius.com/drive", request.url);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 307);
  }

  if (isNavHost && !request.nextUrl.pathname.startsWith("/nav")) {
    const url = request.nextUrl.clone();
    url.pathname = `/nav${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icons/|favicon.ico|sitemap.xml|robots.txt).*)"],
};
