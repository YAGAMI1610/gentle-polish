import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/auth/origin";

/**
 * App-wide same-origin net for the API surface (build step 9). This is the outer
 * layer of a two-layer CSRF defence: every state-changing /api request must carry
 * a same-origin (or allowlisted) Origin header. Each write handler re-checks via
 * `assertSameOrigin` so the guarantee holds even if a route is reached another way.
 */
export function middleware(req: NextRequest) {
  const ok = isSameOrigin({
    method: req.method,
    url: req.url,
    origin: req.headers.get("origin"),
  });
  if (!ok) {
    return NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
