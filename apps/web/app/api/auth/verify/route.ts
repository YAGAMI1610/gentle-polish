import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getExpectedDomain } from "@/lib/auth/origin";
import { UnauthorizedError, toHttpError } from "@/lib/auth/errors";
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

    await ensureWallet(address);
    session.address = address;
    session.chainId = chainId;
    // Consume the nonce so the same signature can never be replayed.
    delete session.nonce;
    await session.save();

    return NextResponse.json({ address });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
