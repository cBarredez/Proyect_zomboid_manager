import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface FactoryResetMarker {
  requestedAt: string;
  requestId: string;
}

/**
 * Two-phase factory reset, mirroring arma_server's FactoryResetExecutor: the
 * request handler only ever writes a marker file and triggers a process
 * restart. The actual wipe happens on the next boot, before anything else
 * opens the database, so a crash mid-wipe just retries on the following start.
 */
export class FactoryResetExecutor {
  constructor(
    private readonly markerPath: string,
    private readonly persistentRoots: string[],
  ) {}

  async prepare(): Promise<void> {
    const marker: FactoryResetMarker = {
      requestedAt: new Date().toISOString(),
      requestId: randomUUID(),
    };
    const tmpPath = `${this.markerPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(marker), "utf-8");
    await rename(tmpPath, this.markerPath);
  }

  async hasPendingReset(): Promise<boolean> {
    try {
      await readFile(this.markerPath, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  async executePending(): Promise<void> {
    if (!(await this.hasPendingReset())) return;

    for (const root of this.persistentRoots) {
      assertSafeRoot(root);
      await wipeDirectoryContents(root);
    }

    await rm(this.markerPath, { force: true });
  }
}

function assertSafeRoot(root: string): void {
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error(`refusing to wipe filesystem root: ${resolved}`);
  }
  if (resolved.split(path.sep).filter(Boolean).length < 2) {
    throw new Error(`refusing to wipe suspiciously shallow path: ${resolved}`);
  }
}

async function wipeDirectoryContents(dir: string, attempt = 1): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // directory doesn't exist yet, nothing to wipe
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    try {
      await rm(entryPath, { recursive: true, force: true });
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      await wipeDirectoryContents(dir, attempt + 1);
      return;
    }
  }
}
