import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/** Report the currently authenticated wallet (or null) for the client session hook. */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ address: session.address ?? null });
}
