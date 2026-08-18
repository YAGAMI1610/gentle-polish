import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadCommitmentViews } from "@/lib/api/loaders";

/** GET /api/commitments — the authenticated wallet's commitments (build step 9, phase 2). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadCommitmentViews(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
