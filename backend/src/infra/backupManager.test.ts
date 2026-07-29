import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BackupManager } from "./backupManager.js";

async function tempDirs(): Promise<{ root: string; backupsDir: string; sourceDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "pz-backup-"));
  const backupsDir = path.join(root, "backups");
  const sourceDir = path.join(root, "data");
  await mkdir(sourceDir, { recursive: true });
  return { root, backupsDir, sourceDir };
}

describe("BackupManager", () => {
  it("creates a backup and lists it", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      await writeFile(path.join(sourceDir, "save.txt"), "hello world", "utf-8");
      const manager = new BackupManager(backupsDir, sourceDir, 10);

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
      const manager = new BackupManager(backupsDir, sourceDir, 10);
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
      const manager = new BackupManager(backupsDir, sourceDir, 10);
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
      const manager = new BackupManager(backupsDir, sourceDir, 10);
      await expect(manager.restore("../../etc/passwd")).rejects.toThrow(/invalid backup id/);
      await expect(manager.delete("../../etc/passwd")).rejects.toThrow(/invalid backup id/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes scheduled backups beyond the retention count, keeping manual ones", async () => {
    const { root, backupsDir, sourceDir } = await tempDirs();
    try {
      const manager = new BackupManager(backupsDir, sourceDir, 2);

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
});
