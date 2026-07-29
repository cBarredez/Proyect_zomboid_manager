import { create as tarCreate, extract as tarExtract } from "tar";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export type BackupReason = "manual" | "scheduled" | "pre-mod-change" | "pre-update" | "pre-restore" | "pre-world-reset";

export interface BackupInfo {
  id: string;
  reason: BackupReason;
  createdAt: string;
  sizeBytes: number;
}

const REASON_PATTERN = "manual|scheduled|pre-mod-change|pre-update|pre-restore|pre-world-reset";
const FILENAME_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)__(${REASON_PATTERN})\\.tar\\.gz$`);
const ID_RE = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z__(${REASON_PATTERN})$`);

/**
 * Snapshots the Zomboid data dir (saves + server config) as a gzipped tar,
 * mirroring the "world backups" feature found in every mature PZ server
 * manager. Filenames double as the sole source of truth for id/reason/time
 * (no separate index file to fall out of sync with the directory contents).
 */
export class BackupManager {
  constructor(
    private readonly backupsDir: string,
    private readonly sourceDir: string,
    private readonly retainScheduledCount: number,
  ) {}

  async list(): Promise<BackupInfo[]> {
    await mkdir(this.backupsDir, { recursive: true });
    const entries = await readdir(this.backupsDir);
    const infos: BackupInfo[] = [];

    for (const entry of entries) {
      const match = FILENAME_RE.exec(entry);
      if (!match) continue;
      const [, ts, reason] = match;
      const info = await stat(path.join(this.backupsDir, entry));
      infos.push({
        id: entry.replace(/\.tar\.gz$/, ""),
        reason: reason as BackupReason,
        createdAt: filenameTimestampToIso(ts),
        sizeBytes: info.size,
      });
    }

    return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(reason: BackupReason): Promise<BackupInfo> {
    await mkdir(this.backupsDir, { recursive: true });
    await mkdir(this.sourceDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}__${reason}.tar.gz`;
    const filePath = path.join(this.backupsDir, filename);

    await tarCreate(
      { gzip: true, file: filePath, cwd: path.dirname(this.sourceDir) },
      [path.basename(this.sourceDir)],
    );

    if (reason === "scheduled") {
      await this.pruneScheduled();
    }

    const stats = await stat(filePath);
    return {
      id: filename.replace(/\.tar\.gz$/, ""),
      reason,
      createdAt: filenameTimestampToIso(ts),
      sizeBytes: stats.size,
    };
  }

  async restore(id: string): Promise<void> {
    const filePath = this.resolveBackupPath(id);
    await tarExtract({ file: filePath, cwd: path.dirname(this.sourceDir) });
  }

  async delete(id: string): Promise<void> {
    const filePath = this.resolveBackupPath(id);
    await rm(filePath, { force: true });
  }

  private resolveBackupPath(id: string): string {
    if (!ID_RE.test(id)) throw new Error("invalid backup id");
    return path.join(this.backupsDir, `${id}.tar.gz`);
  }

  private async pruneScheduled(): Promise<void> {
    const scheduled = (await this.list()).filter((b) => b.reason === "scheduled");
    const excess = scheduled.slice(this.retainScheduledCount);
    for (const backup of excess) {
      await this.delete(backup.id);
    }
  }
}

function filenameTimestampToIso(ts: string): string {
  return ts.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z");
}
