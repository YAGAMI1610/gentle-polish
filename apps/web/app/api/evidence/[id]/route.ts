import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { readEvidenceBlob } from "@/lib/evidence/storeEvidence";

/**
 * GET /api/evidence/[id] — stream the raw blob behind a piece of evidence, scoped
 * to the owner (build step 9, phase 3). `readEvidenceBlob` returns null for a blob
 * that is absent, not this wallet's, OR a text-only claim — all indistinguishable,
 * so a caller can never probe another wallet's evidence (§13 cross-wallet non-leak).
 *
 * The bytes are UNTRUSTED user content, served from our own origin, so we harden
 * against stored-XSS: `Content-Disposition: attachment` (never render inline — a
 * `text/html` upload would otherwise execute in-origin) and `nosniff`.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const wallet = await requireWallet();
    const { id } = await ctx.params;

    const blob = await readEvidenceBlob(wallet, id);
    if (!blob) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Copy into a fresh Uint8Array so the body is a plain ArrayBufferView.
    const bytes = new Uint8Array(blob.bytes);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": blob.mimeType ?? "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const { status, body } = toHttpError(err, "api/evidence/[id]");
    return NextResponse.json(body, { status });
  }
}
