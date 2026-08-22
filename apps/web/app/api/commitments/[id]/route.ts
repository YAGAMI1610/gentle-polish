import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadCommitmentView } from "@/lib/api/loaders";
import { getCommitment } from "@/lib/db";

/**
 * GET /api/commitments/[id] — one commitment this wallet owns. Cross-wallet or
 * unknown id both resolve to null → 404 (non-leak, §13).
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const wallet = await requireWallet();
    const { id } = await ctx.params;
    const commitment = await getCommitment(wallet, id);
    if (!commitment) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(await loadCommitmentView(wallet, commitment));
  } catch (err) {
    const { status, body } = toHttpError(err, "api/commitments/[id]");
    return NextResponse.json(body, { status });
  }
}
