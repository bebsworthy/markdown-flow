import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSidecarStream } from "../../src/core/sidecar.js";
import { SidecarNotFoundError } from "../../src/core/errors.js";

describe("getSidecarStream", () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), "markflow-sidecar-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  async function makeOutputDir(): Promise<string> {
    const outDir = join(runDir, "output");
    await mkdir(outDir, { recursive: true });
    return outDir;
  }

  it("happy path: reads stdout sidecar content", async () => {
    const outDir = await makeOutputDir();
    await writeFile(join(outDir, "0042-mystep.stdout.log"), "hello");

    const stream = await getSidecarStream(runDir, 42, "stdout");
    const text = await new Response(stream).text();
    expect(text).toBe("hello");
  });

  it("happy path: reads stderr sidecar content", async () => {
    const outDir = await makeOutputDir();
    await writeFile(join(outDir, "0042-mystep.stderr.log"), "boom");

    const stream = await getSidecarStream(runDir, 42, "stderr");
    const text = await new Response(stream).text();
    expect(text).toBe("boom");
  });

  it("zero-pads seq to 4 digits (small seq)", async () => {
    const outDir = await makeOutputDir();
    await writeFile(join(outDir, "0007-build.stdout.log"), "seven");

    const stream = await getSidecarStream(runDir, 7, "stdout");
    const text = await new Response(stream).text();
    expect(text).toBe("seven");
  });

  it("handles four-digit seq without over-padding", async () => {
    const outDir = await makeOutputDir();
    await writeFile(join(outDir, "9999-tail.stdout.log"), "max");

    const stream = await getSidecarStream(runDir, 9999, "stdout");
    const text = await new Response(stream).text();
    expect(text).toBe("max");
  });

  it("throws SidecarNotFoundError when output directory is missing", async () => {
    // Note: runDir exists but no output/ subdirectory
    await expect(
      getSidecarStream(runDir, 1, "stdout"),
    ).rejects.toBeInstanceOf(SidecarNotFoundError);

    try {
      await getSidecarStream(runDir, 1, "stdout");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SidecarNotFoundError);
      const e = err as SidecarNotFoundError;
      expect(e.runDir).toBe(runDir);
      expect(e.seq).toBe(1);
      expect(e.stream).toBe("stdout");
    }
  });

  it("throws SidecarNotFoundError when file is missing but output dir exists", async () => {
    await makeOutputDir();
    // no files written

    try {
      await getSidecarStream(runDir, 5, "stderr");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SidecarNotFoundError);
      const e = err as SidecarNotFoundError;
      expect(e.runDir).toBe(runDir);
      expect(e.seq).toBe(5);
      expect(e.stream).toBe("stderr");
    }
  });

  it("preserves binary content byte-for-byte", async () => {
    const outDir = await makeOutputDir();
    const bytes = new Uint8Array([0x00, 0xff, 0x7f]);
    await writeFile(join(outDir, "0001-bin.stdout.log"), bytes);

    const stream = await getSidecarStream(runDir, 1, "stdout");
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(0x00);
    expect(buf[1]).toBe(0xff);
    expect(buf[2]).toBe(0x7f);
  });

  it("streams a 1 MB file successfully", async () => {
    const outDir = await makeOutputDir();
    const size = 1024 * 1024;
    const payload = new Uint8Array(size);
    payload.fill(0x61); // 'a'
    await writeFile(join(outDir, "0100-big.stdout.log"), payload);

    const stream = await getSidecarStream(runDir, 100, "stdout");
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(buf.length).toBe(size);
  });

  it("throws SidecarNotFoundError on seq prefix collision", async () => {
    const outDir = await makeOutputDir();
    await writeFile(join(outDir, "0042-alpha.stdout.log"), "a");
    await writeFile(join(outDir, "0042-beta.stdout.log"), "b");

    try {
      await getSidecarStream(runDir, 42, "stdout");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SidecarNotFoundError);
      const e = err as SidecarNotFoundError;
      expect(e.message).toMatch(/collision/i);
      expect(e.seq).toBe(42);
      expect(e.stream).toBe("stdout");
    }
  });
});
