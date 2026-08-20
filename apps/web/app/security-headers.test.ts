import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

/**
 * Security response headers — regression guard for the live-audit finding that the
 * deployment (https://commitai-bot.vercel.app) returned only HSTS: no anti-clickjacking,
 * no nosniff, no referrer policy. For a wallet-signing dApp the anti-frame pair is the
 * important one (a hostile page framing us to trick a signature), so pin it here.
 */
describe("next.config security headers", () => {
  it("declares clickjacking + hardening headers for every route", async () => {
    const headersFn = nextConfig.headers;
    expect(typeof headersFn).toBe("function");
    if (typeof headersFn !== "function") return;

    const rules = await headersFn();
    const rule = rules.find((r) => r.source === "/:path*");
    expect(rule).toBeDefined();
    if (!rule) return;

    const byKey = new Map(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
    // Anti-clickjacking — the core finding for a signing app.
    expect(byKey.get("x-frame-options")).toBe("DENY");
    expect(byKey.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // Companion hardening headers.
    expect(byKey.get("x-content-type-options")).toBe("nosniff");
    expect(byKey.get("referrer-policy")).toBeTruthy();
    expect(byKey.get("permissions-policy")).toBeTruthy();
  });
});
