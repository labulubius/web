import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  const isNavHost = hostname === "nav.labulubius.com" || hostname === "nav.localhost";

  if (isNavHost && !request.nextUrl.pathname.startsWith("/nav")) {
    const url = request.nextUrl.clone();
    url.pathname = `/nav${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
