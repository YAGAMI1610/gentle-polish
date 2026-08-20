import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
import { loadGoalView, loadGoalViews } from "@/lib/api/loaders";
import { createGoal } from "@/lib/db";
import type { CreateGoalInput } from "@/lib/db";

/** GET /api/goals — the authenticated wallet's goals (build step 9, phase 2). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadGoalViews(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST /api/goals — create a goal for the authenticated wallet (build step 9,
 * phase 3). `createGoal` validates the body (`createGoalInput`) and stamps the
 * wallet, so a bad shape is a 400 and the goal can only ever be this wallet's.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    // Repo re-parses via `createGoalInput`; a bad shape throws ZodError → 400.
    const goal = await createGoal(wallet, (await readJsonBody(req)) as CreateGoalInput);
    return NextResponse.json(await loadGoalView(wallet, goal), { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
