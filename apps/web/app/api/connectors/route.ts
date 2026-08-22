import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { requireWallet } from "@/lib/auth/session";
import { isGithubConnectorConfigured } from "@/lib/connectors/config";
import { listConnectors } from "@/lib/db";
import type { ConnectorsResponse } from "@/lib/api/dto";

/**
 * GET /api/connectors (LIMITATIONS item 8) — the wallet's linked evidence
 * connectors plus which providers are actually configured for a live OAuth flow.
 * The UI uses `configured` to decide whether the Connect button is live or stays
 * honestly disabled, and `connections` to show the linked account. Never returns
 * any token material (the repo's status type has none).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    const connections = await listConnectors(wallet);
    const body: ConnectorsResponse = {
      configured: { github: isGithubConnectorConfigured() },
      connections: connections.map((c) => ({
        provider: c.provider,
        externalLogin: c.externalLogin,
        scope: c.scope,
        connectedAt: c.connectedAt.toISOString(),
      })),
    };
    return NextResponse.json(body);
  } catch (err) {
    const { status, body } = toHttpError(err, "api/connectors");
    return NextResponse.json(body, { status });
  }
}
