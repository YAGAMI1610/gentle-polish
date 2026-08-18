import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadActivityViews } from "@/lib/api/loaders";

/** GET /api/activity — merged AI-decision + on-chain-transaction feed for the wallet. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadActivityViews(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
