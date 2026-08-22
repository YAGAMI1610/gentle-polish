import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getExpectedDomain } from "@/lib/auth/origin";
import { ServiceUnavailableError, UnauthorizedError, toHttpError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { verifySiwe } from "@/lib/auth/siwe";
import { ensureWallet } from "@/lib/db";

/**
 * Complete SIWE sign-in (build step 9). Verifies the signature against the
 * session's one-time nonce and the expected domain, upserts the wallet, then
 * stores the verified address in the session and consumes the nonce (anti-replay).
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const session = await getSession();
    const expectedNonce = session.nonce;
    if (!expectedNonce) {
      throw new UnauthorizedError("no sign-in in progress — request a nonce first");
    }

    const { message, signature } = bodySchema.parse(await req.json().catch(() => ({})));
    const { address, chainId } = await verifySiwe({
      message,
      signature,
      nonce: expectedNonce,
      domain: getExpectedDomain(req),
    });

    // Past this line the signature is cryptographically valid — the wallet DID sign.
    // Persisting the wallet row and saving the session are INFRASTRUCTURE steps
    // (Prisma + cookie). If they fail (database unreachable, migrations not applied),
    // that is NOT an auth rejection: surface a LOGGED 503 ("temporarily unavailable"),
    // not a silent generic 500 that RainbowKit renders identically to "your signature
    // was rejected" — the very thing that made a valid sign-in look like a signing
    // failure. See LIMITATIONS.md §25.
    try {
      await ensureWallet(address);
      session.address = address;
      session.chainId = chainId;
      // Consume the nonce so the same signature can never be replayed.
      delete session.nonce;
      await session.save();
    } catch (persistErr) {
      console.error(
        "[auth/verify] signature verified but sign-in could not be completed (persist/session step):",
        persistErr,
      );
      throw new ServiceUnavailableError(
        "sign-in is temporarily unavailable — please try again shortly",
      );
    }

    return NextResponse.json({ address });
  } catch (err) {
    const { status, body } = toHttpError(err, "api/auth/verify");
    // 4xx are expected auth/client outcomes and stay quiet; a 500 here is genuinely
    // unexpected (e.g. a missing SESSION_PASSWORD breaking getSession), so log it so
    // it is diagnosable server-side instead of an opaque "internal error".
    if (status >= 500 && !(err instanceof ServiceUnavailableError)) {
      console.error("[auth/verify] unexpected failure:", err);
    }
    return NextResponse.json(body, { status });
  }
}
