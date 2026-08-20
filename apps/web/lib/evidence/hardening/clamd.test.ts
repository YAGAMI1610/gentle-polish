import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceScanUnavailableError } from "../errors";
import { ClamdScanner, parseClamdReply } from "./clamd";

/**
 * clamd client tests (LIMITATIONS §13, item 10).
 *
 * The client speaks a real wire protocol, so it is tested against a real TCP server
 * on loopback that decodes `zINSTREAM` exactly as clamd(8) specifies — not a mocked
 * `scan()`. Each test asserts on what the server actually received (command, frame
 * lengths, reassembled payload), which is the only way to know the framing is right.
 *
 * Note: no EICAR string is committed here. The infected path is driven by the
 * server replying `... FOUND`, which is what the client actually parses; embedding a
 * real AV test signature in the repo would just get the file quarantined by
 * developers' own scanners.
 */

interface FakeClamd {
  readonly port: number;
  /** Everything the client sent, per connection, decoded from the INSTREAM framing. */
  readonly sessions: DecodedSession[];
  close(): Promise<void>;
}

interface DecodedSession {
  command: string;
  frameLengths: number[];
  payload: Buffer;
  terminated: boolean;
}

type Reply = { kind: "reply"; text: string } | { kind: "close" } | { kind: "hang" };

