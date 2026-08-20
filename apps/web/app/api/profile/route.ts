import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadWalletProfileView } from "@/lib/api/loaders";

/** GET /api/profile — the wallet's accountability profile (live-computed, §10). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadWalletProfileView(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
