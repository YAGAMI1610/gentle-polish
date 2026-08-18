import { NextResponse } from "next/server";
import { EvidenceType } from "@prisma/client";
import {
  toHttpError,
  BadRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import {
  storeEvidence,
  isAllowedEvidenceMime,
  MAX_EVIDENCE_BYTES,
  type StoreEvidenceArgs,
} from "@/lib/evidence/storeEvidence";
import type { EvidenceResult } from "@/lib/api/dto";

/**
 * POST /api/evidence — the §11 public upload entry point (build step 9, phase 3).
 *
 * SIWE-scoped because evidence is wallet-owned (the only money-safe reading of
 * "public"): `requireWallet` + `assertSameOrigin`, and `storeEvidence` /
 * `createEvidence` enforce that the target goal/check-in is this wallet's
 * (`WalletScopeError` → 403). The uploaded bytes/text are UNTRUSTED (rule 5) —
 * hashed and stored off-chain, never interpreted as instructions.
 *
 * Boundary hardening (§13, malicious upload): oversize → 413 and disallowed MIME
 * → 415 are refused HERE, before `storeEvidence`, reusing its one allowlist
 * (`isAllowedEvidenceMime`). A coarse Content-Length pre-check bails before the
 * body is buffered; `storeEvidence` still enforces the precise limit internally.
 */
export const dynamic = "force-dynamic";

/** Read a form field as a non-empty string, or undefined. */
function field(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new UnsupportedMediaTypeError("evidence upload must be multipart/form-data");
    }

    // Coarse early-out: reject an obviously-oversized upload by declared length
    // before buffering it (memory-exhaustion defence). +1MB slack for the
    // multipart envelope; the exact per-file limit is enforced on decoded bytes.
    const declaredLen = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLen) && declaredLen > MAX_EVIDENCE_BYTES + 1024 * 1024) {
      throw new PayloadTooLargeError(`evidence exceeds ${MAX_EVIDENCE_BYTES} byte limit`);
    }

    const form = await req.formData();
    const goalId = field(form.get("goalId"));
    const typeRaw = field(form.get("type"));
    const checkInId = field(form.get("checkInId"));
    const contentText = field(form.get("contentText"));
    const fileEntry = form.get("file");
    const hasFile = fileEntry instanceof Blob && fileEntry.size > 0;

    if (goalId === undefined || typeRaw === undefined) {
      throw new BadRequestError("evidence requires `goalId` and `type`");
    }
    if (hasFile === (contentText !== undefined)) {
      throw new BadRequestError("provide exactly one of `file` (binary) or `contentText` (text)");
    }

    // `type` is validated against EvidenceType by storeEvidence's zod parse.
    const base = {
      goalId,
      type: typeRaw as EvidenceType,
      ...(checkInId !== undefined ? { checkInId } : {}),
    };

    let args: StoreEvidenceArgs;
    if (hasFile) {
      const blob = fileEntry as Blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Precise boundary size check (§13) before any storage work.
      if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
        throw new PayloadTooLargeError(`evidence exceeds ${MAX_EVIDENCE_BYTES} byte limit`);
      }
      const mimeType =
        field(form.get("mimeType")) ?? (blob.type.length > 0 ? blob.type : undefined);
      if (!isAllowedEvidenceMime(mimeType)) {
        throw new UnsupportedMediaTypeError(`evidence MIME type not allowed: ${mimeType}`);
      }
      const nameFromFile = "name" in blob ? String((blob as File).name) : "";
      const fileName =
        field(form.get("fileName")) ?? (nameFromFile.length > 0 ? nameFromFile : undefined);
      args = {
        ...base,
        bytes,
        ...(mimeType !== undefined ? { mimeType } : {}),
        ...(fileName !== undefined ? { fileName } : {}),
      };
    } else {
      args = { ...base, contentText: contentText as string };
    }

    const evidence = await storeEvidence(wallet, args);
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
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
