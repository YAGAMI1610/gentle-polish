/**
 * S3 evidence-storage configuration — honest resolution, secret kept separate.
 *
 * Follows the same contract as `lib/chain/config.ts`: when the S3 driver is
 * selected, every required setting must resolve or we throw loudly (a
 * misconfiguration must fail fast, never silently fall back). The access key and
 * secret are read by a dedicated function so they never ride inside a config object
 * that might be logged (money-safety hygiene, though this key only moves blobs, not
 * funds — rules 1/3).
 */

export interface S3StorageConfig {
  readonly bucket: string;
  readonly region: string;
  /** Full origin, e.g. `https://s3.us-east-1.amazonaws.com` or a Supabase/R2/MinIO endpoint. */
  readonly endpoint: string;
  /** Path-style (`endpoint/bucket/key`) vs virtual-hosted (`bucket.host/key`). */
  readonly forcePathStyle: boolean;
  /** Optional key prefix inside the bucket (no leading/trailing slash). */
  readonly prefix?: string;
}

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export type StorageEnv = Record<string, string | undefined>;

function required(env: StorageEnv, key: string): string {
  const raw = env[key]?.trim();
  if (!raw) {
    throw new Error(
      `EVIDENCE_STORAGE_DRIVER="s3" requires ${key} — set it or use the "local" driver (see LIMITATIONS.md §13).`,
    );
  }
  return raw;
}

/**
 * Resolve the S3 driver config from the environment. Throws if a required value is
 * missing. The endpoint defaults to AWS's regional host when unset; a custom
 * endpoint (Supabase/R2/MinIO) implies path-style addressing unless overridden.
 */
export function readS3StorageConfig(env: StorageEnv): S3StorageConfig {
  const bucket = required(env, "EVIDENCE_S3_BUCKET");
  const region = required(env, "EVIDENCE_S3_REGION");

  const explicitEndpoint = env["EVIDENCE_S3_ENDPOINT"]?.trim();
  const endpoint = explicitEndpoint || `https://s3.${region}.amazonaws.com`;
  // Validate the endpoint is a real absolute URL (fail loud on a typo).
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`EVIDENCE_S3_ENDPOINT is not a valid URL: ${endpoint}`);
  }

  const forcePathStyleRaw = env["EVIDENCE_S3_FORCE_PATH_STYLE"]?.trim().toLowerCase();
  const forcePathStyle =
    forcePathStyleRaw === "true"
      ? true
      : forcePathStyleRaw === "false"
        ? false
        : // Default: custom endpoints (Supabase/R2/MinIO) want path-style; AWS uses virtual-hosted.
          Boolean(explicitEndpoint);

  const prefix = env["EVIDENCE_S3_PREFIX"]?.trim().replace(/^\/+|\/+$/g, "");

  return {
    bucket,
    region,
    endpoint: endpoint.replace(/\/+$/, ""),
    forcePathStyle,
    ...(prefix ? { prefix } : {}),
  };
}

/** Read the S3 credentials, separately from the config object. Throws if incomplete. */
export function readS3Credentials(env: StorageEnv): S3Credentials {
  return {
    accessKeyId: required(env, "EVIDENCE_S3_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "EVIDENCE_S3_SECRET_ACCESS_KEY"),
  };
}
