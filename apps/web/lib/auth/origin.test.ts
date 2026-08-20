import { describe, expect, it } from "vitest";
import { ForbiddenError } from "./errors";
import { assertSameOrigin, isSameOrigin } from "./origin";

const SELF = "http://localhost:3000";

describe("same-origin / CSRF defence", () => {
  it("allows non-state-changing methods regardless of Origin", () => {
    expect(isSameOrigin({ method: "GET", url: `${SELF}/api/goals`, origin: null })).toBe(true);
    expect(
      isSameOrigin({ method: "HEAD", url: `${SELF}/api/goals`, origin: "https://evil.example" }),
    ).toBe(true);
  });

  it("allows same-origin state-changing requests", () => {
    expect(isSameOrigin({ method: "POST", url: `${SELF}/api/goals`, origin: SELF })).toBe(true);
    expect(isSameOrigin({ method: "DELETE", url: `${SELF}/api/goals/1`, origin: SELF })).toBe(true);
  });

  it("rejects cross-origin state-changing requests", () => {
    expect(
      isSameOrigin({ method: "POST", url: `${SELF}/api/goals`, origin: "https://evil.example" }),
    ).toBe(false);
  });

  it("rejects a state-changing request with no Origin header (fetch strips it cross-site)", () => {
    expect(isSameOrigin({ method: "POST", url: `${SELF}/api/goals`, origin: null })).toBe(false);
  });

  it("rejects a malformed Origin", () => {
    expect(isSameOrigin({ method: "POST", url: `${SELF}/api/goals`, origin: "not-a-url" })).toBe(
      false,
    );
  });

  it("assertSameOrigin throws ForbiddenError on a forged Origin", () => {
    const req = new Request(`${SELF}/api/goals`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(req)).toThrow(ForbiddenError);
  });

  it("assertSameOrigin passes a genuine same-origin request", () => {
    const req = new Request(`${SELF}/api/goals`, { method: "POST", headers: { origin: SELF } });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });
});
