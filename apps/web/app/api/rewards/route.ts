import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadRewardViews } from "@/lib/api/loaders";

/** GET /api/rewards — reward legs of the wallet's commitments (build step 9, phase 2). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadRewardViews(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err, "api/rewards");
    return NextResponse.json(body, { status });
  }
}
