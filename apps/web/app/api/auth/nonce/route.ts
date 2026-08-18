import { NextResponse } from "next/server";
import { generateNonce } from "siwe";
import { getSession } from "@/lib/auth/session";

/** Issue a one-time SIWE nonce and bind it to the session (build step 9). */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const nonce = generateNonce();
  session.nonce = nonce;
  await session.save();
  return new NextResponse(nonce, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
