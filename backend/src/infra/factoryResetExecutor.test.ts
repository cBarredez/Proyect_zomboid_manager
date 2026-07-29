import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FactoryResetExecutor } from "./factoryResetExecutor.js";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pz-reset-"));
}

describe("FactoryResetExecutor", () => {
  it("has no pending reset by default", async () => {
    const dir = await tempDir();
    try {
      const executor = new FactoryResetExecutor(path.join(dir, "marker.json"), [dir]);
      expect(await executor.hasPendingReset()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a marker on prepare and reports it as pending", async () => {
    const dir = await tempDir();
    try {
      const executor = new FactoryResetExecutor(path.join(dir, "marker.json"), [dir]);
      await executor.prepare();
      expect(await executor.hasPendingReset()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("wipes persistent roots and clears the marker on executePending", async () => {
    const dir = await tempDir();
    try {
      const root = path.join(dir, "data");
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "keep-me-out.txt"), "hello", "utf-8");

      const markerPath = path.join(root, "marker.json");
      const executor = new FactoryResetExecutor(markerPath, [root]);
      await executor.prepare();
      await executor.executePending();

      await expect(readFile(path.join(root, "keep-me-out.txt"), "utf-8")).rejects.toThrow();
      expect(await executor.hasPendingReset()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when no marker exists", async () => {
    const dir = await tempDir();
    try {
      const root = path.join(dir, "data");
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "safe.txt"), "hello", "utf-8");

      const executor = new FactoryResetExecutor(path.join(root, "marker.json"), [root]);
      await executor.executePending();

      expect(await readFile(path.join(root, "safe.txt"), "utf-8")).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to operate on a filesystem root", async () => {
    const dir = await tempDir();
    try {
      const markerPath = path.join(dir, "marker.json");
      const fsRoot = path.parse(dir).root;
      const executor = new FactoryResetExecutor(markerPath, [fsRoot]);
      await executor.prepare();
      await expect(executor.executePending()).rejects.toThrow(/refusing/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
