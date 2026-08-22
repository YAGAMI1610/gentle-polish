import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/origin";
import { toHttpError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";

/** Destroy the session cookie (build step 9). Same-origin only. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const session = await getSession();
    session.destroy();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = toHttpError(err, "api/auth/logout");
    return NextResponse.json(body, { status });
  }
}
