import { create as tarCreate, extract as tarExtract } from "tar";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type BackupReason = "manual" | "scheduled" | "pre-mod-change" | "pre-update" | "pre-restore" | "pre-world-reset";

export interface BackupInfo {
  id: string;
  reason: BackupReason;
  createdAt: string;
  sizeBytes: number;
}

export interface BackupManagerOptions {
  backupsDir: string;
  sourceDir: string;
  retainScheduledCount: number;
  /** Retention count applied per-reason to every automatic "pre-*" safety snapshot (pre-mod-change, pre-update, pre-restore, pre-world-reset). "manual" backups are never auto-pruned — they're a deliberate user choice to keep, not a transient safety net. */
  retainOtherCount: number;
  /** Best-effort hook run before every backup, e.g. an RCON `save` so the snapshot isn't taken mid-write. A failure here (server not running, RCON unreachable) never blocks the backup itself — a slightly-stale snapshot beats no snapshot. */
  beforeCreate?: () => Promise<void>;
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
  constructor(private readonly opts: BackupManagerOptions) {}

  async list(): Promise<BackupInfo[]> {
    await mkdir(this.opts.backupsDir, { recursive: true });
    const entries = await readdir(this.opts.backupsDir);
    const infos: BackupInfo[] = [];

    for (const entry of entries) {
      const match = FILENAME_RE.exec(entry);
      if (!match) continue;
      const [, ts, reason] = match;
      const info = await stat(path.join(this.opts.backupsDir, entry));
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
    await mkdir(this.opts.backupsDir, { recursive: true });
    await mkdir(this.opts.sourceDir, { recursive: true });

    if (this.opts.beforeCreate) {
      await this.opts.beforeCreate().catch(() => {
        // best-effort — see BackupManagerOptions.beforeCreate doc comment
      });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}__${reason}.tar.gz`;
    const filePath = path.join(this.opts.backupsDir, filename);

    await this.createArchiveDeprioritized(filePath);

    await this.pruneReason(reason);

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
    await tarExtract({ file: filePath, cwd: path.dirname(this.opts.sourceDir) });
  }

  async delete(id: string): Promise<void> {
    const filePath = this.resolveBackupPath(id);
    await rm(filePath, { force: true });
  }

  private resolveBackupPath(id: string): string {
    if (!ID_RE.test(id)) throw new Error("invalid backup id");
    return path.join(this.opts.backupsDir, `${id}.tar.gz`);
  }

  /**
   * A full backup is a multi-GB gzip pass competing for CPU against the
   * sibling Java game process in the same container — there's no separate
   * cgroup between them. Lowers this process's OS scheduling priority for
   * the duration of the archive so the OS scheduler favors the game process
   * under contention, restoring it afterward regardless of outcome. Not
   * every platform/container setup permits changing priority (e.g. some
   * restricted sandboxes) — that's fine, the backup still proceeds at
   * normal priority if so. Also uses a low gzip level: these are already
   * mostly-dense binary save-game chunks where higher compression buys
   * little, so trading a bit of archive size for materially less CPU is a
   * good trade specifically for this contention problem.
   */
  private async createArchiveDeprioritized(filePath: string): Promise<void> {
    let restorePriority: number | null = null;
    try {
      restorePriority = os.getPriority();
      os.setPriority(os.constants.priority.PRIORITY_LOW);
    } catch {
      restorePriority = null;
    }
    try {
      await tarCreate(
        { gzip: { level: 1 }, file: filePath, cwd: path.dirname(this.opts.sourceDir) },
        [path.basename(this.opts.sourceDir)],
      );
    } finally {
      if (restorePriority !== null) {
        try {
          os.setPriority(restorePriority);
        } catch {
          // already best-effort — nothing else to do if this fails too
        }
      }
    }
  }

  private async pruneReason(reason: BackupReason): Promise<void> {
    // "manual" is a deliberate user choice to keep — never auto-pruned.
    if (reason === "manual") return;
    const retainCount = reason === "scheduled" ? this.opts.retainScheduledCount : this.opts.retainOtherCount;
    const matching = (await this.list()).filter((b) => b.reason === reason);
    const excess = matching.slice(retainCount);
    for (const backup of excess) {
      await this.delete(backup.id);
    }
  }
}

function filenameTimestampToIso(ts: string): string {
  return ts.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z");
}
