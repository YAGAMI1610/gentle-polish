import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
import { createCheckIn } from "@/lib/db";
import type { CreateCheckInInput } from "@/lib/db";
import type { CheckInResult } from "@/lib/api/dto";

/**
 * POST /api/checkins — record a progress check-in for a goal this wallet owns
 * (build step 9, phase 3). `createCheckIn` validates the body (`createCheckInInput`)
 * and enforces ownership (throws `WalletScopeError` → 403 cross-wallet). The
 * check-in `message` is untrusted content (rule 5): it is stored, and only ever
 * reaches the model through the `promptGuards` trust boundary, never as instructions.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    // Repo re-parses via `createCheckInInput`; a bad shape throws ZodError → 400.
    const checkIn = await createCheckIn(wallet, (await readJsonBody(req)) as CreateCheckInInput);
    const body: CheckInResult = {
      id: checkIn.id,
      goalId: checkIn.goalId,
      message: checkIn.message,
      milestoneId: checkIn.milestoneId ?? null,
      createdAt: checkIn.createdAt.toISOString(),
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err, "api/checkins");
    return NextResponse.json(body, { status });
  }
}
