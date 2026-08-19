import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { ConnectorNotConnectedError, importGithubActivity } from "@/lib/connectors/import";
import { githubImportInput } from "@/lib/db/schemas";
import type { EvidenceResult } from "@/lib/api/dto";

/**
 * POST /api/connectors/github/import (LIMITATIONS item 8) — pull the wallet's
 * recent GitHub activity (using the stored, encrypted token) and record it as one
 * off-chain `Evidence(type: GITHUB)` row against the named goal. The client only
 * names the target (goalId / optional since); the evidence CONTENT comes from
 * GitHub, hashed and stored like any other evidence — never anchored on-chain
 * except as its sha256, never interpreted as instructions (rule 5).
 *
 * SIWE-scoped + same-origin, like the evidence upload route. A wallet that hasn't
 * linked GitHub gets an honest 409 (never a fabricated result — rule 1).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    const json = (await req.json().catch(() => null)) as unknown;
    const input = githubImportInput.parse(json);

    const evidence = await importGithubActivity(wallet, {
      goalId: input.goalId,
      ...(input.checkInId !== undefined ? { checkInId: input.checkInId } : {}),
      ...(input.since !== undefined ? { since: input.since } : {}),
    });

    const body: EvidenceResult = {
      id: evidence.id,
      goalId: evidence.goalId,
      type: evidence.type,
      contentHash: evidence.contentHash,
      sizeBytes: evidence.sizeBytes ?? 0,
      mimeType: evidence.mimeType ?? null,
      fileName: evidence.fileName ?? null,
      createdAt: evidence.createdAt.toISOString(),
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    if (err instanceof ConnectorNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
