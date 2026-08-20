import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { deleteConnector } from "@/lib/db";

/**
 * DELETE /api/connectors/github (LIMITATIONS item 8) — disconnect GitHub for the
 * signed-in wallet, deleting the stored (encrypted) token. SIWE-scoped +
 * same-origin; wallet-scoped in the repo so it can only ever remove the caller's
 * own connection. Idempotent: disconnecting when nothing is linked returns
 * `{disconnected: false}` rather than erroring.
 */
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    const removed = await deleteConnector(wallet, "GITHUB");
    return NextResponse.json({ disconnected: removed > 0 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
