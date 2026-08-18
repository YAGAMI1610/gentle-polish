import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WalletScopeError, CommitmentTermsLockedError } from "@/lib/db/errors";
import { BadRequestError, ForbiddenError, UnauthorizedError, toHttpError } from "./errors";

describe("toHttpError", () => {
  it("maps UnauthorizedError to 401 and preserves its message", () => {
    const r = toHttpError(new UnauthorizedError("connect your wallet"));
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("connect your wallet");
  });

  it("maps ForbiddenError to 403", () => {
    expect(toHttpError(new ForbiddenError()).status).toBe(403);
  });

  it("maps WalletScopeError to a NON-leaking 403", () => {
    // A scope violation must not reveal whether the resource exists.
    const r = toHttpError(new WalletScopeError());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("forbidden");
    expect(r.body.error).not.toContain("wallet");
  });

  it("maps a locked-terms conflict to 409, not a 500", () => {
    // Re-creating terms for an already-anchored goal is a client conflict, not a
    // server fault: it must surface as 409 so the caller does not blindly retry.
    const r = toHttpError(new CommitmentTermsLockedError());
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already has an on-chain commitment/);
  });

  it("maps BadRequestError and ZodError to 400", () => {
    expect(toHttpError(new BadRequestError()).status).toBe(400);
    const parsed = z.object({ a: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(toHttpError(parsed.error).status).toBe(400);
    }
  });

  it("maps unknown errors to a generic 500 with no internal detail", () => {
    const r = toHttpError(new Error("boom: secret internal detail"));
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("internal error");
    expect(r.body.error).not.toContain("secret");
  });
});