/** A loopback server that decodes zINSTREAM for real, then answers as scripted. */
async function startFakeClamd(reply: Reply): Promise<FakeClamd> {
  const sessions: DecodedSession[] = [];

  const server: Server = createServer((socket: Socket) => {
    const session: DecodedSession = {
      command: "",
      frameLengths: [],
      payload: Buffer.alloc(0),
      terminated: false,
    };
    sessions.push(session);
    let buffer = Buffer.alloc(0);
    let commandRead = false;

    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      if (!commandRead) {
        const nul = buffer.indexOf(0x00);
        if (nul === -1) return;
        session.command = buffer.subarray(0, nul).toString("latin1");
        buffer = buffer.subarray(nul + 1);
        commandRead = true;
      }

      // <uint32 BE length><chunk>… then a zero-length frame.
      while (buffer.byteLength >= 4 && !session.terminated) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          session.terminated = true;
          buffer = buffer.subarray(4);
          break;
        }
        if (buffer.byteLength < 4 + length) return;
        session.frameLengths.push(length);
        session.payload = Buffer.concat([session.payload, buffer.subarray(4, 4 + length)]);
        buffer = buffer.subarray(4 + length);
      }

      if (!session.terminated) return;
      if (reply.kind === "reply") socket.end(Buffer.from(reply.text, "latin1"));
      else if (reply.kind === "close") socket.end();
      // "hang": accept the stream and never answer, to exercise the timeout.
    });
    socket.on("error", () => {
      /* client-side destroy during fail-closed paths is expected */
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  return {
    port: address.port,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

let running: FakeClamd | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

// Generous deadline on purpose: these cases assert the *protocol* against the loopback fake,
// so the timeout must never be the thing that decides them (a 2s budget flaked under a fully
// loaded suite in the PRoot sandbox). The two tests that assert timeout behaviour build their
// own scanners with explicit short deadlines below.
const scannerFor = (port: number, chunkBytes?: number): ClamdScanner =>
  new ClamdScanner({
    host: "127.0.0.1",
    port,
    timeoutMs: 30_000,
    ...(chunkBytes === undefined ? {} : { chunkBytes }),
  });

describe("parseClamdReply", () => {
  it("reads a clean verdict from clamd's real OK replies", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ clean: true, scanner: "clamd" });
    expect(parseClamdReply("stream: OK\n")).toEqual({ clean: true, scanner: "clamd" });
  });

  it("extracts the signature name from a FOUND reply", () => {
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({
      clean: false,
      scanner: "clamd",
      signature: "Win.Test.EICAR_HDB-1",
    });
  });

  it("fails closed on ERROR and on anything unparsable", () => {
    expect(() => parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toThrow(
      EvidenceScanUnavailableError,
    );
    expect(() => parseClamdReply("")).toThrow(EvidenceScanUnavailableError);
    expect(() => parseClamdReply("what?")).toThrow(/scan unavailable \(clamd\): unexpected reply/);
  });
});

describe("ClamdScanner — against a real loopback socket", () => {
  it("sends zINSTREAM, the framed payload and a zero-length terminator", async () => {
    running = await startFakeClamd({ kind: "reply", text: "stream: OK\0" });
    const bytes = new Uint8Array(Buffer.from("harmless evidence bytes", "utf8"));

    const verdict = await scannerFor(running.port).scan({ bytes, fileName: "proof.png" });

    expect(verdict).toEqual({ clean: true, scanner: "clamd" });
    expect(running.sessions).toHaveLength(1);
    const session = running.sessions[0];
    expect(session?.command).toBe("zINSTREAM");
    expect(session?.terminated).toBe(true);
    expect(session?.frameLengths).toEqual([bytes.byteLength]);
    // The server reassembled exactly the bytes we handed the scanner.
    expect(session?.payload.toString("utf8")).toBe("harmless evidence bytes");
  });

  it("splits a large payload into chunk-sized frames that reassemble byte-exactly", async () => {
    running = await startFakeClamd({ kind: "reply", text: "stream: OK\0" });
    // 200 KiB of non-repeating bytes at a 64 KiB chunk size: 3 full frames + a tail.
    const bytes = new Uint8Array(200 * 1024);
    for (let i = 0; i < bytes.byteLength; i += 1) bytes[i] = (i * 7 + (i >> 8)) & 0xff;

    await scannerFor(running.port, 64 * 1024).scan({ bytes });

    const session = running.sessions[0];
    expect(session?.frameLengths).toEqual([65536, 65536, 65536, 200 * 1024 - 3 * 65536]);
    expect(
      createHash("sha256")
        .update(session?.payload ?? Buffer.alloc(0))
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("reports the signature name when clamd answers FOUND", async () => {
    running = await startFakeClamd({ kind: "reply", text: "stream: Unix.Trojan.Test-1 FOUND\0" });

    await expect(
      scannerFor(running.port).scan({ bytes: new Uint8Array([1, 2, 3]) }),
    ).resolves.toEqual({ clean: false, scanner: "clamd", signature: "Unix.Trojan.Test-1" });
  });

  it("fails closed when clamd answers ERROR", async () => {
    running = await startFakeClamd({
      kind: "reply",
      text: "INSTREAM size limit exceeded. ERROR\0",
    });

    await expect(
      scannerFor(running.port).scan({ bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toBeInstanceOf(EvidenceScanUnavailableError);
  });

  it("fails closed when the connection drops before a verdict", async () => {
    running = await startFakeClamd({ kind: "close" });

    await expect(
      scannerFor(running.port).scan({ bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/closed before a verdict/);
  });

  it("fails closed when clamd accepts the stream but never answers", async () => {
    running = await startFakeClamd({ kind: "hang" });
    const scanner = new ClamdScanner({ host: "127.0.0.1", port: running.port, timeoutMs: 150 });

    await expect(scanner.scan({ bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(
      /timed out after 150ms|idle for 150ms/,
    );
  });

  it("fails closed when nothing is listening (a broken scanner blocks the upload)", async () => {
    // Bind then immediately release a port, so the address is real but unserved.
    const probe = await startFakeClamd({ kind: "reply", text: "stream: OK\0" });
    const deadPort = probe.port;
    await probe.close();

    const error = await new ClamdScanner({ host: "127.0.0.1", port: deadPort, timeoutMs: 1_000 })
      .scan({ bytes: new Uint8Array([1, 2, 3]) })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(EvidenceScanUnavailableError);
    expect((error as EvidenceScanUnavailableError).scanner).toBe("clamd");
  });
});
