import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { SidecarNotFoundError } from "./errors.js";

/**
 * Resolve the sidecar transcript file for a single step execution and return
 * a Web `ReadableStream` of its bytes.
 *
 * The canonical on-disk name is
 *   `<runDir>/output/<seqPadded4>-<nodeId>.<stream>.log`
 *
 * where `seqPadded4 = String(seq).padStart(4, "0")` and `nodeId` is the
 * graph node id of the executing step. Because `seq` is monotonic per run,
 * exactly one file per run matches a given `(seq, stream)` tuple — so this
 * resolver discovers `nodeId` by scanning `output/` for a single entry with
 * the zero-padded seq prefix and the given stream suffix.
 *
 * @param runDir absolute path to a run directory (e.g. `runs/20260416-…/`),
 *   NOT the parent `runs/` directory.
 * @param seq the `seq` of the owning `step:start` event.
 * @param stream which transcript to open.
 * @returns a Web `ReadableStream<Uint8Array>` over the file contents. Backed
 *   by a Node `fs.ReadStream`; cancelling the returned stream destroys the
 *   underlying Node stream (handled by `Readable.toWeb`).
 * @throws {SidecarNotFoundError} when `output/` does not exist, no file
 *   matches the seq prefix, or multiple files collide on the same prefix.
 *   All other fs errors propagate.
 */
export async function getSidecarStream(
  runDir: string,
  seq: number,
  stream: "stdout" | "stderr",
): Promise<ReadableStream<Uint8Array>> {
  const seqStr = String(seq).padStart(4, "0");
  const outputDir = join(runDir, "output");
  const suffix = `.${stream}.log`;

  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new SidecarNotFoundError(
        runDir,
        seq,
        stream,
        "output directory does not exist",
      );
    }
    throw err;
  }

  const prefix = `${seqStr}-`;
  const matches = entries.filter(
    (name) =>
      name.startsWith(prefix) &&
      name.endsWith(suffix) &&
      name.length > prefix.length + suffix.length,
  );

  if (matches.length === 0) {
    throw new SidecarNotFoundError(
      runDir,
      seq,
      stream,
      `no file matches ${prefix}*${suffix}`,
    );
  }
  if (matches.length > 1) {
    throw new SidecarNotFoundError(
      runDir,
      seq,
      stream,
      `collision: multiple files match ${prefix}*${suffix} (${matches.join(", ")})`,
    );
  }

  const sidecarPath = join(outputDir, matches[0]!);
  const nodeStream = createReadStream(sidecarPath);
  // Readable.toWeb bridges Node → Web Streams (stable in Node 18+).
  // Cancelling the returned ReadableStream destroys the underlying Node
  // ReadStream — no manual wiring required.
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}
