import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadAchievementViews } from "@/lib/api/loaders";

/** GET /api/achievements — achievements derived from the wallet's real counts. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadAchievementViews(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
