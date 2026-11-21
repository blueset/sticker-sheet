import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFileSync, hashBytes, readManifestFrom, webpSibling, writeManifestAtomic } from "./optimize-assets.ts";

describe("webpSibling", () => {
  it("returns the .webp path next to a PNG when that file exists", () => {
    expect(webpSibling("/stickers/yurucom.png", new Set(["/stickers/yurucom.webp"]))).toBe(
      "/stickers/yurucom.webp",
    );
  });

  it("returns null for an SVG, even when the SVG itself is in the set", () => {
    expect(webpSibling("/stickers/gif.svg", new Set(["/stickers/gif.svg"]))).toBeNull();
  });

  it("returns null when the PNG has no .webp sibling", () => {
    expect(webpSibling("/stickers/earth.png", new Set(["/stickers/yurucom.webp"]))).toBeNull();
  });

  it("matches the extension case-insensitively and keeps dots in the stem", () => {
    expect(webpSibling("/stickers/a.b.PNG", new Set(["/stickers/a.b.webp"]))).toBe("/stickers/a.b.webp");
  });
});

// `processFile`'s settle step writes the manifest entry (atomically) *before* the optimised bytes
// replace the only copy of a file on disk, in that order, and both writes themselves go through
// `atomicWriteFileSync` (temp file + rename). These tests exercise that exact sequence on a scratch
// directory to pin down the crash-safety property the review flagged: a process killed at any point
// must leave either (old file + old/absent entry) or (new file + new entry) on disk, never a new,
// already-optimised file with no entry recording that it is no longer the original.
describe("manifest/disk crash safety", () => {
  const root = path.resolve(import.meta.dirname, ".crash-safety-tmp");

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function scratch(name: string): { target: string; manifestPath: string } {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    return { target: path.join(dir, "sticker.svg"), manifestPath: path.join(dir, "optimized-assets.json") };
  }

  it("a full settle (manifest written, then file written) makes a rerun treat the file as already settled", () => {
    const { target, manifestPath } = scratch("settled");
    fs.writeFileSync(target, "ORIGINAL");
    const optimised = Buffer.from("OPTIMISED");
    const expected = hashBytes(optimised);

    writeManifestAtomic(manifestPath, { "sticker.svg": expected });
    atomicWriteFileSync(target, optimised);

    const onDisk = fs.readFileSync(target);
    expect(onDisk.equals(optimised)).toBe(true);
    // The "up to date" check in processFile() is `manifest[file] === hashOf(current on-disk bytes)`.
    // It matches here, so a rerun skips the file instead of reprocessing an already-settled asset.
    expect(readManifestFrom(manifestPath)["sticker.svg"]).toBe(hashBytes(onDisk));
  });

  it("a crash right after the output write (before the run ends) is still a settled, consistent pair", () => {
    const { target, manifestPath } = scratch("crash-after-output-write");
    fs.writeFileSync(target, "ORIGINAL");
    const optimised = Buffer.from("OPTIMISED");
    const expected = hashBytes(optimised);

    expect(() => {
      writeManifestAtomic(manifestPath, { "sticker.svg": expected });
      atomicWriteFileSync(target, optimised);
      throw new Error("simulated crash between the output write and the end of the run");
    }).toThrow();

    // Because the manifest was persisted before the output write, there is no window after the
    // output write where the pairing can be wrong: the crash here changes nothing about the
    // invariant below.
    const onDisk = fs.readFileSync(target);
    expect(onDisk.equals(optimised)).toBe(true);
    expect(readManifestFrom(manifestPath)["sticker.svg"]).toBe(hashBytes(onDisk));
  });

  it("a crash between the manifest write and the output write leaves the true original on disk and forces a reprocess, never a skip", () => {
    const { target, manifestPath } = scratch("crash-before-output-write");
    const original = Buffer.from("ORIGINAL");
    fs.writeFileSync(target, original);
    const optimised = Buffer.from("OPTIMISED");
    const expected = hashBytes(optimised);

    expect(() => {
      writeManifestAtomic(manifestPath, { "sticker.svg": expected });
      throw new Error("simulated crash before the output write runs");
      // atomicWriteFileSync(target, optimised); // never reached
    }).toThrow();

    const onDisk = fs.readFileSync(target);
    // No corruption: the only copy of the file is untouched by the interrupted write.
    expect(onDisk.equals(original)).toBe(true);
    // The manifest now disagrees with what's on disk, so the next run's "up to date" check fails
    // and the file is reprocessed from its real, unmodified original - never skipped, and never
    // mistaken for an already-optimised file.
    expect(readManifestFrom(manifestPath)["sticker.svg"]).not.toBe(hashBytes(onDisk));
  });

  it("regression guard: writing the file before the manifest (the pre-fix order) loses the original and hides it from the next run", () => {
    const { target, manifestPath } = scratch("old-order-regression");
    const original = Buffer.from("ORIGINAL");
    fs.writeFileSync(target, original);
    const optimised = Buffer.from("OPTIMISED");

    expect(() => {
      // The pre-fix order: the output write (an SVG's only copy, overwritten in place) happens
      // first, and the manifest is only persisted once the whole run finishes.
      atomicWriteFileSync(target, optimised);
      throw new Error("simulated crash before the manifest write runs");
      // writeManifestAtomic(manifestPath, { "sticker.svg": hashBytes(optimised) }); // never reached
    }).toThrow();

    const onDisk = fs.readFileSync(target);
    // This is exactly the bug: the true original is gone, and the manifest has no record that
    // `onDisk` is already-optimised output rather than source material, so the next run's
    // "up to date" check fails and the optimiser reprocesses already-optimised bytes as if they
    // were the original input - the lossy, non-fixpoint drift the review reported.
    expect(onDisk.equals(optimised)).toBe(true);
    expect(onDisk.equals(original)).toBe(false);
    expect(readManifestFrom(manifestPath)["sticker.svg"]).toBeUndefined();
  });
});
