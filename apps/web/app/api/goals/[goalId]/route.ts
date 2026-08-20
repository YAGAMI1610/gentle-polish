import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { loadGoalView } from "@/lib/api/loaders";
import { getGoal } from "@/lib/db";

/**
 * GET /api/goals/[goalId] — one goal this wallet owns.
 *
 * A goal that does not exist AND a goal owned by another wallet both resolve to
 * null (the repository is wallet-scoped), so both answer 404: a caller can never
 * tell "not yours" from "does not exist" (non-leak, §13).
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ goalId: string }> }) {
  try {
    const wallet = await requireWallet();
    const { goalId } = await ctx.params;
    const goal = await getGoal(wallet, goalId);
    if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(await loadGoalView(wallet, goal));
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
