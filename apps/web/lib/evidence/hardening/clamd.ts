/**
 * ClamAV (`clamd`) malware scanner over its real INSTREAM wire protocol
 * (LIMITATIONS §13, item 10). No SDK, no shelling out to `clamscan` — a direct TCP
 * client, the same "implement the real protocol" approach as the S3 SigV4 signer.
 *
 * Protocol (clamd's `zINSTREAM`, as documented in clamd(8)):
 *   → `zINSTREAM\0`
 *   → repeated `<uint32 BE length><chunk bytes>`
 *   → `<uint32 BE 0>`               (end of stream)
 *   ← `stream: OK\0`                                  → clean
 *   ← `stream: Eicar-Test-Signature FOUND\0`          → infected
 *   ← `INSTREAM size limit exceeded. ERROR\0`         → no verdict
 *
 * FAIL-CLOSED: anything that is not an explicit OK/FOUND verdict (refused
 * connection, timeout, `ERROR`, unparsable reply) throws
 * `EvidenceScanUnavailableError`, so a configured-but-broken scanner refuses the
 * upload instead of quietly letting it through unscanned (rule 1).
 */
import { connect, type Socket } from "node:net";
import { EvidenceScanUnavailableError } from "../errors";
import type { MalwareScanTarget, MalwareScanVerdict, MalwareScanner } from "./scanner";

export interface ClamdConfig {
  readonly host: string;
  readonly port: number;
  /** Whole-scan deadline: connect, stream, and read the verdict. */
  readonly timeoutMs: number;
  /** INSTREAM chunk size; clamd's own limit is `StreamMaxLength`. */
  readonly chunkBytes?: number;
}

const DEFAULT_CHUNK_BYTES = 64 * 1024;

/** Parse a clamd reply into a verdict, or throw if it is not a verdict at all. */
export function parseClamdReply(reply: string): MalwareScanVerdict {
  const line = reply.replace(/\0+$/, "").trim();
  if (/\bOK$/.test(line)) return { clean: true, scanner: "clamd" };
  const found = /^(?:.*?:\s*)?(.+?)\s+FOUND$/.exec(line);
  if (found) {
    const signature = found[1]?.trim();
    if (signature) return { clean: false, scanner: "clamd", signature };
  }
  throw new EvidenceScanUnavailableError("clamd", `unexpected reply ${JSON.stringify(line)}`);
}

/** Encode one INSTREAM frame: a big-endian uint32 length followed by the chunk. */
function frame(chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + chunk.byteLength);
  const length = chunk.byteLength;
  out[0] = (length >>> 24) & 0xff;
  out[1] = (length >>> 16) & 0xff;
  out[2] = (length >>> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(chunk, 4);
  return out;
}

export class ClamdScanner implements MalwareScanner {
  readonly name = "clamd";
  private readonly config: ClamdConfig;

  constructor(config: ClamdConfig) {
    this.config = config;
  }

  async scan(target: MalwareScanTarget): Promise<MalwareScanVerdict> {
    const { host, port, timeoutMs } = this.config;
    const chunkBytes = this.config.chunkBytes ?? DEFAULT_CHUNK_BYTES;

    const reply = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      const socket: Socket = connect({ host, port });

      const fail = (detail: string): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new EvidenceScanUnavailableError("clamd", detail));
      };

      const timer = setTimeout(() => fail(`timed out after ${timeoutMs}ms`), timeoutMs);
      timer.unref?.();

      socket.setTimeout(timeoutMs, () => fail(`socket idle for ${timeoutMs}ms`));
      socket.on("error", (err: Error) => fail(err.message));

      socket.on("connect", () => {
        void (async () => {
          try {
            await write(socket, Buffer.from("zINSTREAM\0", "latin1"));
            for (let offset = 0; offset < target.bytes.byteLength; offset += chunkBytes) {
              const slice = target.bytes.subarray(offset, offset + chunkBytes);
              await write(socket, Buffer.from(frame(slice)));
            }
            // Zero-length frame = end of stream; clamd answers, then closes.
            await write(socket, Buffer.from([0, 0, 0, 0]));
          } catch (err) {
            fail(err instanceof Error ? err.message : "write failed");
          }
        })();
      });

      socket.on("data", (data: Buffer) => {
        chunks.push(data);
        // clamd terminates its answer with a NUL (z-command) or a newline.
        const text = Buffer.concat(chunks).toString("latin1");
        if (text.includes("\0") || text.includes("\n")) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.end();
          resolve(text);
        }
      });

      socket.on("close", () => {
        clearTimeout(timer);
        if (settled) return;
        const text = Buffer.concat(chunks).toString("latin1");
        if (text.trim().length > 0) {
          settled = true;
          resolve(text);
          return;
        }
        fail("connection closed before a verdict was returned");
      });
    });

    return parseClamdReply(reply);
  }
}

/** Write with backpressure — resolves once the chunk is flushed. */
function write(socket: Socket, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ok = socket.write(data, (err) => {
      if (err) reject(err);
      else if (ok) resolve();
    });
    if (!ok) socket.once("drain", () => resolve());
  });
}
