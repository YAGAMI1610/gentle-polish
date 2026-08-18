/**
 * `EvidenceStorage` — the off-chain blob boundary (build-prompt §1/§2, §9).
 *
 * Raw evidence (photos, screenshots, files, documents) lives OFF-chain only. This
 * interface is the single seam through which those bytes are written and read; the
 * database keeps a pointer (`storageKey`) and a `contentHash`, and ONLY the hash is
 * ever eligible to be anchored on-chain (§9/§10). Nothing here ever touches the
 * chain, and no method returns a value that could move funds.
 *
 * Two drivers are anticipated (§1): the real local-disk driver shipped now, and an
 * S3-compatible bucket later. Business logic depends only on this interface, so
 * swapping the driver is a config change (see `./index.ts`), never a code change in
 * the evidence pipeline.
 */

/** Bytes to store, plus the metadata the caller knows about them. */
export interface EvidencePutInput {
  /** Authenticated owner. Storage keys are namespaced by this so blobs are isolated per wallet. */
  readonly walletAddress: string;
  /** The raw evidence bytes. Never logged, never sent to a model, never anchored on-chain. */
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
  readonly fileName?: string;
}

/** What a successful `put` records — exactly the on-chain-safe fields the DB row needs. */
export interface EvidencePutResult {
  /** Opaque pointer to the stored blob. Off-chain only; NEVER anchored on-chain. */
  readonly storageKey: string;
  /** sha256 of the bytes, 64 lowercase hex. The ONLY part eligible for on-chain anchoring. */
  readonly contentHash: string;
  readonly sizeBytes: number;
}

/** A retrieved blob. Scoping is enforced above this layer, before a key is ever handed in. */
export interface EvidenceBlob {
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
}

export interface EvidenceStorage {
  /**
   * Persist bytes off-chain and return the pointer + content hash. Implementations
   * are content-addressed: identical bytes for the same wallet resolve to the same
   * key (idempotent), so re-submitting the same evidence never duplicates a blob.
   */
  put(input: EvidencePutInput): Promise<EvidencePutResult>;

  /** Read a blob back by its storage key, or null if no blob exists at that key. */
  get(storageKey: string): Promise<EvidenceBlob | null>;

  /** Remove a blob. Idempotent: deleting a missing key is not an error. */
  delete(storageKey: string): Promise<void>;
}
