import { NextResponse } from "next/server";
import { generateNonce } from "siwe";
import { getSession } from "@/lib/auth/session";

/** Issue a one-time SIWE nonce and bind it to the session (build step 9). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    const nonce = generateNonce();
    session.nonce = nonce;
    await session.save();
    return new NextResponse(nonce, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // A sign-in nonce is per-session and single-use — never let a shared/proxy
        // cache store or replay it. (The live deploy previously sent `public, max-age=0`.)
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Common cause: a missing/short SESSION_PASSWORD makes getSessionOptions() throw,
    // so iron-session can't seal the cookie and no nonce can be issued. Without this
    // catch the throw becomes an unhandled 500 and RainbowKit shows only its generic
    // "Error preparing message, please retry!". Log the real reason server-side; return
    // a clean JSON 500 that never leaks the SESSION_PASSWORD hint to the client.
    console.error("[auth/nonce] failed to issue sign-in nonce:", err);
    return NextResponse.json(
      { error: "could not start sign-in — please try again" },
      { status: 500 },
    );
  }
}
