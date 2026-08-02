import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BackupManager, type BackupManagerOptions } from "./backupManager.js";

async function tempDirs(): Promise<{ root: string; backupsDir: string; sourceDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "pz-backup-"));
  const backupsDir = path.join(root, "backups");
  const sourceDir = path.join(root, "data");
  await mkdir(sourceDir, { recursive: true });
  return { root, backupsDir, sourceDir };
}

function makeManager(backupsDir: string, sourceDir: string, overrides: Partial<BackupManagerOptions> = {}): BackupManager {
  return new BackupManager({
    backupsDir,
    sourceDir,
    retainScheduledCount: 10,
    retainOtherCount: 5,
    ...overrides,
  });
}

describe("BackupManager", () => {
  it("creates a backup and lists it", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      await writeFile(path.join(sourceDir, "save.txt"), "hello world", "utf-8");
      const manager = makeManager(backupsDir, sourceDir);

      const info = await manager.create("manual");
      expect(info.reason).toBe("manual");

      const list = await manager.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(info.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores file contents from a backup", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const filePath = path.join(sourceDir, "save.txt");
      await writeFile(filePath, "original content", "utf-8");
      const manager = makeManager(backupsDir, sourceDir);
      const info = await manager.create("manual");

      await writeFile(filePath, "corrupted content", "utf-8");
      await manager.restore(info.id);

      expect(await readFile(filePath, "utf-8")).toBe("original content");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes a backup", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const manager = makeManager(backupsDir, sourceDir);
      const info = await manager.create("manual");
      await manager.delete(info.id);
      expect(await manager.list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a malformed backup id (path traversal guard)", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const manager = makeManager(backupsDir, sourceDir);
      await expect(manager.restore("../../etc/passwd")).rejects.toThrow(/invalid backup id/);
      await expect(manager.delete("../../etc/passwd")).rejects.toThrow(/invalid backup id/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes scheduled backups beyond retainScheduledCount, keeping manual ones", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const manager = makeManager(backupsDir, sourceDir, { retainScheduledCount: 2 });

      await manager.create("manual");
      for (let i = 0; i < 4; i++) {
        await manager.create("scheduled");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const list = await manager.list();
      const scheduled = list.filter((b) => b.reason === "scheduled");
      const manual = list.filter((b) => b.reason === "manual");

      expect(scheduled).toHaveLength(2);
      expect(manual).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes every pre-* safety-snapshot reason independently down to retainOtherCount", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const manager = makeManager(backupsDir, sourceDir, { retainOtherCount: 2 });

      for (let i = 0; i < 4; i++) {
        await manager.create("pre-mod-change");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      for (let i = 0; i < 3; i++) {
        await manager.create("pre-update");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const list = await manager.list();
      expect(list.filter((b) => b.reason === "pre-mod-change")).toHaveLength(2);
      expect(list.filter((b) => b.reason === "pre-update")).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never auto-prunes manual backups, no matter how many accumulate", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const manager = makeManager(backupsDir, sourceDir, { retainOtherCount: 1, retainScheduledCount: 1 });

      for (let i = 0; i < 5; i++) {
        await manager.create("manual");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(await manager.list()).toHaveLength(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("calls beforeCreate before archiving, and still creates the backup if it rejects", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const order: string[] = [];
      const beforeCreate = vi.fn(async () => {
        order.push("beforeCreate");
      });
      const manager = makeManager(backupsDir, sourceDir, { beforeCreate });

      await manager.create("manual");
      expect(beforeCreate).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["beforeCreate"]);

      const failingManager = makeManager(backupsDir, sourceDir, {
        beforeCreate: () => Promise.reject(new Error("rcon unreachable")),
      });
      const info = await failingManager.create("manual");
      expect(info.reason).toBe("manual");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
